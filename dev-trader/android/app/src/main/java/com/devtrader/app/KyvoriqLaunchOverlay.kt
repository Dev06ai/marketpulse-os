package com.devtrader.app

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Short, non-blocking KYVORIQ launch motion.
 *
 * The sequence deliberately stays under one second and uses Android property
 * animation so it follows the display VSYNC instead of a manual frame timer.
 */
class KyvoriqLaunchOverlay(context: Context) : FrameLayout(context) {
    private val gold = KyvoriqTheme.gold
    private val gray = KyvoriqTheme.muted
    private val charcoal = KyvoriqTheme.charcoal
    private val slate = KyvoriqTheme.surface
    private val motion = PathInterpolator(0.18f, 0.82f, 0.20f, 1f)

    private val mark = ImageView(context).apply {
        setImageResource(R.drawable.kyvoriq_mark)
        scaleType = ImageView.ScaleType.CENTER_INSIDE
        alpha = 0f
        scaleX = 0.72f
        scaleY = 0.72f
        translationY = dp(8f)
    }
    private val title = TextView(context).apply {
        text = "KYVORIQ"
        textSize = 24f
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        setTextColor(gold)
        letterSpacing = 0.10f
        includeFontPadding = false
        alpha = 0f
        translationY = dp(8f)
    }
    private val subtitle = TextView(context).apply {
        text = "INTELLIGENCE  •  DISCIPLINE  •  EXECUTION"
        textSize = 8.5f
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        setTextColor(gray)
        letterSpacing = 0.08f
        includeFontPadding = false
        alpha = 0f
        translationY = dp(6f)
    }
    private val line = View(context).apply {
        background = GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            intArrayOf(Color.TRANSPARENT, gold, Color.TRANSPARENT)
        )
        scaleX = 0f
        alpha = 0f
        pivotX = 0f
    }
    private val sweep = View(context).apply {
        background = GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            intArrayOf(Color.TRANSPARENT, Color.argb(58, 219, 170, 59), Color.TRANSPARENT)
        )
        alpha = 0f
        rotation = -10f
    }

    init {
        isClickable = true
        isFocusable = true
        background = GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            intArrayOf(charcoal, slate, charcoal)
        )

        val center = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }
        center.addView(mark, LinearLayout.LayoutParams(dp(78f).toInt(), dp(78f).toInt()).apply {
            gravity = Gravity.CENTER_HORIZONTAL
        })
        center.addView(title, LinearLayout.LayoutParams(-2, -2).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = dp(10f).toInt()
        })
        center.addView(subtitle, LinearLayout.LayoutParams(-2, -2).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = dp(8f).toInt()
        })
        center.addView(line, LinearLayout.LayoutParams(dp(190f).toInt(), dp(2f).toInt()).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = dp(15f).toInt()
        })
        addView(center, LayoutParams(-1, -1))
        addView(
            sweep,
            LayoutParams(dp(76f).toInt(), dp(170f).toInt()).apply {
                gravity = Gravity.CENTER_VERTICAL or Gravity.START
            }
        )
    }

    fun play(onEnd: () -> Unit) {
        if (!KyvoriqTheme.motionEnabled(context)) { onEnd(); return }
        post {
            mark.animate().alpha(1f).scaleX(1f).scaleY(1f).translationY(0f)
                .setDuration(360L).setInterpolator(motion).withLayer().start()
            title.animate().alpha(1f).translationY(0f)
                .setStartDelay(90L).setDuration(310L).setInterpolator(motion).withLayer().start()
            subtitle.animate().alpha(1f).translationY(0f)
                .setStartDelay(150L).setDuration(300L).setInterpolator(motion).withLayer().start()
            line.animate().alpha(1f).scaleX(1f)
                .setStartDelay(190L).setDuration(360L).setInterpolator(motion).withLayer().start()

            sweep.translationX = -sweep.width.toFloat() * 1.5f
            sweep.animate()
                .alpha(0.40f)
                .translationX(width + sweep.width.toFloat())
                .setStartDelay(250L)
                .setDuration(420L)
                .setInterpolator(motion)
                .withLayer()
                .start()

            animate()
                .alpha(0f)
                .scaleX(1.015f)
                .scaleY(1.015f)
                .setStartDelay(690L)
                .setDuration(240L)
                .setInterpolator(motion)
                .withEndAction { onEnd() }
                .start()
        }
    }

    override fun onDetachedFromWindow() {
        animate().cancel()
        listOf(mark, title, subtitle, line, sweep).forEach { it.animate().cancel() }
        super.onDetachedFromWindow()
    }

    private fun dp(value: Float): Float = value * resources.displayMetrics.density
}
