package com.devtrader.app

/**
 * RemoteViews TextView auto-sizing is inconsistent across Android launchers
 * and can ellipsize a price even when a smaller font would fit. Use explicit
 * font sizes for the fixed KYVORIQ widget-width tiers instead.
 */
object WidgetTickerLayoutPolicy {
    fun priceSp(widthDp: Int, formattedPrice: String, fontScale: Float = 1f): Float {
        val base = when {
            widthDp < 230 -> 16f
            widthDp < 260 -> 18f
            widthDp < 315 -> 19f
            widthDp < 335 -> 15f // The full wordmark becomes visible at 315dp.
            widthDp < 355 -> 17f
            widthDp < 385 -> 18f
            widthDp < 445 -> 20f
            else -> 22f
        }
        val chars = formattedPrice.length.coerceAtLeast(1)
        val lengthFactor = if (chars > 9) 9f / chars else 1f
        val scale = fontScale.coerceAtLeast(1f)
        return (base * lengthFactor / scale).coerceIn(11f, 24f)
    }
}
