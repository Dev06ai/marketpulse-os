"""Read-only KYVORIQ post-release soak probe. Uses only public GET /health and /heartbeat.

Example:
  python tools/observe_release.py --url https://dev-trader-engine.de.deplexo.com \
    --source-commit <source-from-CI-manifest> --content-sha256 <digest-from-CI-manifest> \
    --samples 30 --interval 10 --out soak.jsonl

Never submits orders or credentials, and does not loosen admission freshness limits.
HEALTHY observations are not proof of profitable trading or protected fills.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import time
import urllib.parse
import urllib.request

MAX_RESPONSE_BYTES = 64 * 1024
MAX_BOOK_AGE_MS = 5000  # Observation only; preserve the execution hard gate.


def safe_age(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value < 0:
        return None
    return round(float(value), 1)


def classify(health: dict, heartbeat: dict, expected_commit: str, expected_digest: str) -> dict:
    """Return only non-secret release and feed observations."""
    build = health.get("build") if isinstance(health.get("build"), dict) else {}
    ages = heartbeat.get("ages_ms") if isinstance(heartbeat.get("ages_ms"), dict) else {}
    book_age = safe_age(health.get("book_age_ms"))
    heartbeat_book_age = safe_age(ages.get("book_ms"))
    consistent = health.get("data_health") == heartbeat.get("data_health")
    connected = health.get("ws_connected") is True and heartbeat.get("market_ws") is True
    fresh = (
        health.get("ok") is True and connected and consistent and health.get("data_health") == "HEALTHY"
        and book_age is not None and heartbeat_book_age is not None
        and book_age <= MAX_BOOK_AGE_MS and heartbeat_book_age <= MAX_BOOK_AGE_MS
    )
    source_ok = build.get("source_commit") == expected_commit
    digest_ok = build.get("content_sha256") == expected_digest
    return {
        "identity_ok": source_ok and digest_ok,
        "source_ok": source_ok,
        "content_ok": digest_ok,
        "health_ok": health.get("ok") is True,
        "data_health": str(health.get("data_health") or "UNKNOWN")[:24],
        "feed_connected": connected,
        "feed_consistent": consistent,
        "book_fresh": bool(fresh),
        "book_age_ms": book_age,
        "heartbeat_book_age_ms": heartbeat_book_age,
        "data_age_ms": safe_age(health.get("data_age_ms")),
        "trade_age_ms": safe_age(health.get("trade_age_ms")),
    }


def fetch_json(origin: str, route: str, timeout: float = 8) -> dict:
    request = urllib.request.Request(
        origin + route, headers={"Accept": "application/json", "Cache-Control": "no-cache"}, method="GET"
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read(MAX_RESPONSE_BYTES + 1)
    if len(body) > MAX_RESPONSE_BYTES:
        raise ValueError("health response exceeded size limit")
    result = json.loads(body)
    if not isinstance(result, dict):
        raise ValueError("health response is not a JSON object")
    return result


def validate_origin(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path not in ("", "/")):
        raise ValueError("Only a bare https://host URL is permitted")
    return value.rstrip("/")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--content-sha256", required=True)
    parser.add_argument("--samples", type=int, default=30)
    parser.add_argument("--interval", type=float, default=10)
    parser.add_argument("--out", type=Path, help="append non-sensitive samples as JSONL")
    args = parser.parse_args(argv)
    try:
        origin = validate_origin(args.url)
    except ValueError as exc:
        parser.error(str(exc))
    if not (1 <= args.samples <= 120 and 1 <= args.interval <= 60):
        parser.error("samples must be 1..120 and interval 1..60 seconds")
    if len(args.source_commit) != 40 or any(c not in "0123456789abcdef" for c in args.source_commit.lower()):
        parser.error("source commit must be 40 hex characters")
    if len(args.content_sha256) != 64 or any(c not in "0123456789abcdef" for c in args.content_sha256.lower()):
        parser.error("digest must be 64 hex characters")
    output = args.out.open("a", encoding="utf-8") if args.out else None
    errors = bad_identity = fresh_count = 0
    try:
        for i in range(args.samples):
            result = {"sample": i + 1, "observed_at_ms": int(time.time() * 1000)}
            try:
                health = fetch_json(origin, "/health")
                heartbeat = fetch_json(origin, "/heartbeat")
                result.update(classify(health, heartbeat, args.source_commit, args.content_sha256))
                bad_identity += not result["identity_ok"]
                fresh_count += result["book_fresh"]
            except (OSError, ValueError) as exc:
                errors += 1
                result["error_type"] = type(exc).__name__  # Do not log payloads, URLs or credentials.
            line = json.dumps(result, sort_keys=True)
            print(line, flush=True)
            if output:
                output.write(line + "\n")
                output.flush()
            if i + 1 < args.samples:
                time.sleep(args.interval)
    finally:
        if output:
            output.close()
    print(json.dumps({
        "samples": args.samples, "fresh_book_samples": fresh_count,
        "identity_mismatches": bad_identity, "transport_errors": errors,
        "note": "read-only observations, not demo fills or performance evidence",
    }))
    return 2 if bad_identity else (1 if errors else 0)


if __name__ == "__main__":
    raise SystemExit(main())
