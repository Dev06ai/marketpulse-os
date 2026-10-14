"""KYVORIQ: server—not Android—determines administrative privileges."""
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from auth import verify_access_token, AuthenticationRejected, AuthUnavailable


class JwtAdminGates(unittest.TestCase):
    def _principal(self, claims):
        signer = MagicMock()
        signer.get_signing_key_from_jwt.return_value.key = "trusted_public_key"
        with patch("auth.settings", return_value=(
            "https://securetoken.google.com/kyvoriq-customer",
            "kyvoriq-customer",
            "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
            frozenset({"immutable-owner-id"}),
        )), patch("auth.PyJWKClient", return_value=signer), patch("auth.jwt.decode", return_value=claims):
            return verify_access_token("signed.jwt.token")

    def test_verified_regular_google_signin_is_not_admin(self):
        claim = {"sub": "immutable-owner-id", "email_verified": True,
                 "auth_time": int(time.time()), "firebase": {"sign_in_provider": "google.com"}}
        obj = self._principal(claim)
        self.assertTrue(obj.email_verified)
        self.assertFalse(obj.admin_mfa)

    def test_totp_second_factor_and_recent_auth_required(self):
        claim = {"sub": "immutable-owner-id", "email_verified": True,
                 "auth_time": int(time.time()),
                 "firebase": {"sign_in_second_factor": "totp"}}
        self.assertTrue(self._principal(claim).admin_mfa)
        claim["auth_time"] = int(time.time()) - 720
        self.assertFalse(self._principal(claim).admin_mfa)

    def test_paid_account_or_email_does_not_make_admin(self):
        claim = {"sub": "consumer-1", "email_verified": True,
                 "auth_time": int(time.time()),
                 "firebase": {"sign_in_second_factor": "totp"},
                 "tier": "ELITE", "role": "admin", "is_admin": True}
        self.assertFalse(self._principal(claim).admin_mfa)

    def test_unverified_email_cannot_receive_verified_principal(self):
        claim = {"sub": "consumer-1", "email_verified": False,
                 "auth_time": int(time.time())}
        self.assertFalse(self._principal(claim).email_verified)

    def test_invalid_token_rejected_before_settings(self):
        with self.assertRaises(AuthenticationRejected):
            verify_access_token("")

if __name__ == "__main__":
    unittest.main()
