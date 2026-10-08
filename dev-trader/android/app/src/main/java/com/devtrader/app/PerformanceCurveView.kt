package com.devtrader.app

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.*
import android.view.View
import org.json.JSONArray
import kotlin.math.max

/** A gold equity trace drawn only from verified, fee-adjusted exchange fills. */
class PerformanceCurveView(context: Context) : View(context) {
    private var values = emptyList<Double>()
    private var reveal = 1f
    private var animator: ValueAnimator? = null
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = 1.8f * resources.displayMetrics.density
        strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND; color = KyvoriqTheme.gold
    }
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.muted; textSize = 9f * resources.displayMetrics.scaledDensity
    }
    private val area = Paint(Paint.ANTI_ALIAS_FLAG)
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG)
    private val grid = Paint().apply { color = KyvoriqTheme.border; strokeWidth = 1f }
    init { background = KyvoriqTheme.surface(context); contentDescription = "Realized profit and loss after fees" }

    fun setPoints(value: JSONArray) {
        val next = (0 until value.length()).mapNotNull { i ->
            value.optJSONObject(i)?.optDouble("net_usdt", Double.NaN)?.takeIf { it.isFinite() }
        }
        if (next == values) return
        values = next
        animator?.cancel()
        contentDescription = if (values.size < 2) "Performance chart: waiting for verified exchange fills"
            else "Realized profit and loss after fees: ${values.last()} USDT"
        if (values.size < 2 || !isShown || !KyvoriqTheme.motionEnabled(context)) {
            reveal = 1f; invalidate(); return
        }
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 620L; interpolator = KyvoriqTheme.motion
            addUpdateListener { reveal = it.animatedValue as Float; invalidate() }
            start()
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val d = resources.displayMetrics.density
        canvas.drawText("REALIZED P&L AFTER FEES", 14*d, 22*d, label)
        if (values.size < 2) {
            canvas.drawText("Waiting for verified exchange fills", 14*d, height * .65f, label)
            return
        }
        val low = minOf(0.0, values.minOrNull() ?: 0.0)
        val high = maxOf(0.0, values.maxOrNull() ?: 0.0)
        val span = max(high - low, .1)
        val left = 14*d; val right = width - 14*d
        val top = 36*d; val bottom = height - 15*d
        val zero = (bottom - (0-low)/span*(bottom-top)).toFloat()
        canvas.drawLine(left, zero, right, zero, grid)
        val path = Path()
        var lastY = bottom
        values.forEachIndexed { i, v ->
            val x = left + i.toFloat()/(values.size-1)*(right-left)
            lastY = (bottom - (v-low)/span*(bottom-top)).toFloat()
            if (i == 0) path.moveTo(x, lastY) else path.lineTo(x, lastY)
        }
        val fillPath = Path(path).apply { lineTo(right, bottom); lineTo(left, bottom); close() }
        area.shader = LinearGradient(0f, top, 0f, bottom, Color.argb(38, 234, 194, 137), Color.TRANSPARENT, Shader.TileMode.CLAMP)
        val save = canvas.save()
        canvas.clipRect(left - 3*d, top - 4*d, left + (right-left)*reveal + 3*d, bottom + 4*d)
        canvas.drawPath(fillPath, area); canvas.drawPath(path, line)
        canvas.restoreToCount(save)
        if (reveal >= .99f) {
            dot.color = if (values.last() >= 0) Color.rgb(64, 207, 156) else Color.rgb(238, 105, 123)
            canvas.drawCircle(right, lastY, 2.5f*d, dot)
        }
    }

    override fun onDetachedFromWindow() {
        animator?.cancel(); animator = null; reveal = 1f
        super.onDetachedFromWindow()
    }
}
