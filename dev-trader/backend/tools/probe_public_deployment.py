"""Read-only deployed KYVORIQ public release and feed attestation.

Queries only the allowlisted public /health endpoint. No secret, account,
order, or control request. Never interprets healthy HTTP as permission to trade.
"""
from __future__ import annotations
import argparse
import json
import math
import re
import time
import urllib.parse
import urllib.request

HOST = "dev-trader-engine.de.deplexo.com"
PUBLIC_HEALTH = f"https://{HOST}/health"
MAX_BYTES = 16_384
PREVIOUS_SOURCE = "06402d83352f6665ef27c24691d3701b3fbd7a18"


def read_health(url: str = PUBLIC_HEALTH, timeout: float = 10.0) -> dict:
    parsed = urllib.parse.urlsplit(url)
    if (
        parsed.scheme != "https" or parsed.hostname != HOST or
        parsed.port not in (None, 443) or parsed.username or parsed.password
        or parsed.path != "/health" or parsed.query or parsed.fragment
    ):
        raise ValueError("probe only allows KYVORIQ public HTTPS /health")
    req = urllib.request.Request(
        PUBLIC_HEALTH,
        headers={"Accept": "application/json", "Cache-Control": "no-cache"},
        method="GET",
    )
    # Avoid redirects to a different host or path when observing deployment.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(NoRedirect())
    with opener.open(req, timeout=timeout) as response:
        raw = response.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("health response too large")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("health response is not an object")
    return data


def _age(value):
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        return None
    return round(float(value), 1)


def summarize(health: dict, expected_source: str, expected_digest: str) -> dict:
    build = health.get("build")
    if not isinstance(build, dict):
        build = {}
    source = build.get("source_commit")
    digest = build.get("content_sha256")
    if source == expected_source and digest == expected_digest:
        release = "TARGET_DEPLOYED"
    elif source == PREVIOUS_SOURCE:
        release = "OLDER_RELEASE_STILL_ACTIVE"
    elif not isinstance(source, str) or not re.fullmatch(r"[a-f0-9]{40}", source):
        release = "SOURCE_UNATTESTED"
    else:
        release = "DIFFERENT_RELEASE"
    feed = health.get("feed_channels")
    if not isinstance(feed, dict):
        feed = {}
    return {
        "reachable": health.get("ok") is True,
        "release": release,
        # This is already public build identity, not authentication material.
        "source_commit": source if isinstance(source, str) and re.fullmatch(r"[a-f0-9]{40}", source) else None,
        "content_matches_target": digest == expected_digest,
        "data_health": str(health.get("data_health") or "UNKNOWN")[:24],
        "ws_connected": health.get("ws_connected") is True,
        "book_age_ms": _age(health.get("book_age_ms")),
        "trade_age_ms": _age(health.get("trade_age_ms")),
        "depth_subscription": str(feed.get("depth_subscription") or "UNKNOWN")[:32],
        "trades_subscription": str(feed.get("trades_subscription") or "UNKNOWN")[:32],
        "critical_stall": str(feed.get("critical_stall") or "NONE")[:56],
        "bounded_reconnects": feed.get("bounded_reconnects")
          if type(feed.get("bounded_reconnects")) is int and 0 <= feed.get("bounded_reconnects") < 100_000 else None,
    }


def run(expected_source: str, expected_digest: str, count: int = 2, interval: int = 5) -> int:
    if not re.fullmatch(r"[a-f0-9]{40}", expected_source):
        raise ValueError("expected source must be 40 lowercase hex characters")
    if not re.fullmatch(r"[a-f0-9]{64}", expected_digest):
        raise ValueError("expected content digest must be 64 lowercase hex characters")
    if not (1 <= count <= 3 and 1 <= interval <= 15):
        raise ValueError("probe frequency outside safe bounds")
    for i in range(count):
        try:
            result = summarize(read_health(), expected_source, expected_digest)
            print(json.dumps({"sample": i+1, **result}, sort_keys=True), flush=True)
        except Exception as exc:
            # Do not print a remote response, token, redirect target, or URL.
            print(json.dumps({"sample": i+1, "reachable": False,
                              "error_type": type(exc).__name__}), flush=True)
        if i != count-1:
            time.sleep(interval)
    # Observation only: a mismatched version does not cause hidden deployment.
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--content-sha256", required=True)
    args = parser.parse_args(argv)
    return run(args.source, args.content_sha256)


if __name__ == "__main__":
    raise SystemExit(main())
