package com.devtrader.app

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlin.math.abs
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Axis labels must never overlap or move their underlying source price lines. */
@RunWith(AndroidJUnit4::class)
class ChartAxisRailTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val density get() = context.resources.displayMetrics.density
    private fun d(dp: Float) = dp * density

    @Test fun reservesLivePriceAndHidesCrowdedLevelsWithoutStretching() {
        val chart = MarketChartView(context)
        val top = d(50f)
        val bottom = d(360f)
        val live = d(195f)
        val ideals = listOf(190f, 194f, 197f, 203f, 230f, 295f).map(::d)
        val centers = chart.layoutAxisTagCenters(ideals, top, bottom, listOf(live))
        assertEquals(ideals.size, centers.size)
        val accepted = centers.filterNotNull()
        assertTrue("Uncrowded labels should remain visible", accepted.size >= 2)
        assertTrue("Labels at the live price must be hidden rather than sent far away",
            centers.take(4).all { it == null })
        ideals.zip(centers).forEach { (source, center) ->
            if (center == null) return@forEach
            assertTrue("Tag must stay in plot", center >= top + d(10f) && center <= bottom - d(10f))
            assertTrue("Tag cannot cover live BTC", abs(center - live) >= d(25f))
            assertTrue("Stretched price leader detected", abs(center - source) <= d(6f) + 0.1f)
        }
        for (i in accepted.indices) for (j in i + 1 until accepted.size) {
            assertTrue("Overlapping axis badges at $i/$j", abs(accepted[i] - accepted[j]) >= d(21f) - 0.1f)
        }
        assertEquals("Layout must be stable between draw frames",
            centers, chart.layoutAxisTagCenters(ideals, top, bottom, listOf(live)))
    }

    @Test fun priceOrderCannotBeReversedByMovingLabelsToOtherPrices() {
        val chart = MarketChartView(context)
        val ideals = listOf(190f, 210f, 198f, 170f, 235f).map(::d)
        val result = chart.layoutAxisTagCenters(ideals, d(50f), d(280f), emptyList())
        // The 198dp label is close to the protected 190dp label; don't send it
        // above 170dp or below 210dp merely to fill a free space.
        assertNull("Crowded 198dp level must be hidden instead of displaced", result[2])
        ideals.zip(result).forEach { (priceY, tagY) ->
            if (tagY != null) {
                assertTrue("App may not misrepresent a level's vertical price",
                    abs(priceY - tagY) <= d(6f) + 0.1f)
            }
        }
        val visible = ideals.zip(result).mapNotNull { (source, shown) ->
            if (shown == null) null else source to shown
        }.sortedBy { it.first }
        for (i in 0 until visible.size - 1) {
            assertTrue("Higher-priced marker visually appears below a lower-priced one",
                visible[i].second < visible[i + 1].second)
        }
    }

    @Test fun handlesTinyViewportsWithoutRenderingOffscreenBadges() {
        val chart = MarketChartView(context)
        val positions = chart.layoutAxisTagCenters(
            List(12) { d(44f) }, d(40f), d(65f), listOf(d(52f))
        )
        assertEquals(12, positions.size)
        assertTrue("Crowded axis should hide lower priority badges", positions.count { it == null } >= 11)
        assertEquals(List(2) { null }, chart.layoutAxisTagCenters(
            listOf(d(40f), d(60f)), d(40f), d(48f), emptyList()))
    }

    @Test fun renderedPriceRailIsInsideCanvasAndBadgesDoNotIntersect() {
        val chart = MarketChartView(context)
        val chartWidth = d(393f).toInt()
        val chartHeight = d(630f).toInt()
        chart.layout(0, 0, chartWidth, chartHeight)
        val candles = JSONArray()
        val begin = 1_760_000_000_000L
        repeat(90) { i ->
            val ts = begin + i * 3_600_000L
            candles.put(JSONObject().put("start", ts).put("end", ts + 3_600_000L)
                .put("open", 83000.0).put("close", 82900.0)
                .put("high", 85100.0).put("low", 80700.0).put("volume", 300.0))
        }
        val levels = JSONArray()
        listOf(
            "NPOC" to 82400.0, "RANGE_POC" to 82440.0,
            "DAILY" to 82500.0, "WEEKLY" to 82545.0,
            "NPOC" to 82600.0, "DAILY" to 83000.0,
            "WEEKLY" to 84400.0
        ).forEachIndexed { i, (kind, value) ->
            levels.put(JSONObject().put("kind", kind).put("label", "$kind-$i")
                .put("price", value).put("id", "axis-test-$i"))
        }
        chart.setData(candles, null, null, 82530.0, levels)
        val bitmap = Bitmap.createBitmap(chartWidth, chartHeight, Bitmap.Config.ARGB_8888)
        try {
            chart.draw(Canvas(bitmap))
            val badges = chart.visibleAxisLabelRectsForTest()
            val anchors = chart.visibleAxisPriceAnchorsForTest()
            assertEquals("Every visible badge must retain a true source price anchor", badges.size, anchors.size)
            for ((source, displayed) in anchors) {
                assertTrue("Source-to-badge distance must stay under 6dp",
                    abs(source - displayed) <= d(6f) + 0.1f)
            }
            assertTrue("Fixture needs at least two rendered axis badges", badges.size >= 2)
            for (badge in badges) {
                assertTrue("Badge must not enter candle plot", badge.left >= chart.plotGeometry().price.right)
                assertTrue("Badge must be fully in view", badge.right <= chartWidth && badge.left >= 0f)
                assertTrue("Badge must have height", badge.height() >= d(17f))
            }
            for (i in badges.indices) for (j in i+1 until badges.size) {
                assertFalse("Badge boxes overlap", android.graphics.RectF.intersects(badges[i], badges[j]))
                assertTrue("Need visible badge separation",
                    abs(badges[i].centerY() - badges[j].centerY()) >= d(21f) - 0.5f)
            }
        } finally {
            bitmap.recycle()
        }
    }
}
