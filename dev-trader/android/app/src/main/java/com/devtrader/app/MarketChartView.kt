package com.devtrader.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.View
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

class MarketChartView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    private val gridPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(47, 49, 57)
        strokeWidth = dp(1f)
    }
    private val wickPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        strokeWidth = dp(1f)
    }
    private val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        strokeWidth = dp(1.3f)
        style = Paint.Style.STROKE
    }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(150, 154, 164)
        textSize = dp(10f)
    }

    private var candles = JSONArray()
    private var signal: JSONObject? = null
    private var ema50: Double? = null
    private var timeframe = "15m"
    private var price = Double.NaN

    fun setData(candles: JSONArray, signal: JSONObject?, ema50: Double?, price: Double) {
        this.candles = candles
        this.signal = signal
        this.ema50 = ema50
        this.price = price
        invalidate()
    }

    fun setTimeframe(value: String) {
        timeframe = value
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawColor(Color.rgb(12, 13, 17))

        val left = dp(8f)
        val top = dp(28f)
        val right = width - dp(54f)
        val bottom = height - dp(20f)
        if (right <= left || bottom <= top || candles.length() == 0) {
            canvas.drawText("Waiting for candle data…", left, top + dp(16f), textPaint)
            return
        }

        repeat(5) { i ->
            val y = top + (bottom - top) * i / 4f
            canvas.drawLine(left, y, right, y, gridPaint)
        }
        repeat(4) { i ->
            val x = left + (right - left) * i / 3f
            canvas.drawLine(x, top, x, bottom, gridPaint)
        }

        val visible = min(candles.length(), 72)
        val start = candles.length() - visible
        var high = Double.MIN_VALUE
        var low = Double.MAX_VALUE
        for (i in start until candles.length()) {
            val c = candles.getJSONObject(i)
            high = max(high, c.optDouble("high", 0.0))
            low = min(low, c.optDouble("low", 0.0))
        }
        signal?.let {
            high = max(high, it.optDouble("entry", high))
            high = max(high, it.optDouble("stop", high))
            high = max(high, it.optDouble("target2", high))
            low = min(low, it.optDouble("entry", low))
            low = min(low, it.optDouble("stop", low))
            low = min(low, it.optDouble("target2", low))
        }
        if (high <= low) return
        val pad = (high - low) * 0.06
        high += pad
        low -= pad

        val candleWidth = max(dp(2f), (right - left) / visible * 0.62f)
        val step = (right - left) / visible

        fun y(v: Double): Float = (bottom - ((v - low) / (high - low)).toFloat() * (bottom - top))

        for (j in 0 until visible) {
            val i = start + j
            val c = candles.getJSONObject(i)
            val x = left + step * j + step * 0.5f
            val o = c.optDouble("open")
            val h = c.optDouble("high")
            val l = c.optDouble("low")
            val cl = c.optDouble("close")
            val up = cl >= o
            wickPaint.color = if (up) Color.rgb(142, 184, 161) else Color.rgb(196, 128, 128)
            bodyPaint.color = if (up) Color.rgb(73, 115, 94) else Color.rgb(122, 65, 68)
            canvas.drawLine(x, y(h), x, y(l), wickPaint)
            val bodyTop = min(y(o), y(cl))
            val bodyBottom = max(y(o), y(cl))
            canvas.drawRect(
                x - candleWidth / 2f,
                bodyTop,
                x + candleWidth / 2f,
                max(bodyTop + dp(1f), bodyBottom),
                bodyPaint
            )
        }

        ema50?.let { value ->
            if (value in low..high) {
                linePaint.color = Color.rgb(169, 173, 188)
                linePaint.strokeWidth = dp(1.4f)
                canvas.drawLine(left, y(value), right, y(value), linePaint)
                canvas.drawText("EMA 50", right + dp(5f), y(value) + dp(4f), textPaint)
            }
        }

        signal?.let {
            drawLevel(canvas, left, right, y(it.optDouble("entry", price)), "ENTRY")
            drawLevel(canvas, left, right, y(it.optDouble("stop", price)), "SL")
            drawLevel(canvas, left, right, y(it.optDouble("target2", price)), "TP2")
        }

        if (!price.isNaN() && price in low..high) {
            linePaint.color = Color.rgb(215, 215, 220)
            linePaint.strokeWidth = dp(1f)
            canvas.drawLine(left, y(price), right, y(price), linePaint)
        }

        canvas.drawText(timeframe, left, top - dp(8f), textPaint)
        canvas.drawText(String.format("%.2f", high), right + dp(5f), top + dp(5f), textPaint)
        canvas.drawText(String.format("%.2f", low), right + dp(5f), bottom, textPaint)
    }

    private fun drawLevel(canvas: Canvas, left: Float, right: Float, y: Float, label: String) {
        linePaint.color = Color.rgb(112, 115, 126)
        linePaint.pathEffect = android.graphics.DashPathEffect(floatArrayOf(dp(6f), dp(5f)), 0f)
        canvas.drawLine(left, y, right, y, linePaint)
        linePaint.pathEffect = null
        canvas.drawText(label, right + dp(5f), y + dp(4f), textPaint)
    }

    private fun dp(v: Float): Float = v * resources.displayMetrics.density
}
