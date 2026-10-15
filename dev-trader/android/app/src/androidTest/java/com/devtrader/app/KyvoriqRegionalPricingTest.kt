package com.devtrader.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Preview-only regional prices; billing amounts will be sourced from Play. */
@RunWith(AndroidJUnit4::class)
class KyvoriqRegionalPricingTest {
    @Test fun preapprovedMarketsUseLocalPriceInsteadOfExchangeRateGuesswork() {
        assertEquals("₹499", KyvoriqRegionalPricing.forCountry("IN").pro)
        assertEquals("₹1,499", KyvoriqRegionalPricing.forCountry("in").elite)
        assertEquals("$19.99", KyvoriqRegionalPricing.forCountry("US").pro)
        assertEquals("£39.99", KyvoriqRegionalPricing.forCountry("GB").elite)
        assertEquals("€17.99", KyvoriqRegionalPricing.forCountry("DE").pro)
        assertEquals("C$69.99", KyvoriqRegionalPricing.forCountry("CA").elite)
        assertEquals("A$29.99", KyvoriqRegionalPricing.forCountry("AU").pro)
        assertEquals("AED 179", KyvoriqRegionalPricing.forCountry("AE").elite)
        assertEquals("Rp115,000", KyvoriqRegionalPricing.forCountry("ID").pro)
        assertEquals("R$109.90", KyvoriqRegionalPricing.forCountry("BR").elite)
    }
    @Test fun unknownMarketNeverInventsAConvertedPrice() {
        val unknown = KyvoriqRegionalPricing.forCountry("JP")
        assertNull(unknown.pro)
        assertNull(unknown.elite)
        assertEquals("TBA", unknown.amount(KyvoriqAccessTier.PRO))
        assertEquals("JPY", unknown.currencyCode)
    }
    @Test fun realGooglePlayLocalizedPriceHasPriorityWhenSupplied() {
        val quote = KyvoriqRegionalPricing.forCountry("IN")
        assertEquals("₹499", KyvoriqRegionalPricing.displayAmount(KyvoriqAccessTier.PRO, quote))
        assertEquals("₹599.00", KyvoriqRegionalPricing.displayAmount(
            KyvoriqAccessTier.PRO, quote, "₹599.00"))
        assertEquals("FREE", KyvoriqRegionalPricing.displayAmount(
            KyvoriqAccessTier.BASIC, quote, "₹599.00"))
    }
}
