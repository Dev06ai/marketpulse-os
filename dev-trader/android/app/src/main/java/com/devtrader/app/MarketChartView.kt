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
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        alpha = 205
    }
    private val bbMiddlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(224, 167, 46)
        strokeWidth = dp(1.0f)
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        alpha = 175
    }
    private val emaPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(247, 201, 72)
        strokeWidth = dp(1.7f)
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val emaLabelBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(18, 24, 33)
        style = Paint.Style.FILL
        alpha = 242
    }
    private val emaLabelBorderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(184, 134, 11)
        style = Paint.Style.STROKE
        strokeWidth = dp(.75f)
        alpha = 190
    }
    private val emaLabelTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(247, 201, 72)
        textSize = dp(8.8f)
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
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
    private val controlActivePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(49, 39, 14) }
    private val controlInactivePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(20, 27, 36) }
    private val controlBorderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = dp(.7f)
    }
    private val controlTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = dp(8.2f)
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
    }
    private val structureLinePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = dp(.8f)
        pathEffect = DashPathEffect(floatArrayOf(dp(3f), dp(4f)), 0f)
        alpha = 150
    }
    private val structureLabelBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(16, 22, 30)
        alpha = 235
    }
    private val structureLabelTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = dp(8.1f)
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
    }
    private val tradeLevelBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { alpha = 238 }
    private val tradeLevelLinePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = dp(.9f)
        pathEffect = DashPathEffect(floatArrayOf(dp(6f), dp(4f)), 0f)
        alpha = 200
    }
    private val tradeLevelTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = dp(8.2f)
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
    }

    private var candles = JSONArray()
    private var signal: JSONObject? = null
    private var ema50: Double? = null
    private var overlays = JSONArray()
    private var timeframe = "15m"
    private var livePrice = Double.NaN
    private var feedHealthy = false
    private var showBollinger = true
    private var showEma = true
    private var showLevels = true
    private var showVolume = true

    fun setFeedHealthy(value: Boolean) { feedHealthy = value; invalidate() }

    fun setOverlays(value: JSONArray?) {
        overlays = value ?: JSONArray()
        invalidate()
    }

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
    private var dragHapticActive = false
    private var pinchStartDistance = 0f
    private var pinchStartZoomX = 1f
    private var pinchStartZoomY = 1f
    private var lastTapMs = 0L
    private var lastDataCount = 0

    fun setData(
        candles: JSONArray,
        signal: JSONObject?,
        ema50: Double?,
        price: Double,
        overlays: JSONArray? = null
    ) {
        this.candles = candles
        this.signal = signal
        this.ema50 = ema50
        this.overlays = overlays ?: JSONArray()
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
        val priceBottom = if (showVolume) top + (bottom - top) * .76f else bottom
        val volumeTop = if (showVolume) priceBottom + dp(4f) else bottom

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
        if (showVolume) canvas.drawLine(left, volumeTop, right, volumeTop, volumeDividerPaint)
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

            if (showVolume && maxVolume > 0.0) {
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

        if (showBollinger) drawBollinger(canvas, start, actualVisible, left, top, priceBottom, low, high, step)
        if (showEma) drawEma50(canvas, start, actualVisible, left, top, priceBottom, low, high, step)
        if (showLevels) {
            drawStructureOverlays(canvas, left, right, top, priceBottom, low, high)
            signal?.let { s ->
                listOf(
                    Triple("entry", "ENTRY", Color.rgb(247, 201, 72)),
                    Triple("stop", "SL", Color.rgb(242, 91, 111)),
                    Triple("target1", "TP1", Color.rgb(76, 211, 166)),
                    Triple("target2", "TP2", Color.rgb(76, 211, 166))
                ).forEach { (key, label, color) ->
                    val value = s.optDouble(key, Double.NaN)
                    if (value.isFinite() && value in low..high) {
                        drawTradeLevel(canvas, left, right, mapY(value, low, high, top, priceBottom), label, value, color)
                    }
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
        if (top > dp(40f)) {
            indicatorChipRects(left).forEach { (key, rect) ->
                val active = when (key) {
                    "BB" -> showBollinger
                    "EMA" -> showEma
                    "LVL" -> showLevels
                    else -> showVolume
                }
                canvas.drawRoundRect(rect, dp(5f), dp(5f), if (active) controlActivePaint else controlInactivePaint)
                controlBorderPaint.color = if (active) Color.rgb(184, 134, 11) else Color.rgb(55, 64, 76)
                canvas.drawRoundRect(rect, dp(5f), dp(5f), controlBorderPaint)
                controlTextPaint.color = if (active) Color.rgb(247, 201, 72) else Color.rgb(126, 135, 148)
                val tw = controlTextPaint.measureText(key)
                canvas.drawText(key, rect.centerX() - tw / 2f, rect.centerY() + dp(3f), controlTextPaint)
            }
        }

        val chipWidth = dp(58f)
        val chipLeft = width - chipWidth - dp(10f)
        val chipTop = dp(8f)
        val rect = RectF(chipLeft, chipTop, width - dp(10f), chipTop + dp(24f))
        canvas.drawRoundRect(rect, dp(12f), dp(12f), liveChipPaint)
        val resetting = !followLive
        liveDotPaint.color = when {
            resetting -> Color.rgb(247, 201, 72)
            feedHealthy -> Color.rgb(71, 191, 149)
            else -> Color.rgb(156, 163, 175)
        }
        canvas.drawCircle(chipLeft + dp(10f), chipTop + dp(12f), dp(3.2f), liveDotPaint)
        val stateText = if (resetting) "RESET" else if (feedHealthy) "LIVE" else "WAIT"
        canvas.drawText(stateText, chipLeft + dp(17f), chipTop + dp(16f), strongLabelPaint)
    }

    private fun indicatorChipRects(left: Float): List<Pair<String, RectF>> {
        val top = dp(23f)
        val height = dp(16f)
        val gap = dp(4f)
        val specs = listOf("BB" to 26f, "EMA" to 34f, "LVL" to 32f, "VOL" to 32f)
        var x = left
        return specs.map { (key, widthDp) ->
            val rect = RectF(x, top, x + dp(widthDp), top + height)
            x = rect.right + gap
            key to rect
        }
    }

    private fun toggleIndicatorAt(x: Float, y: Float): Boolean {
        if (height < dp(190f)) return false
        val left = dp(10f)
        val hit = indicatorChipRects(left).firstOrNull { it.second.contains(x, y) }?.first ?: return false
        when (hit) {
            "BB" -> showBollinger = !showBollinger
            "EMA" -> showEma = !showEma
            "LVL" -> showLevels = !showLevels
            "VOL" -> showVolume = !showVolume
        }
        crosshairVisible = false
        return true
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
        val candleIndex = (start + ((clampedX - left) / step)).roundToInt().coerceIn(start, min(candles.length() - 1, start + visible - 1))
        val candle = candles.optJSONObject(candleIndex) ?: return
        val snappedX = left + ((candleIndex - start) + 0.5f) * step

        val previousEffect = crosshairPaint.pathEffect
        crosshairPaint.pathEffect = DashPathEffect(floatArrayOf(dp(3f), dp(4f)), 0f)
        canvas.drawLine(snappedX, top, snappedX, bottom, crosshairPaint)
        canvas.drawLine(left, clampedY, right, clampedY, crosshairPaint)
        crosshairPaint.pathEffect = previousEffect

        val price = high - ((clampedY - top) / (priceBottom - top)) * (high - low)

        val dateLabel = formatCrosshairTime(candle.optLong("start", 0L))
        val priceLabel = String.format(Locale.US, "%.2f", price)

        val dateWidth = dp(94f)
        val dateLeft = (snappedX - dateWidth / 2f).coerceIn(left, right - dateWidth)
        val dateTop = bottom + dp(2f)
        canvas.drawRoundRect(
            android.graphics.RectF(dateLeft, dateTop, dateLeft + dateWidth, dateTop + dp(20f)),
            dp(5f), dp(5f), liveChipPaint
        )
        canvas.drawText(dateLabel, dateLeft + dp(6f), dateTop + dp(14f), strongLabelPaint)

        drawPriceTag(canvas, right + dp(4f), clampedY, priceLabel, false)

        val open = candle.optDouble("open", Double.NaN)
        val close = candle.optDouble("close", Double.NaN)
        val volume = candle.optDouble("volume", Double.NaN)
        val changePct = if (open.isFinite() && open != 0.0 && close.isFinite()) (close - open) / open * 100.0 else Double.NaN
        val line1 = "O " + compactPrice(open) +
            "   H " + compactPrice(candle.optDouble("high")) +
            "   L " + compactPrice(candle.optDouble("low")) +
            "   C " + compactPrice(close)
        val line2 = "VOL " + compactVolume(volume) +
            if (changePct.isFinite()) "   Δ " + String.format(Locale.US, "%+.2f%%", changePct) else ""
        val infoWidth = min(width - dp(28f), dp(278f))
        val infoLeft = (snappedX - infoWidth / 2f).coerceIn(left, right - infoWidth)
        val infoTop = max(dp(47f), clampedY - dp(52f))
        canvas.drawRoundRect(
            RectF(infoLeft, infoTop, infoLeft + infoWidth, infoTop + dp(36f)),
            dp(7f), dp(7f), liveChipPaint
        )
        canvas.drawText(line1, infoLeft + dp(7f), infoTop + dp(14f), axisLabelPaint)
        val oldColor = axisLabelPaint.color
        axisLabelPaint.color = when {
            !changePct.isFinite() -> Color.rgb(156, 163, 175)
            changePct >= 0.0 -> Color.rgb(76, 211, 166)
            else -> Color.rgb(242, 91, 111)
        }
        canvas.drawText(line2, infoLeft + dp(7f), infoTop + dp(29f), axisLabelPaint)
        axisLabelPaint.color = oldColor
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
        if (visible <= 1 || candles.length() <= 1) return
        val endExclusive = min(candles.length(), start + visible)

        val upperPath = Path()
        val middlePath = Path()
        val lowerPath = Path()
        var upperMoved = false
        var middleMoved = false
        var lowerMoved = false

        for (chartIndex in start until endExclusive) {
            val windowStart = max(0, chartIndex - 19)
            val window = ArrayList<Double>(20)
            for (i in windowStart..chartIndex) {
                val close = candles.optJSONObject(i)?.optDouble("close", Double.NaN) ?: Double.NaN
                if (close.isFinite()) window.add(close)
            }
            if (window.size < 2) continue

            val mean = window.average()
            val variance = window.sumOf { (it - mean) * (it - mean) } / window.size
            val sd = sqrt(variance)
            val x = left + (chartIndex - start) * step + step * 0.5f

            val upperY = mapY(mean + 2.0 * sd, low, high, top, bottom)
            val middleY = mapY(mean, low, high, top, bottom)
            val lowerY = mapY(mean - 2.0 * sd, low, high, top, bottom)

            if (!upperMoved) {
                upperPath.moveTo(x, upperY)
                upperMoved = true
            } else upperPath.lineTo(x, upperY)

            if (!middleMoved) {
                middlePath.moveTo(x, middleY)
                middleMoved = true
            } else middlePath.lineTo(x, middleY)

            if (!lowerMoved) {
                lowerPath.moveTo(x, lowerY)
                lowerMoved = true
            } else lowerPath.lineTo(x, lowerY)
        }

        if (upperMoved) canvas.drawPath(upperPath, bbPaint)
        if (middleMoved) canvas.drawPath(middlePath, bbMiddlePaint)
        if (lowerMoved) canvas.drawPath(lowerPath, bbPaint)
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
        var lastX = Float.NaN
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
            lastX = x
            lastY = y
        }

        if (moved) {
            canvas.drawPath(path, emaPaint)
            if (lastX.isFinite() && lastY.isFinite() && lastY in top..bottom && bottom - top >= dp(120f)) {
                val text = "EMA 50"
                val textWidth = emaLabelTextPaint.measureText(text)
                val padX = dp(6f)
                val chipWidth = textWidth + padX * 2f
                val chipHeight = dp(18f)
                val chipRight = (lastX - dp(5f)).coerceAtMost(left + (visible - 1) * step)
                val chipLeft = (chipRight - chipWidth).coerceAtLeast(left + dp(4f))
                val preferredTop = if (lastY - chipHeight - dp(6f) >= top) {
                    lastY - chipHeight - dp(6f)
                } else {
                    lastY + dp(6f)
                }
                val chipTop = preferredTop.coerceIn(top + dp(3f), bottom - chipHeight - dp(3f))
                val rect = RectF(chipLeft, chipTop, chipLeft + chipWidth, chipTop + chipHeight)
                canvas.drawRoundRect(rect, dp(6f), dp(6f), emaLabelBgPaint)
                canvas.drawRoundRect(rect, dp(6f), dp(6f), emaLabelBorderPaint)
                canvas.drawText(text, chipLeft + padX, chipTop + dp(12.2f), emaLabelTextPaint)
            }
        }
    }

    private fun drawTradeLevel(
        canvas: Canvas,
        left: Float,
        right: Float,
        y: Float,
        label: String,
        value: Double,
        color: Int
    ) {
        tradeLevelLinePaint.color = color
        canvas.drawLine(left, y, right, y, tradeLevelLinePaint)
        val text = "$label  " + String.format(Locale.US, "%.2f", value)
        val pad = dp(5f)
        val w = tradeLevelTextPaint.measureText(text) + pad * 2f
        val h = dp(17f)
        val rect = RectF((right - w - dp(4f)).coerceAtLeast(left + dp(4f)), y - h / 2f, right - dp(4f), y + h / 2f)
        tradeLevelBgPaint.color = Color.rgb(13, 18, 24)
        tradeLevelTextPaint.color = color
        canvas.drawRoundRect(rect, dp(5f), dp(5f), tradeLevelBgPaint)
        canvas.drawText(text, rect.left + pad, rect.centerY() + dp(3f), tradeLevelTextPaint)
    }

    private fun drawStructureOverlays(
        canvas: Canvas,
        left: Float,
        right: Float,
        top: Float,
        bottom: Float,
        low: Double,
        high: Double
    ) {
        if (overlays.length() == 0) return
        val rows = (0 until overlays.length()).mapNotNull { overlays.optJSONObject(it) }
            .mapNotNull { row ->
                val value = row.optDouble("price", Double.NaN)
                if (!value.isFinite() || value !in low..high) null else Triple(row, value, mapY(value, low, high, top, bottom))
            }
            .sortedBy { it.third }
            .take(6)

        var lastLabelBottom = top - dp(20f)
        rows.forEach { (row, value, lineY) ->
            val kind = row.optString("kind", "LEVEL").uppercase(Locale.US)
            val color = when (kind) {
                "SFP" -> Color.rgb(224, 167, 46)
                "DLINE" -> Color.rgb(247, 201, 72)
                "OB" -> Color.rgb(156, 163, 175)
                "NPOC" -> Color.rgb(219, 188, 103)
                else -> Color.rgb(126, 135, 148)
            }
            structureLinePaint.color = color
            canvas.drawLine(left, lineY, right, lineY, structureLinePaint)

            val rawLabel = row.optString("label", kind).uppercase(Locale.US)
            val text = rawLabel.take(12)
            structureLabelTextPaint.color = color
            val pad = dp(4f)
            val w = structureLabelTextPaint.measureText(text) + pad * 2f
            val h = dp(15f)
            var labelTop = (lineY - h / 2f).coerceIn(top + dp(2f), bottom - h - dp(2f))
            if (labelTop < lastLabelBottom + dp(2f)) {
                labelTop = (lastLabelBottom + dp(2f)).coerceAtMost(bottom - h - dp(2f))
            }
            val rect = RectF(left + dp(3f), labelTop, left + dp(3f) + w, labelTop + h)
            canvas.drawRoundRect(rect, dp(4f), dp(4f), structureLabelBgPaint)
            canvas.drawText(text, rect.left + pad, rect.centerY() + dp(2.8f), structureLabelTextPaint)
            lastLabelBottom = rect.bottom
        }
    }

    private fun mapY(value: Double, low: Double, high: Double, top: Float, bottom: Float): Float {
        return bottom - (((value - low) / (high - low)).toFloat() * (bottom - top))
    }

    private fun compactPrice(value: Double): String {
        if (!value.isFinite()) return "—"
        return when {
            abs(value) >= 1000000 -> String.format(Locale.US, "%.2fM", value / 1000000.0)
            abs(value) >= 1000 -> String.format(Locale.US, "%.1fk", value / 1000.0)
            else -> String.format(Locale.US, "%.2f", value)
        }
    }

    private fun compactVolume(value: Double): String {
        if (!value.isFinite()) return "—"
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
                dragHapticActive = false
                return true
            }

            MotionEvent.ACTION_POINTER_DOWN -> {
                if (event.pointerCount >= 2) {
                    pinchActive = true
                    dragging = true
                    if (!dragHapticActive) {
                        KyvoriqHaptics.fire(this, KyvoriqHaptics.Cue.DRAG_START)
                        dragHapticActive = true
                    }
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
                    if (!dragging && !dragHapticActive) {
                        KyvoriqHaptics.fire(this, KyvoriqHaptics.Cue.DRAG_START)
                        dragHapticActive = true
                    }
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
                if (event.pointerCount - 1 < 2) {
                    pinchActive = false
                    if (dragHapticActive) {
                        KyvoriqHaptics.fire(this, KyvoriqHaptics.Cue.DRAG_END)
                        dragHapticActive = false
                    }
                }
                return true
            }

            MotionEvent.ACTION_UP -> {
                parent?.requestDisallowInterceptTouchEvent(false)
                val liveChipHit =
                    event.x > width - dp(70f) &&
                    event.y < dp(42f)

                if (!dragging && !pinchActive) {
                    if (toggleIndicatorAt(event.x, event.y)) {
                        KyvoriqHaptics.fire(this, KyvoriqHaptics.Cue.SELECT)
                        performClick()
                        invalidate()
                        return true
                    }
                    val now = SystemClock.uptimeMillis()
                    if (liveChipHit || now - lastTapMs < 280L) {
                        KyvoriqHaptics.fire(this, KyvoriqHaptics.Cue.CONFIRM)
                        followLive = true
                        candleShift = 0f
                        verticalOffset = 0.0
                        zoomX = 1.0f
                        zoomY = 1.0f
                        crosshairVisible = false
                    } else {
                        KyvoriqHaptics.fire(this, KyvoriqHaptics.Cue.TAP)
                        crosshairVisible = true
                        crosshairX = event.x
                        crosshairY = event.y
                    }
                    lastTapMs = now
                    invalidate()
                } else if (dragHapticActive) {
                    KyvoriqHaptics.fire(this, KyvoriqHaptics.Cue.DRAG_END)
                    dragHapticActive = false
                }
                return true
            }

            MotionEvent.ACTION_CANCEL -> {
                parent?.requestDisallowInterceptTouchEvent(false)
                pinchActive = false
                dragging = false
                dragHapticActive = false
                return true
            }
        }
        return true
    }

    override fun performClick(): Boolean {
        super.performClick()
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
