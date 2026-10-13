package com.devtrader.app
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
@RunWith(AndroidJUnit4::class)
class KyvoriqResponsiveLayoutTest {
    @Test fun phoneActionsHaveTheirOwnReadableRow() {
        for(width in listOf(240,280,320,360,390,425,480)) {
            val spec=KyvoriqResponsiveLayout.forViewport(width,780,1f)
            assertTrue(spec.stackedActions)
            assertTrue(spec.emblemDp>=48)
            assertTrue(spec.alertsDp>=112)
            assertTrue(spec.alertsDp+spec.retryDp+8<=width)
        }
    }
    @Test fun tabletCanFitInlineActions() {
        assertFalse(KyvoriqResponsiveLayout.forViewport(840,920,1f).stackedActions)
        assertTrue(KyvoriqResponsiveLayout.forViewport(840,920,1.6f).stackedActions)
    }
}
