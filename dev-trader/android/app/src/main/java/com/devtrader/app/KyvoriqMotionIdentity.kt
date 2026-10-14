package com.devtrader.app

import android.content.Context
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView

/**
 * Build 143 identity: the angular emblem shared with the launcher, widgets and
 * notifications. Do not replay the old flame/razor Lotties over this logo.
 */
open class KyvoriqIdentityMotionView(context: Context, description: String) : FrameLayout(context) {
    init { contentDescription = description }
}
class KyvoriqEmblemMotionView(context: Context) :
    KyvoriqIdentityMotionView(context, "KYVORIQ angular ivory emblem") {
    init {
        addView(ImageView(context).apply {
            setImageResource(R.drawable.kyvoriq_mark)
            scaleType = ImageView.ScaleType.FIT_CENTER
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }
}
/** Pixel-faithful KYVORIQ reference wordmark (nested-ring O). */
class KyvoriqRazorWordmarkView(context: Context) : FrameLayout(context) {
    init {
        contentDescription = "KYVORIQ geometric concentric-ring wordmark"
        addView(ImageView(context).apply {
            setImageResource(R.drawable.kyvoriq_concentric_wordmark)
            // Text hugs the mark; centering a wide vector view created a fake gap.
            scaleType = ImageView.ScaleType.FIT_START
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }
}
