package com.devtrader.app

import android.content.Context
import android.telephony.TelephonyManager
import java.util.Locale

/**
 * Launch-planning PREVIEW prices only. The final checkout price must come
 * directly from Google Play Billing ProductDetails, never from a device locale
 * or a self-computed foreign exchange conversion.
 */
object KyvoriqRegionalPricing {
    data class Quote(
        val regionName: String,
        val currencyCode: String,
        val pro: String?,
        val elite: String?,
        val indicative: Boolean = true
    ) {
        fun amount(tier: KyvoriqAccessTier): String = when (tier) {
            KyvoriqAccessTier.BASIC -> "FREE"
            KyvoriqAccessTier.PRO -> pro ?: "TBA"
            KyvoriqAccessTier.ELITE, KyvoriqAccessTier.OWNER -> elite ?: "TBA"
        }
    }

    /** Prices individually proposed by the owner; not real-time conversion. */
    private val localPrices = mapOf(
        "IN" to Quote("India", "INR", "₹499", "₹1,499"),
        "US" to Quote("United States", "USD", "$19.99", "$49.99"),
        "CA" to Quote("Canada", "CAD", "C$26.99", "C$69.99"),
        "GB" to Quote("United Kingdom", "GBP", "£15.99", "£39.99"),
        "AU" to Quote("Australia", "AUD", "A$29.99", "A$74.99"),
        "AE" to Quote("United Arab Emirates", "AED", "AED 69", "AED 179"),
        "ID" to Quote("Indonesia", "IDR", "Rp115,000", "Rp299,000"),
        "BR" to Quote("Brazil", "BRL", "R$39.90", "R$109.90")
    )
    private val euroArea = setOf(
        "AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR",
        "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK", "BG"
    )

    fun forCountry(country: String): Quote {
        val normalized = country.trim().uppercase(Locale.US)
        if (normalized in euroArea) {
            return Quote("Eurozone", "EUR", "€17.99", "€44.99")
        }
        return localPrices[normalized] ?: Quote(
            regionName = normalized.ifBlank { "your region" },
            currencyCode = runCatching {
                java.util.Currency.getInstance(Locale.Builder().setRegion(normalized).build()).currencyCode
            }.getOrDefault(""),
            pro = null,
            elite = null
        )
    }

    /**
     * Device preference + SIM country are only a preview heuristic: a SIM is
     * not a billing address, and IP geolocation must never be used for charging.
     */
    fun deviceCountry(context: Context): String {
        val simCountry = runCatching {
            (context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager)
                ?.simCountryIso.orEmpty().uppercase(Locale.US)
        }.getOrDefault("")
        if (simCountry.length == 2) return simCountry
        val localeCountry = Locale.getDefault().country.uppercase(Locale.US)
        return localeCountry.ifBlank { "US" }
    }

    fun forDevice(context: Context): Quote = forCountry(deviceCountry(context))

    /**
     * Future Google Play integration: pass the exact formatted price reported
     * by BillingClient ProductDetails for the customer's selected base plan.
     * This method does not initiate billing or authorize any entitlement.
     */
    fun displayAmount(tier: KyvoriqAccessTier, preview: Quote, playFormattedPrice: String? = null): String {
        if (tier == KyvoriqAccessTier.BASIC) return "FREE"
        return playFormattedPrice?.takeIf { it.isNotBlank() } ?: preview.amount(tier)
    }
}
