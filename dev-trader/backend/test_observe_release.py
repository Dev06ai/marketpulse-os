"""Offline regression tests for read-only KYVORIQ release monitoring."""
import io
import json
from unittest.mock import patch
import pytest
from tools.observe_release import classify, fetch_json, validate_origin

SOURCE = "a" * 40
DIGEST = "b" * 64


def sample(age=1000, status="HEALTHY"):
    return (
        {"ok": True, "build": {"source_commit": SOURCE, "content_sha256": DIGEST},
         "ws_connected": True, "data_health": status,
         "book_age_ms": age, "trade_age_ms": 100, "data_age_ms": 200},
        {"market_ws": True, "data_health": status, "ages_ms": {
            "book_ms": age + 100 if type(age) in (int, float) else age}},
    )


def test_verified_release_with_fresh_book():
    result = classify(*sample(), SOURCE, DIGEST)
    assert result["identity_ok"] is True
    assert result["book_fresh"] is True
    assert "access_token" not in result and "build" not in result


@pytest.mark.parametrize("age", [None, -100, "100", 5001, float("nan"), True])
def test_bad_or_unverifiable_book_age_is_never_fresh(age):
    assert classify(*sample(age), SOURCE, DIGEST)["book_fresh"] is False


def test_stale_disconnected_or_inconsistent_feed_cannot_pass():
    assert classify(*sample(status="DEGRADED"), SOURCE, DIGEST)["book_fresh"] is False
    health, hb = sample()
    hb["market_ws"] = False
    assert classify(health, hb, SOURCE, DIGEST)["book_fresh"] is False
    health, hb = sample()
    hb["data_health"] = "STALE"
    assert classify(health, hb, SOURCE, DIGEST)["book_fresh"] is False


def test_unhealthy_http_cannot_be_called_fresh():
    health, heartbeat = sample()
    health["ok"] = False
    assert classify(health, heartbeat, SOURCE, DIGEST)["book_fresh"] is False


def test_release_identity_mismatch_fails_closed():
    result = classify(*sample(), "c" * 40, DIGEST)
    assert result["identity_ok"] is False
    assert result["source_ok"] is False
    assert result["content_ok"] is True


@pytest.mark.parametrize("url", ["http://example.com", "https://u:p@example.com",
    "https://example.com/token", "https://example.com?a=1", "https://example.com#frag", "https://"])
def test_only_bare_https_origin_is_accepted(url):
    with pytest.raises(ValueError):
        validate_origin(url)
    assert validate_origin("https://example.com/") == "https://example.com"


def test_network_probe_uses_only_get_and_no_auth_header():
    requests = []
    def fake_open(request, timeout):
        requests.append((request.full_url, request.get_method(), request.header_items()))
        return io.BytesIO(json.dumps({"ok": True}).encode())
    with patch("urllib.request.urlopen", fake_open):
        assert fetch_json("https://example.com", "/health") == {"ok": True}
    assert requests[0][0] == "https://example.com/health"
    assert requests[0][1] == "GET"
    assert not any(k.lower() == "authorization" for k, _ in requests[0][2])
