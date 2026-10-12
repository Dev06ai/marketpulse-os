package com.devtrader.app

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import com.airbnb.lottie.LottieAnimationView
import com.airbnb.lottie.LottieDrawable

/** Reusable vector/motion assets, authored as independent Lottie compositions.
 *  The existing gold icon remains a static vector above an amber/gold flame crown;
 *  the cyan/gold custom razor wordmark is geometry, not a generic italic font.
 */
private fun newLottie(context: Context, filename: String): LottieAnimationView =
    LottieAnimationView(context).apply {
        setAnimation(filename)
        repeatCount = LottieDrawable.INFINITE
        repeatMode = LottieDrawable.RESTART
        setRenderMode(com.airbnb.lottie.RenderMode.AUTOMATIC)
        setCacheComposition(true)
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }

class KyvoriqEmblemMotionView(context: Context) : FrameLayout(context) {
    private val flame = newLottie(context, "kyvoriq_gold_flames.json").apply {
        scaleType = ImageView.ScaleType.FIT_XY
    }
    private val mark = ImageView(context).apply {
        setImageResource(R.drawable.kyvoriq_mark)
        scaleType = ImageView.ScaleType.FIT_CENTER
    }
    init {
        contentDescription = "KYVORIQ gold emblem with gold flame crown"
        clipChildren = false
        clipToPadding = false
        addView(flame, LayoutParams(-1, -1))
        addView(mark, LayoutParams(-1, -1).apply {
            gravity = Gravity.CENTER
            topMargin = dp(10f)
        })
    }
    private fun refresh() {
        if (KyvoriqTheme.motionEnabled(context) && isShown && hasWindowFocus()) flame.resumeAnimation()
        else flame.pauseAnimation()
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); refresh() }
    override fun onDetachedFromWindow() { flame.pauseAnimation(); super.onDetachedFromWindow() }
    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        super.onWindowFocusChanged(hasWindowFocus); refresh()
    }
    override fun onVisibilityAggregated(isVisible: Boolean) {
        super.onVisibilityAggregated(isVisible); refresh()
    }
    private fun dp(d:Float) = d * resources.displayMetrics.density
}

class KyvoriqRazorWordmarkView(context: Context) : FrameLayout(context) {
    private val fallback = TextView(context).apply {
        text = "KYVORIQ"
        textSize = 23f
        setTextColor(0xFF17E6FC.toInt())
        typeface = Typeface.create("sans-serif-condensed-black", Typeface.BOLD_ITALIC)
        gravity = Gravity.CENTER
        letterSpacing = -.03f
    }
    private val animation = newLottie(context, "kyvoriq_razor_wordmark.json").apply {
        scaleType = ImageView.ScaleType.FIT_CENTER
        addLottieOnCompositionLoadedListener { fallback.visibility = View.INVISIBLE }
        setFailureListener { fallback.visibility = View.VISIBLE }
    }
    init {
        contentDescription = "KYVORIQ neon cyan electric wordmark"
        addView(fallback, LayoutParams(-1, -1))
        addView(animation, LayoutParams(-1, -1))
    }
    private fun refresh() {
        if (KyvoriqTheme.motionEnabled(context) && isShown && hasWindowFocus()) animation.resumeAnimation()
        else animation.pauseAnimation()
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); refresh() }
    override fun onDetachedFromWindow() { animation.pauseAnimation(); super.onDetachedFromWindow() }
    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        super.onWindowFocusChanged(hasWindowFocus); refresh()
    }
    override fun onVisibilityAggregated(isVisible: Boolean) {
        super.onVisibilityAggregated(isVisible); refresh()
    }
}
