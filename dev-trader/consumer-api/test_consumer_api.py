"""Adversarial API contracts: a hacked UI must never upgrade permissions."""
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi.testclient import TestClient
from app import app, require_identity
from access_policy import Tier
from auth import Principal

class ConsumerApiSecurityContract(unittest.TestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def test_public_catalog_is_not_billing_checkout(self):
        with TestClient(app) as client:
            r = client.get("/v1/catalog")
            self.assertEqual(r.status_code, 200)
            self.assertFalse(r.json()["billing_enabled"])
            self.assertIsNone(r.json()["checkout_url"])
            self.assertIn("no-store", r.headers["cache-control"])

    def test_anonymous_cannot_read_role_or_admin_data(self):
        with patch.dict(os.environ, {"KYVORIQ_CONSUMER_AUTH_ENABLED": "true"}):
            with TestClient(app) as client:
                self.assertEqual(client.get("/v1/me").status_code, 401)
                self.assertEqual(client.get("/v1/admin/overview").status_code, 401)
                self.assertEqual(client.get("/v1/access/advanced_insight_reports").status_code, 401)

    def test_auth_cannot_accidentally_activate_before_operator_enables(self):
        with patch.dict(os.environ, {"KYVORIQ_CONSUMER_AUTH_ENABLED": "false"}):
            with TestClient(app) as client:
                self.assertEqual(client.get("/v1/me").status_code, 503)
                self.assertEqual(client.get("/readyz").status_code, 503)
                self.assertFalse(client.get("/readyz").json()["consumer_login_live"])
                self.assertEqual(client.get("/livez").status_code, 200)
                self.assertEqual(client.get("/v1/catalog").status_code, 200)

    def test_modified_client_cannot_request_owner_features(self):
        app.dependency_overrides[require_identity] = lambda: Principal("consumer-1", True, False)
        with TestClient(app) as client:
            for feature in ("demo_trade_execution", "billing_override", "admin_access", "exchange_credentials"):
                self.assertEqual(client.get("/v1/access/" + feature).status_code, 403)
            self.assertEqual(client.get("/v1/admin/overview").status_code, 403)
            self.assertEqual(client.post("/v1/checkout").status_code, 503)

    def test_basic_cannot_access_paid_features_with_client_tier_header(self):
        app.dependency_overrides[require_identity] = lambda: Principal("consumer-1", True, False)
        with patch("app.authoritative_tier", return_value=Tier.BASIC):
            with TestClient(app) as client:
                for tier in ("ELITE", "ADMIN", "PRO"):
                    r = client.get("/v1/access/advanced_insight_reports",
                                   headers={"X-Tier": tier, "X-Admin": "true"})
                    self.assertEqual(r.status_code, 403)
                self.assertEqual(client.get("/v1/access/market_chart").status_code, 200)

    def test_pro_inherits_basic_but_not_elite(self):
        app.dependency_overrides[require_identity] = lambda: Principal("consumer-2", True, False)
        with patch("app.authoritative_tier", return_value=Tier.PRO):
            with TestClient(app) as client:
                self.assertEqual(client.get("/v1/access/confirmed_signal_alerts").status_code, 200)
                self.assertEqual(client.get("/v1/access/advanced_insight_reports").status_code, 403)

if __name__ == "__main__":
    unittest.main()
