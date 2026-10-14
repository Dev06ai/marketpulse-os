import sys
import os
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from access_policy import Tier, entitled, grants, parse_tier, OWNER_ONLY
from auth import verify_access_token, AuthenticationRejected, AuthUnavailable

class ConsumerEntitlementTests(unittest.TestCase):
    def test_never_trust_user_supplied_role_names(self):
        self.assertEqual(parse_tier("ADMIN"), Tier.BASIC)
        self.assertEqual(parse_tier("unknown"), Tier.BASIC)
        self.assertEqual(parse_tier("ELITE"), Tier.ELITE)
        self.assertEqual(parse_tier(None), Tier.BASIC)

    def test_progressive_capability_inheritance(self):
        self.assertTrue(entitled(Tier.BASIC, "market_chart"))
        self.assertFalse(entitled(Tier.BASIC, "confirmed_signal_alerts"))
        self.assertTrue(entitled(Tier.PRO, "confirmed_signal_alerts"))
        self.assertFalse(entitled(Tier.PRO, "advanced_insight_reports"))
        self.assertTrue(entitled(Tier.ELITE, "advanced_insight_reports"))
        self.assertTrue(set(grants(Tier.BASIC)).issubset(set(grants(Tier.PRO))))
        self.assertTrue(set(grants(Tier.PRO)).issubset(set(grants(Tier.ELITE))))

    def test_no_paid_tier_can_reach_owner_system(self):
        for tier in Tier:
            for name in OWNER_ONLY:
                with self.subTest(tier=tier, feature=name):
                    self.assertFalse(entitled(tier, name))

    def test_consumer_sign_in_fails_closed_before_identity_setup(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(AuthUnavailable):
                verify_access_token("a" * 40)

if __name__ == "__main__":
    unittest.main()
