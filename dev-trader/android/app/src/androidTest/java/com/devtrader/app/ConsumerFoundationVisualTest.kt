package com.devtrader.app

import android.content.Intent
import android.graphics.Rect
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ConsumerFoundationVisualTest {
    private val inst get() = InstrumentationRegistry.getInstrumentation()

    private fun children(root: View): List<View> =
        listOf(root) + if (root is ViewGroup)
            (0 until root.childCount).flatMap { children(root.getChildAt(it)) } else emptyList()

    @Test fun freeMarketUiHasLargerChartAndNoOwnerControls() {
        val activity = inst.startActivitySync(Intent(inst.targetContext, SafeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra("visual_preview", true))
        try {
            SystemClock.sleep(800)
            inst.runOnMainSync {
                val all = children(activity.window.decorView)
                val login = all.filterIsInstance<Button>().first {
                    it.contentDescription == "Sign in or create a KYVORIQ account"
                }
                assertTrue("Account entry must be in header", login.isShown)
                assertFalse(all.any { it.contentDescription == "KYVORIQ music island" })
                assertFalse(all.any { it.contentDescription == "Open KYVORIQ music island" })
                val chart = all.filterIsInstance<MarketChartView>().first()
                assertTrue("Basic chart should be visible", chart.isShown)
                val scale = activity.resources.displayMetrics.density
                assertTrue("Chart needs at least 400 dp of vertical drawing space",
                    chart.height / scale >= 398f)
                assertTrue("Chart should use almost all the viewport width",
                    chart.width >= activity.resources.displayMetrics.widthPixels - (38 * scale))
                val positions = all.filterIsInstance<Button>().first { it.contentDescription == "Workspace POSITIONS" }
                assertFalse("Private positions navigation must be hidden from guests", positions.isShown)
                assertFalse("Admin system checks should be hidden", all.filterIsInstance<Button>().any {
                    it.text.toString() == "SYSTEM CHECK" && it.isShown
                })
            }
        } finally {
            inst.runOnMainSync { activity.finish() }
        }
    }

    @Test fun accountControlIsInteractiveWithoutBypassingServerPermissions() {
        val activity = inst.startActivitySync(Intent(inst.targetContext, SafeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra("visual_preview", true))
        try {
            SystemClock.sleep(650)
            inst.runOnMainSync {
                val account = children(activity.window.decorView).filterIsInstance<Button>()
                    .first { it.contentDescription == "Sign in or create a KYVORIQ account" }
                account.performClick()
            }
            SystemClock.sleep(200)
            // A login choice must not silently pair the device or unlock owner tools.
            assertFalse(KyvoriqSecureSession.isPaired(activity))
        } finally {
            inst.runOnMainSync { activity.finish() }
        }
    }
}
