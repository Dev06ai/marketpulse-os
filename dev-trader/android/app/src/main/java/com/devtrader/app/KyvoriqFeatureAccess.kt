package com.devtrader.app

/**
 * Membership capabilities shared by chart controls and membership copy.
 *
 * These are presentation guardrails, NOT proof of a paid purchase. Do not choose
 * PRO or ELITE from client preferences, billing callbacks, intents or UI controls.
 * Until trusted server-verified consumer entitlements exist, public users remain BASIC.
 *
 * OWNER is exclusively the existing private owner-paired session, not a paid tier.
 * The server must also redact premium analysis payloads for BASIC consumers before
 * publicly launching subscriptions; client-side rendering checks are not security.
 */
enum class KyvoriqAccessTier {
    BASIC, PRO, ELITE, OWNER;

    fun isAtLeast(minimum: KyvoriqAccessTier): Boolean = ordinal >= minimum.ordinal

    fun volumeIndicator(): Boolean = true
    fun homeWidgets(): Boolean = true
    fun volumeProfile(): Boolean = isAtLeast(PRO)
    fun fullscreenChart(): Boolean = isAtLeast(PRO)
    fun dailyWeeklyNpoc(): Boolean = isAtLeast(PRO)
    fun highValueOrderBlocks(): Boolean = isAtLeast(ELITE)
    fun dLineAndValueArea(): Boolean = isAtLeast(ELITE)
    fun sfpAndBaseIndicators(): Boolean = true
}

object KyvoriqMembershipAccess {
    /** Intentionally fails closed for consumer subscriptions until backend validation. */
    fun current(ownerSessionPaired: Boolean): KyvoriqAccessTier =
        if (ownerSessionPaired) KyvoriqAccessTier.OWNER else KyvoriqAccessTier.BASIC
}
