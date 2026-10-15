package com.devtrader.app

import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.fragment.app.FragmentActivity
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.viewpager2.widget.ViewPager2
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Offline preview assertion: three accessible plans, working selection, no checkout. */
@RunWith(AndroidJUnit4::class)
class KyvoriqMembershipCarouselTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    private fun descendants(v: View): List<View> = listOf(v) +
        if (v is ViewGroup) (0 until v.childCount).flatMap { descendants(v.getChildAt(it)) }
        else emptyList()

    @Test fun membershipCarouselChangesPlanWithoutActivatingBilling() {
        val activity = instrumentation.startActivitySync(
            Intent(instrumentation.targetContext, SafeActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra("visual_preview", true)
        ) as FragmentActivity
        var dialog: android.app.Dialog? = null
        try {
            instrumentation.runOnMainSync {
                dialog = KyvoriqMembershipCarousel(activity).show()
                assertNotNull(dialog)
                val root = requireNotNull(dialog?.window?.decorView)
                val pager = descendants(root).filterIsInstance<ViewPager2>().single()
                assertEquals(3, pager.adapter?.itemCount)
                assertEquals(1, pager.currentItem)
                val textBefore = descendants(root).filterIsInstance<Button>()
                    .first { it.text.contains("EXPLORE") }.text.toString()
                assertTrue(textBefore.contains("PRO"))

                pager.setCurrentItem(2, false)
                assertEquals(2, pager.currentItem)
                val all = descendants(root)
                val action = all.filterIsInstance<Button>().first { it.text.contains("EXPLORE") }
                assertTrue(action.text.contains("ELITE"))
                assertTrue(all.filterIsInstance<TextView>().any {
                    it.text.contains("checkout are not active")
                })
                assertTrue(all.any { it.contentDescription == "Show BASIC membership" })
                assertTrue(all.any { it.contentDescription == "Show ELITE membership" })
                dialog?.dismiss()
            }
        } finally {
            instrumentation.runOnMainSync {
                dialog?.dismiss()
                activity.finish()
            }
        }
    }
}
