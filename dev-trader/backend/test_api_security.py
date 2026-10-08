"""Dependency-free, network-free security contract tests for the private API."""
import os
import unittest
from unittest.mock import patch

from app.api_security import (
    private_http_error, websocket_error, security_headers,
    owner_token, PUBLIC_GET_PATHS, MAX_CLIENTS,
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
