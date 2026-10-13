package com.devtrader.app

/** All dimensions are dp from the usable viewport, never raw display pixels. */
internal object KyvoriqResponsiveLayout {
    data class Header(
        val stackedActions: Boolean,
        val compactActions: Boolean,
        val emblemDp: Int,
        val alertsDp: Int,
        val retryDp: Int,
        val wordmarkHeightDp: Int,
        val wordmarkWidthDp: Int,
        val taglineWidthDp: Int,
        val chartHeightDp: Int
    )

    fun forViewport(widthDp: Int, heightDp: Int, fontScale: Float): Header {
        val width = widthDp.coerceAtLeast(240)
        val font = fontScale.coerceIn(0.8f, 2.5f)
        val narrow = width < 600 || font > 1.15f
        val emblem = when {
            width < 320 -> 40
            width < 380 -> 44
            else -> 48
        }
        // Reserve enough room for the brand on very narrow split-screen windows.
        val wordmark = (when {
            width < 300 -> 142
            width < 345 -> 165
            width < 390 -> 191
            else -> 205
        }).coerceAtMost(width - emblem - 36)
        return Header(
            stackedActions = narrow,
            compactActions = width < 520 || font > 1.15f,
            emblemDp = emblem,
            alertsDp = 112,
            retryDp = 96,
            wordmarkHeightDp = if (width < 300) 32 else 38,
            wordmarkWidthDp = wordmark,
            taglineWidthDp = if (width < 300) 86 else 105,
            chartHeightDp = when {
                heightDp < 640 -> 280
                heightDp < 760 -> 330
                heightDp < 920 -> 365
                else -> 405
            }
        )
    }
}
