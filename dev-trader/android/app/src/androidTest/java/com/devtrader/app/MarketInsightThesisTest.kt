package com.devtrader.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MarketInsightThesisTest {
    private val now = 1760544300000L
    private fun packet() = JSONObject().put("quality", "LIVE")
        .put("generated_at_ms", now - 1000)
        .put("market_as_of_ms", now - 7000)
        .put("context", JSONObject().put("bias", "BEARISH")
            .put("thesis", "4h and 1h down; 15m countertrend bounce.")
            .put("structure_15m", "BULLISH")
            .put("trends", JSONObject().put("4h", "DOWN")
                .put("1h", "DOWN").put("15m", "UP")))
        .put("levels", JSONObject())
        .put("flow", JSONObject().put("oi_source", "UNAVAILABLE")
            .put("cvd_source", "UNAVAILABLE"))

    @Test fun auditedThesisWinsOverOldStrategyClaims() {
        val root = JSONObject().put("market_insights", packet())
            .put("features", JSONObject().put("trend_240", "UP")
                .put("oi_change_5m_pct", 0.0))
        val report = MarketInsightThesis.render(root, now)
        assertTrue(report.fresh)
        assertTrue(report.context.contains("THESIS · BEARISH"))
        assertTrue(report.context.contains("15M UP"))
        assertTrue(report.flow.contains("5m unavailable"))
        assertFalse(report.context.contains("THESIS · BULLISH"))
    }

    @Test fun missingOrOldEvidenceCannotClaimCurrentMarketDirection() {
        assertFalse(MarketInsightThesis.render(JSONObject(), now).fresh)
        val stale = packet().put("generated_at_ms", now - 200000)
        val result = MarketInsightThesis.render(JSONObject().put("market_insights", stale), now)
        assertFalse(result.fresh)
        assertFalse(result.context.contains("THESIS · BEARISH"))
        assertTrue(result.flow.contains("withheld"))
    }
}
