"""Release gate for distributed consumer API abuse limits."""
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fastapi.testclient import TestClient
from rate_limit import check_consumer_rate, opaque_ip_key, LimiterUnavailable
from app import app


class FakeRedis:
    def __init__(self, counts):
        self.counts = iter(counts)
        self.keys = []
    async def eval(self, script, count, key, period):
        self.keys.append(key)
        return [next(self.counts), period]


class AbuseProtectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_hidden_ip_keys_cannot_expose_ip(self):
        with patch.dict(os.environ, {"KYVORIQ_RATE_LIMIT_HMAC_KEY": "1"*48}):
            a = opaque_ip_key("192.0.2.1")
            b = opaque_ip_key("192.0.2.2")
            self.assertNotEqual(a, b)
            self.assertNotIn("192.0.2.1", a)
            self.assertEqual(a, opaque_ip_key("192.0.2.1"))

    async def test_atomic_ip_quota_and_hourly_quota(self):
        with patch.dict(os.environ, {"KYVORIQ_RATE_LIMIT_HMAC_KEY": "s"*48}):
            client = FakeRedis([120, 1200])
            with patch("rate_limit.configured_client", return_value=client):
                self.assertEqual(await check_consumer_rate("203.0.113.8"), (True, 0))
            self.assertEqual(len(client.keys), 2)
            self.assertIn(":60:", client.keys[0])
            self.assertIn(":3600:", client.keys[1])

    async def test_over_quota_rejected(self):
        with patch.dict(os.environ, {"KYVORIQ_RATE_LIMIT_HMAC_KEY": "s"*48}):
            with patch("rate_limit.configured_client", return_value=FakeRedis([121])):
                self.assertEqual(await check_consumer_rate("203.0.113.8"), (False, 60))

    async def test_missing_storage_fails_closed(self):
        with patch.dict(os.environ, {"KYVORIQ_CONSUMER_REDIS_URL": "",
                                      "KYVORIQ_RATE_LIMIT_HMAC_KEY": ""}):
            from rate_limit import configured_client
            configured_client.cache_clear()
            with self.assertRaises(LimiterUnavailable):
                await check_consumer_rate("192.0.2.1")

class MiddlewareTests(unittest.TestCase):
    def test_authenticated_surface_unavailable_without_distributed_redis(self):
        with patch.dict(os.environ, {"KYVORIQ_CONSUMER_OIDC_ISSUER": "https://id.example.test"}):
            with patch("app.check_consumer_rate", new=AsyncMock(side_effect=LimiterUnavailable)):
                with TestClient(app) as client:
                    response = client.get("/v1/me", headers={"Authorization": "Bearer anything"})
                    self.assertEqual(response.status_code, 503)

    def test_over_limit_returns_429_retry_after(self):
        with patch.dict(os.environ, {"KYVORIQ_CONSUMER_OIDC_ISSUER": "https://id.example.test"}):
            with patch("app.check_consumer_rate", new=AsyncMock(return_value=(False, 36))):
                with TestClient(app) as client:
                    response = client.get("/v1/me")
                    self.assertEqual(response.status_code, 429)
                    self.assertEqual(response.headers["retry-after"], "36")
                    self.assertEqual(response.headers["cache-control"], "no-store")

    def test_catalog_is_public_without_identity_runtime(self):
        with patch.dict(os.environ, {}, clear=True):
            with TestClient(app) as client:
                response = client.get("/v1/catalog")
                self.assertEqual(response.status_code, 200)
                self.assertFalse(response.json()["billing_enabled"])

if __name__ == "__main__":
    unittest.main()
