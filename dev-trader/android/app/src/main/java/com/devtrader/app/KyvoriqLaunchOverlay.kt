package com.devtrader.app

import android.content.Context
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/** Build 143: native black/white/deep-gold intro, never the old flame animation. */
class KyvoriqLaunchOverlay(context: Context) : FrameLayout(context) {
    private val easing = PathInterpolator(.18f, .78f, .20f, 1f)
    private var completed = false
    private var onComplete: (() -> Unit)? = null
    private val timeout = Runnable { finish() }
    private val emblem = KyvoriqEmblemMotionView(context).apply {
        alpha = 0f; scaleX = .76f; scaleY = .76f
    }
    private val wordmark = KyvoriqRazorWordmarkView(context).apply {
        alpha = 0f; translationY = dp(12f)
    }
    // Same owner-provided handwritten tagline as the dashboard header.
    private val subtitle = ImageView(context).apply {
        setImageResource(R.drawable.kyvoriq_trade_the_plot)
        scaleType = ImageView.ScaleType.FIT_CENTER
        contentDescription = "Trade the Plot"
        alpha = 0f
    }
    private val hairline = View(context).apply { setBackgroundColor(KyvoriqTheme.deepGold); alpha = 0f }
    private val footer = TextView(context).apply {
        text = "MARKET INTELLIGENCE    / /    EST. 2026"
        gravity = Gravity.CENTER
        setTextColor(KyvoriqTheme.gray)
        typeface = Typeface.create("monospace", Typeface.NORMAL)
        letterSpacing = .05f
        textSize = 9f
        alpha = 0f
    }
    init {
        background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(KyvoriqTheme.charcoal, KyvoriqTheme.slate, KyvoriqTheme.charcoal))
        isClickable = true
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        val top = TextView(context).apply {
            text = "K / /   01"
            setTextColor(KyvoriqTheme.deepGold)
            letterSpacing = .28f
            textSize = 11f
            typeface = Typeface.create("monospace", Typeface.BOLD)
        }
        addView(top, LayoutParams(-2, dp(32f).toInt(), Gravity.TOP or Gravity.START).apply {
            leftMargin = dp(28f).toInt(); topMargin = dp(52f).toInt()
        })
        val lockup = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }
        lockup.addView(emblem, LinearLayout.LayoutParams(dp(194f).toInt(), dp(194f).toInt()).apply {
            gravity = Gravity.CENTER_HORIZONTAL
        })
        lockup.addView(wordmark, LinearLayout.LayoutParams(dp(308f).toInt(), dp(68f).toInt()).apply {
            gravity = Gravity.CENTER_HORIZONTAL; topMargin = dp(16f).toInt()
        })
        lockup.addView(subtitle, LinearLayout.LayoutParams(dp(186f).toInt(), dp(29f).toInt()).apply {
            gravity = Gravity.END; rightMargin = dp(15f).toInt(); topMargin = dp(1f).toInt()
        })
        lockup.addView(hairline, LinearLayout.LayoutParams(dp(206f).toInt(), dp(1f).toInt().coerceAtLeast(1)).apply {
            gravity = Gravity.CENTER_HORIZONTAL; topMargin = dp(11f).toInt()
        })
        addView(lockup, LayoutParams(-1, -1, Gravity.CENTER))
        addView(footer, LayoutParams(-1, dp(48f).toInt(), Gravity.BOTTOM).apply {
            bottomMargin = dp(44f).toInt()
        })
    }
    fun play(onEnd: () -> Unit) {
        if (completed) { onEnd(); return }
        onComplete = onEnd
        if (!KyvoriqTheme.motionEnabled(context)) { finish(); return }
        post {
            if (completed || onComplete == null) return@post
            postDelayed(timeout, 1950L)
            emblem.animate().alpha(1f).scaleX(1f).scaleY(1f).setStartDelay(90L)
                .setDuration(520L).setInterpolator(easing).start()
            wordmark.animate().alpha(1f).translationY(0f).setStartDelay(390L)
                .setDuration(470L).setInterpolator(easing).start()
            hairline.animate().alpha(1f).setStartDelay(720L).setDuration(240L).start()
            subtitle.animate().alpha(1f).setStartDelay(920L).setDuration(260L).start()
            footer.animate().alpha(1f).setStartDelay(1000L).setDuration(260L).start()
            animate().alpha(0f).setStartDelay(1510L).setDuration(250L)
                .setInterpolator(easing).withEndAction { finish() }.start()
        }
    }
    internal fun showVerificationFrame() {
        emblem.alpha = 1f; emblem.scaleX = 1f; emblem.scaleY = 1f
        wordmark.alpha = 1f; wordmark.translationY = 0f
        subtitle.alpha = 1f; hairline.alpha = 1f; footer.alpha = 1f; alpha = 1f
    }
    private fun finish() {
        if (completed) return
        completed = true
        removeCallbacks(timeout)
        val callback = onComplete
        onComplete = null
        callback?.invoke()
    }
    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        super.onWindowFocusChanged(hasWindowFocus)
        if (!hasWindowFocus && onComplete != null) finish()
    }
    override fun onDetachedFromWindow() {
        removeCallbacks(timeout)
        animate().cancel()
        emblem.animate().cancel()
        wordmark.animate().cancel()
        subtitle.animate().cancel()
        footer.animate().cancel()
        hairline.animate().cancel()
        onComplete = null
        completed = true
        super.onDetachedFromWindow()
    }
    private fun dp(value: Float) = value * resources.displayMetrics.density
}
