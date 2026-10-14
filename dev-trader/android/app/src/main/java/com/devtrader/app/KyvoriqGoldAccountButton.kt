package com.devtrader.app

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader

/**
 * Restrained gold sheen for the account entry point.
 *
 * Only visual state is animated: never represent an unverified login,
 * payment or owner session as authenticated. Respects reduced motion and
 * battery saver through KyvoriqTheme.motionEnabled; cancels when detached.
 */
class KyvoriqGoldAccountButton(context: Context) : KyvoriqButton(context) {
    private val shimmerPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = resources.displayMetrics.density * .85f
        color = KyvoriqTheme.gold
    }
    private val shimmerBounds = RectF()
    private val clipPath = Path()
    private var sweep = -0.65f
    private var animator: ValueAnimator? = null

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (!KyvoriqTheme.motionEnabled(context)) return
        animator?.cancel()
        animator = ValueAnimator.ofFloat(-.65f, 1.65f).apply {
            duration = 2600L
            startDelay = 1800L
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.RESTART
            addUpdateListener {
                sweep = (it.animatedValue as Float)
                invalidate()
            }
            start()
        }
    }

    override fun onDetachedFromWindow() {
        animator?.cancel()
        animator = null
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val d = resources.displayMetrics.density
        val radius = 13f * d
        shimmerBounds.set(d, d, width.toFloat()-d, height.toFloat()-d)
        if (shimmerBounds.width() <= 0 || shimmerBounds.height() <= 0) return
        val save = canvas.save()
        clipPath.rewind()
        clipPath.addRoundRect(shimmerBounds, radius, radius, Path.Direction.CW)
        canvas.clipPath(clipPath)
        if (KyvoriqTheme.motionEnabled(context) && animator?.isRunning == true) {
            val center = sweep * width
            shimmerPaint.shader = LinearGradient(
                center-34f*d, 0f, center+34f*d, 0f,
                intArrayOf(Color.TRANSPARENT, Color.argb(40, 190, 148, 76), Color.TRANSPARENT),
                null, Shader.TileMode.CLAMP
            )
            canvas.drawRect(shimmerBounds, shimmerPaint)
            shimmerPaint.shader = null
        }
        borderPaint.alpha = if (isPressed) 185 else 115
        canvas.drawRoundRect(shimmerBounds, radius, radius, borderPaint)
        canvas.restoreToCount(save)
    }
}
