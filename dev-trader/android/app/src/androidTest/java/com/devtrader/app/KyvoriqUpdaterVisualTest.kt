package com.devtrader.app

import android.content.Intent
import android.os.SystemClock
import android.view.View
import android.widget.Button
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Regression: Check for Updates must work without a consumer account/owner token. */
@RunWith(AndroidJUnit4::class)
class KyvoriqUpdaterVisualTest {
    @Test fun updateButtonIsPublicAndIndependentOfOwnerOnlySystemCheck() {
        val inst = InstrumentationRegistry.getInstrumentation()
        KyvoriqSecureSession.clear(inst.targetContext)
        val activity = inst.startActivitySync(
            Intent(inst.targetContext, SafeActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra("visual_preview", true)
        )
        try {
            inst.runOnMainSync {
                val select = SafeActivity::class.java
                    .getDeclaredMethod("selectWorkspace", Int::class.javaPrimitiveType!!)
                    .apply { isAccessible = true }
                select.invoke(activity, 2)
            }
            SystemClock.sleep(350L)
            inst.runOnMainSync {
                val update = SafeActivity::class.java.getDeclaredField("updateButton")
                    .apply { isAccessible = true }.get(activity) as Button
                val systemCheck = SafeActivity::class.java.getDeclaredField("checkButton")
                    .apply { isAccessible = true }.get(activity) as Button
                @Suppress("UNCHECKED_CAST")
                val adminViews = SafeActivity::class.java.getDeclaredField("adminOnlyViews")
                    .apply { isAccessible = true }.get(activity) as List<View>
                assertTrue("Update must be visible even when signed out", update.isShown)
                assertTrue("Update must be enabled", update.isEnabled)
                assertTrue("Update button must not be gated on owner access",
                    adminViews.none { it === update || it === update.parent })
                assertTrue("System diagnostics remain owner-only",
                    adminViews.any { it === systemCheck.parent })
                assertTrue("Accessibility label must explain update action",
                    update.contentDescription.toString().contains("app updates"))
            }
        } finally {
            inst.runOnMainSync { activity.finish() }
        }
    }
}
