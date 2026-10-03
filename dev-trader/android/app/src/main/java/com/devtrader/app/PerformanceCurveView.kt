package com.devtrader.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.View
import org.json.JSONArray
import kotlin.math.max

class PerformanceCurveView(context: Context) : View(context) {
    private var points = JSONArray()
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2.5f }
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(147, 157, 184); textSize = 11f * resources.displayMetrics.scaledDensity }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(14, 17, 25) }
    private val grid = Paint().apply { color = Color.rgb(36, 42, 57); strokeWidth = 1f }
    fun setPoints(value: JSONArray) { points = value; invalidate() }
    override fun onDraw(canvas: Canvas) {
        val d = resources.displayMetrics.density
        canvas.drawRoundRect(0f, 0f, width.toFloat(), height.toFloat(), 16*d, 16*d, fill)
        canvas.drawText("REALIZED P&L AFTER FEES", 14*d, 23*d, label)
        val values = (0 until points.length()).mapNotNull { i -> points.optJSONObject(i)?.optDouble("net_usdt", Double.NaN)?.takeIf { it.isFinite() } }
        if (values.size < 2) {
            canvas.drawText("Waiting for verified exchange fills", 14*d, height * .62f, label)
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
        values.forEachIndexed { i, v ->
            val x = left + i.toFloat()/(values.size-1)*(right-left)
            val y = (bottom - (v-low)/span*(bottom-top)).toFloat()
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        line.color = if (values.last() >= 0) Color.rgb(64, 207, 156) else Color.rgb(238, 105, 123)
        canvas.drawPath(path, line)
    }
}
