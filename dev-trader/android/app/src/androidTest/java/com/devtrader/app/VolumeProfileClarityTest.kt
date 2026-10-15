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

    private fun chartWithProfile(
        tier: KyvoriqAccessTier, optionalLevelsEnabled: Boolean = false
    ): MarketChartView {
        val prefs = ctx.getSharedPreferences("kyvoriq_chart_layers", android.content.Context.MODE_PRIVATE)
        // Old users migrate to clean defaults. A separate fixture opts into
        // level filters explicitly so offscreen price presentation is tested.
        prefs.edit().clear().putBoolean("vp_core_only_v1", optionalLevelsEnabled)
            .putBoolean("npoc", true).putBoolean("daily", true)
            .putBoolean("weekly", !optionalLevelsEnabled)
            .putBoolean("ob", !optionalLevelsEnabled)
            .putBoolean("session_profile", true).commit()
        val chart = MarketChartView(ctx).apply { setAccessTier(tier) }
        if (!optionalLevelsEnabled) {
            assertFalse(prefs.getBoolean("npoc", true))
            assertFalse(prefs.getBoolean("daily", true))
            assertFalse(prefs.getBoolean("weekly", true))
            assertFalse(prefs.getBoolean("ob", true))
        }
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
            .put("bins", JSONArray()
                .put(JSONObject().put("price", 81700.0).put("volume", 20.0).put("down", 8.0))
                .put(JSONObject().put("price", 83200.0).put("volume", 80.0).put("down", 35.0))
                .put(JSONObject().put("price", 84000.0).put("volume", 30.0).put("down", 5.0)))
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
        // An older session may still be within the visible candle window.
        // The current session must be the only default VP histogram/readout.
        val prior = JSONObject().put("source", "OHLCV_15M_ESTIMATE")
            .put("start_ms", startMs + 38 * 3_600_000L)
            .put("end_ms", startMs + 69 * 3_600_000L)
            .put("val", 82100.0).put("poc", 83750.0).put("vah", 84200.0)
            .put("bins", JSONArray()
                .put(JSONObject().put("price", 82100.0).put("volume", 15.0))
                .put(JSONObject().put("price", 83750.0).put("volume", 60.0)))
        chart.setSessionProfiles(JSONArray().put(prior).put(profile))
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

    @Test fun importantVpPricesRemainVisibleWhenLiveTagCoversPocAxis() {
        val chart = chartWithProfile(KyvoriqAccessTier.OWNER)
        chart.setLivePrice(83200.0)
        render(chart)
        val readout = chart.visibleVpReadoutForTest()
        assertEquals("POC / VAH / VAL must always remain in the reserved row", 3, readout.size)
        assertTrue(readout[0].startsWith("POC 83,200."))
        assertTrue(readout[1].startsWith("VAH 84,000."))
        assertTrue(readout[2].startsWith("VAL 81,700."))
        assertFalse("Older session must not take over current POC display",
            readout.any { it.contains("83,750") })
        assertTrue("VP prices must not be duplicated on top of the live-price badge",
            chart.visibleAxisTagTextsForTest().none { it.startsWith("POC ") })
    }

    @Test fun horizontalPanBeyondProfileTimeKeepsPinnedRealVpReadout() {
        val chart = chartWithProfile(KyvoriqAccessTier.OWNER)
        val base = 1_760_000_000_000L
        val recent = JSONObject().put("source", "OHLCV_15M_ESTIMATE")
            .put("start_ms", base + 82 * 3_600_000L)
            .put("end_ms", base + 90 * 3_600_000L)
            .put("val", 81700.0).put("poc", 83200.0).put("vah", 84000.0)
            .put("bins", JSONArray()
                .put(JSONObject().put("price", 81700.0).put("volume", 10.0))
                .put(JSONObject().put("price", 83200.0).put("volume", 70.0)))
        chart.setSessionProfiles(JSONArray().put(recent))
        chart.setViewportForTest(28f)
        render(chart)
        assertTrue("Historical viewport should show a pinned verified snapshot", chart.isVpPinnedForTest())
        assertEquals(3, chart.visibleVpReadoutForTest().size)
        assertTrue(chart.visibleVpReadoutForTest()[0].contains("83,200"))
    }

    @Test fun dragIntoBlankFutureGutterCannotEraseProfileSelection() {
        val chart = chartWithProfile(KyvoriqAccessTier.OWNER)
        chart.setViewportForTest(-9f)
        render(chart)
        assertEquals("Virtual future bars must not erase VP", 3,
            chart.visibleVpReadoutForTest().size)
        assertFalse("Real recent session remains current", chart.isVpPinnedForTest())
    }

    @Test fun verticalPricePanKeepsHonestVpReadoutEvenWhenBinsAreOutsidePlot() {
        val chart = chartWithProfile(KyvoriqAccessTier.OWNER)
        chart.setViewportForTest(0f, -6000.0)
        render(chart)
        assertEquals(3, chart.visibleVpReadoutForTest().size)
        assertTrue(chart.visibleVpReadoutForTest()[0].startsWith("POC "))
    }

    @Test fun offscreenMonthlyPocShowsBelowContextNotFalsePriceAxisLocation() {
        val chart = chartWithProfile(KyvoriqAccessTier.OWNER, optionalLevelsEnabled = true)
        val outside = JSONObject()
            .put("kind", "MONTHLY_POC").put("label", "Monthly POC")
            .put("source", "TEST_CHART_REFERENCE")
            .put("price", 77249.9).put("reference_expires_ms", Long.MAX_VALUE)
        chart.setReferenceLevels(JSONArray().put(outside))
        chart.setViewportForTest(0f)
        render(chart)
        val hints = chart.visibleOffscreenPriceHintsForTest()
        assertTrue("Below-view level must have a direction and real price: $hints",
            hints.any { it.contains("↓") && it.contains("77,249.9") })
        assertTrue("Offscreen contextual strip must explain that price is below view: $hints",
            hints.any { it.contains("BELOW") })
        assertFalse("77,249.9 is not at a visible axis coordinate",
            chart.visibleAxisTagTextsForTest().any { it.contains("77,249") })
        assertEquals("VP readout must still be present", 3,
            chart.visibleVpReadoutForTest().size)
    }

    @Test fun profileReadoutNeverAppearsForBasicAccount() {
        val chart = chartWithProfile(KyvoriqAccessTier.BASIC)
        render(chart)
        assertEquals(emptyList<String>(), chart.visibleVpReadoutForTest())
    }

    @Test fun noPrivateMembershipPrivilegeLeaksThroughOldScreenshotReferences() {
        val chart = chartWithProfile(KyvoriqAccessTier.BASIC)
        val labels = render(chart)
        assertTrue("Free account must not gain paid VP or level tags", labels.isEmpty())
    }
}
