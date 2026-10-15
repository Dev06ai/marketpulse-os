package com.devtrader.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class VerifiedInsightsPresentationTest {
    private val now = 1_760_544_300_000L
    private fun packet() = JSONObject().put("schema", 1)
        .put("source", "BITGET_PUBLIC_BTCUSDT_PERPETUAL")
        .put("price", 82400.0)
        .put("quality", "LIVE")
        .put("source", "BITGET_PUBLIC_BTCUSDT_PERPETUAL")
        .put("generated_at_ms", now - 2_000)
        .put("market_as_of_ms", now - 9_000)
        .put("context", JSONObject()
            .put("bias", "BEARISH")
            .put("thesis", "4h and 1h trends point down. The 15m rebound is countertrend, not a confirmed reversal.")
            .put("structure_15m", "BULLISH")
            .put("trends", JSONObject().put("4h", "DOWN").put("1h", "DOWN").put("15m", "UP")))
        .put("levels", JSONObject().put("above",
            JSONObject().put("kind", "WEEKLY").put("price", 83125.75).put("distance_pct", 0.27))
            .put("below", JSONObject().put("kind", "DAILY")
                .put("price", 82100.5).put("distance_pct", -0.95)))
        .put("flow", JSONObject().put("oi_5m_pct", 0.25)
            .put("oi_source", "EXCHANGE_OPEN_INTEREST")
            .put("cvd_divergence", "NONE").put("cvd_source", "RECENT_TRADE_TAPE"))

    @Test fun currentVerifiedDataShowsThesisAndClearlyDistinguishesShortTermStructure() {
        val s = VerifiedInsightsPresentation.marketContext(packet(), now)
        assertTrue(s.contains("THESIS · BEARISH"))
        assertTrue(s.contains("4H DOWN"))
        assertTrue(s.contains("15M UP"))
        assertTrue(s.contains("15M STRUCTURE · BULLISH"))
        assertTrue(s.contains("countertrend"))
        assertTrue(s.contains("not a guaranteed forecast"))
        assertFalse(s.contains("No FOMO"))
        assertFalse(s.contains("Bitget Demo"))
    }

    @Test fun flowAndPriceLevelsShowActualValuesOnlyWithCoverage() {
        val s = VerifiedInsightsPresentation.levelsFlow(packet(), now)
        assertTrue(s.contains("WEEKLY 83,125.75"))
        assertTrue(s.contains("DAILY 82,100.50"))
        assertTrue(s.contains("5m +0.250%"))
        assertTrue(s.contains("No divergence observed"))
        assertFalse(s.contains("demo", ignoreCase = true))
    }

    @Test fun staleOrUnavailablePayloadNeverPresentsOldThesisOrMadeUpOiZeros() {
        val stale = packet().put("generated_at_ms", now - 150_000)
            .put("market_as_of_ms", now - 160_000)
        val market = VerifiedInsightsPresentation.marketContext(stale, now)
        val levels = VerifiedInsightsPresentation.levelsFlow(stale, now)
        assertTrue(market.contains("UNVERIFIED / STALE"))
        assertFalse(market.contains("THESIS · BEARISH"))
        assertTrue(levels.contains("withheld"))
        assertFalse(levels.contains("5m +0.000%"))
        assertTrue(VerifiedInsightsPresentation.marketContext(null, now).contains("UNVERIFIED"))
    }

    @Test fun missingOiCvdHistoryCannotPretendNeutralFlow() {
        val missing = packet().put("flow", JSONObject()
            .put("oi_source", "UNAVAILABLE")
            .put("cvd_divergence", "NONE")
            .put("cvd_source", "UNAVAILABLE"))
        val rendered = VerifiedInsightsPresentation.levelsFlow(missing, now)
        assertTrue(rendered.contains("5m unavailable"))
        assertTrue(rendered.contains("CVD · Not verified"))
        assertFalse(rendered.contains("No divergence observed"))
    }
}
