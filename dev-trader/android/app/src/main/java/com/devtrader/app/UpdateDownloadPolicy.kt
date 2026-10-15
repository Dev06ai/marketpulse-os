package com.devtrader.app

/**
 * DownloadManager may stay RUNNING at zero bytes forever when a CDN is blocked.
 * Never use a stalled partial APK; offer a browser/retry route instead.
 */
object UpdateDownloadPolicy {
    private const val NO_PROGRESS_MS = 60_000L
    private const val ABSOLUTE_DOWNLOAD_MS = 4 * 60_000L

    private val releaseApkPattern = Regex(
        """https://github[.]com/Dev06ai/marketpulse-os/releases/download/dev-trader-v[0-9]+[.][0-9]+[.][0-9]+-[0-9]+/app-release[.]apk"""
    )

    // Only pinned GitHub release assets from our own repository can be installed.
    fun isTrustedReleaseApkUrl(url: String): Boolean = releaseApkPattern.matches(url)

    /** Unknown content length is represented explicitly, never a fake 0% forever. */
    fun percent(received: Long, expected: Long): Int {
        if (received < 0L || expected <= 0L) return -1
        return ((received * 100.0) / expected).toInt().coerceIn(0, 99)
    }

    fun isStalled(lastProgressMs: Long, startedMs: Long, nowMs: Long): Boolean {
        if (nowMs < lastProgressMs || nowMs < startedMs) return false
        return nowMs - lastProgressMs >= NO_PROGRESS_MS ||
            nowMs - startedMs >= ABSOLUTE_DOWNLOAD_MS
    }
}
