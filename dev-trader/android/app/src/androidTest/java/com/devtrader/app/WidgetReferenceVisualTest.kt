package com.devtrader.app

import android.graphics.Rect
import android.view.View
import android.widget.ImageView
import android.widget.RemoteViews
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Regression for the selected KYVORIQ black/ivory 4x1 ticker across launchers. */
@RunWith(AndroidJUnit4::class)
class WidgetReferenceVisualTest {
    @Test fun tickerHasReadablePriceAndReachableAlertsAcrossWidgetWidths() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync {
            val context = instrumentation.targetContext
            val d = context.resources.displayMetrics.density
            for (width in listOf(180, 240, 260, 315, 340, 385, 460)) {
                val rv = RemoteViews(context.packageName, R.layout.widget_kyvoriq_compact)
                rv.setTextViewText(R.id.widget_price_0, "81,574.90")
                val mark = if (width >= 315) View.VISIBLE else View.GONE
                rv.setViewVisibility(R.id.widget_wordmark, mark)
                rv.setViewVisibility(R.id.widget_brand_divider, mark)
                rv.setViewVisibility(R.id.widget_market_divider,
                    if (width >= 355) View.VISIBLE else View.GONE)
                rv.setViewVisibility(R.id.widget_health,
                    if (width >= 385) View.VISIBLE else View.GONE)
                rv.setViewVisibility(R.id.widget_alerts,
                    if (width >= 230) View.VISIBLE else View.GONE)
                rv.setTextViewText(R.id.widget_health, if (width >= 445) "MARKET LIVE" else "LIVE")
                val root = rv.apply(context, null)
                root.measure(
                    View.MeasureSpec.makeMeasureSpec((width * d).toInt(), View.MeasureSpec.EXACTLY),
                    View.MeasureSpec.makeMeasureSpec((74 * d).toInt(), View.MeasureSpec.EXACTLY)
                )
                root.layout(0, 0, root.measuredWidth, root.measuredHeight)
                val price = root.findViewById<TextView>(R.id.widget_price_0)
                val emblem = root.findViewById<ImageView>(R.id.widget_brand_emblem)
                val alerts = root.findViewById<View>(R.id.widget_alerts)
                assertTrue("Emblem must remain visible at $width dp", emblem.width > 0)
                assertTrue("BTC price must have width at $width dp", price.width > 0)
                assertEquals("BTC price must not be truncated at $width dp",
                    0, price.layout.getEllipsisCount(0))
                if (width >= 230) {
                    assertTrue("Alerts must be visible at $width dp", alerts.width > 0)
                    val p = Rect()
                    val a = Rect()
                    price.getHitRect(p)
                    alerts.getHitRect(a)
                    assertTrue("Alerts must be within available bounds at $width dp",
                        alerts.right <= root.width && alerts.left >= 0)
                }
                assertEquals("Price always uses a single line", 1, price.lineCount)
            }
        }
    }
}
