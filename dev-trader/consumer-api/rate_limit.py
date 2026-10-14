"""Distributed fail-closed rate limits for the separated consumer API.

Identity-provider login/signup/reset/OTP limits live at the managed provider.
This protects KYVORIQ's own authenticated API; a local Python dictionary
would not be safe across multiple workers or service instances.
"""
from __future__ import annotations

import hashlib
import hmac
import os
from functools import lru_cache
from urllib.parse import urlparse

import redis.asyncio as redis


class LimiterUnavailable(Exception):
    pass


@lru_cache(maxsize=1)
def configured_client():
    endpoint = os.getenv("KYVORIQ_CONSUMER_REDIS_URL", "")
    secret = os.getenv("KYVORIQ_RATE_LIMIT_HMAC_KEY", "")
    if len(secret.encode("utf-8")) < 32 or not endpoint:
        raise LimiterUnavailable("Consumer rate limiter not configured")
    parsed = urlparse(endpoint)
    if parsed.scheme != "rediss" or not parsed.hostname or parsed.fragment:
        raise LimiterUnavailable("Rate limiter requires encrypted rediss://")
    return redis.from_url(endpoint, decode_responses=True, socket_timeout=1.5,
                          socket_connect_timeout=1.5, health_check_interval=30)


def opaque_ip_key(ip: str) -> str:
    secret = os.getenv("KYVORIQ_RATE_LIMIT_HMAC_KEY", "")
    if len(secret.encode("utf-8")) < 32:
        raise LimiterUnavailable("No secure hash key")
    # No IP address or bearer token is stored in Redis keys.
    return hmac.new(secret.encode(), ip.encode(), hashlib.sha256).hexdigest()[:32]


# Atomic, distributed and self-expiring quota. An attacker cannot evade by
# sending a fake X-Forwarded-For (the trusted proxy MUST configure ASGI
# request.client.host from an allowlisted proxy at the server boundary).
_ATOMIC = """
local val = redis.call('INCR', KEYS[1])
if val == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {val, ttl}
"""


async def check_consumer_rate(client_ip: str) -> tuple[bool, int]:
    client = configured_client()
    digest = opaque_ip_key(client_ip or "unknown")
    try:
        # Global across all /v1 API routes. Reduce at ingress for high-risk
        # URLs and IdP password/OTP operations (not implemented here).
        for period, limit in ((60, 120), (3600, 1200)):
            key = f"kyvoriq:consumer:limit:{period}:{digest}"
            count, ttl = await client.eval(_ATOMIC, 1, key, period)
            if int(count) > limit:
                return False, max(1, int(ttl))
    except (redis.RedisError, ConnectionError, TimeoutError) as exc:
        raise LimiterUnavailable("Rate limiter unreachable") from exc
    return True, 0
