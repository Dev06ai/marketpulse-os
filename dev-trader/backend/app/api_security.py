"""Server-side protection for KYVORIQ private API and WebSocket data.

The owner token is a SERVER secret. Never package this token inside an APK.
Before deploying, implement device-specific pairing with Android Keystore storage.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import time
from urllib.parse import urlsplit
from typing import Mapping


PUBLIC_GET_PATHS = frozenset({
    # Only price/availability and APK configuration: never expose private
    # accounts, strategy diagnostics, owner levels, or computational backtests.
    "/health", "/heartbeat", "/chart", "/app-config",
})
MAX_CLIENTS = 24
MAX_HTTP_BODY_BYTES = 65536
DEVICE_TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60
DEVICE_TOKEN_PATTERN = re.compile(r"^kvq\.v1\.(\d{10,11})\.([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$")


def owner_token() -> str | None:
    token = os.getenv("KYVORIQ_API_OWNER_TOKEN", "")
    # Weak/empty credentials must not silently create a public API.
    return token if len(token) >= 32 and not token.isspace() else None


def _sign_device_payload(payload: str, expected: str) -> str:
    sig = hmac.new(expected.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(sig).rstrip(b"=").decode("ascii")


def issue_device_token(expected: str, *, now: int | None = None) -> tuple[str, int]:
    """7-day revocable-by-master-rotation mobile credential, not an APK secret."""
    if not expected or len(expected) < 32:
        raise ValueError("Owner secret is not configured")
    expires = int(time.time() if now is None else now) + DEVICE_TOKEN_LIFETIME_SECONDS
    device_nonce = secrets.token_urlsafe(24)
    payload = f"v1.{expires}.{device_nonce}"
    return f"kvq.{payload}.{_sign_device_payload(payload, expected)}", expires


def verify_device_token(supplied: str, expected: str, *, now: int | None = None) -> bool:
    if not expected:
        return False
    match = DEVICE_TOKEN_PATTERN.fullmatch(supplied)
    if not match:
        return False
    expires = int(match.group(1))
    current = int(time.time() if now is None else now)
    if not current < expires <= current + DEVICE_TOKEN_LIFETIME_SECONDS:
        return False
    payload = f"v1.{expires}.{match.group(2)}"
    return hmac.compare_digest(match.group(3), _sign_device_payload(payload, expected))


def _compare_bearer(headers: Mapping[str, str], expected: str) -> bool:
    header = headers.get("authorization", "")
    if not header.startswith("Bearer "):
        return False
    supplied = header[7:]
    if not supplied or len(supplied) > 512:
        return False
    if supplied.startswith("kvq."):
        return verify_device_token(supplied, expected)
    return hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8"))


def private_http_error(method: str, path: str, headers: Mapping[str, str]) -> tuple[int, str] | None:
    """None allows request; otherwise return (HTTP status, generic reason)."""
    if (method.upper() in {"GET", "HEAD"} and path in PUBLIC_GET_PATHS) or (method.upper() == "POST" and path == "/auth/pair"):
        return None
    token = owner_token()
    if token is None:
        return (503, "Private API is not provisioned")
    if not _compare_bearer(headers, token):
        return (401, "Authentication required")
    return None


def websocket_error(headers: Mapping[str, str]) -> str | None:
    """Require auth AND reject cross-origin browser WebSocket connections."""
    origin = headers.get("origin", "").strip()
    if origin:
        try:
            parsed = urlsplit(origin)
        except ValueError:
            return "Unapproved WebSocket origin"
        host = headers.get("host", "").strip().lower()
        configured = {value.strip() for value in os.getenv("KYVORIQ_WS_ALLOWED_ORIGINS", "").split(",") if value.strip()}
        same_origin = (parsed.scheme == "https" and parsed.netloc.lower() == host)
        if origin not in configured and not same_origin:
            return "Unapproved WebSocket origin"
    token = owner_token()
    if token is None:
        return "Private API is not provisioned"
    if not _compare_bearer(headers, token):
        return "Authentication required"
    return None


def security_headers(is_private: bool) -> dict[str, str]:
    result = {
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    }
    if is_private:
        result["Cache-Control"] = "no-store, private"
    return result
