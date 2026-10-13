package com.devtrader.app

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.RemoteViews
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Offline verification of the current native branding, not obsolete Lottie players. */
@RunWith(AndroidJUnit4::class)
class BrandVisualTest {
    private val inst get() = InstrumentationRegistry.getInstrumentation()
    private fun children(v: View): List<View> = listOf(v) + if (v is ViewGroup)
        (0 until v.childCount).flatMap { children(v.getChildAt(it)) } else emptyList()
    private fun save(v: View, name: String) {
        val bitmap = Bitmap.createBitmap(v.width, v.height, Bitmap.Config.ARGB_8888)
        v.draw(Canvas(bitmap))
        val dir = File(inst.targetContext.getExternalFilesDir(null), "build154").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    @Test fun headerHasReadableNonOverlappingActionsAndBrand() {
        val activity = inst.startActivitySync(Intent(inst.targetContext, SafeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("visual_preview", true))
        try {
            SystemClock.sleep(1200)
            inst.runOnMainSync {
                val root = activity.window.decorView
                val controls = children(root).filterIsInstance<Button>().filter {
                    it.contentDescription in listOf("Enable trade alerts", "Reconnect market data") }
                assertEquals(2, controls.size)
                controls.forEach {
                    assertTrue("Control must have words", it.text.toString().any(Char::isLetter))
                    assertTrue("Readable action label", it.textSize / activity.resources.displayMetrics.scaledDensity >= 10f)
                    assertTrue(it.width > 0 && it.height > 0)
                    assertEquals("No action text clipping", 0, it.layout.getEllipsisCount(0))
                }
                val a = android.graphics.Rect(); val b = android.graphics.Rect()
                controls[0].getGlobalVisibleRect(a); controls[1].getGlobalVisibleRect(b)
                assertFalse(android.graphics.Rect.intersects(a,b))
                assertEquals(1, children(root).filterIsInstance<KyvoriqRazorWordmarkView>().size)
                val mark = children(root).filterIsInstance<KyvoriqEmblemMotionView>().first()
                val wordmark = children(root).filterIsInstance<KyvoriqRazorWordmarkView>().first()
                val markBounds = android.graphics.Rect()
                val wordmarkBounds = android.graphics.Rect()
                mark.getGlobalVisibleRect(markBounds)
                wordmark.getGlobalVisibleRect(wordmarkBounds)
                val gapDp = (wordmarkBounds.left - markBounds.right) / activity.resources.displayMetrics.density
                assertTrue("Wordmark should visually hug emblem (gap = $gapDp dp)", gapDp in 0f..22f)
                save(root, "header-chart")
            }
        } finally { inst.runOnMainSync { activity.finish() } }
    }
    @Test fun insightsCardAndNavigationRenderWithoutClipping() {
        val activity = inst.startActivitySync(Intent(inst.targetContext, SafeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("visual_preview", true))
        try {
            SystemClock.sleep(1000)
            inst.runOnMainSync {
                val root = activity.window.decorView
                val insights = children(root).filterIsInstance<Button>().first {
                    it.contentDescription == "Workspace INSIGHTS"
                }
                insights.performClick()
                save(root, "insights")
                val entryHeading = children(root).filterIsInstance<TextView>().first {
                    it.text.toString() == "Entry checks"
                }
                val card = entryHeading.parent as ViewGroup
                assertFalse("Entry report must not be in a nested fixed-height scroll",
                    children(card).any { it is android.widget.ScrollView })
            }
        } finally { inst.runOnMainSync { activity.finish() } }
    }

    @Test fun widgetAndNotificationVariantsFitCompactWidths() {
        inst.runOnMainSync {
            val ctx = inst.targetContext
            val density = ctx.resources.displayMetrics.density
            fun dp(v: Int) = (v*density).toInt()
            for (width in listOf(180,260,340)) {
                for ((layout, name, height) in listOf(
                    Triple(R.layout.widget_kyvoriq_compact,"widget-compact",74),
                    Triple(R.layout.widget_kyvoriq_expanded,"widget-expanded",180),
                    Triple(R.layout.notification_kyvoriq_collapsed,"notification-compact",0),
                    Triple(R.layout.notification_kyvoriq_expanded,"notification-expanded",0))) {
                    if (width == 180 && name.startsWith("notification")) continue
                    val remote = RemoteViews(ctx.packageName,layout)
                    val widget = name.startsWith("widget")
                    if (widget) {
                        remote.setTextViewText(R.id.widget_price_0,"103,725.50")
                        remote.setTextViewText(R.id.widget_health,"SYNCING")
                        if(width < 230) remote.setViewVisibility(R.id.widget_alerts,View.GONE)
                    } else {
                        remote.setTextViewText(R.id.notif_chip,"SYNCING")
                        remote.setTextViewText(R.id.notif_subtitle,"Restoring live monitoring")
                    }
                    val view = remote.apply(ctx,null)
                    view.measure(View.MeasureSpec.makeMeasureSpec(dp(width),View.MeasureSpec.EXACTLY),
                        View.MeasureSpec.makeMeasureSpec(dp(height),if(height>0) View.MeasureSpec.EXACTLY else View.MeasureSpec.UNSPECIFIED))
                    view.layout(0,0,view.measuredWidth,view.measuredHeight)
                    assertTrue(view.height > 0)
                    if(widget) {
                        assertFalse(children(view).filterIsInstance<TextView>().any { it.text.toString() == "WAIT" })
                        val price = view.findViewById<TextView>(R.id.widget_price_0)
                        assertTrue(price.width > 0)
                        assertEquals("Price must be complete at $width dp",0,price.layout.getEllipsisCount(0))
                    }
                    save(view,"$name-$width")
                }
            }
        }
    }
}
