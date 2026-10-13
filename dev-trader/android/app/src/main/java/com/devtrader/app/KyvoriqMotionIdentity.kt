package com.devtrader.app

import android.content.Context
import android.graphics.Typeface
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView

/**
 * Build 143 identity: the angular emblem shared with the launcher, widgets and
 * notifications. Do not replay the old flame/razor Lotties over this logo.
 */
open class KyvoriqIdentityMotionView(context: Context, description: String) : FrameLayout(context) {
    init { contentDescription = description }
}
class KyvoriqEmblemMotionView(context: Context) :
    KyvoriqIdentityMotionView(context, "KYVORIQ angular deep-gold emblem") {
    init {
        addView(ImageView(context).apply {
            setImageResource(R.drawable.kyvoriq_mark)
            scaleType = ImageView.ScaleType.FIT_CENTER
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }
}
class KyvoriqRazorWordmarkView(context: Context) :
    KyvoriqIdentityMotionView(context, "KYVORIQ serif-display wordmark") {
    init {
        addView(TextView(context).apply {
            text = "KYVORIQ"
            typeface = Typeface.create("serif", Typeface.BOLD)
            setTextColor(KyvoriqTheme.white)
            gravity = Gravity.CENTER
            isSingleLine = true
            includeFontPadding = false
            letterSpacing = .035f
            setTextScaleX(.93f)
            setAutoSizeTextTypeUniformWithConfiguration(12, 38, 1, TypedValue.COMPLEX_UNIT_SP)
        }, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }
}
