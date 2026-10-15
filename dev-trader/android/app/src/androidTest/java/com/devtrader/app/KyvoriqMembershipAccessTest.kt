package com.devtrader.app

import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Offline feature-gate tests. Billing is intentionally not enabled, and these tests
 * never contact the backend, pair a device or issue trading orders.
 */
@RunWith(AndroidJUnit4::class)
class KyvoriqMembershipAccessTest {
    @Test fun volumeAndWidgetsAreIncludedForEveryTier() {
        KyvoriqAccessTier.values().forEach { tier ->
            assertTrue(tier.name, tier.volumeIndicator())
            assertTrue(tier.name, tier.homeWidgets())
        }
    }

    @Test fun vpAndFullscreenAreExclusiveToProEliteAndPrivateOwner() {
        assertFalse(KyvoriqAccessTier.BASIC.volumeProfile())
        assertFalse(KyvoriqAccessTier.BASIC.fullscreenChart())
        listOf(KyvoriqAccessTier.PRO, KyvoriqAccessTier.ELITE, KyvoriqAccessTier.OWNER).forEach {
            assertTrue(it.name, it.volumeProfile())
            assertTrue(it.name, it.fullscreenChart())
        }
    }

    @Test fun marketLevelsRespectTheCurrentPlanRoadmap() {
        assertTrue(KyvoriqAccessTier.BASIC.sfpAndBaseIndicators())
        assertFalse(KyvoriqAccessTier.BASIC.dailyWeeklyNpoc())
        assertFalse(KyvoriqAccessTier.PRO.highValueOrderBlocks())
        assertFalse(KyvoriqAccessTier.PRO.dLineAndValueArea())
        assertTrue(KyvoriqAccessTier.ELITE.highValueOrderBlocks())
        assertTrue(KyvoriqAccessTier.ELITE.dLineAndValueArea())
    }

    @Test fun unverifiedPublicUsersAlwaysFailClosedToBasic() {
        assertEquals(KyvoriqAccessTier.BASIC, KyvoriqMembershipAccess.current(false))
        assertEquals(KyvoriqAccessTier.OWNER, KyvoriqMembershipAccess.current(true))
    }

    @Test fun chartCannotEnableFullscreenForBasic() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val chart = MarketChartView(ctx)
        chart.setAccessTier(KyvoriqAccessTier.BASIC)
        chart.setFullscreenMode(true)
        assertFalse(chart.canUseFullscreenChart())
        chart.setAccessTier(KyvoriqAccessTier.PRO)
        assertTrue(chart.canUseFullscreenChart())
        chart.setAccessTier(KyvoriqAccessTier.BASIC)
        assertFalse(chart.canUseFullscreenChart())
    }
}
