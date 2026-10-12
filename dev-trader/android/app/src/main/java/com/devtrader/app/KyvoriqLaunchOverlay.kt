package com.devtrader.app

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Cinematic vector storyboard: authored Lottie logo and wordmark compositions.
 * Kept under 1.8 seconds, with a static fallback when motion is disabled.
 * Asset-driven animation avoids GIF raster scaling and full-screen video decoder overhead.
 */
class KyvoriqLaunchOverlay(context: Context) : FrameLayout(context) {
    private val ease = PathInterpolator(.18f, .80f, .22f, 1f)
    private val circuit = CyberpunkCircuitBackdrop(context)
    private val emblem = KyvoriqEmblemMotionView(context).apply {
        alpha = 0f; scaleX = .66f; scaleY = .66f
    }
    private val wordmark = KyvoriqRazorWordmarkView(context).apply {
        alpha = 0f; translationX = -dp(36f)
    }
    private val subtitle = TextView(context).apply {
        text = "KYVORIQ  //  MARKET INTELLIGENCE"
        textSize = 10f
        typeface = Typeface.create("monospace", Typeface.BOLD)
        setTextColor(0xFFABC1CC.toInt())
        letterSpacing = .12f
        gravity = Gravity.CENTER
        includeFontPadding = false
        alpha = 0f
    }
    private val energy = View(context).apply {
        background = GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            intArrayOf(Color.TRANSPARENT, 0xFFFFAF26.toInt(), 0xFF18DBF8.toInt(), Color.TRANSPARENT)
        )
        alpha = 0f
        scaleX = .01f
    }

    init {
        setBackgroundColor(0xFF060C12.toInt())
        isClickable = true
        isFocusable = true
        addView(circuit, LayoutParams(-1, -1))
        val center = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }
        center.addView(emblem, LinearLayout.LayoutParams(dp(172f).toInt(), dp(172f).toInt()).apply {
            gravity = Gravity.CENTER_HORIZONTAL
        })
        center.addView(wordmark, LinearLayout.LayoutParams(dp(296f).toInt(), dp(68f).toInt()).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = dp(4f).toInt()
        })
        center.addView(subtitle, LinearLayout.LayoutParams(-1, dp(28f).toInt()).apply {
            topMargin = dp(9f).toInt()
        })
        center.addView(energy, LinearLayout.LayoutParams(dp(275f).toInt(), dp(2f).toInt()).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = dp(8f).toInt()
        })
        addView(center, LayoutParams(-1, -1))
    }

    fun play(onEnd: () -> Unit) {
        if (!KyvoriqTheme.motionEnabled(context)) { onEnd(); return }
        post {
            emblem.animate().alpha(1f).scaleX(1f).scaleY(1f)
                .setStartDelay(120L).setDuration(560L).setInterpolator(ease).withLayer().start()
            wordmark.animate().alpha(1f).translationX(0f)
                .setStartDelay(500L).setDuration(590L).setInterpolator(ease).withLayer().start()
            energy.animate().alpha(.98f).scaleX(1f)
                .setStartDelay(800L).setDuration(490L).setInterpolator(ease).start()
            subtitle.animate().alpha(1f)
                .setStartDelay(970L).setDuration(310L).setInterpolator(ease).start()
            animate().alpha(0f).scaleX(1.012f).scaleY(1.012f)
                .setStartDelay(1530L).setDuration(250L).setInterpolator(ease)
                .withEndAction { onEnd() }.start()
        }
    }

    override fun onDetachedFromWindow() {
        animate().cancel()
        listOf(emblem, wordmark, subtitle, energy).forEach { it.animate().cancel() }
        super.onDetachedFromWindow()
    }
    private fun dp(x: Float) = x * resources.displayMetrics.density
}
