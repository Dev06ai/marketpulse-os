package com.devtrader.app

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class HeroChartVisualTest {
    private val inst get() = InstrumentationRegistry.getInstrumentation()
    private fun children(v: View): List<View> = listOf(v) +
        if (v is ViewGroup) (0 until v.childCount).flatMap { children(v.getChildAt(it)) } else emptyList()
    private fun screenshot(name: String) {
        val target = File(inst.targetContext.getExternalFilesDir(null), "$name.png")
        inst.uiAutomation.takeScreenshot().useBitmap { bitmap ->
            target.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
    }
    private fun Bitmap.useBitmap(block: (Bitmap) -> Unit) { try { block(this) } finally { recycle() } }
    private fun tap(chart: MarketChartView, x: Float, y: Float) {
        val now = SystemClock.uptimeMillis()
        listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP).forEachIndexed { i, action ->
            MotionEvent.obtain(now, now + i * 60, action, x, y, 0).also {
                chart.onTouchEvent(it); it.recycle()
            }
        }
    }
    @Test fun chartOwnsTheViewportAndRetainsInteractions() {
        KyvoriqSecureSession.clear(inst.targetContext)
        val activity = inst.startActivitySync(Intent(inst.targetContext, SafeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("visual_preview", true))
        try {
            SystemClock.sleep(900)
            inst.runOnMainSync {
                val all = children(activity.window.decorView)
                val chart = all.filterIsInstance<MarketChartView>().first()
                val root = activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0)
                val usable = root.height - root.paddingTop - root.paddingBottom
                val portrait = root.height >= root.width
                val ratio = chart.height.toFloat() / usable
                if (portrait) assertTrue("Chart/window ratio $ratio", ratio in .55f.. .58f)
                assertTrue("Near edge-to-edge width", chart.width >= root.width - root.paddingLeft - root.paddingRight)
                val plot = chart.plotGeometry()
                assertTrue("Actual candles must grow with container", plot.price.height() >= chart.height * (if (portrait) .57f else .40f))
                assertTrue("Price rail must remain compact", plot.price.width() >= chart.width * .78f)
                assertTrue("Volume must remain subordinate", plot.volume.height() / chart.height in .18f.. .22f)
                val visible = Rect()
                chart.getGlobalVisibleRect(visible)
                if (portrait && activity.resources.configuration.fontScale <= 1.1f) {
                    assertTrue("Visible chart must exceed half the usable screen: ${visible.height()}/$usable",
                        visible.height().toFloat() / usable >= .51f)
                }
                assertTrue(all.filterIsInstance<Button>().first { it.contentDescription == "Workspace TRADE" }.isShown)
                val tf = all.filterIsInstance<Button>().first { it.contentDescription == "Chart 4h" }
                tf.performClick()
                val field = MarketChartView::class.java.getDeclaredField("timeframe").apply { isAccessible = true }
                assertEquals("4h", field.get(chart))
                all.filterIsInstance<Button>().first { it.contentDescription == "Chart 15m" }.performClick()
                val density = activity.resources.displayMetrics.density
                val before = chart.plotGeometry().price.height()
                tap(chart, 123f * density, 29f * density) // VOL
                assertTrue("Hiding volume expands price plot", chart.plotGeometry().price.height() > before)
                tap(chart, 123f * density, 29f * density)
                val now = SystemClock.uptimeMillis()
                listOf(Triple(MotionEvent.ACTION_DOWN, 160f, 170f),
                    Triple(MotionEvent.ACTION_MOVE, 110f, 205f),
                    Triple(MotionEvent.ACTION_UP, 110f, 205f)).forEachIndexed { i, (action, x, y) ->
                    MotionEvent.obtain(now, now + i * 100, action, x * density, y * density, 0).also {
                        chart.onTouchEvent(it); it.recycle()
                    }
                }
                val follow = MarketChartView::class.java.getDeclaredField("followLive").apply { isAccessible = true }
                assertEquals("Pan must leave live-follow mode", false, follow.get(chart))
                tap(chart, chart.width - 25f * density, 15f * density) // live reset
                assertEquals(true, follow.get(chart))
                tap(chart, 162f * density, 29f * density) // fullscreen
                assertTrue(children(activity.window.decorView).any { it.contentDescription == "Fullscreen KYVORIQ chart" })
                tap(chart, 162f * density, 29f * density) // restore same chart and sizing
            }
            SystemClock.sleep(250)
            screenshot("trade")
            // Build 160: deliberately overlap 1H/4H/12H and supply/demand
            // zones. Labels use real fixture boundaries, never inferred ticks.
            // Every viewport captures the actual rendered result for review.
            inst.runOnMainSync {
                val chart = children(activity.window.decorView)
                    .filterIsInstance<MarketChartView>().first()
                val formatter = MarketChartView::class.java
                    .getDeclaredMethod("exactZonePrice", java.lang.Double.TYPE)
                    .apply { isAccessible = true }
                assertEquals("83,409.25", formatter.invoke(chart, 83409.25))
                assertEquals("83,409.125", formatter.invoke(chart, 83409.125))
                val ob = JSONArray()
                fun zone(name: String, lo: Double, hi: Double, direction: String) {
                    ob.put(JSONObject().put("kind", "OB_ZONE").put("label", name)
                        .put("price", (lo + hi) / 2.0)
                        .put("zone_low", lo).put("zone_high", hi)
                        .put("direction", direction))
                }
                // Keep both intraday zones inside the preview's 84.1k–84.5k
                // visible market range, so this actually tests overlapping
                // price capsules instead of testing only an off-screen zone.
                zone("1H OB", 84345.25, 84405.50, "LONG")
                zone("4H OB", 84370.75, 84435.125, "LONG")
                zone("12H OB", 84180.50, 84300.25, "SHORT")
                zone("DAILY OB", 84020.125, 84190.25, "LONG")
                chart.setOverlays(ob)
                assertTrue(chart.plotGeometry().price.height() > 0)
            }
            SystemClock.sleep(120)
            screenshot("ob-price-labels")
            inst.runOnMainSync {
                children(activity.window.decorView).filterIsInstance<Button>()
                    .first { it.contentDescription == "Sign in or create a KYVORIQ account" }.performClick()
            }
            SystemClock.sleep(250)
            screenshot("account-free")
            assertFalse("Opening sheet must not grant owner access", KyvoriqSecureSession.isPaired(activity))
            inst.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK) // close account sheet
            SystemClock.sleep(200)
            // Offline preview only: synthetic expiring device fixture never authenticates a request.
            KyvoriqSecureSession.save(activity, "kvq.v1.invalid-visual-fixture", System.currentTimeMillis()/1000 + 300)
            inst.runOnMainSync {
                children(activity.window.decorView).filterIsInstance<Button>()
                    .first { it.contentDescription == "Sign in or create a KYVORIQ account" }.performClick()
            }
            SystemClock.sleep(250)
            screenshot("account-owner")
        } catch (failure: Throwable) {
            screenshot("failure")
            throw failure
        } finally {
            KyvoriqSecureSession.clear(inst.targetContext)
            inst.runOnMainSync { activity.finish() }
        }
    }
}
