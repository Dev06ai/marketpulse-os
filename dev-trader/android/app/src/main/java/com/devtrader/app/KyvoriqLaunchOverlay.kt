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

/** One-second, non-blocking cinematic intro. VSYNC-driven native vector motion. */
class KyvoriqLaunchOverlay(context: Context) : FrameLayout(context) {
    private val gold = KyvoriqTheme.gold
    private val cyan = Color.rgb(37, 226, 249)
    private val ease = PathInterpolator(.18f, .82f, .20f, 1f)
    private val emblem = CyberpunkMarkView(context).apply {
        alpha = 0f; scaleX = .74f; scaleY = .74f; translationY = dp(12f)
    }
    private val wordmark = CyberpunkWordmarkView(context).apply {
        alpha = 0f; translationY = dp(9f)
    }
    private val caption = TextView(context).apply {
        text = "SYSTEM ONLINE  //  STAY SHARP"
        textSize = 9f
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        setTextColor(Color.rgb(170, 191, 206))
        letterSpacing = .12f
        includeFontPadding = false
        alpha = 0f
    }
    private val bootline = View(context).apply {
        background = GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            intArrayOf(Color.TRANSPARENT, cyan, gold, Color.TRANSPARENT)
        )
        scaleX = 0f; alpha = 0f
    }
    private val sweep = View(context).apply {
        background = GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            intArrayOf(Color.TRANSPARENT, Color.argb(105, 37, 226, 249), Color.TRANSPARENT)
        )
        rotation = -13f; alpha = 0f
    }
    init {
        isClickable = true
        isFocusable = true
        background = GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            intArrayOf(Color.rgb(6, 10, 17), Color.rgb(16, 20, 36), Color.rgb(6, 10, 17))
        )
        val center = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }
        center.addView(emblem, LinearLayout.LayoutParams(dp(128f).toInt(), dp(128f).toInt()).apply {
            gravity = Gravity.CENTER_HORIZONTAL
        })
        center.addView(wordmark, LinearLayout.LayoutParams(dp(220f).toInt(), dp(47f).toInt()).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = dp(7f).toInt()
        })
        center.addView(caption, LinearLayout.LayoutParams(-2, -2).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = dp(3f).toInt()
        })
        center.addView(bootline, LinearLayout.LayoutParams(dp(220f).toInt(), dp(2f).toInt()).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = dp(17f).toInt()
        })
        addView(center, LayoutParams(-1, -1))
        addView(sweep, LayoutParams(dp(56f).toInt(), dp(250f).toInt()).apply {
            gravity = Gravity.CENTER_VERTICAL or Gravity.START
        })
    }

    fun play(onEnd: () -> Unit) {
        if (!KyvoriqTheme.motionEnabled(context)) { onEnd(); return }
        post {
            emblem.animate().alpha(1f).scaleX(1f).scaleY(1f).translationY(0f)
                .setDuration(320L).setInterpolator(ease).withLayer().start()
            wordmark.animate().alpha(1f).translationY(0f)
                .setStartDelay(90L).setDuration(280L).setInterpolator(ease).withLayer().start()
            caption.animate().alpha(1f)
                .setStartDelay(205L).setDuration(225L).setInterpolator(ease).start()
            bootline.animate().alpha(1f).scaleX(1f)
                .setStartDelay(175L).setDuration(330L).setInterpolator(ease).start()
            sweep.translationX = -dp(125f)
            sweep.animate().alpha(.50f).translationX(width + dp(90f))
                .setStartDelay(190L).setDuration(520L).setInterpolator(ease).withLayer().start()
            animate().alpha(0f).scaleX(1.018f).scaleY(1.018f)
                .setStartDelay(730L).setDuration(230L).setInterpolator(ease)
                .withEndAction { onEnd() }.start()
        }
    }

    override fun onDetachedFromWindow() {
        animate().cancel()
        listOf(emblem, wordmark, caption, bootline, sweep).forEach { it.animate().cancel() }
        super.onDetachedFromWindow()
    }

    private fun dp(value: Float): Float = value * resources.displayMetrics.density
}