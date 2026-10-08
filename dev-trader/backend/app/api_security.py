"""Server-side protection for KYVORIQ private API and WebSocket data.

The owner token is a SERVER secret. Never package this token inside an APK.
Before deploying, implement device-specific pairing with Android Keystore storage.
"""
from __future__ import annotations

import hmac
import os
from urllib.parse import urlsplit
from typing import Mapping


PUBLIC_GET_PATHS = frozenset({
    "/health", "/heartbeat", "/chart", "/features", "/app-config",
    "/level-pack", "/config", "/risk", "/backtest/recent",
})
MAX_CLIENTS = 24
MAX_HTTP_BODY_BYTES = 65536


def owner_token() -> str | None:
    token = os.getenv("KYVORIQ_API_OWNER_TOKEN", "")
    # Weak/empty credentials must not silently create a public API.
    return token if len(token) >= 32 and not token.isspace() else None


def _compare_bearer(headers: Mapping[str, str], expected: str) -> bool:
    header = headers.get("authorization", "")
    if not header.startswith("Bearer "):
        return False
    supplied = header[7:]
    if not supplied or len(supplied) > 512:
        return False
    return hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8"))


def private_http_error(method: str, path: str, headers: Mapping[str, str]) -> tuple[int, str] | None:
    """None allows request; otherwise return (HTTP status, generic reason)."""
    if method.upper() in {"GET", "HEAD"} and path in PUBLIC_GET_PATHS:
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
