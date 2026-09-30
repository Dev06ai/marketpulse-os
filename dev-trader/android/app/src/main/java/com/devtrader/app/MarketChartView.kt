package com.devtrader.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PathEffect
import android.graphics.DashPathEffect
import android.util.AttributeSet
import android.view.View
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

class MarketChartView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    private val gridPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(34, 36, 43)
        strokeWidth = dp(1f)
    }
    private val wickPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeWidth = dp(1.2f) }
    private val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val bbPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(109, 84, 171)
        strokeWidth = dp(1.15f)
        style = Paint.Style.STROKE
    }
    private val emaPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(220, 167, 65)
        strokeWidth = dp(1.2f)
        style = Paint.Style.STROKE
    }
    private val levelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(142, 146, 156)
        strokeWidth = dp(1f)
        style = Paint.Style.STROKE
    }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(148, 152, 162)
        textSize = dp(10f)
    }
    private val volumeUpPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(59, 135, 116) }
    private val volumeDownPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(172, 77, 92) }

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
        canvas.drawColor(Color.rgb(10, 11, 14))

        val left = dp(4f)
        val top = dp(26f)
        val right = width - dp(54f)
        val priceBottom = height * 0.77f
        val volumeTop = priceBottom + dp(12f)
        val bottom = height - dp(22f)

        if (right <= left || bottom <= top || candles.length() == 0) {
            canvas.drawText("Loading market candles…", left + dp(8f), top + dp(18f), textPaint)
            return
        }

        drawGrid(canvas, left, top, right, priceBottom)

        val visible = min(candles.length(), 78)
        val start = candles.length() - visible
        var high = Double.MIN_VALUE
        var low = Double.MAX_VALUE
        var maxVolume = 0.0
        for (i in start until candles.length()) {
            val c = candles.getJSONObject(i)
            high = max(high, c.optDouble("high"))
            low = min(low, c.optDouble("low"))
            maxVolume = max(maxVolume, c.optDouble("volume"))
        }

        signal?.let {
            listOf("entry", "stop", "target2").forEach { key ->
                val v = it.optDouble(key, Double.NaN)
                if (!v.isNaN()) {
                    high = max(high, v)
                    low = min(low, v)
                }
            }
        }

        if (high <= low) return
        val pad = (high - low) * 0.055
        high += pad
        low -= pad

        fun y(v: Double): Float =
            priceBottom - ((v - low) / (high - low)).toFloat() * (priceBottom - top)

        val step = (right - left) / visible
        val candleWidth = max(dp(2.2f), step * 0.62f)

        for (j in 0 until visible) {
            val c = candles.getJSONObject(start + j)
            val x = left + j * step + step * 0.5f
            val o = c.optDouble("open")
            val h = c.optDouble("high")
            val l = c.optDouble("low")
            val cl = c.optDouble("close")
            val up = cl >= o

            wickPaint.color = if (up) Color.rgb(77, 188, 159) else Color.rgb(220, 91, 108)
            bodyPaint.color = if (up) Color.rgb(48, 146, 122) else Color.rgb(177, 66, 83)

            canvas.drawLine(x, y(h), x, y(l), wickPaint)

            val topBody = min(y(o), y(cl))
            val bottomBody = max(y(o), y(cl))
            canvas.drawRect(
                x - candleWidth / 2f,
                topBody,
                x + candleWidth / 2f,
                max(topBody + dp(1.2f), bottomBody),
                bodyPaint
            )

            if (maxVolume > 0) {
                val vh = ((c.optDouble("volume") / maxVolume) * (bottom - volumeTop)).toFloat()
                val vp = if (up) volumeUpPaint else volumeDownPaint
                canvas.drawRect(
                    x - candleWidth / 2f,
                    bottom - vh,
                    x + candleWidth / 2f,
                    bottom,
                    vp
                )
            }
        }

        drawBollinger(canvas, start, visible, left, right, top, priceBottom, low, high, step, bbPaint)
        ema50?.let { value ->
            if (value in low..high) {
                drawHorizontal(canvas, left, right, y(value), emaPaint, "EMA 50")
            }
        }

        signal?.let {
            drawLevel(canvas, left, right, y(it.optDouble("entry")), "ENTRY")
            drawLevel(canvas, left, right, y(it.optDouble("stop")), "SL")
            drawLevel(canvas, left, right, y(it.optDouble("target2")), "TP")
        }

        if (!price.isNaN() && price in low..high) {
            levelPaint.color = Color.rgb(225, 227, 232)
            canvas.drawLine(left, y(price), right, y(price), levelPaint)
            canvas.drawText(String.format("%.1f", price), right + dp(4f), y(price) + dp(4f), textPaint)
        }

        canvas.drawText("BOLL", left, dp(12f), textPaint)
        canvas.drawText(timeframe, left, top - dp(8f), textPaint)
        canvas.drawText(String.format("%.1f", high), right + dp(4f), top + dp(5f), textPaint)
        canvas.drawText(String.format("%.1f", low), right + dp(4f), priceBottom, textPaint)
        canvas.drawText("VOL", left, bottom + dp(12f), textPaint)
    }

    private fun drawGrid(canvas: Canvas, left: Float, top: Float, right: Float, bottom: Float) {
        repeat(6) { i ->
            val y = top + (bottom - top) * i / 5f
            canvas.drawLine(left, y, right, y, gridPaint)
        }
        repeat(4) { i ->
            val x = left + (right - left) * i / 3f
            canvas.drawLine(x, top, x, bottom, gridPaint)
        }
    }

    private fun drawBollinger(
        canvas: Canvas,
        start: Int,
        visible: Int,
        left: Float,
        right: Float,
        top: Float,
        bottom: Float,
        low: Double,
        high: Double,
        step: Float,
        paint: Paint
    ) {
        val closes = ArrayList<Double>()
        for (i in start until start + visible) closes.add(candles.getJSONObject(i).optDouble("close"))
        if (closes.size < 20) return

        fun y(v: Double): Float =
            bottom - ((v - low) / (high - low)).toFloat() * (bottom - top)

        fun point(index: Int, value: Double) =
            Pair(left + index * step + step * 0.5f, y(value))

        fun makeSeries(mult: Double): MutableList<Pair<Float, Float>> {
            val out = mutableListOf<Pair<Float, Float>>()
            for (i in 19 until closes.size) {
                val window = closes.subList(i - 19, i + 1)
                val mean = window.average()
                val variance = window.sumOf { (it - mean) * (it - mean) } / window.size
                val sd = sqrt(variance)
                val value = if (mult == 0.0) mean else mean + mult * sd
                out.add(point(i, value))
            }
            return out
        }

        drawSeries(canvas, makeSeries(2.0), paint)
        drawSeries(canvas, makeSeries(0.0), paint)
        drawSeries(canvas, makeSeries(-2.0), paint)
    }

    private fun drawSeries(canvas: Canvas, points: List<Pair<Float, Float>>, paint: Paint) {
        if (points.isEmpty()) return
        val path = android.graphics.Path()
        path.moveTo(points[0].first, points[0].second)
        for (i in 1 until points.size) path.lineTo(points[i].first, points[i].second)
        canvas.drawPath(path, paint)
    }

    private fun drawHorizontal(canvas: Canvas, left: Float, right: Float, y: Float, paint: Paint, label: String) {
        canvas.drawLine(left, y, right, y, paint)
        canvas.drawText(label, right + dp(4f), y + dp(4f), textPaint)
    }

    private fun drawLevel(canvas: Canvas, left: Float, right: Float, y: Float, label: String) {
        val old: PathEffect? = levelPaint.pathEffect
        levelPaint.pathEffect = DashPathEffect(floatArrayOf(dp(6f), dp(5f)), 0f)
        levelPaint.color = Color.rgb(120, 124, 135)
        canvas.drawLine(left, y, right, y, levelPaint)
        levelPaint.pathEffect = old
        canvas.drawText(label, right + dp(4f), y + dp(4f), textPaint)
    }

    private fun dp(v: Float): Float = v * resources.displayMetrics.density
}
