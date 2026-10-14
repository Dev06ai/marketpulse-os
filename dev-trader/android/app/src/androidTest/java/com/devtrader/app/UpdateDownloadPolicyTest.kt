package com.devtrader.app

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4

@RunWith(AndroidJUnit4::class)
class UpdateDownloadPolicyTest {
    @Test fun downloadAtZeroBytesCannotRemainStuckForever() {
        assertFalse(UpdateDownloadPolicy.isStalled(1000L, 1000L, 59_999L))
        assertTrue(UpdateDownloadPolicy.isStalled(1000L, 1000L, 61_000L))
    }
    @Test fun progressResetsIdleWatchdogButNotAbsoluteDeadline() {
        assertFalse(UpdateDownloadPolicy.isStalled(180_000L, 1000L, 200_000L))
        assertTrue(UpdateDownloadPolicy.isStalled(239_000L, 1000L, 241_000L))
    }
    @Test fun clockRollbackMustNotCancelValidDownload() {
        assertFalse(UpdateDownloadPolicy.isStalled(60_000L, 60_000L, 1000L))
    }
}
