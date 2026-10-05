package com.devtrader.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathEffect
import android.graphics.DashPathEffect
import android.graphics.LinearGradient
import android.graphics.RectF
import android.graphics.Shader
import android.os.SystemClock
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

class MarketChartView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val gridPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(40, 49, 61)
        strokeWidth = dp(.72f)
        alpha = 96
    }
    private val axisPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(92, 101, 114)
        strokeWidth = dp(.85f)
        alpha = 175
    }
    private val plotBorderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(76, 62, 28)
        strokeWidth = dp(.8f)
        style = Paint.Style.STROKE
        alpha = 155
    }
    private val axisPanelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(9, 13, 18)
        alpha = 215
    }
    private val volumeDividerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(66, 72, 82)
        strokeWidth = dp(.7f)
        alpha = 105
    }
    private val wickPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        strokeWidth = dp(1.05f)
        strokeCap = Paint.Cap.ROUND
    }
    private val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val bbPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(201, 149, 27)
        strokeWidth = dp(.95f)
        style = Paint.Style.STROKE
        alpha = 205
    }
    private val bbFillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(184, 134, 11)
        style = Paint.Style.FILL
        alpha = 20
    }
    private val emaPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(247, 201, 72)
        strokeWidth = dp(1.7f)
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val currentPricePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(247, 201, 72)
        strokeWidth = dp(.95f)
        style = Paint.Style.STROKE
        pathEffect = DashPathEffect(floatArrayOf(dp(5f), dp(4f)), 0f)
        alpha = 225
    }
    private val livePriceTagPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(247, 201, 72)
        style = Paint.Style.FILL
    }
    private val livePriceTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(11, 15, 20)
        textSize = dp(9.6f)
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
    }
    private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(156, 163, 175)
        textSize = dp(10f)
    }
    private val axisLabelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(126, 135, 148)
        textSize = dp(9.5f)
    }
    private val strongLabelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(245, 247, 250)
        textSize = dp(10f)
        typeface = android.graphics.Typeface.create(
            android.graphics.Typeface.DEFAULT,
            android.graphics.Typeface.BOLD
        )
    }
    private val crosshairPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(224, 167, 46)
        strokeWidth = dp(1f)
    }
    private val volumeUpPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(49, 137, 115); alpha = 170 }
    private val volumeDownPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(167, 70, 86); alpha = 170 }
    private val liveChipPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(18, 24, 33) }
    private val liveDotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(71, 191, 149) }

    private var candles = JSONArray()
    private var signal: JSONObject? = null
    private var ema50: Double? = null
    private var timeframe = "15m"
    private var livePrice = Double.NaN
    private var feedHealthy = false

    fun setFeedHealthy(value: Boolean) { feedHealthy = value; invalidate() }

    private var followLive = true
    private var candleShift = 0f
    private var verticalOffset = 0.0
    private var zoomX = 1.0f
    private var zoomY = 1.0f

    private var crosshairVisible = false
    private var crosshairX = 0f
    private var crosshairY = 0f

    private var dragging = false
    private var lastTouchX = 0f
    private var lastTouchY = 0f
    private var touchDownX = 0f
    private var touchDownY = 0f
    private var pinchActive = false
    private var pinchStartDistance = 0f
    private var pinchStartZoomX = 1f
    private var pinchStartZoomY = 1f
    private var lastTapMs = 0L
    private var lastDataCount = 0

    fun setData(
        candles: JSONArray,
        signal: JSONObject?,
        ema50: Double?,
        price: Double
    ) {
        this.candles = candles
        this.signal = signal
        this.ema50 = ema50
        if (price.isFinite()) this.livePrice = price

        val newCount = candles.length()
        if (followLive) {
            candleShift = 0f
            verticalOffset = 0.0
        } else {
            val added = (newCount - lastDataCount).coerceAtLeast(0)
            if (added > 0) candleShift += added.toFloat()
            val maxShift = max(0f, newCount.toFloat() - visibleCount())
            candleShift = candleShift.coerceIn(0f, maxShift)
        }
        lastDataCount = newCount
        invalidate()
    }

    fun setLivePrice(price: Double) {
        if (!price.isFinite()) return
        livePrice = price
        if (followLive) verticalOffset = 0.0
        invalidate()
    }

    fun setTimeframe(value: String) {
        if (timeframe == value) return
        timeframe = value
        followLive = true
        candleShift = 0f
        verticalOffset = 0.0
        zoomX = 1.0f
        zoomY = 1.0f
        crosshairVisible = false
        invalidate()
    }

    private fun visibleCount(): Int {
        val widthPx = max(1f, width - dp(66f))
        val base = max(34f, widthPx / dp(7.4f))
        return max(24, min(140, (base / zoomX).roundToInt()))
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        bgPaint.shader = LinearGradient(
            0f, 0f, 0f, height.toFloat(),
            intArrayOf(Color.rgb(13, 18, 24), Color.rgb(8, 12, 17), Color.rgb(10, 14, 19)),
            null,
            Shader.TileMode.CLAMP
        )
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), bgPaint)
        bgPaint.shader = null

        val left = dp(10f)
        val right = width - dp(60f)
        val top = dp(if (height < dp(190f)) 32f else 44f)
        val bottom = height - dp(24f)
        val priceBottom = top + (bottom - top) * .76f
        val volumeTop = priceBottom + dp(4f)

        drawHeader(canvas, left, top)

        if (right <= left || bottom <= top || candles.length() == 0) {
            canvas.drawText("Waiting for market candles…", left, top + dp(30f), labelPaint)
            return
        }

        val visible = min(candles.length(), visibleCount())
        val maxShift = max(0f, candles.length().toFloat() - visible.toFloat())
        if (followLive) candleShift = 0f else candleShift = candleShift.coerceIn(0f, maxShift)

        val endExclusive = candles.length() - candleShift.roundToInt()
        val start = max(0, endExclusive - visible)
        val actualVisible = max(1, endExclusive - start)

        var high = Double.NEGATIVE_INFINITY
        var low = Double.POSITIVE_INFINITY
        var maxVolume = 0.0

        for (i in start until endExclusive) {
            val c = candles.optJSONObject(i) ?: continue
            high = max(high, c.optDouble("high"))
            low = min(low, c.optDouble("low"))
            maxVolume = max(maxVolume, c.optDouble("volume"))
        }

        val visibleLive = !livePrice.isNaN() && (followLive || livePrice in low..high)
        if (!livePrice.isNaN() && (followLive || livePrice in low..high)) {
            high = max(high, livePrice)
            low = min(low, livePrice)
        }

        signal?.let { s ->
            for (key in listOf("entry", "stop", "target2")) {
                val v = s.optDouble(key, Double.NaN)
                if (!v.isNaN() && (followLive || v in low..high)) {
                    high = max(high, v)
                    low = min(low, v)
                }
            }
        }

        if (!high.isFinite() || !low.isFinite() || high <= low) {
            canvas.drawText("No chart data", left, top + dp(30f), labelPaint)
            return
        }

        var range = (high - low).coerceAtLeast(1.0)
        val basePad = range * 0.075
        high += basePad
        low -= basePad
        range = high - low

        val center = (high + low) / 2.0 + verticalOffset
        val zoomedRange = range / zoomY
        high = center + zoomedRange / 2.0
        low = center - zoomedRange / 2.0
        range = (high - low).coerceAtLeast(1.0)

        drawGrid(canvas, left, top, right, priceBottom)
        canvas.drawRoundRect(RectF(left, top, right, bottom), dp(3f), dp(3f), plotBorderPaint)
        canvas.drawLine(left, volumeTop, right, volumeTop, volumeDividerPaint)
        drawAxes(canvas, right, priceBottom, top, bottom, low, high)

        val step = (right - left) / actualVisible
        val candleWidth = max(dp(2.4f), min(dp(9.2f), step * 0.62f))

        for (j in 0 until actualVisible) {
            val index = start + j
            val c = candles.optJSONObject(index) ?: continue
            val x = left + j * step + step * 0.5f
            val o = c.optDouble("open")
            val h = c.optDouble("high")
            val l = c.optDouble("low")
            val cl = c.optDouble("close")
            val up = cl >= o

            wickPaint.color = if (up) Color.rgb(76, 211, 166) else Color.rgb(242, 91, 111)
            bodyPaint.color = if (up) Color.rgb(54, 188, 148) else Color.rgb(214, 73, 94)

            canvas.drawLine(x, mapY(h, low, high, top, priceBottom), x, mapY(l, low, high, top, priceBottom), wickPaint)

            val bodyTop = min(mapY(o, low, high, top, priceBottom), mapY(cl, low, high, top, priceBottom))
            val bodyBottom = max(mapY(o, low, high, top, priceBottom), mapY(cl, low, high, top, priceBottom))
            canvas.drawRect(
                x - candleWidth / 2f,
                bodyTop,
                x + candleWidth / 2f,
                max(bodyTop + dp(1.2f), bodyBottom),
                bodyPaint
            )

            if (maxVolume > 0.0) {
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

        drawBollinger(canvas, start, actualVisible, left, top, priceBottom, low, high, step)
        drawEma50(canvas, start, actualVisible, left, top, priceBottom, low, high, step)

        signal?.let { s ->
            listOf("entry" to "ENTRY", "stop" to "SL", "target2" to "TP").forEach { (key, label) ->
                val value = s.optDouble(key, Double.NaN)
                if (value.isFinite() && value in low..high) {
                    val text = if (key == "entry" && priceBottom - top < dp(120f)) "" else label
                    drawLevel(canvas, left, right, mapY(value, low, high, top, priceBottom), text)
                }
            }
        }

        if (!livePrice.isNaN() && visibleLive) {
            val y = mapY(livePrice, low, high, top, priceBottom)
            canvas.drawLine(left, y, right, y, currentPricePaint)
            drawPriceTag(canvas, right + dp(4f), y, String.format(Locale.US, "%.2f", livePrice), true)
        }

        drawTimeAxis(canvas, start, actualVisible, left, right, bottom, step)
        drawCrosshair(canvas, start, actualVisible, left, right, top, priceBottom, bottom, low, high, step)
    }

    private fun drawHeader(canvas: Canvas, left: Float, top: Float) {
        canvas.drawText("PRICE  •  $timeframe", left, dp(17f), strongLabelPaint)
        if (top > dp(40f)) canvas.drawText("BB(20,2)  •  EMA 50  •  VOL", left, dp(32f), axisLabelPaint)

        val chipWidth = dp(54f)
        val chipLeft = width - chipWidth - dp(10f)
        val chipTop = dp(8f)
        val rect = android.graphics.RectF(chipLeft, chipTop, width - dp(10f), chipTop + dp(24f))
        canvas.drawRoundRect(rect, dp(12f), dp(12f), liveChipPaint)
        liveDotPaint.color = if (feedHealthy) Color.rgb(71, 191, 149) else Color.rgb(156, 163, 175)
        canvas.drawCircle(chipLeft + dp(11f), chipTop + dp(12f), dp(3.5f), liveDotPaint)
        canvas.drawText(if (feedHealthy) "LIVE" else "WAIT", chipLeft + dp(19f), chipTop + dp(16f), strongLabelPaint)
    }

    private fun drawGrid(canvas: Canvas, left: Float, top: Float, right: Float, bottom: Float) {
        val ticks = ((bottom - top) / dp(28f)).toInt().coerceIn(2, 5)
        for (i in 0..ticks) {
            val y = top + (bottom - top) * i / ticks
            canvas.drawLine(left, y, right, y, gridPaint)
        }
        for (i in 0..5) {
            val x = left + (right - left) * i / 5f
            canvas.drawLine(x, top, x, bottom, gridPaint)
        }
    }

    private fun drawAxes(
        canvas: Canvas,
        right: Float,
        priceBottom: Float,
        top: Float,
        bottom: Float,
        low: Double,
        high: Double
    ) {
        canvas.drawRect(right, top, width.toFloat(), bottom + dp(22f), axisPanelPaint)
        canvas.drawLine(right, top, right, bottom, axisPaint)
        val ticks = ((priceBottom - top) / dp(28f)).toInt().coerceIn(2, 5)
        val liveY = if (livePrice.isFinite() && livePrice in low..high) mapY(livePrice, low, high, top, priceBottom) else Float.NaN
        for (i in 0..ticks) {
            val y = top + (priceBottom - top) * i / ticks
            if (liveY.isFinite() && abs(y - liveY) < dp(14f)) continue
            val value = high - (high - low) * i / ticks
            val label = compactPrice(value)
            canvas.drawText(label, right + dp(5f), y + dp(3.5f), axisLabelPaint)
        }
    }

    private fun drawTimeAxis(
        canvas: Canvas,
        start: Int,
        visible: Int,
        left: Float,
        right: Float,
        bottom: Float,
        step: Float
    ) {
        val marks = 5
        for (i in 0 until marks) {
            val idx = min(start + (visible - 1) * i / (marks - 1), candles.length() - 1)
            val c = candles.optJSONObject(idx) ?: continue
            val x = left + ((idx - start) + 0.5f) * step
            val ts = c.optLong("start", 0L)
            val label = formatAxisTime(ts)
            val labelWidth = axisLabelPaint.measureText(label)
            val labelX = (x - labelWidth / 2f).coerceIn(left, max(left, right - labelWidth))
            canvas.drawText(label, labelX, bottom + dp(14f), axisLabelPaint)
        }
    }

    private fun drawCrosshair(
        canvas: Canvas,
        start: Int,
        visible: Int,
        left: Float,
        right: Float,
        top: Float,
        priceBottom: Float,
        bottom: Float,
        low: Double,
        high: Double,
        step: Float
    ) {
        if (!crosshairVisible || candles.length() == 0) return

        val clampedX = crosshairX.coerceIn(left, right)
        val clampedY = crosshairY.coerceIn(top, priceBottom)

        val previousEffect = crosshairPaint.pathEffect
        crosshairPaint.pathEffect = DashPathEffect(floatArrayOf(dp(3f), dp(4f)), 0f)
        canvas.drawLine(clampedX, top, clampedX, bottom, crosshairPaint)
        canvas.drawLine(left, clampedY, right, clampedY, crosshairPaint)
        crosshairPaint.pathEffect = previousEffect

        val candleIndex = (start + ((clampedX - left) / step)).roundToInt().coerceIn(0, candles.length() - 1)
        val candle = candles.optJSONObject(candleIndex) ?: return
        val price = high - ((clampedY - top) / (priceBottom - top)) * (high - low)

        val dateLabel = formatCrosshairTime(candle.optLong("start", 0L))
        val priceLabel = String.format(Locale.US, "%.2f", price)

        val dateWidth = dp(86f)
        val dateLeft = (clampedX - dateWidth / 2f).coerceIn(left, right - dateWidth)
        val dateTop = bottom + dp(2f)
        canvas.drawRoundRect(
            android.graphics.RectF(dateLeft, dateTop, dateLeft + dateWidth, dateTop + dp(20f)),
            dp(5f), dp(5f), liveChipPaint
        )
        canvas.drawText(dateLabel, dateLeft + dp(6f), dateTop + dp(14f), strongLabelPaint)

        drawPriceTag(canvas, right + dp(4f), clampedY, priceLabel, false)

        val info = "O " + compactPrice(candle.optDouble("open")) +
            "   H " + compactPrice(candle.optDouble("high")) +
            "   L " + compactPrice(candle.optDouble("low")) +
            "   C " + compactPrice(candle.optDouble("close"))
        val infoWidth = min(width - dp(28f), dp(250f))
        val infoLeft = (clampedX - infoWidth / 2f).coerceIn(left, right - infoWidth)
        val infoTop = max(dp(48f), clampedY - dp(42f))
        canvas.drawRoundRect(
            android.graphics.RectF(infoLeft, infoTop, infoLeft + infoWidth, infoTop + dp(22f)),
            dp(6f), dp(6f), liveChipPaint
        )
        canvas.drawText(info, infoLeft + dp(7f), infoTop + dp(15f), axisLabelPaint)
    }

    private fun drawPriceTag(canvas: Canvas, x: Float, y: Float, text: String, live: Boolean) {
        val tagWidth = if (live) dp(56f) else dp(64f)
        val tagLeft = if (live) x + dp(2f) else x
        val rect = RectF(tagLeft, y - dp(10f), tagLeft + tagWidth, y + dp(10f))
        if (live) {
            val pointer = Path().apply {
                moveTo(x - dp(3f), y)
                lineTo(tagLeft, y - dp(5f))
                lineTo(tagLeft, y + dp(5f))
                close()
            }
            canvas.drawPath(pointer, livePriceTagPaint)
            canvas.drawRoundRect(rect, dp(5.5f), dp(5.5f), livePriceTagPaint)
            canvas.drawText(text, tagLeft + dp(5f), y + dp(3.5f), livePriceTextPaint)
        } else {
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(31, 41, 54) }
            canvas.drawRoundRect(rect, dp(5f), dp(5f), paint)
            canvas.drawText(text, tagLeft + dp(5f), y + dp(3.5f), strongLabelPaint)
        }
    }

    private fun drawBollinger(
        canvas: Canvas,
        start: Int,
        visible: Int,
        left: Float,
        top: Float,
        bottom: Float,
        low: Double,
        high: Double,
        step: Float
    ) {
        if (visible < 20) return
        val closes = ArrayList<Double>(visible)
        for (i in start until start + visible) {
            closes.add(candles.optJSONObject(i)?.optDouble("close") ?: Double.NaN)
        }
        if (closes.size < 20) return

        val upper = ArrayList<Pair<Float, Float>>()
        val lower = ArrayList<Pair<Float, Float>>()
        for (i in 19 until closes.size) {
            val window = closes.subList(i - 19, i + 1)
            if (window.any { !it.isFinite() }) continue
            val mean = window.average()
            val variance = window.sumOf { (it - mean) * (it - mean) } / window.size
            val sd = sqrt(variance)
            val x = left + i * step + step * 0.5f
            upper.add(x to mapY(mean + 2.0 * sd, low, high, top, bottom))
            lower.add(x to mapY(mean - 2.0 * sd, low, high, top, bottom))
        }
        if (upper.size < 2 || lower.size < 2) return

        val band = Path().apply {
            moveTo(upper.first().first, upper.first().second)
            for (i in 1 until upper.size) lineTo(upper[i].first, upper[i].second)
            for (i in lower.indices.reversed()) lineTo(lower[i].first, lower[i].second)
            close()
        }
        canvas.drawPath(band, bbFillPaint)

        fun drawLine(points: List<Pair<Float, Float>>) {
            val path = Path().apply {
                moveTo(points.first().first, points.first().second)
                for (i in 1 until points.size) lineTo(points[i].first, points[i].second)
            }
            canvas.drawPath(path, bbPaint)
        }
        drawLine(upper)
        drawLine(lower)
    }

    private fun drawEma50(
        canvas: Canvas,
        start: Int,
        visible: Int,
        left: Float,
        top: Float,
        bottom: Float,
        low: Double,
        high: Double,
        step: Float
    ) {
        val endExclusive = min(candles.length(), start + visible)
        if (endExclusive <= 0) return

        val k = 2.0 / 51.0
        var ema = Double.NaN
        val path = Path()
        var moved = false
        var lastY = Float.NaN

        for (i in 0 until endExclusive) {
            val close = candles.optJSONObject(i)?.optDouble("close", Double.NaN) ?: Double.NaN
            if (!close.isFinite()) continue
            ema = if (!ema.isFinite()) close else close * k + ema * (1.0 - k)
            if (i < start) continue

            val local = i - start
            val x = left + local * step + step * 0.5f
            val y = mapY(ema, low, high, top, bottom)
            if (!moved) {
                path.moveTo(x, y)
                moved = true
            } else {
                path.lineTo(x, y)
            }
            lastY = y
        }

        if (moved) {
            canvas.drawPath(path, emaPaint)
            if (lastY.isFinite() && lastY in top..bottom && bottom - top >= dp(120f)) {
                canvas.drawText("EMA 50", left + dp(5f), (lastY - dp(5f)).coerceAtLeast(top + dp(10f)), axisLabelPaint)
            }
        }
    }

    private fun drawLevel(canvas: Canvas, left: Float, right: Float, y: Float, text: String) {
        val old: PathEffect? = axisPaint.pathEffect
        axisPaint.pathEffect = DashPathEffect(floatArrayOf(dp(5f), dp(5f)), 0f)
        canvas.drawLine(left, y, right, y, axisPaint)
        axisPaint.pathEffect = old
        canvas.drawText(text, right - dp(27f), y - dp(4f), axisLabelPaint)
    }

    private fun mapY(value: Double, low: Double, high: Double, top: Float, bottom: Float): Float {
        return bottom - (((value - low) / (high - low)).toFloat() * (bottom - top))
    }

    private fun compactPrice(value: Double): String {
        return when {
            abs(value) >= 1000000 -> String.format(Locale.US, "%.2fM", value / 1000000.0)
            abs(value) >= 1000 -> String.format(Locale.US, "%.1fk", value / 1000.0)
            else -> String.format(Locale.US, "%.2f", value)
        }
    }

    private fun formatAxisTime(ts: Long): String {
        if (ts <= 0L) return "—"
        val pattern = when (timeframe) {
            "1h" -> "dd/MM HH'h'"
            "4h" -> "dd/MM"
            else -> "HH:mm"
        }
        return SimpleDateFormat(pattern, Locale.getDefault()).apply {
            timeZone = TimeZone.getDefault()
        }.format(Date(ts))
    }

    private fun formatCrosshairTime(ts: Long): String {
        if (ts <= 0L) return "—"
        return SimpleDateFormat("dd/MM  HH:mm", Locale.getDefault()).apply {
            timeZone = TimeZone.getDefault()
        }.format(Date(ts))
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                parent?.requestDisallowInterceptTouchEvent(true)
                lastTouchX = event.x
                lastTouchY = event.y
                touchDownX = event.x
                touchDownY = event.y
                dragging = false
                pinchActive = false
                return true
            }

            MotionEvent.ACTION_POINTER_DOWN -> {
                if (event.pointerCount >= 2) {
                    pinchActive = true
                    dragging = true
                    pinchStartDistance = distance(event)
                    pinchStartZoomX = zoomX
                    pinchStartZoomY = zoomY
                }
                return true
            }

            MotionEvent.ACTION_MOVE -> {
                if (pinchActive && event.pointerCount >= 2) {
                    val d = distance(event)
                    if (pinchStartDistance > 0f) {
                        val factor = d / pinchStartDistance
                        zoomX = (pinchStartZoomX * factor).coerceIn(0.55f, 3.8f)
                        zoomY = (pinchStartZoomY * factor).coerceIn(0.65f, 2.8f)
                        followLive = false
                        crosshairVisible = false
                        invalidate()
                    }
                    return true
                }

                val dx = event.x - lastTouchX
                val dy = event.y - lastTouchY
                if (abs(event.x - touchDownX) > dp(6f) || abs(event.y - touchDownY) > dp(6f)) {
                    dragging = true
                    followLive = false
                    crosshairVisible = false
                    val bar = max(1f, (width - dp(70f)) / visibleCount())
                    candleShift = (candleShift - dx / bar).coerceIn(
                        0f,
                        max(0f, candles.length() - visibleCount().toFloat())
                    )
                    val visiblePriceRange = estimateVisibleRange()
                    verticalOffset += (-dy / max(1f, height * 0.65f)) * visiblePriceRange
                    invalidate()
                }
                lastTouchX = event.x
                lastTouchY = event.y
                return true
            }

            MotionEvent.ACTION_POINTER_UP -> {
                if (event.pointerCount - 1 < 2) pinchActive = false
                return true
            }

            MotionEvent.ACTION_UP -> {
                parent?.requestDisallowInterceptTouchEvent(false)
                val liveChipHit =
                    event.x > width - dp(70f) &&
                    event.y < dp(42f)

                if (!dragging && !pinchActive) {
                    val now = SystemClock.uptimeMillis()
                    if (liveChipHit || now - lastTapMs < 280L) {
                        followLive = true
                        candleShift = 0f
                        verticalOffset = 0.0
                        zoomX = 1.0f
                        zoomY = 1.0f
                        crosshairVisible = false
                    } else {
                        crosshairVisible = true
                        crosshairX = event.x
                        crosshairY = event.y
                    }
                    lastTapMs = now
                    invalidate()
                }
                return true
            }

            MotionEvent.ACTION_CANCEL -> {
                parent?.requestDisallowInterceptTouchEvent(false)
                pinchActive = false
                dragging = false
                return true
            }
        }
        return true
    }

    private fun distance(event: MotionEvent): Float {
        if (event.pointerCount < 2) return 0f
        val dx = event.getX(0) - event.getX(1)
        val dy = event.getY(0) - event.getY(1)
        return sqrt(dx * dx + dy * dy)
    }

    private fun estimateVisibleRange(): Double {
        if (candles.length() == 0) return 1.0
        val visible = min(candles.length(), visibleCount())
        val endExclusive = candles.length() - candleShift.roundToInt()
        val start = max(0, endExclusive - visible)
        var high = Double.NEGATIVE_INFINITY
        var low = Double.POSITIVE_INFINITY
        for (i in start until endExclusive) {
            val c = candles.optJSONObject(i) ?: continue
            high = max(high, c.optDouble("high"))
            low = min(low, c.optDouble("low"))
        }
        return max(1.0, (high - low) / zoomY)
    }

    private fun dp(v: Float): Float = v * resources.displayMetrics.density
}
