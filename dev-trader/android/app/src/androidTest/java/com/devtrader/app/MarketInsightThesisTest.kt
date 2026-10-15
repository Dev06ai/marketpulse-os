package com.devtrader.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MarketInsightThesisTest {
    private val now = 1_760_000_000_000L
    private fun snapshot(): JSONObject = JSONObject()
        .put("last_price", 81200.0)
        .put("data_health", "HEALTHY")
        .put("ws_connected", true)
        .put("received_ts", now - 800)
        .put("upstream", JSONObject().put("source", "BITGET_WS"))
        .put("features", JSONObject()
            .put("trend_240", "DOWN").put("trend_60", "DOWN")
            .put("trend_15", "UP").put("regime", "TREND_DOWN")
            .put("market_structure", "BULLISH")
            .put("cvd_price_divergence", "NONE")
            .put("oi_change_5m_pct", 0.05))
        .put("chart_overlays", JSONArray()
            .put(JSONObject().put("kind", "DAILY").put("price", 83125.7))
            .put(JSONObject().put("kind", "WEEKLY").put("price", 80095.9))
            .put(JSONObject().put("kind", "NPOC").put("price", 89900.0)
                .put("reference_expires_ms", now - 1)))

    @Test fun downHigherTimeframesWithUpFifteenIsExplicitlyCountertrend() {
        val r = MarketInsightThesis.render(snapshot(), now)
        assertTrue(r.fresh)
        assertTrue(r.context.contains("15m rebound is countertrend"))
        assertTrue(r.context.contains("CONFLICTING SIGNALS"))
        assertTrue(r.context.contains("83,") == false)
        assertTrue(r.flow.contains("Daily 83,125.70"))
        assertTrue(r.flow.contains("Weekly 80,095.90"))
        assertFalse(r.flow.contains("89,900.00"))
        assertTrue(r.flow.contains("participation change; not long/short direction"))
        assertTrue(r.flow.contains("No confirmed divergence flagged"))
    }

    @Test fun staleOrUnverifiedDataCannotGenerateMarketThesisOrFlow() {
        val stale = snapshot().put("received_ts", now - 60_000)
        val r = MarketInsightThesis.render(stale, now)
        assertFalse(r.fresh)
        assertTrue(r.context.contains("DATA NOT VERIFIED"))
        assertFalse(r.context.contains("Bearish 4H"))
        assertFalse(r.flow.contains("83,125"))
        val badSource = snapshot().put("upstream", JSONObject().put("source", "UNKNOWN"))
        assertFalse(MarketInsightThesis.render(badSource, now).fresh)
    }

    @Test fun missingFlowEvidenceNeverDefaultsToZeroOrPositiveClaims() {
        val f = JSONObject().put("trend_240", "UP").put("trend_60", "DOWN")
            .put("trend_15", "UNKNOWN")
        val r = MarketInsightThesis.render(snapshot().put("features", f), now)
        assertTrue(r.context.contains("Timeframe evidence is incomplete"))
        assertTrue(r.flow.contains("Unavailable (no reliable 5m change)"))
        assertTrue(r.flow.contains("Divergence data unavailable"))
    }

    @Test fun executionPayloadCannotAlterMarketOnlyInsights() {
        val a = snapshot()
        val baseline = MarketInsightThesis.render(a, now)
        a.put("execution", JSONObject().put("summary", JSONObject()
            .put("open_trades", 9).put("equity_usdt", 111111.0))
            .put("demo_execution", JSONObject().put("ready", false)))
        val changed = MarketInsightThesis.render(a, now)
        assertEquals(baseline, changed)
        assertFalse(changed.context.contains("demo", ignoreCase = true))
        assertFalse(changed.flow.contains("execution", ignoreCase = true))
    }
}
