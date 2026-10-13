package com.devtrader.app

/**
 * Actual usable dp, not raw screen pixels: handles display density and font scale.
 * One-row branding on ordinary and compact phones; a clear 2-row fallback
 * when a device has large accessibility text or genuinely tiny windows.
 */
internal object KyvoriqResponsiveLayout {
    data class Header(
        val stackedActions: Boolean,
        val compactActions: Boolean,
        val emblemDp: Int,
        val alertsDp: Int,
        val retryDp: Int,
        val wordmarkHeightDp: Int,
        val taglineWidthDp: Int,
        val chartHeightDp: Int
    )
    fun forViewport(widthDp: Int, heightDp: Int, fontScale: Float): Header {
        val safeWidth = widthDp.coerceAtLeast(240)
        val scale = fontScale.coerceIn(0.8f, 2.5f)
        val stacked = safeWidth < 340 || (scale > 1.35f && safeWidth < 460)
        val compact = safeWidth < 520 || scale > 1.15f
        val emblem = when {
            safeWidth < 335 -> 34
            compact -> 39
            else -> 48
        }
        return Header(
            stackedActions = stacked,
            compactActions = compact && !stacked,
            emblemDp = emblem,
            alertsDp = if (stacked) 91 else if (compact) 42 else 69,
            retryDp = if (stacked) 70 else if (compact) 42 else 56,
            wordmarkHeightDp = if (safeWidth < 335) 26 else 30,
            taglineWidthDp = if (safeWidth < 335) 100 else if (compact) 112 else 109,
            chartHeightDp = when {
                heightDp < 640 -> 300
                heightDp < 760 -> 345
                heightDp < 920 -> 415
                else -> 470
            }
        )
    }
}
