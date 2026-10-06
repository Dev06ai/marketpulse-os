package com.devtrader.app

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.view.View
import android.view.animation.PathInterpolator
import kotlin.math.sin

/**
 * Lightweight motion-graphics layer drawn above the Decision Center.
 * It never intercepts touches and never changes trading state.
 */
class DecisionMotionView(context: Context) : View(context) {
    private val gold = Color.rgb(247, 201, 72)
    private val green = Color.rgb(54, 211, 153)
    private val red = Color.rgb(255, 82, 105)
    private val amber = Color.rgb(224, 167, 46)
    private val sweepPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = dp(1.2f)
    }
    private val eventPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val motion = PathInterpolator(0.18f, 0.82f, 0.20f, 1f)

    private var state = "WAIT"
    private var scanProgress = -0.25f
    private var eventProgress = 1f
    private var scanAnimator: ValueAnimator? = null
    private var eventAnimator: ValueAnimator? = null
    private var scanRunnable: Runnable? = null

    init {
        isClickable = false
        isFocusable = false
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    fun setDecisionState(value: String) {
        val next = value.uppercase()
        if (state == next) return
        state = next
        if (isScanning(next)) startScanning() else stopScanning()
        val color = eventColor(next)
        if (color != null) playEvent(color)
        invalidate()
    }

    fun startIfNeeded() {
        if (isScanning(state)) startScanning()
    }

    private fun isScanning(value: String): Boolean =
        value == "WAIT" || value.contains("SCANN") || value.contains("SIGNAL_WAIT")

    private fun eventColor(value: String): Int? = when {
        value.startsWith("OPEN_LONG") || value == "TP1" || value == "TP2" -> green
        value.startsWith("OPEN_SHORT") -> red
        value.startsWith("EXECUTING") -> gold
        value == "SL" || value == "FAILED" -> red
        value.startsWith("SIGNAL_LONG") || value.startsWith("SIGNAL_SHORT") -> amber
        else -> null
    }

    private fun startScanning() {
        if (scanAnimator?.isRunning == true || scanRunnable != null) return
        scheduleScan(500L)
    }

    private fun scheduleScan(delay: Long) {
        scanRunnable?.let { removeCallbacks(it) }
        val runnable = Runnable {
            scanRunnable = null
            scanAnimator?.cancel()
            scanAnimator = ValueAnimator.ofFloat(-0.25f, 1.25f).apply {
                duration = 900L
                interpolator = motion
                addUpdateListener {
                    scanProgress = it.animatedValue as Float
                    invalidate()
                }
                doOnEndCompat {
                    if (isScanning(state) && isAttachedToWindow) scheduleScan(3_900L)
                }
                start()
            }
        }
        scanRunnable = runnable
        postDelayed(runnable, delay)
    }

    private fun stopScanning() {
        scanRunnable?.let { removeCallbacks(it) }
        scanRunnable = null
        scanAnimator?.cancel()
        scanAnimator = null
        scanProgress = -0.25f
        invalidate()
    }

    private fun playEvent(color: Int) {
        eventAnimator?.cancel()
        eventPaint.color = color
        eventProgress = 0f
        eventAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 760L
            interpolator = motion
            addUpdateListener {
                eventProgress = it.animatedValue as Float
                invalidate()
            }
            start()
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (width <= 0 || height <= 0) return

        if (isScanning(state) && scanProgress in -0.24f..1.24f) {
            val center = width * scanProgress
            val band = dp(78f)
            sweepPaint.shader = LinearGradient(
                center - band,
                0f,
                center + band,
                height.toFloat(),
                intArrayOf(Color.TRANSPARENT, Color.argb(48, 247, 201, 72), Color.TRANSPARENT),
                floatArrayOf(0f, 0.5f, 1f),
                Shader.TileMode.CLAMP
            )
            canvas.drawRoundRect(
                RectF(0f, 0f, width.toFloat(), height.toFloat()),
                dp(17f), dp(17f), sweepPaint
            )
            sweepPaint.shader = null
        }

        if (eventProgress < 1f) {
            val pulse = sin(eventProgress * Math.PI).toFloat().coerceAtLeast(0f)
            val color = eventPaint.color
            borderPaint.color = color
            borderPaint.alpha = (160f * pulse).toInt().coerceIn(0, 255)
            borderPaint.strokeWidth = dp(1f + 1.4f * pulse)
            val inset = dp(1.5f + 2.5f * (1f - pulse))
            canvas.drawRoundRect(
                RectF(inset, inset, width - inset, height - inset),
                dp(17f), dp(17f), borderPaint
            )

            eventPaint.alpha = (42f * pulse).toInt().coerceIn(0, 255)
            val sweepX = width * eventProgress
            canvas.drawRect(
                (sweepX - dp(46f)).coerceAtLeast(0f),
                0f,
                (sweepX + dp(12f)).coerceAtMost(width.toFloat()),
                height.toFloat(),
                eventPaint
            )
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        startIfNeeded()
    }

    override fun onDetachedFromWindow() {
        stopScanning()
        eventAnimator?.cancel()
        eventAnimator = null
        super.onDetachedFromWindow()
    }

    private fun ValueAnimator.doOnEndCompat(block: () -> Unit) {
        addListener(object : android.animation.AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: android.animation.Animator) = block()
        })
    }

    private fun dp(value: Float): Float = value * resources.displayMetrics.density
}
