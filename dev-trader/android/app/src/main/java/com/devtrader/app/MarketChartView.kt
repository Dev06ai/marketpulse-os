package com.devtrader.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathEffect
import android.graphics.DashPathEffect
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

    private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(9, 10, 13) }
    private val gridPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(31, 33, 40)
        strokeWidth = dp(1f)
    }
    private val axisPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(92, 96, 108)
        strokeWidth = dp(1f)
    }
    private val wickPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeWidth = dp(1.15f) }
    private val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val bbPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(112, 89, 177)
        strokeWidth = dp(1.05f)
        style = Paint.Style.STROKE
    }
    private val emaPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(218, 171, 71)
        strokeWidth = dp(1.15f)
        style = Paint.Style.STROKE
    }
    private val currentPricePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        strokeWidth = dp(1f)
        style = Paint.Style.STROKE
    }
    private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(164, 168, 179)
        textSize = dp(10f)
    }
    private val axisLabelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(136, 140, 151)
        textSize = dp(9.5f)
    }
    private val strongLabelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(235, 237, 241)
        textSize = dp(10f)
        typeface = android.graphics.Typeface.create(
            android.graphics.Typeface.DEFAULT,
            android.graphics.Typeface.BOLD
        )
    }
    private val crosshairPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(152, 156, 169)
        strokeWidth = dp(1f)
    }
    private val volumeUpPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(57, 132, 116) }
    private val volumeDownPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(164, 73, 90) }
    private val liveChipPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(45, 48, 58) }
    private val liveDotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(71, 191, 149) }

    private var candles = JSONArray()
    private var signal: JSONObject? = null
    private var ema50: Double? = null
    private var timeframe = "15m"
    private var livePrice = Double.NaN

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

    fun setData(
        candles: JSONArray,
        signal: JSONObject?,
        ema50: Double?,
        price: Double
    ) {
        this.candles = candles
        this.signal = signal
        this.ema50 = ema50
        if (!price.isNaN()) this.livePrice = price
        if (followLive) {
            candleShift = 0f
            verticalOffset = 0.0
        } else {
            val maxShift = max(0f, candles.length().toFloat() - visibleCount())
            candleShift = candleShift.coerceIn(0f, maxShift)
        }
        invalidate()
    }

    fun setLivePrice(price: Double) {
        if (price.isNaN()) return
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
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), bgPaint)

        val left = dp(10f)
        val right = width - dp(60f)
        val top = dp(48f)
        val priceBottom = height * 0.73f
        val volumeTop = priceBottom + dp(18f)
        val bottom = height - dp(28f)

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

        val center = (high + low) / 2.0 + verticalOffset
        val zoomedRange = range / zoomY
        high = center + zoomedRange / 2.0
        low = center - zoomedRange / 2.0
        range = (high - low).coerceAtLeast(1.0)

        drawGrid(canvas, left, top, right, priceBottom)
        drawAxes(canvas, right, priceBottom, top, bottom, low, high)

        val step = (right - left) / actualVisible
        val candleWidth = max(dp(2.5f), min(dp(10f), step * 0.68f))

        for (j in 0 until actualVisible) {
            val index = start + j
            val c = candles.optJSONObject(index) ?: continue
            val x = left + j * step + step * 0.5f
            val o = c.optDouble("open")
            val h = c.optDouble("high")
            val l = c.optDouble("low")
            val cl = c.optDouble("close")
            val up = cl >= o

            wickPaint.color = if (up) Color.rgb(72, 185, 157) else Color.rgb(214, 86, 105)
            bodyPaint.color = if (up) Color.rgb(50, 145, 121) else Color.rgb(176, 67, 85)

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
        ema50?.let { value ->
            if (value in low..high) {
                val y = mapY(value, low, high, top, priceBottom)
                canvas.drawLine(left, y, right, y, emaPaint)
                canvas.drawText("EMA 50", right - dp(44f), y - dp(4f), labelPaint)
            }
        }

        signal?.let { s ->
            drawLevel(canvas, left, right, mapY(s.optDouble("entry"), low, high, top, priceBottom), "ENTRY")
            drawLevel(canvas, left, right, mapY(s.optDouble("stop"), low, high, top, priceBottom), "SL")
            drawLevel(canvas, left, right, mapY(s.optDouble("target2"), low, high, top, priceBottom), "TP")
        }

        if (!livePrice.isNaN() && visibleLive) {
            val y = mapY(livePrice, low, high, top, priceBottom)
            currentPricePaint.color = Color.rgb(219, 221, 229)
            canvas.drawLine(left, y, right, y, currentPricePaint)
            drawPriceTag(canvas, right + dp(4f), y, String.format(Locale.US, "%.2f", livePrice), true)
        }

        drawTimeAxis(canvas, start, actualVisible, left, right, bottom, step)
        drawCrosshair(canvas, start, actualVisible, left, right, top, priceBottom, bottom, low, high, step)
    }

    private fun drawHeader(canvas: Canvas, left: Float, top: Float) {
        canvas.drawText("PRICE  •  $timeframe", left, dp(17f), strongLabelPaint)
        canvas.drawText("BB(20,2)  •  EMA 50  •  VOL", left, dp(32f), axisLabelPaint)

        val chipWidth = dp(54f)
        val chipLeft = width - chipWidth - dp(10f)
        val chipTop = dp(8f)
        val rect = android.graphics.RectF(chipLeft, chipTop, width - dp(10f), chipTop + dp(24f))
        canvas.drawRoundRect(rect, dp(12f), dp(12f), liveChipPaint)
        canvas.drawCircle(chipLeft + dp(11f), chipTop + dp(12f), dp(3.5f), liveDotPaint)
        canvas.drawText("LIVE", chipLeft + dp(19f), chipTop + dp(16f), strongLabelPaint)
    }

    private fun drawGrid(canvas: Canvas, left: Float, top: Float, right: Float, bottom: Float) {
        for (i in 0..5) {
            val y = top + (bottom - top) * i / 5f
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
        canvas.drawLine(right, top, right, bottom, axisPaint)
        for (i in 0..5) {
            val y = top + (priceBottom - top) * i / 5f
            val value = high - (high - low) * i / 5.0
            val label = compactPrice(value)
            canvas.drawText(label, right + dp(5f), y + dp(3.5f), axisLabelPaint)
        }
        canvas.drawText("VOL", dp(10f), bottom + dp(16f), axisLabelPaint)
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
            canvas.drawText(label, x - dp(16f), bottom + dp(12f), axisLabelPaint)
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

        canvas.drawLine(clampedX, top, clampedX, bottom, crosshairPaint)
        canvas.drawLine(left, clampedY, right, clampedY, crosshairPaint)

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
        val width = if (live) dp(58f) else dp(64f)
        val rect = android.graphics.RectF(x, y - dp(10f), x + width, y + dp(10f))
        val paint = if (live) liveChipPaint else Color.rgb(39, 41, 49).let {
            Paint(Paint.ANTI_ALIAS_FLAG).apply { color = it }
        }
        canvas.drawRoundRect(rect, dp(5f), dp(5f), paint)
        canvas.drawText(text, x + dp(5f), y + dp(3.5f), strongLabelPaint)
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

        fun y(v: Double): Float = mapY(v, low, high, top, bottom)
        fun draw(mult: Double) {
            val path = Path()
            var moved = false
            for (i in 19 until closes.size) {
                val window = closes.subList(i - 19, i + 1)
                val mean = window.average()
                val variance = window.sumOf { (it - mean) * (it - mean) } / window.size
                val sd = sqrt(variance)
                val value = mean + mult * sd
                val x = left + i * step + step * 0.5f
                if (!moved) {
                    path.moveTo(x, y(value))
                    moved = true
                } else {
                    path.lineTo(x, y(value))
                }
            }
            if (moved) canvas.drawPath(path, bbPaint)
        }

        draw(2.0)
        draw(0.0)
        draw(-2.0)
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
        val pattern = if (timeframe == "1h" || timeframe == "4h") "dd/MM" else "HH:mm"
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
