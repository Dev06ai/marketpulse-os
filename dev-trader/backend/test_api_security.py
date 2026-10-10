"""Dependency-free, network-free security contract tests for the private API."""
import os
import unittest
from unittest.mock import patch

from app.api_security import (
    private_http_error, websocket_error, security_headers,
    owner_token, PUBLIC_GET_PATHS, MAX_CLIENTS,
    issue_device_token, verify_device_token,
)


class PrivateApiSecurityTests(unittest.TestCase):
    def test_owner_secret_is_required_for_private_http(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(private_http_error("GET", "/trades", {}), (503, "Private API is not provisioned"))
            self.assertEqual(private_http_error("POST", "/system-check/push", {}), (503, "Private API is not provisioned"))
            self.assertIsNone(private_http_error("GET", "/chart", {}))

    def test_short_and_blank_tokens_cannot_enable_private_api(self):
        for secret in ("", "guessme", " " * 40):
            with self.subTest(secret=repr(secret[:8])), patch.dict(os.environ, {"KYVORIQ_API_OWNER_TOKEN": secret}, clear=True):
                self.assertIsNone(owner_token())
                self.assertIsNotNone(private_http_error("GET", "/decisions/export", {}))

    def test_valid_owner_token_is_required_not_public_apk_token(self):
        token = "example-unit-test-only-" + "z" * 32
        with patch.dict(os.environ, {"KYVORIQ_API_OWNER_TOKEN": token}, clear=True):
            self.assertEqual(private_http_error("GET", "/trades", {}), (401, "Authentication required"))
            self.assertEqual(private_http_error("GET", "/trades", {"authorization": "Bearer wrong"}), (401, "Authentication required"))
            self.assertEqual(private_http_error("GET", "/trades", {"authorization": "Bearer " + token + "oops"}), (401, "Authentication required"))
            self.assertIsNone(private_http_error("GET", "/trades", {"authorization": "Bearer " + token}))
            self.assertIsNone(private_http_error("GET", "/health", {}))
            self.assertNotIn("/bootstrap", PUBLIC_GET_PATHS)
            self.assertNotIn("/execution/status", PUBLIC_GET_PATHS)

    def test_device_bearer_is_short_lived_and_not_forgeable(self):
        secret = "integration-owner-only-" + "Z" * 48
        with patch.dict(os.environ, {"KYVORIQ_API_OWNER_TOKEN": secret}, clear=True):
            access, expires = issue_device_token(secret, now=1750000000)
            self.assertNotIn(secret, access)
            self.assertTrue(verify_device_token(access, secret, now=1750000000))
            self.assertFalse(verify_device_token(access, secret, now=expires))
            self.assertFalse(verify_device_token(access, secret, now=expires + 1))
            self.assertFalse(verify_device_token(access[:-1] + ("a" if access[-1] != "a" else "b"), secret, now=1750000000))
            self.assertFalse(verify_device_token(access, secret + "rotated", now=1750000000))
            self.assertIsNone(private_http_error("POST", "/auth/pair", {}))

    def test_pairing_endpoint_integration_and_private_access(self):
        from fastapi.testclient import TestClient
        from app import main
        secret = "integration-owner-only-" + "Q" * 48
        main.pair_attempts.clear()
        with patch.dict(os.environ, {"KYVORIQ_API_OWNER_TOKEN": secret}, clear=True):
            client = TestClient(main.app)
            self.assertEqual(client.get("/trades").status_code, 401)
            self.assertEqual(client.post("/auth/pair", json={"pairing_secret": "not-the-secret-" * 4}).status_code, 401)
            r = client.post("/auth/pair", json={"pairing_secret": secret})
            self.assertEqual(r.status_code, 200)
            token = r.json()["access_token"]
            self.assertEqual(client.get("/trades", headers={"Authorization": "Bearer " + token}).status_code, 200)
            self.assertEqual(client.get("/bootstrap", headers={"Authorization": "Bearer " + token}).status_code, 200)
            self.assertEqual(client.get("/trades", headers={"Authorization": "Bearer " + token + "tamper"}).status_code, 401)
            self.assertIn("no-store", r.headers["cache-control"])
            with client.websocket_connect("/ws?profile=alerts", headers={"Authorization": "Bearer " + token}) as ws:
                self.assertEqual(ws.receive_json()["profile"], "alerts")
        main.pair_attempts.clear()

    def test_websocket_auth_and_origins(self):
        token = "unit-test-only-" + "x" * 40
        env = {"KYVORIQ_API_OWNER_TOKEN": token}
        good = {"host": "api.example.test", "authorization": "Bearer " + token}
        with patch.dict(os.environ, env, clear=True):
            self.assertIsNone(websocket_error(good))
            self.assertIsNone(websocket_error({**good, "origin": "https://api.example.test"}))
            self.assertEqual(websocket_error({**good, "origin": "https://hostile.example.test"}), "Unapproved WebSocket origin")
            self.assertEqual(websocket_error({"host": "api.example.test"}), "Authentication required")
            self.assertEqual(websocket_error({**good, "origin": "http://api.example.test"}), "Unapproved WebSocket origin")
        with patch.dict(os.environ, {**env, "KYVORIQ_WS_ALLOWED_ORIGINS": "https://dashboard.example.test"}, clear=True):
            self.assertIsNone(websocket_error({**good, "origin": "https://dashboard.example.test"}))

    def test_headers_do_not_cache_private_data(self):
        h = security_headers(True)
        self.assertEqual(h["X-Content-Type-Options"], "nosniff")
        self.assertEqual(h["X-Frame-Options"], "DENY")
        self.assertIn("no-store", h["Cache-Control"])
        self.assertNotIn("Cache-Control", security_headers(False))
        self.assertLessEqual(MAX_CLIENTS, 64)


if __name__ == "__main__":
    unittest.main()
