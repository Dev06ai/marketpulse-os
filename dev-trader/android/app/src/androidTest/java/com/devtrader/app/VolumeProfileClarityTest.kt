package com.devtrader.app

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.RectF
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs

/** The VP toggle contains POC, VAH and VAL, never unrelated screenshot levels. */
@RunWith(AndroidJUnit4::class)
class VolumeProfileClarityTest {
    private val ctx get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val density get() = ctx.resources.displayMetrics.density
    private fun px(dp: Int) = (dp * density).toInt()

    private fun chartWithProfile(tier: KyvoriqAccessTier): MarketChartView {
        val prefs = ctx.getSharedPreferences("kyvoriq_chart_layers", android.content.Context.MODE_PRIVATE)
        // Simulate an existing cluttered Build 184 user: after one-time migration,
        // LVL reference layers are OFF, while VP retains its current setting.
        prefs.edit().clear().putBoolean("npoc", true).putBoolean("daily", true)
            .putBoolean("weekly", true).putBoolean("ob", true)
            .putBoolean("session_profile", true).commit()
        val chart = MarketChartView(ctx).apply { setAccessTier(tier) }
        assertFalse(prefs.getBoolean("npoc", true))
        assertFalse(prefs.getBoolean("daily", true))
        assertFalse(prefs.getBoolean("weekly", true))
        assertFalse(prefs.getBoolean("ob", true))
        val startMs = 1_760_000_000_000L
        val candles = JSONArray()
        repeat(90) { i ->
            val ts = startMs + i * 3_600_000L
            candles.put(JSONObject().put("start", ts).put("end", ts + 3_600_000L - 1)
                .put("open", 83000.0).put("close", 82980.0)
                .put("high", 84400.0).put("low", 80700.0).put("volume", 200.0))
        }
        val earliest = startMs + 65 * 3_600_000L
        val profile = JSONObject().put("source", "OHLCV_15M_ESTIMATE")
            .put("start_ms", earliest).put("end_ms", startMs + 90 * 3_600_000L)
            .put("val", 81700.0).put("poc", 83200.0).put("vah", 84000.0)
        val extras = JSONArray()
        listOf(
            "SFP_GAP" to 84362.3, "IPOC" to 82719.8,
            "DAILY" to 81813.4, "RANGE_POC" to 83974.8,
            "RANGE_VAL" to 82351.3
        ).forEach { (kind, price) ->
            extras.put(JSONObject().put("kind", kind).put("label", kind)
                .put("source", "MINDPILLAR_SCREENSHOT_2026_10_14")
                .put("price", price).put("reference_expires_ms", Long.MAX_VALUE))
        }
        chart.setSessionProfiles(JSONArray().put(profile))
        chart.setReferenceLevels(extras)
        chart.setData(candles, null, null, 82800.0, JSONArray())
        chart.layout(0, 0, px(393), px(650))
        return chart
    }

    private fun render(chart: MarketChartView): List<String> {
        val bitmap = Bitmap.createBitmap(px(393), px(650), Bitmap.Config.ARGB_8888)
        try { chart.draw(Canvas(bitmap)) } finally { bitmap.recycle() }
        return chart.visibleAxisTagTextsForTest()
    }

    @Test fun vpShowsOnlyThreeCoreReadablePriceLabels() {
        val chart = chartWithProfile(KyvoriqAccessTier.OWNER)
        val labels = render(chart)
        assertTrue("POC is the highest-priority VP level", labels.any { it.startsWith("POC ") })
        assertTrue("Value-area high should be available", labels.any { it.startsWith("VAH ") })
        assertTrue("Value-area low should be available", labels.any { it.startsWith("VAL ") })
        assertTrue("Unexpected extra VP badges: $labels", labels.size <= 3)
        assertTrue("Legacy iPOC, daily, GAP and range labels must be hidden", labels.none {
            it.startsWith("iP") || it.startsWith("G") || it.startsWith("DAY") || it.startsWith("R")
        })
        val rects = chart.visibleAxisLabelRectsForTest()
        for (i in rects.indices) for (j in i + 1 until rects.size) {
            assertFalse("Price labels must not overlap", RectF.intersects(rects[i], rects[j]))
        }
        assertEquals("VP badges must retain original price anchors", rects.size,
            chart.visibleAxisPriceAnchorsForTest().size)
        assertTrue(chart.visibleAxisPriceAnchorsForTest().all { (priceY, tagY) ->
            abs(priceY - tagY) <= 6 * density + 0.1f
        })
    }

    @Test fun noPrivateMembershipPrivilegeLeaksThroughOldScreenshotReferences() {
        val chart = chartWithProfile(KyvoriqAccessTier.BASIC)
        val labels = render(chart)
        assertTrue("Free account must not gain paid VP or level tags", labels.isEmpty())
    }
}
