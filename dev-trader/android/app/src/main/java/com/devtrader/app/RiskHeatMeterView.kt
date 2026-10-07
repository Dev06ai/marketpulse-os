package com.devtrader.app

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.util.AttributeSet
import android.view.View
import android.view.animation.DecelerateInterpolator
import kotlin.math.max
import kotlin.math.min

class RiskHeatMeterView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {
    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = KyvoriqTheme.raised }
    private val segment = Paint(Paint.ANTI_ALIAS_FLAG)
    private val marker = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.gold
        textSize = sp(10f)
        isFakeBoldText = true
    }
    private var renderedScore = 0f
    private var targetScore = 0f
    private var stateLabel = "IDLE"
    private var previousState = "IDLE"
    private var animator: ValueAnimator? = null
    private var pulseAnimator: ValueAnimator? = null
    private var pulseProgress = 1f

    fun setRisk(score: Float, state: String, animate: Boolean = true) {
        val nextScore = if (score.isFinite()) score.coerceIn(0f, 100f) else 0f
        if (targetScore == nextScore && stateLabel == state.uppercase()) return
        val shouldAnimate = animate && isShown && KyvoriqTheme.motionEnabled(context)
        targetScore = nextScore
        val normalizedState = state.uppercase()
        val stateChanged = normalizedState != stateLabel
        previousState = stateLabel
        stateLabel = normalizedState
        if (stateChanged && normalizedState != "IDLE" && shouldAnimate) {
            pulseAnimator?.cancel()
            pulseProgress = 0f
            pulseAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
                duration = 720L
                interpolator = DecelerateInterpolator()
                addUpdateListener {
                    pulseProgress = it.animatedValue as Float
                    invalidate()
                }
                start()
            }
        }
        animator?.cancel()
        if (!shouldAnimate) {
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
            KyvoriqTheme.gold,
            KyvoriqTheme.ember,
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

        if (pulseProgress < 1f && stateLabel != "IDLE") {
            val sweepX = left + total * pulseProgress
            val sweepWidth = dp(22f)
            val pulseColor = when (stateLabel) {
                "CRITICAL" -> Color.rgb(255, 82, 105)
                "HIGH" -> KyvoriqTheme.ember
                "ELEVATED" -> KyvoriqTheme.gold
                else -> Color.rgb(54, 211, 153)
            }
            val sweepPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                shader = LinearGradient(
                    sweepX - sweepWidth,
                    top,
                    sweepX + sweepWidth,
                    top,
                    intArrayOf(Color.TRANSPARENT, pulseColor, Color.TRANSPARENT),
                    null,
                    Shader.TileMode.CLAMP
                )
                alpha = 150
            }
            canvas.drawRoundRect(
                RectF(left, top - dp(2f), right, top + barHeight + dp(2f)),
                radius, radius, sweepPaint
            )
        }

        marker.strokeWidth = dp(2f)
        canvas.drawLine(x, top - dp(4f), x, top + barHeight + dp(4f), marker)
        val markerRadius = if (pulseProgress < 1f && stateLabel != "IDLE") {
            dp(3f + 1.8f * kotlin.math.sin(pulseProgress * Math.PI).toFloat().coerceAtLeast(0f))
        } else dp(3f)
        canvas.drawCircle(x, top + barHeight / 2f, markerRadius, marker)

        label.color = when {
            stateLabel == "CRITICAL" -> Color.rgb(255, 82, 105)
            stateLabel == "HIGH" -> KyvoriqTheme.ember
            stateLabel == "ELEVATED" -> KyvoriqTheme.gold
            stateLabel == "SAFE" -> Color.rgb(54, 211, 153)
            else -> KyvoriqTheme.muted
        }
        canvas.drawText("${stateLabel}  •  ${renderedScore.toInt()}/100", left, dp(13f), label)
    }

    override fun onDetachedFromWindow() {
        animator?.cancel()
        animator = null
        pulseAnimator?.cancel()
        pulseAnimator = null
        super.onDetachedFromWindow()
    }

    private fun dp(value: Float): Float = value * resources.displayMetrics.density
    private fun sp(value: Float): Float = value * resources.displayMetrics.scaledDensity
}
