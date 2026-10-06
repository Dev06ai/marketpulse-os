package com.devtrader.app

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View
import android.view.animation.DecelerateInterpolator
import kotlin.math.max
import kotlin.math.min

class RiskHeatMeterView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {
    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(25, 33, 43) }
    private val segment = Paint(Paint.ANTI_ALIAS_FLAG)
    private val marker = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(247, 201, 72)
        textSize = sp(10f)
        isFakeBoldText = true
    }
    private var renderedScore = 0f
    private var targetScore = 0f
    private var stateLabel = "IDLE"
    private var animator: ValueAnimator? = null

    fun setRisk(score: Float, state: String, animate: Boolean = true) {
        targetScore = score.coerceIn(0f, 100f)
        stateLabel = state
        animator?.cancel()
        if (!animate) {
            renderedScore = targetScore
            invalidate()
            return
        }
        animator = ValueAnimator.ofFloat(renderedScore, targetScore).apply {
            duration = 360L
            interpolator = DecelerateInterpolator()
            addUpdateListener {
                renderedScore = it.animatedValue as Float
                invalidate()
            }
            start()
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val pad = dp(2f)
        val top = dp(22f)
        val barHeight = dp(10f)
        val left = pad
        val right = width - pad
        val total = max(1f, right - left)
        val gap = dp(3f)
        val segmentWidth = (total - gap * 3f) / 4f
        val radius = dp(5f)
        val colors = intArrayOf(
            Color.rgb(54, 211, 153),
            Color.rgb(247, 201, 72),
            Color.rgb(224, 167, 46),
            Color.rgb(255, 82, 105)
        )

        canvas.drawRoundRect(RectF(left, top, right, top + barHeight), radius, radius, track)
        for (i in 0..3) {
            val l = left + i * (segmentWidth + gap)
            val r = min(right, l + segmentWidth)
            segment.color = colors[i]
            segment.alpha = if (renderedScore >= i * 25f) 235 else 72
            canvas.drawRoundRect(RectF(l, top, r, top + barHeight), radius, radius, segment)
        }

        val x = left + total * (renderedScore / 100f)
        marker.strokeWidth = dp(2f)
        canvas.drawLine(x, top - dp(4f), x, top + barHeight + dp(4f), marker)
        canvas.drawCircle(x, top + barHeight / 2f, dp(3f), marker)

        label.color = when {
            stateLabel == "CRITICAL" -> Color.rgb(255, 82, 105)
            stateLabel == "HIGH" -> Color.rgb(224, 167, 46)
            stateLabel == "ELEVATED" -> Color.rgb(247, 201, 72)
            stateLabel == "SAFE" -> Color.rgb(54, 211, 153)
            else -> Color.rgb(156, 163, 175)
        }
        canvas.drawText("${stateLabel}  •  ${renderedScore.toInt()}/100", left, dp(13f), label)
    }

    override fun onDetachedFromWindow() {
        animator?.cancel()
        animator = null
        super.onDetachedFromWindow()
    }

    private fun dp(value: Float): Float = value * resources.displayMetrics.density
    private fun sp(value: Float): Float = value * resources.displayMetrics.scaledDensity
}
