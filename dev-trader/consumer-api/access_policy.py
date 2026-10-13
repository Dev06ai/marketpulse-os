"""Server-owned consumer feature policy. Never accept client-supplied tiers.

Admin is a distinct identity privilege, never a subscription SKU.
Past performance and trade execution are never promised or unlocked via purchase.
"""
from __future__ import annotations

from enum import IntEnum

class Tier(IntEnum):
    BASIC = 0
    PRO = 1
    ELITE = 2

FEATURE_MIN_TIER: dict[str, Tier] = {
    "market_chart": Tier.BASIC,
    "public_market_context": Tier.BASIC,
    "saved_chart_layouts": Tier.PRO,
    "confirmed_signal_alerts": Tier.PRO,
    "market_structure_tools": Tier.PRO,
    "advanced_insight_reports": Tier.ELITE,
    "extended_signal_explanations": Tier.ELITE,
}
# Consumer API explicitly disallows these even at the highest paid tier.
OWNER_ONLY: frozenset[str] = frozenset({
    "exchange_credentials", "demo_trade_execution", "trade_policy_mutation",
    "private_execution_history", "owner_diagnostics", "admin_access",
    "security_settings", "billing_override",
})

def parse_tier(raw: str) -> Tier:
    try:
        return Tier[raw.upper()]
    except (KeyError, AttributeError):
        return Tier.BASIC

def entitled(tier: Tier, feature: str) -> bool:
    return feature not in OWNER_ONLY and feature in FEATURE_MIN_TIER and tier >= FEATURE_MIN_TIER[feature]

def grants(tier: Tier) -> list[str]:
    return [name for name, minimum in FEATURE_MIN_TIER.items() if tier >= minimum]
