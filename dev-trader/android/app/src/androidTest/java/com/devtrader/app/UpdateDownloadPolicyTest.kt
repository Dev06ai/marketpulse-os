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
    @Test fun releaseAssetUrlMustBeExactSignedApkPath() {
        assertTrue(UpdateDownloadPolicy.isTrustedReleaseApkUrl(
            "https://github.com/Dev06ai/marketpulse-os/releases/download/dev-trader-v0.21.54-179/app-release.apk"))
        assertFalse(UpdateDownloadPolicy.isTrustedReleaseApkUrl(
            "http://github.com/Dev06ai/marketpulse-os/releases/download/dev-trader-v0.21.54-179/app-release.apk"))
        assertFalse(UpdateDownloadPolicy.isTrustedReleaseApkUrl(
            "https://github.com/attacker/marketpulse-os/releases/download/dev-trader-v0.21.54-179/app-release.apk"))
        assertFalse(UpdateDownloadPolicy.isTrustedReleaseApkUrl(
            "https://github.com/Dev06ai/marketpulse-os/releases/download/dev-trader-v0.21.54-179/app-release.apk?redirect=evil"))
        assertFalse(UpdateDownloadPolicy.isTrustedReleaseApkUrl(
            "https://github.com/Dev06ai/marketpulse-os/releases/download/dev-trader-v0.21.54-179/malware.apk"))
    }

    @Test fun downloadProgressNeverPretendsUnknownSizeIsZeroPercent() {
        assertEquals(-1, UpdateDownloadPolicy.percent(65536L, -1L))
        assertEquals(-1, UpdateDownloadPolicy.percent(-5L, 100L))
        assertEquals(25, UpdateDownloadPolicy.percent(250L, 1000L))
        assertEquals(99, UpdateDownloadPolicy.percent(1000L, 1000L))
        assertEquals(99, UpdateDownloadPolicy.percent(4000L, 1000L))
    }
}
