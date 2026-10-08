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
        color = Color.rgb(73, 88, 107)
        strokeWidth = dp(.65f)
        alpha = 75
    }
    private val axisPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.muted
        strokeWidth = dp(.85f)
        alpha = 175
    }
    private val plotBorderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.border
        strokeWidth = dp(.8f)
        style = Paint.Style.STROKE
        alpha = 155
    }
    private val axisPanelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.charcoal
        alpha = 215
    }
    private val volumeDividerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.border
        strokeWidth = dp(.7f)
        alpha = 105
    }
    private val wickPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        strokeWidth = dp(1.05f)
        strokeCap = Paint.Cap.ROUND
    }
    private val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val bbPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.ember
        strokeWidth = dp(.95f)
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        alpha = 205
    }
    private val bbMiddlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.ember
        strokeWidth = dp(1.0f)
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        alpha = 175
    }
    private val emaPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.gold
        strokeWidth = dp(1.7f)
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val emaLabelBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.surface
        style = Paint.Style.FILL
        alpha = 242
    }
    private val emaLabelBorderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.ember
        style = Paint.Style.STROKE
        strokeWidth = dp(.75f)
        alpha = 175
    }
    private val emaLabelTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.gold
        textSize = dp(8.8f)
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
    }
    private val currentPricePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.gold
        strokeWidth = dp(.95f)
        style = Paint.Style.STROKE
        pathEffect = DashPathEffect(floatArrayOf(dp(5f), dp(4f)), 0f)
        alpha = 225
    }
    private val livePriceTagPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.gold
        style = Paint.Style.FILL
    }
    private val livePriceTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.charcoal
        textSize = dp(9.6f)
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
    }
    private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.muted
        textSize = dp(10f)
    }
    private val axisLabelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.muted
        textSize = dp(9.5f)
    }
    private val strongLabelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.white
        textSize = dp(10f)
        typeface = android.graphics.Typeface.create(
            android.graphics.Typeface.DEFAULT,
            android.graphics.Typeface.BOLD
        )
    }
    private val crosshairPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.ember
        strokeWidth = dp(1f)
    }
    private val volumeUpPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(40, 158, 144); alpha = 185 }
    private val volumeDownPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(188, 76, 99); alpha = 185 }
    private val liveChipPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = KyvoriqTheme.graphite }
    private val liveDotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(71, 191, 149) }
    private val controlActivePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = KyvoriqTheme.gold }
    private val controlInactivePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = KyvoriqTheme.graphite }
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
        pathEffect = DashPathEffect(floatArrayOf(dp(2f), dp(4f)), 0f)
        alpha = 150
    }
    private val structureLabelBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.surface
        alpha = 235
    }
    private val structureLabelTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = dp(8.1f)
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
    }
    // Price-axis level rail: colored values are outside the candle plot.
    private val axisLevelBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.slate
        alpha = 246
    }
    private val axisLevelTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = dp(8.2f)
        typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL)
    }
    private val axisLevelGuidePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        strokeWidth = dp(0.7f)
        alpha = 155
    }
    private val zoneFillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val zoneBorderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = dp(.9f)
        pathEffect = DashPathEffect(floatArrayOf(dp(4f), dp(3f)), 0f)
    }
    private val zoneTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.white
        textSize = dp(8.3f)
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
    private val reactionGlowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val reactionChipPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = KyvoriqTheme.surface
    }
    private val reactionChipTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = dp(7.8f)
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
    }
    private val tradeHitPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }

    private var candles = JSONArray()
    private var signal: JSONObject? = null
    private var ema50: Double? = null
    private var overlays = JSONArray()
    private var timeframe = "1h"
    private var livePrice = Double.NaN
    private var feedHealthy = false
    private var showBollinger = true
    private var showEma = true
    private var showVolume = true

    private val layerPrefs = context.getSharedPreferences("kyvoriq_chart_layers", Context.MODE_PRIVATE)
    private var showSfpLevels = layerPrefs.getBoolean("sfp", false)
    private var showNpocLevels = layerPrefs.getBoolean("npoc", true)
    private var showObLevels = layerPrefs.getBoolean("ob", true)
    private var showDailyLevels = layerPrefs.getBoolean("daily", true)
    private var showWeeklyLevels = layerPrefs.getBoolean("weekly", true)
    private var showOtherLevels = layerPrefs.getBoolean("other", false)
    private var levelMenuOpen = false
    private var fullscreenMode = false
    var onFullscreenRequested: (() -> Unit)? = null

    fun setFullscreenMode(value: Boolean) {
        fullscreenMode = value
        levelMenuOpen = false
        invalidate()
    }

    private fun hasVisibleLevelLayers(): Boolean =
        showSfpLevels || showNpocLevels || showObLevels || showDailyLevels || showWeeklyLevels || showOtherLevels

    private fun isOverlayVisible(row: JSONObject): Boolean {
        val kind = row.optString("kind", "LEVEL").uppercase(Locale.US)
        val label = row.optString("label", kind).uppercase(Locale.US)
        return when {
            kind == "SFP" || label.startsWith("SFP") -> showSfpLevels
            kind in setOf("NPOC", "RANGE_POC") || label.contains("NPOC") || label.contains("POC") -> showNpocLevels
            kind in setOf("OB", "OB_ZONE", "SUPPLY_ZONE", "DEMAND_ZONE") || label.contains(" OB") || label.endsWith("OB") -> showObLevels
            kind == "DAILY" || label.startsWith("D HIGH") || label.startsWith("D LOW") || label.startsWith("DAILY") -> showDailyLevels
            kind in setOf("WEEKLY_OPEN", "WEEKLY_NPOC") || label.contains("WEEK") -> showWeeklyLevels
            else -> showOtherLevels
        }
    }

    private fun persistLayerPrefs() {
        layerPrefs.edit()
            .putBoolean("sfp", showSfpLevels)
            .putBoolean("npoc", showNpocLevels)
            .putBoolean("ob", showObLevels)
            .putBoolean("daily", showDailyLevels)
            .putBoolean("weekly", showWeeklyLevels)
            .putBoolean("other", showOtherLevels)
            .apply()
    }

    private val overlayStatusByKey = mutableMapOf<String, String>()
    private val overlayMotionStartedAt = mutableMapOf<String, Long>()
    private var tradeRevealStartedAt = 0L
    private var lastSignalMotionKey = ""
    private var tradeEvent: JSONObject? = null
    private var lastTradeEventMotionKey = ""
    private var tradeHitStartedAt = 0L

    fun setFeedHealthy(value: Boolean) { feedHealthy = value; invalidate() }

    private fun overlayKey(row: JSONObject): String {
        val price = row.optDouble("price", Double.NaN)
        return row.optString("kind", "LEVEL").uppercase(Locale.US) + "|" +
            row.optString("label", "LEVEL").uppercase(Locale.US) + "|" +
            if (price.isFinite()) String.format(Locale.US, "%.2f", price) else "NA"
    }

    private fun applyOverlays(value: JSONArray?) {
        val next = value ?: JSONArray()
        val now = SystemClock.elapsedRealtime()
        val activeKeys = mutableSetOf<String>()
        for (i in 0 until next.length()) {
            val row = next.optJSONObject(i) ?: continue
            val key = overlayKey(row)
            activeKeys += key
            val status = row.optString("status", "").uppercase(Locale.US)
            val previous = overlayStatusByKey[key]
            if (previous != status && status in setOf("ARMED", "PLAYED", "TRIGGERED", "REACTION_CONFIRMED")) {
                overlayMotionStartedAt[key] = now
            }
            overlayStatusByKey[key] = status
        }
        overlayStatusByKey.keys.retainAll(activeKeys)
        overlayMotionStartedAt.keys.retainAll(activeKeys)
        overlays = next
    }

    private fun signalMotionKey(value: JSONObject?): String {
        if (value == null) return ""
        return listOf("id", "entry", "stop", "target1", "target2")
            .joinToString("|") { value.optString(it, "") }
    }

    private fun applySignal(value: JSONObject?) {
        val key = signalMotionKey(value)
        if (key.isNotBlank() && key != lastSignalMotionKey) {
            lastSignalMotionKey = key
            tradeRevealStartedAt = SystemClock.elapsedRealtime()
        } else if (key.isBlank()) {
            lastSignalMotionKey = ""
            tradeRevealStartedAt = 0L
        }
        signal = value
    }

    fun setSignal(value: JSONObject?) {
        applySignal(value)
        invalidate()
    }

    fun setTradeEvent(value: JSONObject?) {
        tradeEvent = value
        if (value == null) return
        val type = value.optString("type", "").uppercase(Locale.US)
        if (type !in setOf("TP1_HIT", "TP2_HIT", "SL_HIT", "EXECUTION_OPEN", "EXECUTION_PENDING")) return
        val key = value.optString("key").ifBlank {
            type + "|" + value.optString("signal_id") + "|" +
                value.optString("trade_id") + "|" + value.optString("price") + "|" +
                value.optString("ts", value.optString("timestamp"))
        }
        if (key.isNotBlank() && key != lastTradeEventMotionKey) {
            lastTradeEventMotionKey = key
            tradeHitStartedAt = SystemClock.elapsedRealtime()
            invalidate()
        }
    }

    fun setOverlays(value: JSONArray?) {
        applyOverlays(value)
        invalidate()
    }

    private var followLive = true
    // Signed shift: positive browses older history; negative creates a limited
    // future-side gutter so dragging right can move the latest candle left.
    private var candleShift = 0f
    private var verticalOffset = 0.0
    // The reference screenshot is a wide, context-first default chart.
    // One zoom unit shows roughly 65–80 15m candles instead of a tightly
    // cropped 35–45 candle viewport. Pinch gestures still work normally.
    // Reference viewport: ~3 days of 1h candles, readable vertical volatility.
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
        applySignal(signal)
        this.ema50 = ema50
        applyOverlays(overlays)
        if (price.isFinite()) this.livePrice = price

        val newCount = candles.length()
        if (followLive) {
            candleShift = 0f
            verticalOffset = 0.0
        } else {
            val added = (newCount - lastDataCount).coerceAtLeast(0)
            if (added > 0) candleShift += added.toFloat()
            val maxShift = max(0f, newCount.toFloat() - visibleCount())
            candleShift = candleShift.coerceIn(-maxFutureShift(), maxShift)
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

    private fun defaultZoomX(): Float = when (timeframe) {
        // The one-hour chart matches the supplied reference when its
        // default 70–80-bar market window is left at native scale.
        "1h" -> 1.0f
        "15m" -> 1.1f
        "5m" -> 1.15f
        else -> 1.0f
    }

    fun resetViewportToDefault() {
        followLive = true
        candleShift = 0f
        verticalOffset = 0.0
        zoomX = defaultZoomX()
        zoomY = 1.0f
        crosshairVisible = false
        invalidate()
    }

    fun setTimeframe(value: String) {
        if (timeframe == value) return
        timeframe = value
        resetViewportToDefault()
    }

    private fun maxFutureShift(): Float = min(16f, visibleCount() * 0.20f)

    private fun visibleCount(): Int {
        val widthPx = max(1f, width - dp(82f))
        val base = max(55f, widthPx / dp(4.15f))
        return max(24, min(180, (base / zoomX).roundToInt()))
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        bgPaint.shader = LinearGradient(
            0f, 0f, 0f, height.toFloat(),
            intArrayOf(KyvoriqTheme.slate, KyvoriqTheme.charcoal, Color.rgb(19, 30, 42)),
            null,
            Shader.TileMode.CLAMP
        )
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), bgPaint)
        bgPaint.shader = null

        val left = dp(6f)
        // Dedicated axis lane for BTC tick values and color-coded level prices.
        val right = width - dp(82f)
        val top = dp(
            if (height < dp(190f)) 32f
            else if (levelMenuOpen) 70f
            else 44f
        )
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
        if (followLive) candleShift = 0f else candleShift = candleShift.coerceIn(-maxFutureShift(), maxShift)

        // Virtual future bars remain blank; real OHLC arrays are never extended
        // or fabricated. This keeps reversed-direction pan usable at live edge.
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

        // Keep the default chart scaled to actual traded candles, not remote
        // profit targets. A nearby entry/SL can expand the viewport modestly;
        // distant targets remain available in Decision Center / trade details.
        val candleRange = (high - low).coerceAtLeast(1.0)
        val allowedLow = low - candleRange * 0.35
        val allowedHigh = high + candleRange * 0.35
        signal?.let { s ->
            for (key in listOf("entry", "stop", "target1", "target2")) {
                val v = s.optDouble(key, Double.NaN)
                if (v.isFinite() && v in allowedLow..allowedHigh) {
                    high = max(high, v)
                    low = min(low, v)
                }
            }
        }

        // Do NOT fit the entire manual Daily/NPOC map into the price range:
        // distant levels used to flatten 15m candles on every app launch.
        // Visible levels are still rendered when price enters their range.

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
        if (hasVisibleLevelLayers()) drawZoneOverlays(canvas, left, right, top, priceBottom, low, high)

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
        if (hasVisibleLevelLayers()) {
            drawStructureOverlays(canvas, left, right, top, priceBottom, low, high)
            signal?.let { s ->
                val revealBase = if (tradeRevealStartedAt > 0L && KyvoriqTheme.motionEnabled(context)) {
                    ((SystemClock.elapsedRealtime() - tradeRevealStartedAt) / 820f).coerceIn(0f, 1f)
                } else 1f
                if (revealBase < 1f) postInvalidateOnAnimation()
                listOf(
                    Triple("entry", "ENTRY", KyvoriqTheme.gold),
                    Triple("stop", "SL", Color.rgb(242, 91, 111)),
                    Triple("target1", "TP1", Color.rgb(76, 211, 166)),
                    Triple("target2", "TP2", Color.rgb(76, 211, 166))
                ).forEachIndexed { index, (key, label, color) ->
                    val value = s.optDouble(key, Double.NaN)
                    if (value.isFinite() && value in low..high) {
                        val startAt = index * 0.12f
                        val reveal = ((revealBase - startAt) / 0.58f).coerceIn(0f, 1f)
                        drawTradeLevel(
                            canvas,
                            left,
                            right,
                            mapY(value, low, high, top, priceBottom),
                            label,
                            value,
                            color,
                            reveal
                        )
                    }
                }
            }
            drawTradeHitEffect(canvas, signal, left, right, top, priceBottom, low, high)
        }

        drawAxisLevelLabels(canvas, right, top, priceBottom, low, high)

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
                    "LVL" -> hasVisibleLevelLayers()
                    "VOL" -> showVolume
                    "FULL" -> fullscreenMode
                    else -> false
                }
                canvas.drawRoundRect(rect, dp(5f), dp(5f), if (active) controlActivePaint else controlInactivePaint)
                controlBorderPaint.color = if (active || (key == "LVL" && levelMenuOpen)) KyvoriqTheme.deepGold else KyvoriqTheme.border
                canvas.drawRoundRect(rect, dp(5f), dp(5f), controlBorderPaint)
                controlTextPaint.color = when {
                    active -> KyvoriqTheme.charcoal
                    key == "FULL" -> KyvoriqTheme.gold
                    else -> KyvoriqTheme.muted
                }
                val label = if (key == "FULL" && fullscreenMode) "EXIT" else key
                val tw = controlTextPaint.measureText(label)
                canvas.drawText(label, rect.centerX() - tw / 2f, rect.centerY() + dp(3f), controlTextPaint)
            }
            if (levelMenuOpen) drawLevelMenu(canvas, left)
        }

        val chipWidth = dp(58f)
        val chipLeft = width - chipWidth - dp(6f)
        val chipTop = dp(8f)
        val rect = RectF(chipLeft, chipTop, width - dp(6f), chipTop + dp(24f))
        canvas.drawRoundRect(rect, dp(12f), dp(12f), liveChipPaint)
        val resetting = !followLive
        liveDotPaint.color = when {
            resetting -> KyvoriqTheme.gold
            feedHealthy -> Color.rgb(71, 191, 149)
            else -> KyvoriqTheme.muted
        }
        canvas.drawCircle(chipLeft + dp(10f), chipTop + dp(12f), dp(3.2f), liveDotPaint)
        val stateText = if (resetting) "RESET" else if (feedHealthy) "LIVE" else "WAIT"
        canvas.drawText(stateText, chipLeft + dp(17f), chipTop + dp(16f), strongLabelPaint)
    }

    private fun indicatorChipRects(left: Float): List<Pair<String, RectF>> {
        val top = dp(23f)
        val height = dp(16f)
        val gap = dp(4f)
        val specs = listOf("BB" to 26f, "EMA" to 34f, "LVL" to 32f, "VOL" to 32f, "FULL" to 38f)
        var x = left
        return specs.map { (key, widthDp) ->
            val rect = RectF(x, top, x + dp(widthDp), top + height)
            x = rect.right + gap
            key to rect
        }
    }

    private fun levelFilterChipRects(left: Float): List<Pair<String, RectF>> {
        val top = dp(44f)
        val height = dp(18f)
        val gap = dp(3f)
        val specs = listOf(
            "SFP" to 29f,
            "NPOC" to 40f,
            "OB" to 27f,
            "DAILY" to 40f,
            "WEEK" to 40f,
            "OTHER" to 43f
        )
        var x = left
        return specs.map { (key, widthDp) ->
            val rect = RectF(x, top, x + dp(widthDp), top + height)
            x = rect.right + gap
            key to rect
        }
    }

    private fun layerEnabled(key: String): Boolean = when (key) {
        "SFP" -> showSfpLevels
        "NPOC" -> showNpocLevels
        "OB" -> showObLevels
        "DAILY" -> showDailyLevels
        "WEEK" -> showWeeklyLevels
        else -> showOtherLevels
    }

    private fun drawLevelMenu(canvas: Canvas, left: Float) {
        levelFilterChipRects(left).forEach { (key, rect) ->
            val active = layerEnabled(key)
            canvas.drawRoundRect(rect, dp(5f), dp(5f), if (active) controlActivePaint else controlInactivePaint)
            controlBorderPaint.color = if (active) KyvoriqTheme.deepGold else KyvoriqTheme.border
            canvas.drawRoundRect(rect, dp(5f), dp(5f), controlBorderPaint)
            controlTextPaint.color = if (active) KyvoriqTheme.charcoal else KyvoriqTheme.muted
            val tw = controlTextPaint.measureText(key)
            canvas.drawText(key, rect.centerX() - tw / 2f, rect.centerY() + dp(3f), controlTextPaint)
        }
    }

    private fun toggleLevelFilterAt(x: Float, y: Float): Boolean {
        if (!levelMenuOpen || height < dp(190f)) return false
        val key = levelFilterChipRects(dp(6f)).firstOrNull { it.second.contains(x, y) }?.first ?: return false
        when (key) {
            "SFP" -> showSfpLevels = !showSfpLevels
            "NPOC" -> showNpocLevels = !showNpocLevels
            "OB" -> showObLevels = !showObLevels
            "DAILY" -> showDailyLevels = !showDailyLevels
            "WEEK" -> showWeeklyLevels = !showWeeklyLevels
            "OTHER" -> showOtherLevels = !showOtherLevels
        }
        persistLayerPrefs()
        crosshairVisible = false
        return true
    }

    private fun toggleIndicatorAt(x: Float, y: Float): Boolean {
        if (height < dp(190f)) return false
        val left = dp(6f)
        val hit = indicatorChipRects(left).firstOrNull { it.second.contains(x, y) }?.first ?: return false
        when (hit) {
            "BB" -> showBollinger = !showBollinger
            "EMA" -> showEma = !showEma
            "LVL" -> levelMenuOpen = !levelMenuOpen
            "VOL" -> showVolume = !showVolume
            "FULL" -> onFullscreenRequested?.invoke()
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
            !changePct.isFinite() -> KyvoriqTheme.muted
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
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = KyvoriqTheme.raised }
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
        color: Int,
        reveal: Float = 1f
    ) {
        if (reveal <= 0f) return
        tradeLevelLinePaint.color = color
        tradeLevelLinePaint.alpha = (205f * reveal).toInt().coerceIn(0, 205)
        val lineRight = left + (right - left) * reveal
        canvas.drawLine(left, y, lineRight, y, tradeLevelLinePaint)
        tradeLevelLinePaint.alpha = 200

        if (reveal < 0.48f) return
        val labelAlpha = (((reveal - 0.48f) / 0.52f) * 255f).toInt().coerceIn(0, 255)
        val text = "$label  " + String.format(Locale.US, "%.2f", value)
        val pad = dp(5f)
        val w = tradeLevelTextPaint.measureText(text) + pad * 2f
        val h = dp(17f)
        // Keep execution chips in the left lane so the right lane remains
        // dedicated to Daily/nPOC/Weekly nPOC map labels.
        val tradeLeft = left + dp(4f)
        val tradeRight = (tradeLeft + w).coerceAtMost(left + (right - left) * 0.58f)
        val rect = RectF(tradeLeft, y - h / 2f, tradeRight, y + h / 2f)
        tradeLevelBgPaint.color = KyvoriqTheme.surface
        tradeLevelBgPaint.alpha = (238f * labelAlpha / 255f).toInt()
        tradeLevelTextPaint.color = color
        tradeLevelTextPaint.alpha = labelAlpha
        canvas.drawRoundRect(rect, dp(5f), dp(5f), tradeLevelBgPaint)
        val available = (rect.width() - pad * 2f).coerceAtLeast(dp(30f))
        val renderedText = if (tradeLevelTextPaint.measureText(text) <= available) text else "$label  " + String.format(Locale.US, "%.0f", value)
        canvas.drawText(renderedText, rect.left + pad, rect.centerY() + dp(3f), tradeLevelTextPaint)
        tradeLevelBgPaint.alpha = 238
        tradeLevelTextPaint.alpha = 255
    }

    private fun drawTradeHitEffect(
        canvas: Canvas,
        signal: JSONObject?,
        left: Float,
        right: Float,
        top: Float,
        bottom: Float,
        low: Double,
        high: Double
    ) {
        if (tradeHitStartedAt <= 0L || !KyvoriqTheme.motionEnabled(context)) return
        val elapsed = SystemClock.elapsedRealtime() - tradeHitStartedAt
        val duration = 1050f
        val progress = (elapsed / duration).coerceIn(0f, 1f)
        if (progress >= 1f) return

        val event = tradeEvent ?: return
        val type = event.optString("type", "").uppercase(Locale.US)
        val eventPrice = event.optDouble("price", Double.NaN)
        val value = if (eventPrice.isFinite()) {
            eventPrice
        } else when (type) {
            "TP1_HIT" -> signal?.optDouble("target1", Double.NaN) ?: Double.NaN
            "TP2_HIT" -> signal?.optDouble("target2", Double.NaN) ?: Double.NaN
            "SL_HIT" -> signal?.optDouble("stop", Double.NaN) ?: Double.NaN
            "EXECUTION_OPEN", "EXECUTION_PENDING" ->
                signal?.optDouble("entry", Double.NaN) ?: Double.NaN
            else -> Double.NaN
        }
        if (!value.isFinite() || value !in low..high) return

        val color = when (type) {
            "TP1_HIT", "TP2_HIT" -> Color.rgb(54, 211, 153)
            "SL_HIT" -> Color.rgb(255, 82, 105)
            else -> KyvoriqTheme.gold
        }
        val y = mapY(value, low, high, top, bottom)
        val pulse = kotlin.math.sin(progress * Math.PI).toFloat().coerceAtLeast(0f)
        val sweepRight = left + (right - left) * progress
        tradeHitPaint.color = color
        tradeHitPaint.alpha = (210f * pulse).toInt().coerceIn(0, 255)
        tradeHitPaint.strokeWidth = dp(1.4f + 2.2f * pulse)
        canvas.drawLine(left, y, sweepRight, y, tradeHitPaint)
        canvas.drawCircle(sweepRight.coerceIn(left, right), y, dp(3f + 5f * pulse), tradeHitPaint)

        val label = when (type) {
            "TP1_HIT" -> "TP1 HIT"
            "TP2_HIT" -> "TP2 HIT"
            "SL_HIT" -> "SL HIT"
            "EXECUTION_OPEN" -> "POSITION OPEN"
            else -> "EXECUTING"
        }
        reactionChipTextPaint.color = color
        reactionChipTextPaint.alpha = (255f * pulse).toInt().coerceIn(0, 255)
        reactionChipPaint.alpha = (225f * pulse).toInt().coerceIn(0, 225)
        val pad = dp(5f)
        val w = reactionChipTextPaint.measureText(label) + pad * 2f
        val h = dp(16f)
        val x = (right - w - dp(7f)).coerceAtLeast(left + dp(8f))
        val chipY = (y - h - dp(7f)).coerceIn(top + dp(2f), bottom - h - dp(2f))
        canvas.drawRoundRect(RectF(x, chipY, x + w, chipY + h), dp(5f), dp(5f), reactionChipPaint)
        canvas.drawText(label, x + pad, chipY + dp(11f), reactionChipTextPaint)
        reactionChipPaint.alpha = 255
        reactionChipTextPaint.alpha = 255
        postInvalidateOnAnimation()
    }

    private fun drawZoneOverlays(
        canvas: Canvas,
        left: Float,
        right: Float,
        top: Float,
        bottom: Float,
        low: Double,
        high: Double
    ) {
        val wallNow = System.currentTimeMillis()
        for (i in 0 until overlays.length()) {
            val row = overlays.optJSONObject(i) ?: continue
            if (!isOverlayVisible(row)) continue
            val zl = row.optDouble("zone_low", Double.NaN)
            val zh = row.optDouble("zone_high", Double.NaN)
            if (!zl.isFinite() || !zh.isFinite() || zl <= 0.0 || zh <= 0.0) continue
            val lo = min(zl, zh); val hi = max(zl, zh)
            if (hi < low || lo > high) continue
            val hideAfter = row.optLong("hide_after_ms", 0L)
            if (hideAfter > 0L && wallNow >= hideAfter) continue
            val direction = row.optString("direction","BOTH").uppercase(Locale.US)
            val kind = row.optString("kind","OB_ZONE").uppercase(Locale.US)
            val color = when {
                direction == "SHORT" || kind == "SUPPLY_ZONE" -> Color.rgb(214,73,94)
                direction == "LONG" -> Color.rgb(54,188,148)
                else -> KyvoriqTheme.deepGold
            }
            val y1=mapY(min(hi,high),low,high,top,bottom)
            val y2=mapY(max(lo,low),low,high,top,bottom)
            val rect=RectF(left,min(y1,y2),right,max(y1,y2))
            zoneFillPaint.color=color; zoneFillPaint.alpha=if(row.optBoolean("manual",false)) 52 else 34
            canvas.drawRect(rect,zoneFillPaint)
            zoneBorderPaint.color=if(kind=="OB" || kind=="OB_ZONE") KyvoriqTheme.white else color
            zoneBorderPaint.alpha=150; canvas.drawRect(rect,zoneBorderPaint)
            val label=row.optString("label",kind).uppercase(Locale.US)
            val w=zoneTextPaint.measureText(label)
            val x=(left+(right-left)*0.52f-w/2f).coerceIn(left+dp(6f),right-w-dp(6f))
            canvas.drawText(label,x,rect.centerY()-dp(3f),zoneTextPaint)
        }
        zoneFillPaint.alpha=255; zoneBorderPaint.alpha=255
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
                if (!isOverlayVisible(row)) return@mapNotNull null
                val zoneLow = row.optDouble("zone_low", Double.NaN)
                val zoneHigh = row.optDouble("zone_high", Double.NaN)
                if (zoneLow.isFinite() && zoneHigh.isFinite() && zoneLow > 0.0 && zoneHigh > 0.0) return@mapNotNull null
                val value = row.optDouble("price", Double.NaN)
                if (!value.isFinite() || value !in low..high) null else Triple(row, value, mapY(value, low, high, top, bottom))
            }
            .sortedBy { it.third }
            .take(24)

        val elapsedNow = SystemClock.elapsedRealtime()
        val wallNow = System.currentTimeMillis()
        rows.forEach { (row, value, lineY) ->
            val kind = row.optString("kind", "LEVEL").uppercase(Locale.US)
            val color = when (kind) {
                "SFP", "WEEKLY_OPEN", "WEEKLY_NPOC" -> KyvoriqTheme.gold
                "DLINE" -> KyvoriqTheme.ember
                "OB", "OB_ZONE" -> KyvoriqTheme.white
                "NPOC", "RANGE_POC", "SUPPLY_ZONE" -> Color.rgb(255, 82, 105)
                "DAILY" -> Color.rgb(54, 211, 153)
                else -> KyvoriqTheme.muted
            }
            val status = row.optString("status", "").uppercase(Locale.US)
            val motionStart = overlayMotionStartedAt[overlayKey(row)] ?: 0L
            val motionAge = if (motionStart > 0L && KyvoriqTheme.motionEnabled(context)) elapsedNow - motionStart else Long.MAX_VALUE

            val hideAfter = row.optLong("hide_after_ms", 0L)
            if (hideAfter > 0L && wallNow >= hideAfter) return@forEach
            val remaining = if (hideAfter > 0L) hideAfter - wallNow else Long.MAX_VALUE
            val retirementFade = if (remaining in 0..4_000L && KyvoriqTheme.motionEnabled(context)) (remaining / 4_000f).coerceIn(0f, 1f) else 1f
            if (remaining in 1..4_000L && KyvoriqTheme.motionEnabled(context)) postInvalidateOnAnimation()

            val armedPulse = if (status == "ARMED" && motionAge in 0..760L) {
                kotlin.math.sin((motionAge / 760.0) * Math.PI).toFloat().coerceAtLeast(0f)
            } else 0f
            val confirmedPulse = if (status in setOf("PLAYED", "TRIGGERED", "REACTION_CONFIRMED") && motionAge in 0..1_450L) {
                kotlin.math.sin((motionAge / 1450.0) * Math.PI).toFloat().coerceAtLeast(0f)
            } else 0f
            if (armedPulse > 0f || confirmedPulse > 0f) postInvalidateOnAnimation()

            val pulse = max(armedPulse, confirmedPulse)
            val alpha = (150f * retirementFade * (1f + 0.35f * pulse)).toInt().coerceIn(0, 240)
            val shrink = (1f - retirementFade) * (right - left) * 0.12f
            val lineLeft = left + shrink
            val lineRight = right - shrink

            structureLinePaint.color = color
            structureLinePaint.alpha = alpha
            structureLinePaint.strokeWidth = dp(0.8f + 1.25f * pulse)
            canvas.drawLine(lineLeft, lineY, lineRight, lineY, structureLinePaint)

            if (pulse > 0f) {
                reactionGlowPaint.color = color
                reactionGlowPaint.alpha = (150f * pulse * retirementFade).toInt().coerceIn(0, 255)
                reactionGlowPaint.strokeWidth = dp(1.6f + 2.8f * pulse)
                canvas.drawCircle(right - dp(8f), lineY, dp(3f + 7f * pulse), reactionGlowPaint)
            }

            // Structural price numbers render in the reserved right-axis lane
            // below, not on top of candles, Bollinger bands or order blocks.

            if (confirmedPulse > 0f) {
                val confirmedText = "REACTION CONFIRMED"
                reactionChipTextPaint.color = color
                reactionChipTextPaint.alpha = (255f * confirmedPulse).toInt().coerceIn(0, 255)
                reactionChipPaint.alpha = (225f * confirmedPulse).toInt().coerceIn(0, 225)
                val chipPad = dp(5f)
                val chipW = reactionChipTextPaint.measureText(confirmedText) + chipPad * 2f
                val chipH = dp(16f)
                val chipLeft = (right - chipW - dp(7f)).coerceAtLeast(left + dp(82f))
                val chipTop = (lineY - chipH - dp(6f)).coerceIn(top + dp(2f), bottom - chipH - dp(2f))
                canvas.drawRoundRect(
                    RectF(chipLeft, chipTop, chipLeft + chipW, chipTop + chipH),
                    dp(5f), dp(5f), reactionChipPaint
                )
                canvas.drawText(confirmedText, chipLeft + chipPad, chipTop + dp(11f), reactionChipTextPaint)
            }

            structureLinePaint.alpha = 150
            structureLinePaint.strokeWidth = dp(.8f)
            structureLabelBgPaint.alpha = 235
            structureLabelTextPaint.alpha = 255
            reactionChipPaint.alpha = 255
            reactionChipTextPaint.alpha = 255
        }
    }

    private data class AxisLevelMark(val originalY: Float, val value: Double, val text: String, val color: Int)

    private fun drawAxisLevelLabels(
        canvas: Canvas,
        right: Float,
        top: Float,
        bottom: Float,
        low: Double,
        high: Double
    ) {
        if (overlays.length() == 0 || !hasVisibleLevelLayers()) return
        val wallNow = System.currentTimeMillis()
        val liveY = if (livePrice.isFinite() && livePrice in low..high) mapY(livePrice, low, high, top, bottom)
                    else Float.NaN
        val markers = (0 until overlays.length()).mapNotNull { overlays.optJSONObject(it) }.mapNotNull { row ->
            if (!isOverlayVisible(row)) return@mapNotNull null
            val zLow = row.optDouble("zone_low", Double.NaN)
            val zHigh = row.optDouble("zone_high", Double.NaN)
            if (zLow.isFinite() && zHigh.isFinite() && zLow > 0 && zHigh > 0) return@mapNotNull null
            if (row.optLong("hide_after_ms", 0L).let { it > 0L && it <= wallNow }) return@mapNotNull null
            val value = row.optDouble("price", Double.NaN)
            if (!value.isFinite() || value !in low..high) return@mapNotNull null
            val kind = row.optString("kind", "LEVEL").uppercase(Locale.US)
            val type = when(kind) {
                "DAILY" -> "D"
                "NPOC" -> "N"
                "WEEKLY_NPOC", "WEEKLY_OPEN" -> "W"
                "RANGE_POC" -> "P"
                "SFP" -> "S"
                "OB", "OB_ZONE" -> "OB"
                else -> "L"
            }
            val color = when(kind) {
                "DAILY" -> Color.rgb(54, 211, 153)
                "NPOC", "RANGE_POC" -> Color.rgb(255, 82, 105)
                "SFP", "WEEKLY_OPEN", "WEEKLY_NPOC" -> KyvoriqTheme.gold
                "OB", "OB_ZONE" -> KyvoriqTheme.white
                else -> KyvoriqTheme.muted
            }
            AxisLevelMark(mapY(value, low, high, top, bottom), value,
                type + " " + String.format(Locale.US, "%,.1f", value), color)
        }.distinctBy { (it.value * 10).roundToInt() }
         .sortedBy { it.originalY }

        // Keep tags aligned with the same right-side strip as BTC axis values.
        // A sparse lane prevents stacked level pills from concealing the plot.
        val minGap = dp(15f)
        val maxRows = ((bottom - top) / minGap).toInt().coerceAtLeast(1)
        val nearLive = markers.filter { !liveY.isFinite() || abs(it.originalY - liveY) > dp(11f) }
        val selected = if (nearLive.size <= maxRows) nearLive else
            nearLive.sortedBy { if (liveY.isFinite()) abs(it.originalY - liveY) else abs(it.originalY - (top + bottom) / 2f) }
                .take(maxRows).sortedBy { it.originalY }

        var previous = top - minGap
        val axisLeft = right + dp(3f)
        val axisRight = width - dp(2f)
        for (mark in selected) {
            val tagY = max(mark.originalY.coerceIn(top + dp(8f), bottom - dp(8f)), previous + minGap)
            if (tagY > bottom - dp(7f)) break
            previous = tagY
            val rect = RectF(axisLeft, tagY - dp(7f), axisRight, tagY + dp(7f))
            axisLevelBgPaint.color = KyvoriqTheme.slate
            canvas.drawRoundRect(rect, dp(3f), dp(3f), axisLevelBgPaint)
            axisLevelGuidePaint.color = mark.color
            canvas.drawLine(right, mark.originalY, axisLeft, tagY, axisLevelGuidePaint)
            axisLevelTextPaint.color = mark.color
            canvas.drawText(mark.text, axisLeft + dp(3f), tagY + dp(2.8f), axisLevelTextPaint)
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
                // Chart-area one-finger gestures manipulate price/time in both
                // axes (opposite the finger). Scroll Trade from its surrounding
                // hero/timeframe/decision cards; chart controls remain tappable.
                // The right-hand price-axis gutter stays scroll-through for
                // navigating the long Trade page; plot gestures pan the chart.
                parent?.requestDisallowInterceptTouchEvent(fullscreenMode || event.x < width - dp(82f))
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
                    parent?.requestDisallowInterceptTouchEvent(true)
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
                val totalDx = abs(event.x - touchDownX)
                val totalDy = abs(event.y - touchDownY)
                // Start swipes on the right-hand axis to scroll the Trade page.
                // Swipes starting inside the plot pan in the direction opposite
                // the finger, horizontally and vertically.
                if (!fullscreenMode && touchDownX >= width - dp(82f)) {
                    lastTouchX = event.x
                    lastTouchY = event.y
                    return true
                }
                if (totalDx > dp(8f) || totalDy > dp(8f)) {
                    parent?.requestDisallowInterceptTouchEvent(true)
                }
                if (abs(event.x - touchDownX) > dp(6f) || abs(event.y - touchDownY) > dp(6f)) {
                    if (!dragging && !dragHapticActive) {
                        KyvoriqHaptics.fire(this, KyvoriqHaptics.Cue.DRAG_START)
                        dragHapticActive = true
                    }
                    dragging = true
                    followLive = false
                    crosshairVisible = false
                    val bar = max(1f, (width - dp(88f)) / visibleCount())
                    // Opposite-to-finger pan with bounded blank future region.
                    candleShift = (candleShift - dx / bar).coerceIn(
                        -maxFutureShift(),
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
                    if (toggleLevelFilterAt(event.x, event.y)) {
                        KyvoriqHaptics.fire(this, KyvoriqHaptics.Cue.SELECT)
                        performClick()
                        invalidate()
                        return true
                    }
                    if (toggleIndicatorAt(event.x, event.y)) {
                        KyvoriqHaptics.fire(this, KyvoriqHaptics.Cue.SELECT)
                        performClick()
                        invalidate()
                        return true
                    }
                    val now = SystemClock.uptimeMillis()
                    if (liveChipHit || now - lastTapMs < 280L) {
                        KyvoriqHaptics.fire(this, KyvoriqHaptics.Cue.CONFIRM)
                        resetViewportToDefault()
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
