"""Offline tests for read-only deployment probe. No live endpoint requests."""
import importlib.util
import json
from pathlib import Path
from unittest.mock import patch
import io
import pytest

SPEC = importlib.util.spec_from_file_location("probe_public_deployment",
    Path(__file__).parent / "tools" / "probe_public_deployment.py")
assert SPEC and SPEC.loader
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)

SOURCE = "a" * 40
DIGEST = "b" * 64


def health(source=SOURCE, digest=DIGEST):
    return {"ok": True, "build": {"source_commit": source, "content_sha256": digest},
            "ws_connected": True, "data_health": "DEGRADED", "book_age_ms": 220,
            "trade_age_ms": 38000, "feed_channels": {
                "depth_subscription": "subscribe", "trades_subscription": "subscribe",
                "bounded_reconnects": 1, "critical_stall": "publicTrade_NO_FRESH_DATA",
            }}


def test_source_matching_but_stale_trade_is_not_marked_healthy():
    result = probe.summarize(health(), SOURCE, DIGEST)
    assert result["release"] == "TARGET_DEPLOYED"
    assert result["data_health"] == "DEGRADED"
    assert result["trade_age_ms"] == 38000
    assert "signal" not in result and "build" not in result


def test_old_release_is_distinguished_from_unattested_and_unknown():
    assert probe.summarize(health(probe.PREVIOUS_SOURCE), SOURCE, DIGEST)["release"] == "OLDER_RELEASE_STILL_ACTIVE"
    assert probe.summarize(health("invalid"), SOURCE, DIGEST)["release"] == "SOURCE_UNATTESTED"
    assert probe.summarize(health("c"*40), SOURCE, DIGEST)["release"] == "DIFFERENT_RELEASE"


def test_digest_mismatch_is_not_counted_as_current_release():
    x=probe.summarize(health(digest="c"*64),SOURCE,DIGEST)
    assert x["release"] == "DIFFERENT_RELEASE"
    assert not x["content_matches_target"]


@pytest.mark.parametrize("bad", [None, -1, True, float("nan"), float("inf"), "350"])
def test_invalid_book_age_is_not_treated_as_fresh(bad):
    x=health()
    x["book_age_ms"]=bad
    assert probe.summarize(x,SOURCE,DIGEST)["book_age_ms"] is None


def test_public_get_does_not_use_credentials_or_redirects(monkeypatch):
    captured=[]
    class Reply:
        def __enter__(self): return self
        def __exit__(self,*args): return False
        def read(self, n): return json.dumps(health()).encode()
    class FakeOpener:
        def open(self, req, timeout=None):
            captured.append((req.full_url,req.get_method(),req.header_items()))
            return Reply()
    monkeypatch.setattr(probe.urllib.request,"build_opener",lambda *args: FakeOpener())
    assert probe.read_health()["ok"] is True
    assert len(captured)==1
    url,method,headers=captured[0]
    assert url=="https://dev-trader-engine.de.deplexo.com/health"
    assert method=="GET"
    assert all("authorization" not in k.lower() for k,_ in headers)


@pytest.mark.parametrize("url",[
    "http://dev-trader-engine.de.deplexo.com/health",
    "https://evil.invalid/health",
    "https://dev-trader-engine.de.deplexo.com.evil.invalid/health",
    "https://dev-trader-engine.de.deplexo.com/health?token=test",
    "https://user:pw@dev-trader-engine.de.deplexo.com/health",
    "https://dev-trader-engine.de.deplexo.com/admin",
])
def test_probe_rejects_any_nonpublic_or_foreign_endpoint(url):
    with pytest.raises(ValueError):
        probe.read_health(url)


def test_network_failure_logs_error_type_only_not_remote_payload(monkeypatch,capsys):
    def boom():
        raise ValueError("secret QWERTY123 and private response")
    monkeypatch.setattr(probe,"read_health",boom)
    assert probe.run(SOURCE,DIGEST,count=1)==2
    out=capsys.readouterr().out
    assert "QWERTY123" not in out
    assert '"error_type": "ValueError"' in out


def test_probe_bounds_sample_interval():
    with pytest.raises(ValueError):
        probe.run(SOURCE,DIGEST,count=100)


def test_probe_confirms_only_exact_commit_and_digest(monkeypatch,capsys):
    monkeypatch.setattr(probe,"read_health",lambda: health())
    assert probe.run(SOURCE,DIGEST,count=1)==0
    result=capsys.readouterr().out
    assert '"attestation": "SOURCE_CONFIRMED"' in result
    assert '"safe_to_trade": false' in result


def test_http_200_old_release_is_observed_but_not_verified(monkeypatch,capsys):
    monkeypatch.setattr(probe,"read_health",lambda:health(probe.PREVIOUS_SOURCE))
    assert probe.run(SOURCE,DIGEST,count=1)==2
    result=capsys.readouterr().out
    assert "OLDER_RELEASE_STILL_ACTIVE" in result
    assert '"attestation": "NOT_VERIFIED"' in result


def test_http_error_never_reports_source_confirmation(monkeypatch,capsys):
    from urllib.error import HTTPError
    monkeypatch.setattr(probe,"read_health",lambda: (_ for _ in ()).throw(
        HTTPError(probe.PUBLIC_HEALTH,403,"Forbidden",{},None)))
    assert probe.run(SOURCE,DIGEST,count=1)==2
    output=capsys.readouterr().out
    assert '"http_status": 403' in output
    assert '"attestation": "NOT_VERIFIED"' in output
