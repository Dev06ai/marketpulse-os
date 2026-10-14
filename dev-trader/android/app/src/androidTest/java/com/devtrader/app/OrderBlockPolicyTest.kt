package com.devtrader.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.json.JSONArray
import org.json.JSONObject

@RunWith(AndroidJUnit4::class)
class OrderBlockPolicyTest {
    private fun block(id: String, low: Double, score: Int = 90, direction: String = "BULLISH") = JSONObject()
        .put("id", id).put("kind", "OB").put("label", "1H OB").put("timeframe", "1h")
        .put("zone_low", low).put("zone_high", low+1).put("price", low+.5)
        .put("direction", direction).put("status", "ACTIVE").put("structure_break", true)
        .put("rule_version", "strong-ob-v1").put("strength_score", score).put("confirmed_at", 12345L)

    @Test fun rejectsWeakLegacyAndInvalidatedZonesPreservingOtherLevels() {
        val input = JSONArray().put(block("weak", 98.0, 60)).put(block("legacy", 100.0).removeRule())
            .put(block("invalid", 102.0).put("status", "INVALIDATED"))
            .put(JSONObject().put("kind", "DAILY").put("price", 101.0))
        val output = OrderBlockPolicy.filter(input, 100.0)
        assertEquals(1, output.length()); assertEquals("DAILY", output.getJSONObject(0).getString("kind"))
    }
    private fun JSONObject.removeRule(): JSONObject { remove("rule_version"); return this }

    @Test fun keepsStrongestOverlapAndCapsBothDirections() {
        val input = JSONArray().put(block("best", 98.0, 95)).put(block("overlap", 98.1, 80))
            .put(block("bull2", 100.0)).put(block("bull3", 102.0))
            .put(block("bear1", 104.0, 90, "BEARISH")).put(block("bear2", 106.0, 90, "BEARISH"))
        val out = OrderBlockPolicy.filter(input, 100.0)
        assertEquals(4, out.length())
        assertEquals("best", out.getJSONObject(0).getString("id"))
        assertFalse((0 until out.length()).any { out.getJSONObject(it).getString("id") == "overlap" })
    }
}
