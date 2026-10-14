import unittest
from unittest.mock import patch
import jwt
from auth import signing_keys, verify_access_token, AuthUnavailable


class SigningKeyCache(unittest.TestCase):
    def setUp(self):
        signing_keys.cache_clear()
        self.addCleanup(signing_keys.cache_clear)

    def test_reuses_bounded_document_cache_without_permanent_key_cache(self):
        with patch("auth.PyJWKClient") as client:
            self.assertIs(signing_keys("https://example.com/keys"), signing_keys("https://example.com/keys"))
            client.assert_called_once_with("https://example.com/keys", cache_keys=False, lifespan=180, timeout=4)

    def test_key_service_outage_is_unavailable_not_invalid_login(self):
        with patch("auth.settings", return_value=("https://issuer.test", "aud", "https://issuer.test/keys", frozenset())), \
             patch("auth.signing_keys") as keys:
            keys.return_value.get_signing_key_from_jwt.side_effect = jwt.PyJWKClientConnectionError("offline")
            with self.assertRaises(AuthUnavailable):
                verify_access_token("signed.jwt.token")
