package com.devtrader.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class VerifiedMarketInsightsPresentationTest {
    private val now = 1_760_544_300_000L

    private fun snapshot(): JSONObject =
        JSONObject().put("schema", 1)
            .put("source", "BITGET_PUBLIC_BTCUSDT_PERPETUAL")
            .put("generated_at_ms", now - 2000L)
            .put("market_as_of_ms", now - 6000L)
            .put("quality", "LIVE").put("price", 81422.40)
            .put("context", JSONObject()
                .put("bias", "BEARISH")
                .put("thesis", "4h and 1h trends point down. The 15m rebound is countertrend, not a confirmed reversal.")
                .put("trends", JSONObject().put("4h", "DOWN").put("1h", "DOWN").put("15m", "UP"))
                .put("structure_15m", "BULLISH"))
            .put("levels", JSONObject()
                .put("above", JSONObject().put("kind", "WEEKLY").put("label", "Weekly")
                    .put("source", "WEEKLY_OPEN").put("price", 83125.70).put("distance_pct", 2.09))
                .put("below", JSONObject().put("kind", "DAILY").put("label", "Daily")
                    .put("source", "PREVIOUS_DAY_LOW").put("price", 80530.00).put("distance_pct", -1.10)))
            .put("flow", JSONObject().put("oi_5m_pct", 0.527)
                .put("oi_source", "EXCHANGE_OPEN_INTEREST")
                .put("cvd_divergence", "NONE").put("cvd_source", "RECENT_TRADE_TAPE"))

    @Test fun verifiedThesisUsesKnownEvidenceAndNeverTradeEngineDetails() {
        val cards = VerifiedMarketInsightsPresentation.present(snapshot(), now)
        assertTrue(cards.valid)
        assertTrue(cards.context.contains("Thesis BEARISH"))
        assertTrue(cards.context.contains("4H DOWN  •  1H DOWN  •  15m UP"))
        assertTrue(cards.context.contains("15m structure BULLISH"))
        assertTrue(cards.levelsAndFlow.contains("Above Weekly"))
        assertTrue(cards.levelsAndFlow.contains("83,125.70"))
        assertTrue(cards.levelsAndFlow.contains("Below Daily"))
        assertTrue(cards.levelsAndFlow.contains("80,530.00"))
        assertTrue(cards.levelsAndFlow.contains("+0.527%"))
        assertTrue(cards.levelsAndFlow.contains("CVD divergence: NONE"))
        val text = cards.context + cards.levelsAndFlow
        assertFalse(text.contains("demo", true))
        assertFalse(text.contains("execution", true))
        assertFalse(text.contains("entry", true))
    }

    @Test fun staleDataNeverProducesDirectionOrFalseOiZero() {
        val cards = VerifiedMarketInsightsPresentation.present(snapshot(), now + 301_000)
        assertFalse(cards.valid)
        assertTrue(cards.context.contains("DATA UNVERIFIED"))
        assertFalse(cards.context.contains("Thesis BEARISH"))
        assertFalse(cards.levelsAndFlow.contains("0.000%"))
        assertFalse(cards.levelsAndFlow.contains("Above Weekly"))
    }

    @Test fun missingSnapshotUnknownSchemaAndWrongSourceFailClosed() {
        assertFalse(VerifiedMarketInsightsPresentation.present(null, now).valid)
        assertFalse(VerifiedMarketInsightsPresentation.present(snapshot().put("schema", 999), now).valid)
        assertFalse(VerifiedMarketInsightsPresentation.present(snapshot().put("source", "UNTRUSTED"), now).valid)
        assertFalse(VerifiedMarketInsightsPresentation.present(snapshot().put("quality", "STALE"), now).valid)
    }

    @Test fun incompleteFlowIsUnavailableNotNoneOrZero() {
        val s = snapshot()
        s.getJSONObject("flow").put("oi_5m_pct", JSONObject.NULL)
            .put("cvd_divergence", "UNAVAILABLE").put("oi_source", "UNAVAILABLE")
            .put("cvd_source", "UNAVAILABLE")
        val cards = VerifiedMarketInsightsPresentation.present(s, now)
        assertTrue(cards.valid)
        assertTrue(cards.levelsAndFlow.contains("insufficient verified history"))
        assertTrue(cards.levelsAndFlow.contains("CVD divergence: unavailable"))
        assertFalse(cards.levelsAndFlow.contains("0.000%"))
    }

    @Test fun invertedOrMalformedLevelCannotLookLikeVerifiedSupport() {
        val s = snapshot()
        s.getJSONObject("levels").getJSONObject("above").put("price", 80000.00)
        val cards = VerifiedMarketInsightsPresentation.present(s, now)
        assertTrue(cards.levelsAndFlow.contains("Above: no confirmed reference"))
        assertTrue(cards.levelsAndFlow.contains("Below Daily"))
    }
}
