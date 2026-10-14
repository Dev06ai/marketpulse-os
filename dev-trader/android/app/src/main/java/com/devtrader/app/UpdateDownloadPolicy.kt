package com.devtrader.app

/**
 * DownloadManager may stay RUNNING at zero bytes forever when a CDN is blocked.
 * Never use a stalled partial APK; offer a browser/retry route instead.
 */
object UpdateDownloadPolicy {
    private const val NO_PROGRESS_MS = 60_000L
    private const val ABSOLUTE_DOWNLOAD_MS = 4 * 60_000L

    fun isStalled(lastProgressMs: Long, startedMs: Long, nowMs: Long): Boolean {
        if (nowMs < lastProgressMs || nowMs < startedMs) return false
        return nowMs - lastProgressMs >= NO_PROGRESS_MS ||
            nowMs - startedMs >= ABSOLUTE_DOWNLOAD_MS
    }
}
