package com.devtrader.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class KyvoriqResponsiveLayoutTest {
    @Test fun narrowPhoneKeepsControlsBesideBrand() {
        val spec = KyvoriqResponsiveLayout.forViewport(360, 780, 1f)
        assertFalse(spec.stackedActions)
        assertTrue(spec.compactActions)
        assertEquals(42, spec.alertsDp)
        assertEquals(42, spec.retryDp)
        assertTrue(spec.emblemDp <= 39)
        assertTrue(spec.chartHeightDp in 300..470)
    }

    @Test fun tinyWindowHasUsableSecondRow() {
        val spec = KyvoriqResponsiveLayout.forViewport(280, 580, 1f)
        assertTrue(spec.stackedActions)
        assertFalse(spec.compactActions)
        assertTrue(spec.alertsDp >= 70)
    }

    @Test fun largeTextAvoidsCrushingWordmark() {
        val spec = KyvoriqResponsiveLayout.forViewport(390, 760, 1.6f)
        assertTrue(spec.stackedActions)
        assertFalse(spec.compactActions)
    }

    @Test fun ordinaryPhoneAndTabletKeepCompleteActions() {
        for (width in listOf(425, 480, 600, 840)) {
            val spec = KyvoriqResponsiveLayout.forViewport(width, 920, 1f)
            assertFalse(spec.stackedActions)
            assertFalse(spec.compactActions)
            assertEquals(69, spec.alertsDp)
            assertEquals(56, spec.retryDp)
        }
    }

    @Test fun compactLandscapeWindowKeepsChartUseable() {
        val spec = KyvoriqResponsiveLayout.forViewport(625, 480, 1.1f)
        assertTrue(spec.chartHeightDp >= 300)
    }
}
