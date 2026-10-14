"""Exercise real RSA signatures; only the remote key lookup is substituted.

These offline tests do not claim live Firebase signup or email delivery.
"""
import os
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

from auth import (FIREBASE_JWKS, AuthenticationRejected, AuthUnavailable,
                  settings, verify_access_token)


class FirebaseTokenContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def setUp(self):
        self.env = patch.dict(os.environ, {
            "KYVORIQ_CONSUMER_OIDC_ISSUER": "https://securetoken.google.com/kyvoriq-test",
            "KYVORIQ_CONSUMER_OIDC_AUDIENCE": "kyvoriq-test",
            "KYVORIQ_CONSUMER_OIDC_JWKS_URL": FIREBASE_JWKS,
            "KYVORIQ_ADMIN_SUBJECTS": "owner-uid",
        }, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.lookup = patch("auth.PyJWKClient")
        self.lookup.start().return_value.get_signing_key_from_jwt.return_value = SimpleNamespace(key=self.key.public_key())
        self.addCleanup(self.lookup.stop)

    def claims(self, **changes):
        now = int(time.time())
        result = dict(sub="consumer-uid", iss="https://securetoken.google.com/kyvoriq-test",
                      aud="kyvoriq-test", iat=now, exp=now + 3600,
                      auth_time=now, email_verified=True)
        result.update(changes)
        return result

    def token(self, claims, key=None):
        return jwt.encode(claims, key or self.key, algorithm="RS256", headers={"kid": "test-key"})

    def test_valid_signed_token_has_no_client_claim_privileges(self):
        principal = verify_access_token(self.token(self.claims(tier="ELITE", admin=True, role="admin")))
        self.assertEqual(principal.subject, "consumer-uid")
        self.assertTrue(principal.email_verified)
        self.assertFalse(principal.admin_mfa)

    def test_wrong_signature_rejected(self):
        with self.assertRaises(AuthenticationRejected):
            verify_access_token(self.token(self.claims(), self.other_key))

    def test_wrong_issuer_audience_and_expired_or_future_tokens_rejected(self):
        for change in ({"iss": "https://securetoken.google.com/another-project"},
                       {"aud": "another-project"}, {"aud": ["kyvoriq-test", "another-project"]},
                       {"exp": int(time.time()) - 60}, {"iat": int(time.time()) + 60}):
            with self.subTest(change=change), self.assertRaises(AuthenticationRejected):
                verify_access_token(self.token(self.claims(**change)))

    def test_missing_claims_rejected(self):
        for field in ("sub", "iat", "exp", "iss", "aud", "auth_time"):
            claims = self.claims()
            del claims[field]
            with self.subTest(field=field), self.assertRaises(AuthenticationRejected):
                verify_access_token(self.token(claims))

    def test_firebase_subject_and_auth_time_boundaries(self):
        for change in ({"sub": ""}, {"sub": "x" * 129}, {"auth_time": True},
                       {"auth_time": "123"}, {"auth_time": -1},
                       {"auth_time": int(time.time()) + 60}):
            with self.subTest(change=change), self.assertRaises(AuthenticationRejected):
                verify_access_token(self.token(self.claims(**change)))

    def test_hmac_and_unsigned_tokens_rejected(self):
        for algorithm, key in (("HS256", "test-only-hmac-key-that-is-32-bytes"), ("none", "")):
            token = jwt.encode(self.claims(), key, algorithm=algorithm)
            with self.subTest(algorithm=algorithm), self.assertRaises(AuthenticationRejected):
                verify_access_token(token)

    def test_admin_requires_immutable_uid_and_recent_second_factor(self):
        claims = self.claims(sub="owner-uid", firebase={"sign_in_second_factor": "totp"})
        self.assertTrue(verify_access_token(self.token(claims)).admin_mfa)
        for change in ({"sub": "consumer-uid"}, {"auth_time": int(time.time()) - 720},
                       {"firebase": {"sign_in_provider": "google.com"}}):
            with self.subTest(change=change):
                self.assertFalse(verify_access_token(self.token({**claims, **change})).admin_mfa)

    def test_firebase_configuration_is_pinned(self):
        for change in ({"KYVORIQ_CONSUMER_OIDC_AUDIENCE": "another-project"},
                       {"KYVORIQ_CONSUMER_OIDC_JWKS_URL": "https://example.com/keys"},
                       {"KYVORIQ_CONSUMER_OIDC_ISSUER": "https://securetoken.google.com:443/kyvoriq-test"}):
            with self.subTest(change=change), patch.dict(os.environ, change), self.assertRaises(AuthUnavailable):
                settings()


if __name__ == "__main__":
    unittest.main()
