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
        color = Color.rgb(74, 76, 82)
        strokeWidth = dp(.65f)
        alpha = 52
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
        color = Color.rgb(136, 140, 146)
        strokeWidth = dp(.95f)
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        alpha = 120
    }
    private val bbMiddlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(162, 166, 171)
        strokeWidth = dp(1.0f)
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        alpha = 175
    }
    private val emaPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.white
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
        color = KyvoriqTheme.gray
        style = Paint.Style.STROKE
        strokeWidth = dp(.75f)
        alpha = 175
    }
    private val emaLabelTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.white
        textSize = dp(8.8f)
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
    }
    private val currentPricePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.gray
        strokeWidth = dp(.95f)
        style = Paint.Style.STROKE
        pathEffect = DashPathEffect(floatArrayOf(dp(5f), dp(4f)), 0f)
        alpha = 225
    }
    private val livePriceTagPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.white
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
        color = KyvoriqTheme.gray
        strokeWidth = dp(1f)
    }
    private val volumeUpPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(206, 207, 210); alpha = 175 }
    private val volumeDownPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(109, 112, 119); alpha = 175 }
    // Estimated volume at price, not exact tick-trade distribution.
    private val profileUpPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(236, 229, 211); alpha = 84 }
    private val profileDownPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(84, 122, 174); alpha = 84 }
    private val profileLinePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeWidth = dp(.85f); alpha = 165 }
    private val profileCaptionPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = KyvoriqTheme.muted; textSize = dp(7.1f) }
    private val profileReadoutPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.white
        textSize = dp(8.0f)
        typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL)
    }
    private val profileReadoutBg = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = KyvoriqTheme.graphite
        alpha = 225
    }
    private val liveChipPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = KyvoriqTheme.graphite }
    private val liveDotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(198, 201, 205) }
    private val controlActivePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(216, 218, 221) }
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
    private var sessionProfiles = JSONArray()
    private var screenshotReferences = DewaldSnapshotReferences.rows()
    private var timeframe = "1h"
    private var livePrice = Double.NaN
    private var feedHealthy = false
    private var customAlertLevels: List<Double> = emptyList()
    private var showBollinger = false
    private var showEma = true
    private var showVolume = true

    private val layerPrefs = context.getSharedPreferences("kyvoriq_chart_layers", Context.MODE_PRIVATE)
    private var showSfpLevels = layerPrefs.getBoolean("sfp", false)
    private var showNpocLevels = layerPrefs.getBoolean("npoc", false)
    private var showObLevels = layerPrefs.getBoolean("ob", false)
    private var showDailyLevels = layerPrefs.getBoolean("daily", false)
    private var showWeeklyLevels = layerPrefs.getBoolean("weekly", false)
    private var showOtherLevels = layerPrefs.getBoolean("other", false)
    private var showSessionProfiles = layerPrefs.getBoolean("session_profile", true)
    private var levelMenuOpen = false
    private var fullscreenMode = false
    private var accessTier = KyvoriqAccessTier.BASIC

    init {
        // Previous builds enabled several unrelated reference layers at once.
        // Migrate one time to a clean VP chart, but allow users to turn them
        // back on individually in LVL; never change paid-tier entitlements.
        if (!layerPrefs.getBoolean("vp_core_only_v1", false)) {
            showNpocLevels = false
            showObLevels = false
            showDailyLevels = false
            showWeeklyLevels = false
            showOtherLevels = false
            layerPrefs.edit()
                .putBoolean("npoc", false).putBoolean("ob", false)
                .putBoolean("daily", false).putBoolean("weekly", false)
                .putBoolean("other", false)
                .putBoolean("vp_core_only_v1", true).apply()
        }
    }

    var onFullscreenRequested: (() -> Unit)? = null
    var onUpgradeRequested: ((String) -> Unit)? = null

    /** The consumer server must verify any future paid tier; clients cannot grant purchases. */
    fun setAccessTier(value: KyvoriqAccessTier) {
        if (accessTier == value) return
        accessTier = value
        if (fullscreenMode && !accessTier.fullscreenChart()) onFullscreenRequested?.invoke()
        levelMenuOpen = false
        invalidate()
    }

    fun canUseFullscreenChart(): Boolean = accessTier.fullscreenChart()

    fun setFullscreenMode(value: Boolean) {
        fullscreenMode = value && accessTier.fullscreenChart()
        levelMenuOpen = false
        invalidate()
    }

    private fun hasVisibleLevelLayers(): Boolean =
        showSfpLevels ||
        (accessTier.dailyWeeklyNpoc() && (showNpocLevels || showDailyLevels || showWeeklyLevels)) ||
        (accessTier.highValueOrderBlocks() && showObLevels) ||
        (accessTier.dLineAndValueArea() && showOtherLevels)

    private fun requiredTier(key: String): KyvoriqAccessTier = when (key) {
        "VP", "FULL", "NPOC", "DAILY", "WEEK" -> KyvoriqAccessTier.PRO
        "OB", "OTHER" -> KyvoriqAccessTier.ELITE
        else -> KyvoriqAccessTier.BASIC
    }

    private fun mayUse(key: String): Boolean = accessTier.isAtLeast(requiredTier(key))

    private fun isOverlayVisible(row: JSONObject): Boolean {
        // A reference sourced from a screenshot is not a live volume-profile
        // component. Never turn on iPOC, SFP gap, Daily or range lines simply
        // because VP was selected. Apply normal LVL filters and tier checks.
        val kind = row.optString("kind", "LEVEL").uppercase(Locale.US)
        val label = row.optString("label", kind).uppercase(Locale.US)
        return when {
            kind == "SFP" || label.startsWith("SFP") -> showSfpLevels
            kind in setOf("OB", "OB_ZONE", "SUPPLY_ZONE", "DEMAND_ZONE") || label.contains(" OB") || label.endsWith("OB") ->
                accessTier.highValueOrderBlocks() && showObLevels
            kind in setOf("RANGE_VAH", "RANGE_VAL", "D_LINE", "D-LINE", "DLINE") ||
                label.contains("VAH") || label.contains("VAL") || label.contains("D-LINE") ->
                accessTier.dLineAndValueArea() && showOtherLevels
            kind in setOf("WEEKLY", "WEEKLY_OPEN", "WEEKLY_NPOC") || label.startsWith("WEEKLY") ->
                accessTier.dailyWeeklyNpoc() && showWeeklyLevels
            kind in setOf("NPOC", "RANGE_POC", "IPOC") || label.contains("NPOC") || label.contains("POC") ->
                accessTier.dailyWeeklyNpoc() && showNpocLevels
            kind == "DAILY" || label.startsWith("D HIGH") || label.startsWith("D LOW") || label.startsWith("DAILY") ->
                accessTier.dailyWeeklyNpoc() && showDailyLevels
            else -> accessTier.dLineAndValueArea() && showOtherLevels
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
            .putBoolean("session_profile", showSessionProfiles)
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

    fun setCustomPriceAlerts(levels: List<Double>) {
        val checked = levels.filter { it.isFinite() && it > 0.0 }.take(20)
        if (customAlertLevels != checked) {
            customAlertLevels = checked
            invalidate()
        }
    }

    fun setSessionProfiles(value: JSONArray?) {
        sessionProfiles = value ?: JSONArray()
        invalidate()
    }

    fun setReferenceLevels(value: JSONArray?) {
        screenshotReferences = DewaldSnapshotReferences.merge(value)
        invalidate()
    }

    private fun displayLevelRows(): List<JSONObject> {
        val now = System.currentTimeMillis()
        // Screenshot references are historical chart annotations, not executable
        // manual levels. Keep their exact y anchors during a private-feed outage.
        val refs = (0 until screenshotReferences.length()).mapNotNull {
            screenshotReferences.optJSONObject(it)
        }.filter { it.optLong("reference_expires_ms", 0L) > now }
        val exactKeys = refs.mapNotNull { r ->
            val p = r.optDouble("price", Double.NaN)
            if (p.isFinite()) r.optString("kind") + "|" + String.format(Locale.US, "%.1f", p) else null
        }.toSet()
        return refs + (0 until overlays.length()).mapNotNull { overlays.optJSONObject(it) }
            .filter { row ->
                val p = row.optDouble("price", Double.NaN)
                !p.isFinite() || row.optString("kind") + "|" + String.format(Locale.US, "%.1f", p) !in exactKeys
            }
    }

    private fun overlayKey(row: JSONObject): String {
        val price = row.optDouble("price", Double.NaN)
        return row.optString("kind", "LEVEL").uppercase(Locale.US) + "|" +
            row.optString("label", "LEVEL").uppercase(Locale.US) + "|" +
            if (price.isFinite()) String.format(Locale.US, "%.2f", price) else "NA"
    }

    private fun applyOverlays(value: JSONArray?) {
        val next = OrderBlockPolicy.filter(value, livePrice)
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
        obBadgePage = 0
        resetViewportToDefault()
    }

    private fun maxFutureShift(): Float = min(16f, visibleCount() * 0.20f)

    private fun visibleCount(): Int {
        // Preserve the familiar candle count while reclaiming plot space from the price rail.
        val widthPx = max(1f, plotRight() - dp(4f))
        val base = max(55f, widthPx / dp(4.15f))
        return max(24, min(180, (base / zoomX).roundToInt()))
    }

    internal data class PlotGeometry(val price: RectF, val volume: RectF)

    // Shared by drawing, gesture scale and instrumentation: enlarging the View
    // must enlarge the real candle region, not a wrapper around a fixed plot.
    internal fun plotGeometry(): PlotGeometry {
        val baseTop = if (height < dp(190f)) 32f else if (levelMenuOpen) 66f else 42f
        val profileReadoutHeight = if (height >= dp(190f) &&
            showSessionProfiles && accessTier.volumeProfile() && sessionProfiles.length() > 0) 20f else 0f
        val top = dp(baseTop + profileReadoutHeight)
        val bottom = height - dp(22f)
        val volumeHeight = if (showVolume) height * 0.20f else 0f
        val volumeTop = bottom - volumeHeight
        val priceBottom = if (showVolume) volumeTop - dp(4f) else bottom
        return PlotGeometry(RectF(dp(4f), top, plotRight(), priceBottom),
            RectF(dp(4f), volumeTop, plotRight(), bottom))
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        bgPaint.shader = LinearGradient(
            0f, 0f, 0f, height.toFloat(),
            intArrayOf(KyvoriqTheme.slate, KyvoriqTheme.charcoal, KyvoriqTheme.slate),
            null,
            Shader.TileMode.CLAMP
        )
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), bgPaint)
        bgPaint.shader = null

        val geometry = plotGeometry()
        val left = geometry.price.left
        val right = geometry.price.right
        val top = geometry.price.top
        val bottom = geometry.volume.bottom
        val priceBottom = geometry.price.bottom
        val volumeTop = geometry.volume.top

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
        val selectedProfile = if (showSessionProfiles && accessTier.volumeProfile())
            selectedSessionVolumeProfile(start, endExclusive) else null
        drawVolumeProfileReadout(canvas, selectedProfile, left, right, top)

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
        drawAxes(canvas, right, top, bottom)
        if (hasVisibleLevelLayers()) drawZoneOverlays(canvas, left, right, top, priceBottom, low, high)

        // Reserve two blank bar slots by the axis so the latest wick never crowds the price labels.
        // This changes visual spacing only; candle timestamps, prices and indicator values are untouched.
        val step = (right - left) / (actualVisible + 2f)
        if (selectedProfile != null) drawSessionVolumeProfiles(canvas, selectedProfile, start, left, right, top, priceBottom, low, high, step)
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

            wickPaint.color = if (up) Color.rgb(247, 247, 248) else Color.rgb(154, 157, 164)
            bodyPaint.color = if (up) Color.rgb(233, 234, 236) else Color.rgb(105, 108, 115)

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
        if (hasVisibleLevelLayers() || (showSessionProfiles && accessTier.volumeProfile())) drawStructureOverlays(canvas, left, right, top, priceBottom, low, high)
        if (hasVisibleLevelLayers()) {
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

        // User-defined one-shot BTC alerts are independent of strategy levels
        // and remain visible even with SFP/NPOC/OB level layers disabled.
        customAlertLevels.forEach { level ->
            if (level in low..high) {
                drawTradeLevel(
                    canvas, left, right,
                    mapY(level, low, high, top, priceBottom),
                    "ALERT", level, KyvoriqTheme.gold
                )
            }
        }
        // OB labels must be painted last so candles/EMA cannot cover prices.
        if (hasVisibleLevelLayers()) drawZonePriceBadges(canvas, left, right, top, priceBottom, low, high)
        val occupiedAxisTags = drawAxisLevelLabels(canvas, right, top, priceBottom, low, high, start, endExclusive, selectedProfile)

        if (!livePrice.isNaN() && visibleLive) {
            val y = mapY(livePrice, low, high, top, priceBottom)
            canvas.drawLine(left, y, right, y, currentPricePaint)
            drawPriceTag(canvas, right, y, compactPrice(livePrice), true)
        }

        drawTimeAxis(canvas, start, actualVisible, left, right, bottom, step)
        drawCrosshair(canvas, start, actualVisible, left, right, top, priceBottom, bottom, low, high, step)
        // Ticks are LAST and only use space left by the ACTUAL (possibly shifted) level badges,
        // live tag and crosshair. Never overwrite a high-priority price annotation.
        drawAxisTicks(canvas, right, top, priceBottom, low, high, occupiedAxisTags)
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
                    "VP" -> showSessionProfiles && accessTier.volumeProfile()
                    "FULL" -> fullscreenMode && accessTier.fullscreenChart()
                    else -> false
                }
                canvas.drawRoundRect(rect, dp(5f), dp(5f), if (active) controlActivePaint else controlInactivePaint)
                controlBorderPaint.color = if (active || (key == "LVL" && levelMenuOpen)) KyvoriqTheme.gray else KyvoriqTheme.border
                canvas.drawRoundRect(rect, dp(5f), dp(5f), controlBorderPaint)
                controlTextPaint.color = when {
                    active -> KyvoriqTheme.charcoal
                    !mayUse(key) -> KyvoriqTheme.muted
                    key == "FULL" -> KyvoriqTheme.white
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
            feedHealthy -> Color.rgb(198, 201, 205)
            else -> KyvoriqTheme.muted
        }
        canvas.drawCircle(chipLeft + dp(10f), chipTop + dp(12f), dp(3.2f), liveDotPaint)
        val stateText = if (resetting) "RESET" else if (feedHealthy) "LIVE" else "WAIT"
        canvas.drawText(stateText, chipLeft + dp(17f), chipTop + dp(16f), strongLabelPaint)
    }

    private fun indicatorChipRects(left: Float): List<Pair<String, RectF>> {
        val top = dp(21f)
        val height = dp(16f)
        val gap = dp(4f)
        val specs = listOf("BB" to 26f, "EMA" to 34f, "LVL" to 32f, "VOL" to 32f, "VP" to 28f, "FULL" to 38f)
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
        "NPOC" -> accessTier.dailyWeeklyNpoc() && showNpocLevels
        "OB" -> accessTier.highValueOrderBlocks() && showObLevels
        "DAILY" -> accessTier.dailyWeeklyNpoc() && showDailyLevels
        "WEEK" -> accessTier.dailyWeeklyNpoc() && showWeeklyLevels
        else -> accessTier.dLineAndValueArea() && showOtherLevels
    }

    private fun drawLevelMenu(canvas: Canvas, left: Float) {
        levelFilterChipRects(left).forEach { (key, rect) ->
            val active = layerEnabled(key)
            canvas.drawRoundRect(rect, dp(5f), dp(5f), if (active) controlActivePaint else controlInactivePaint)
            controlBorderPaint.color = if (active) KyvoriqTheme.gray else KyvoriqTheme.border
            canvas.drawRoundRect(rect, dp(5f), dp(5f), controlBorderPaint)
            controlTextPaint.color = if (active) KyvoriqTheme.charcoal else KyvoriqTheme.muted
            val tw = controlTextPaint.measureText(key)
            canvas.drawText(key, rect.centerX() - tw / 2f, rect.centerY() + dp(3f), controlTextPaint)
        }
    }

    private fun toggleLevelFilterAt(x: Float, y: Float): Boolean {
        if (!levelMenuOpen || height < dp(190f)) return false
        val key = levelFilterChipRects(dp(4f)).firstOrNull { it.second.contains(x, y) }?.first ?: return false
        if (!mayUse(key)) {
            onUpgradeRequested?.invoke(key)
            return true
        }
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
        val left = dp(4f)
        val hit = indicatorChipRects(left).firstOrNull { it.second.contains(x, y) }?.first ?: return false
        if (!mayUse(hit)) {
            onUpgradeRequested?.invoke(hit)
            return true
        }
        when (hit) {
            "BB" -> showBollinger = !showBollinger
            "EMA" -> showEma = !showEma
            "LVL" -> levelMenuOpen = !levelMenuOpen
            "VOL" -> showVolume = !showVolume
            "VP" -> { showSessionProfiles = !showSessionProfiles; persistLayerPrefs() }
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

    private fun drawAxes(canvas: Canvas, right: Float, top: Float, bottom: Float) {
        canvas.drawRect(right, top, width.toFloat(), bottom + dp(22f), axisPanelPaint)
        canvas.drawLine(right, top, right, bottom, axisPaint)
    }

    private fun drawAxisTicks(
        canvas: Canvas, right: Float, top: Float, priceBottom: Float,
        low: Double, high: Double, occupiedTagCenters: List<Float>
    ) {
        val ticks = ((priceBottom - top) / dp(28f)).toInt().coerceIn(2, 5)
        val liveY = if (livePrice.isFinite() && livePrice in low..high)
            mapY(livePrice, low, high, top, priceBottom) else Float.NaN
        val crossY = if (crosshairVisible) crosshairY.coerceIn(top, priceBottom) else Float.NaN
        // Never estimate this from raw price levels: badge collision avoidance MOVES the badges.
        for (i in 0..ticks) {
            val y = top + (priceBottom - top) * i / ticks
            if (liveY.isFinite() && abs(y - liveY) < dp(23f)) continue
            if (crossY.isFinite() && abs(y - crossY) < dp(22f)) continue
            if (occupiedTagCenters.any { abs(y - it) < dp(20f) }) continue
            val price = high - (high - low) * i / ticks
            val label = compactPrice(price)
            // A small font-scale or phone width must not clip ordinary price values.
            if (axisLabelPaint.measureText(label) > width - right - dp(8f)) continue
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

        drawPriceTag(canvas, right, clampedY, priceLabel, false)

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
        val infoWidth = min(right - left, dp(278f))
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
        val textPaint = if (live) livePriceTextPaint else strongLabelPaint
        val tagWidth = textPaint.measureText(text) + dp(8f)
        val tagLeft = min(x + dp(2f), width - dp(2f) - tagWidth)
        val rect = RectF(tagLeft, y - dp(10f), tagLeft + tagWidth, y + dp(10f))
        if (live) {
            val pointer = Path().apply {
                moveTo(x, y)
                lineTo(tagLeft, y - dp(5f))
                lineTo(tagLeft, y + dp(5f))
                close()
            }
            canvas.drawPath(pointer, livePriceTagPaint)
            canvas.drawRoundRect(rect, dp(5.5f), dp(5.5f), livePriceTagPaint)
            canvas.drawText(text, tagLeft + dp(4f), y + dp(3.5f), livePriceTextPaint)
        } else {
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = KyvoriqTheme.raised }
            canvas.drawRoundRect(rect, dp(5f), dp(5f), paint)
            canvas.drawText(text, tagLeft + dp(4f), y + dp(3.5f), strongLabelPaint)
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

    // Keep historical OB calculations untouched. The following is a *presentation*
    // projection of server-provided, finite zone boundaries: no synthetic prices,
    // inferred confirmations or client-side trading decisions.
    private data class VisibleZone(
        val row: JSONObject, val low: Double, val high: Double,
        val bounds: RectF, val color: Int, val label: String
    )
    // Transient geometry from this exact draw frame. Never persist market prices.
    private var frameZoneOverlays: List<VisibleZone> = emptyList()
    private var obBadgePage = 0
    private var obPageControl: RectF? = null
    private val displayedObBadgeBounds = mutableListOf<RectF>()

    private fun exactZonePrice(value: Double): String {
        if (!value.isFinite() || value <= 0.0) return "—"
        // Preserve source decimal precision. Do not use compact "83.5k" labels
        // on the OB boundaries: rounding to 0.1k misstates the actual zone.
        // BigDecimal.toPlainString uses Double's canonical representation
        // without converting it to rounded "k" notation. Group the integer
        // digits manually instead of limiting fractional digits: an unusual
        // venue price must never crash Canvas.draw() through a
        // RoundingMode.UNNECESSARY exception.
        val plain = java.math.BigDecimal.valueOf(value).stripTrailingZeros().toPlainString()
        val digits = plain.split('.', limit = 2)
        val grouped = digits[0].reversed().chunked(3).joinToString(",").reversed()
        val fraction = digits.getOrNull(1).orEmpty().padEnd(2, '0')
        return grouped + "." + fraction
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
        val now = System.currentTimeMillis()
        val candidates = (0 until overlays.length()).mapNotNull { i ->
            val row = overlays.optJSONObject(i) ?: return@mapNotNull null
            if (!isOverlayVisible(row)) return@mapNotNull null
            val zl = row.optDouble("zone_low", Double.NaN)
            val zh = row.optDouble("zone_high", Double.NaN)
            if (!zl.isFinite() || !zh.isFinite() || zl <= 0.0 || zh <= 0.0) return@mapNotNull null
            val hideAfter = row.optLong("hide_after_ms", 0L)
            if (hideAfter > 0L && now >= hideAfter) return@mapNotNull null
            val lo = min(zl, zh)
            val hi = max(zl, zh)
            if (hi < low || lo > high || hi <= lo) return@mapNotNull null
            val yTop = mapY(min(hi, high), low, high, top, bottom)
            val yBottom = mapY(max(lo, low), low, high, top, bottom)
            val kind = row.optString("kind", "OB_ZONE").uppercase(Locale.US)
            val direction = row.optString("direction", "BOTH").uppercase(Locale.US)
            val color = when {
                direction == "SHORT" || kind == "SUPPLY_ZONE" -> Color.rgb(209, 94, 109)
                direction == "LONG" || kind == "DEMAND_ZONE" -> Color.rgb(63, 160, 128)
                else -> KyvoriqTheme.deepGold
            }
            val label = row.optString("label", kind).uppercase(Locale.US).take(14)
            VisibleZone(row, lo, hi, RectF(left, min(yTop, yBottom), right, max(yTop, yBottom)), color, label)
        }.sortedWith(compareBy<VisibleZone> { it.bounds.top }.thenBy { it.low })

        frameZoneOverlays = candidates

        // Draw ALL valid visible zones, including coincident zones from
        // different timeframes. Very light shading avoids opaque, stacked
        // rectangles hiding candles or EMA. Only horizontal boundaries are
        // outlined; vertical frame stacking caused the old "boxed" look.
        candidates.forEach { zone ->
            zoneFillPaint.color = zone.color
            zoneFillPaint.alpha = if (zone.row.optBoolean("manual", false)) 12 else 9
            canvas.drawRect(zone.bounds, zoneFillPaint)
            zoneBorderPaint.color = zone.color
            zoneBorderPaint.alpha = 115
            canvas.drawLine(left, zone.bounds.top, right, zone.bounds.top, zoneBorderPaint)
            canvas.drawLine(left, zone.bounds.bottom, right, zone.bounds.bottom, zoneBorderPaint)
        }

    }

    // A separate pass AFTER candles, EMA and other price primitives prevents
    // white candle wicks from painting over exact OB numbers (the root of
    // the missing-price-label issue in earlier builds).
    // Group OB labels separately from user price-alert callouts. Price zones
    // NEVER move away from their true y position: only their captions move.
    // At most three unobstructed OBs are emphasized on one page; a compact
    // pager reveals the remaining genuine levels without dense overlaps.
    private fun drawZonePriceBadges(canvas: Canvas, left: Float, right: Float,
                                    top: Float, bottom: Float, low: Double, high: Double) {
        displayedObBadgeBounds.clear()
        obPageControl = null
        if (frameZoneOverlays.isEmpty()) return

        val current = timeframe.uppercase(Locale.US)
        val zones = frameZoneOverlays.sortedWith(
            compareByDescending<VisibleZone> {
                it.label.startsWith(current + " ") || (current == "1D" && it.label.startsWith("DAILY"))
            }.thenBy {
                if (livePrice.isFinite()) kotlin.math.abs((it.low + it.high) / 2.0 - livePrice) else it.bounds.top.toDouble()
            }.thenBy { it.label }
        )
        val visibleCount = 3
        val pages = (zones.size + visibleCount - 1) / visibleCount
        obBadgePage = obBadgePage.coerceIn(0, pages - 1)
        val selected = zones.drop(obBadgePage * visibleCount).take(visibleCount)
        // Alerts own the LEFT label rows at their genuine prices. OB capsules
        // take the inner-left lane and avoid every alert row, with 8dp air.
        val forbidden = customAlertLevels.filter { it.isFinite() && it in low..high }
            .map { y ->
                val cy = mapY(y, low, high, top, bottom)
                RectF(left, cy - dp(15f), right, cy + dp(15f))
            }.toMutableList()
        val minAir = dp(9f)
        val labelHeight = dp(28f)
        val leftX = left + dp(7f)
        val rightPad = dp(5f)
        val laneMaxWidth = right - leftX - rightPad
        val labelColor = zoneTextPaint.color
        val sorted = selected.sortedBy { it.bounds.centerY() }
        for (zone in sorted) {
            val title = zone.label
            val range = exactZonePrice(zone.low) + " – " + exactZonePrice(zone.high)
            val textMaxWidth = maxOf(zoneTextPaint.measureText(title), zoneTextPaint.measureText(range))
            // The real venue price must not be abbreviated or clipped.
            // On exceptionally small screens skip a caption, not its zone.
            val capsuleWidth = textMaxWidth + dp(15f)
            if (capsuleWidth > laneMaxWidth) continue
            val desired = zone.bounds.centerY().coerceIn(top + labelHeight/2f, bottom - labelHeight/2f)
            val locations = (0..24).flatMap { step ->
                if (step == 0) listOf(desired)
                else listOf(desired - step * dp(10f), desired + step * dp(10f))
            }
            val fit = locations.map { y -> RectF(leftX, y - labelHeight/2f, leftX + capsuleWidth, y + labelHeight/2f) }
                .firstOrNull { rect ->
                    rect.top >= top + dp(2f) && rect.bottom <= bottom - dp(2f) &&
                        forbidden.none { it.top < rect.bottom + minAir && it.bottom > rect.top - minAir }
                } ?: continue
            forbidden += fit
            displayedObBadgeBounds += fit
            zoneFillPaint.color = KyvoriqTheme.charcoal
            zoneFillPaint.alpha = 247
            canvas.drawRoundRect(fit, dp(5f), dp(5f), zoneFillPaint)
            zoneBorderPaint.color = zone.color
            zoneBorderPaint.alpha = 165
            // An accent bar communicates the true source zone direction.
            canvas.drawLine(fit.left + dp(2f), fit.top + dp(4f),
                fit.left + dp(2f), fit.bottom - dp(4f), zoneBorderPaint)
            zoneTextPaint.color = zone.color
            canvas.drawText(title, fit.left + dp(8f), fit.top + dp(11.5f), zoneTextPaint)
            zoneTextPaint.color = KyvoriqTheme.white
            canvas.drawText(range, fit.left + dp(8f), fit.top + dp(23f), zoneTextPaint)
            // The caption may be spaced away from a crowded zone. An
            // understated connector indicates the actual immutable location.
            if (kotlin.math.abs(zone.bounds.centerY() - fit.centerY()) > dp(9f)) {
                axisLevelGuidePaint.color = zone.color
                axisLevelGuidePaint.alpha = 95
                canvas.drawLine(fit.left + dp(1f), fit.centerY(),
                    fit.left + dp(1f), zone.bounds.centerY(), axisLevelGuidePaint)
            }
        }

        if (pages > 1) {
            val caption = "OB ${obBadgePage+1}/$pages  •  MORE"
            val pw = zoneTextPaint.measureText(caption) + dp(16f)
            val h = dp(20f)
            val x = right - pw - dp(7f)
            val y = top + dp(5f)
            val box = RectF(x, y, right - dp(7f), y + h)
            obPageControl = box
            zoneFillPaint.color = KyvoriqTheme.charcoal
            zoneFillPaint.alpha = 245
            canvas.drawRoundRect(box, dp(5f), dp(5f), zoneFillPaint)
            zoneTextPaint.color = KyvoriqTheme.gold
            canvas.drawText(caption, x + dp(8f), y + dp(13f), zoneTextPaint)
        }
        zoneTextPaint.color = labelColor
        zoneFillPaint.alpha = 255
        zoneBorderPaint.alpha = 255
        axisLevelGuidePaint.alpha = 155
    }

    internal fun visibleObBadgesForTest(): List<RectF> = displayedObBadgeBounds.map { RectF(it) }
    internal fun obPageControlForTest(): RectF? = obPageControl?.let { RectF(it) }

    private fun drawStructureOverlays(
        canvas: Canvas,
        left: Float,
        right: Float,
        top: Float,
        bottom: Float,
        low: Double,
        high: Double
    ) {
        if (overlays.length() == 0 && screenshotReferences.length() == 0) return
        val rows = displayLevelRows()
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
                "SFP", "WEEKLY", "WEEKLY_OPEN", "WEEKLY_NPOC" -> KyvoriqTheme.gold
                "DLINE" -> KyvoriqTheme.ember
                "OB", "OB_ZONE" -> KyvoriqTheme.white
                "NPOC", "RANGE_POC", "IPOC", "SUPPLY_ZONE" -> Color.rgb(255, 82, 105)
                "RANGE_VAH", "RANGE_VAL" -> Color.rgb(85, 139, 218)
                "SFP_GAP" -> KyvoriqTheme.white
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

            // A fresh observed touch publishes TAPPED for five minutes; display
            // a temporary chip here without cluttering the reserved price rail.
            if (status == "TAPPED" || row.optLong("tapped_at_ms", 0L) > 0L) {
                val tag = "TAPPED"
                val tagW = reactionChipTextPaint.measureText(tag) + dp(10f)
                val tagH = dp(16f)
                val tagX = left + dp(7f)
                val tagY = (lineY - tagH - dp(5f)).coerceIn(top + dp(2f), bottom - tagH - dp(2f))
                val oldBgColor = reactionChipPaint.color
                reactionChipPaint.color = KyvoriqTheme.charcoal
                reactionChipPaint.alpha = (225f * retirementFade).toInt().coerceIn(0, 225)
                reactionChipTextPaint.color = color
                reactionChipTextPaint.alpha = (255f * retirementFade).toInt().coerceIn(0, 255)
                canvas.drawRoundRect(RectF(tagX, tagY, tagX + tagW, tagY + tagH), dp(5f), dp(5f), reactionChipPaint)
                canvas.drawText(tag, tagX + dp(5f), tagY + dp(11f), reactionChipTextPaint)
                reactionChipPaint.color = oldBgColor
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


    private var frameVpReadout: List<String> = emptyList()
    internal fun visibleVpReadoutForTest(): List<String> = frameVpReadout.toList()

    /** One valid visible UTC 15m-estimated session is used throughout the chart.
     * This is read-only metadata; it is never consulted by the signal engine.
     */
    private fun selectedSessionVolumeProfile(start: Int, endExclusive: Int): JSONObject? {
        val first = candles.optJSONObject(start)?.optLong("start", 0L) ?: return null
        val last = candles.optJSONObject(endExclusive - 1)?.optLong("end", 0L) ?: return null
        if (first <= 0L || last <= first) return null
        return (0 until sessionProfiles.length())
            .mapNotNull { sessionProfiles.optJSONObject(it) }
            .filter { profile ->
                val begin = profile.optLong("start_ms", 0L)
                val end = profile.optLong("end_ms", 0L)
                val valPrice = profile.optDouble("val", Double.NaN)
                val pocPrice = profile.optDouble("poc", Double.NaN)
                val vahPrice = profile.optDouble("vah", Double.NaN)
                profile.optString("source") == "OHLCV_15M_ESTIMATE" &&
                    begin > 0L && end > begin && begin <= last && end > first &&
                    valPrice.isFinite() && valPrice > 0.0 &&
                    pocPrice.isFinite() && vahPrice.isFinite() &&
                    valPrice <= pocPrice && pocPrice <= vahPrice &&
                    profile.optJSONArray("bins")?.length()?.let { it >= 2 } == true
            }.maxWithOrNull(compareBy<JSONObject> { it.optLong("start_ms", 0L) }
                .thenBy { it.optLong("end_ms", 0L) })
    }

    /** Three values stay readable even when an axis badge is near the live tag.
     * Draw in reserved space immediately below the indicator controls.
     */
    private fun drawVolumeProfileReadout(
        canvas: Canvas, profile: JSONObject?, left: Float, right: Float, chartTop: Float
    ) {
        frameVpReadout = emptyList()
        if (profile == null || height < dp(190f)) return
        val segment = (right - left) / 3f
        if (segment <= dp(42f)) return
        val items = listOf(
            Triple("POC", "poc", Color.rgb(218, 113, 143)),
            Triple("VAH", "vah", Color.rgb(85, 139, 218)),
            Triple("VAL", "val", Color.rgb(85, 139, 218))
        )
        val drawn = mutableListOf<String>()
        items.forEachIndexed { index, (name, field, color) ->
            val value = profile.optDouble(field, Double.NaN)
            if (!value.isFinite()) return@forEachIndexed
            val longLabel = name + " " + String.format(Locale.US, "%,.2f", value)
            val shortLabel = name + " " + String.format(Locale.US, "%,.1f", value)
            val label = if (profileReadoutPaint.measureText(longLabel) <= segment - dp(9f))
                longLabel else shortLabel
            if (profileReadoutPaint.measureText(label) > segment - dp(9f)) return@forEachIndexed
            val leftX = left + segment * index
            val panel = RectF(leftX + dp(1f), chartTop - dp(18f),
                leftX + segment - dp(2f), chartTop - dp(2f))
            canvas.drawRoundRect(panel, dp(5f), dp(5f), profileReadoutBg)
            profileReadoutPaint.color = color
            canvas.drawText(label, panel.left + dp(4f), chartTop - dp(6f), profileReadoutPaint)
            drawn.add(label)
        }
        frameVpReadout = drawn
    }

    // Uses the chart's actual candle-time and price transforms, including pan,
    // zoom and portrait/fullscreen changes. The estimate does not drive trades.
    private fun drawSessionVolumeProfiles(
        canvas: Canvas, session: JSONObject, startIndex: Int, left: Float, right: Float,
        top: Float, bottom: Float, low: Double, high: Double, candleStep: Float
    ) {
        val firstTs = candles.optJSONObject(startIndex)?.optLong("start", 0L) ?: return
        if (firstTs <= 0L) return
        val durationMs = when (timeframe) {
            "5m" -> 300_000L
            "15m" -> 900_000L
            "1h" -> 3_600_000L
            "4h" -> 14_400_000L
            else -> return
        }
        fun timeX(ts: Long): Float =
            left + (((ts - firstTs).toDouble() / durationMs) * candleStep).toFloat()
        var drawnProfile = false
        canvas.save()
        canvas.clipRect(left, top, right, bottom)
        profile@ run {
            // Keep one active session visible; historical session profiles are
            // still available when the user pans back to those timestamps.
            val begin = session.optLong("start_ms", 0L)
            val finish = session.optLong("end_ms", 0L)
            if (begin <= 0L || finish <= begin) return@profile
            val visibleLeft = max(left + dp(2f), timeX(begin) + dp(2f))
            val visibleRight = min(right - dp(2f), timeX(finish) - dp(2f))
            if (visibleRight - visibleLeft < dp(16f)) return@profile
            val bins = session.optJSONArray("bins") ?: return@profile
            val histogramWidth = min(dp(34f), (visibleRight - visibleLeft) * .28f)
            val maxVolume = (0 until bins.length()).mapNotNull { bins.optJSONObject(it) }
                .maxOfOrNull { it.optDouble("volume", 0.0) } ?: 0.0
            if (maxVolume <= 0.0) return@profile
            val first = bins.optJSONObject(0)?.optDouble("price", Double.NaN) ?: Double.NaN
            val second = bins.optJSONObject(1)?.optDouble("price", Double.NaN) ?: Double.NaN
            val pixelHeight = if (first.isFinite() && second.isFinite()) {
                abs(mapY(first, low, high, top, bottom) - mapY(second, low, high, top, bottom))
                    .coerceAtLeast(dp(1f))
            } else dp(1f)
            drawnProfile = true
            for (i in 0 until bins.length()) {
                val bin = bins.optJSONObject(i) ?: continue
                val p = bin.optDouble("price", Double.NaN)
                val volume = bin.optDouble("volume", 0.0)
                if (!p.isFinite() || volume <= 0.0 || p !in low..high) continue
                val y = mapY(p, low, high, top, bottom)
                val w = (histogramWidth * (volume / maxVolume)).toFloat()
                val downFraction = (bin.optDouble("down", 0.0) / volume).coerceIn(0.0, 1.0).toFloat()
                val downWidth = w * downFraction
                val binTop = (y - pixelHeight * .47f).coerceAtLeast(top)
                val binBottom = (y + pixelHeight * .47f).coerceAtMost(bottom)
                if (binBottom <= binTop) continue
                canvas.drawRect(visibleLeft, binTop, visibleLeft + downWidth, binBottom, profileDownPaint)
                canvas.drawRect(visibleLeft + downWidth, binTop, visibleLeft + w, binBottom, profileUpPaint)
            }
            for ((field, color) in listOf(
                "poc" to Color.rgb(218, 113, 143),
                "vah" to Color.rgb(85, 139, 218),
                "val" to Color.rgb(85, 139, 218)
            )) {
                val price = session.optDouble(field, Double.NaN)
                if (!price.isFinite() || price !in low..high) continue
                profileLinePaint.color = color
                canvas.drawLine(visibleLeft, mapY(price, low, high, top, bottom),
                    visibleRight, mapY(price, low, high, top, bottom), profileLinePaint)
            }
        }
        if (drawnProfile) {
            val caption = "VP 15m • EST"
            canvas.drawText(caption, right - profileCaptionPaint.measureText(caption) - dp(6f),
                top + dp(10f), profileCaptionPaint)
        }
        canvas.restore()
    }

    private data class AxisLevelMark(
        val originalY: Float, val value: Double, val text: String, val color: Int,
        val priority: Int = 1
    )
    private var frameAxisLabelRects: List<RectF> = emptyList()
    private var frameAxisSourceCenters: List<Pair<Float, Float>> = emptyList()
    private var frameAxisTexts: List<String> = emptyList()
    internal fun visibleAxisTagTextsForTest(): List<String> = frameAxisTexts.toList()
    internal fun visibleAxisLabelRectsForTest(): List<RectF> = frameAxisLabelRects.map { RectF(it) }
    internal fun visibleAxisPriceAnchorsForTest(): List<Pair<Float, Float>> =
        frameAxisSourceCenters.toList()

    // Badge centers must remain at their TRUE transformed price coordinates.
    // Never search for distant vacant slots: displaced tags used to invert price order,
    // creating misleading vertical colored "wires" on the right hand price rail.
    // In a dense cluster, hide the lower-priority BADGE only; level lines remain intact.
    internal fun layoutAxisTagCenters(
        ideals: List<Float>, top: Float, bottom: Float, reserved: List<Float>
    ): List<Float?> {
        val safeTop = top + dp(10f)
        val safeBottom = bottom - dp(10f)
        if (safeTop >= safeBottom) return List(ideals.size) { null }
        val placed = mutableListOf<Float>()
        val protectedCenters = reserved.filter { it.isFinite() }
        val offsets = listOf(0f, -dp(3f), dp(3f), -dp(6f), dp(6f))
        return ideals.map { source ->
            if (!source.isFinite() || source !in safeTop..safeBottom) return@map null
            val selected = offsets.asSequence().map { source + it }.firstOrNull { y ->
                y in safeTop..safeBottom &&
                    placed.all { abs(it - y) >= dp(21f) } &&
                    protectedCenters.all { abs(it - y) >= dp(25f) }
            }
            if (selected != null) placed.add(selected)
            selected
        }
    }

    private fun drawAxisLevelLabels(
        canvas: Canvas,
        right: Float,
        top: Float,
        bottom: Float,
        low: Double,
        high: Double,
        start: Int,
        endExclusive: Int,
        selectedProfile: JSONObject?
    ): List<Float> {
        frameAxisLabelRects = emptyList()
        frameAxisSourceCenters = emptyList()
        frameAxisTexts = emptyList()
        if (!hasVisibleLevelLayers() && !(showSessionProfiles && accessTier.volumeProfile())) return emptyList()
        val wallNow = System.currentTimeMillis()
        val liveY = if (livePrice.isFinite() && livePrice in low..high) mapY(livePrice, low, high, top, bottom)
                    else Float.NaN
        val manualMarkers = displayLevelRows().mapNotNull { row ->
            if (!isOverlayVisible(row)) return@mapNotNull null
            val zLow = row.optDouble("zone_low", Double.NaN)
            val zHigh = row.optDouble("zone_high", Double.NaN)
            if (zLow.isFinite() && zHigh.isFinite() && zLow > 0 && zHigh > 0) return@mapNotNull null
            if (row.optLong("hide_after_ms", 0L).let { it > 0L && it <= wallNow }) return@mapNotNull null
            val value = row.optDouble("price", Double.NaN)
            if (!value.isFinite() || value !in low..high) return@mapNotNull null
            val kind = row.optString("kind", "LEVEL").uppercase(Locale.US)
            val type = when(kind) {
                "DAILY" -> "DAY"
                "NPOC" -> "nPOC"
                "WEEKLY" -> "W"
                "WEEKLY_NPOC" -> "WN"
                "WEEKLY_OPEN" -> "WO"
                "MONTHLY_POC" -> "M"
                "RANGE_LOW" -> "RL"
                "RANGE_POC" -> "RPOC"
                "RANGE_VAH" -> "RVAH"
                "RANGE_VAL" -> "RVAL"
                "IPOC" -> "iPOC"
                "SFP_GAP" -> "GAP"
                "SFP" -> "S"
                "OB", "OB_ZONE" -> "OB"
                else -> "L"
            }
            val color = when(kind) {
                "DAILY" -> Color.rgb(54, 211, 153)
                "NPOC", "RANGE_POC", "IPOC" -> Color.rgb(255, 82, 105)
                "RANGE_VAH", "RANGE_VAL" -> Color.rgb(85, 139, 218)
                "SFP_GAP" -> KyvoriqTheme.white
                "SFP", "WEEKLY", "WEEKLY_OPEN", "WEEKLY_NPOC" -> KyvoriqTheme.gold
                "OB", "OB_ZONE" -> KyvoriqTheme.white
                else -> KyvoriqTheme.muted
            }
            val priceLabel = if (row.optString("source") == DewaldSnapshotReferences.SOURCE)
                String.format(Locale.US, "%,.1f", value) else compactPrice(value)
            AxisLevelMark(mapY(value, low, high, top, bottom), value,
                type + " " + priceLabel, color,
                if (row.optString("source") == DewaldSnapshotReferences.SOURCE) 6 else when (kind) {
                    "IPOC", "RANGE_POC", "NPOC", "SFP" -> 4
                    "RANGE_VAH", "RANGE_VAL", "DAILY", "WEEKLY", "WEEKLY_NPOC" -> 3
                    else -> 2
                })
        }
        val profileMarkers = if (selectedProfile == null) emptyList() else {
            // Readout and rail share the same selected session. Suppressing an
            // axis badge near the live-price marker never hides its readout.
            listOf(
                Triple("poc", Color.rgb(218, 113, 143), "POC"),
                Triple("vah", Color.rgb(85, 139, 218), "VAH"),
                Triple("val", Color.rgb(85, 139, 218), "VAL")
            ).mapNotNull { (field, color, tag) ->
                val value = selectedProfile.optDouble(field, Double.NaN)
                if (value.isFinite() && value in low..high)
                    AxisLevelMark(mapY(value, low, high, top, bottom), value,
                        tag + " " + compactPrice(value), color, 7)
                else null
            }
        }
        // Preserve actual source prices; remove visually duplicate rounded captions.
        // Prioritize important manual levels before estimated session-profile labels.
        val markers = (manualMarkers + profileMarkers)
            .sortedWith(compareByDescending<AxisLevelMark> { it.priority }
                .thenBy { abs(it.originalY - if (liveY.isFinite()) liveY else (top + bottom) / 2f) })
            .distinctBy { it.text }

        val reserved = buildList {
            if (liveY.isFinite()) add(liveY)
            if (crosshairVisible) add(crosshairY.coerceIn(top, bottom))
        }
        val centers = layoutAxisTagCenters(markers.map { it.originalY }, top, bottom, reserved)
        val axisLeft = right + dp(1f)
        val axisRight = width - dp(2f)
        val rendered = mutableListOf<RectF>()
        val occupied = mutableListOf<Float>()
        val anchors = mutableListOf<Pair<Float, Float>>()
        val drawnTexts = mutableListOf<String>()
        markers.zip(centers).forEach { (mark, tagY) ->
            if (tagY == null) return@forEach
            val rect = RectF(axisLeft, tagY - dp(9f), axisRight, tagY + dp(9f))
            // Skip rather than truncate misleading price text on unusually narrow screens.
            if (axisLevelTextPaint.measureText(mark.text) > rect.width() - dp(4f)) return@forEach
            axisLevelBgPaint.color = KyvoriqTheme.slate
            canvas.drawRoundRect(rect, dp(3f), dp(3f), axisLevelBgPaint)
            axisLevelGuidePaint.color = mark.color
            // Short horizontal tick at the ORIGINAL price: never a long diagonal.
            canvas.drawLine(right, mark.originalY, axisLeft + dp(2f), mark.originalY, axisLevelGuidePaint)
            axisLevelTextPaint.color = mark.color
            canvas.drawText(mark.text, axisLeft + dp(2f), tagY + dp(2.8f), axisLevelTextPaint)
            rendered.add(rect)
            occupied.add(tagY)
            anchors.add(mark.originalY to tagY)
            drawnTexts.add(mark.text)
        }
        frameAxisLabelRects = rendered
        frameAxisSourceCenters = anchors
        frameAxisTexts = drawnTexts
        return occupied
    }

    private fun axisWidth(): Float {
        val sample = compactPrice(if (livePrice.isFinite()) livePrice else 99999.0)
        val base = max(dp(40f), max(livePriceTextPaint.measureText(sample) + dp(8f),
            axisLevelTextPaint.measureText("VAH $sample") + dp(5f)))
        // Keep the actual one-decimal values readable instead of replacing them
        // with rounded 81.7k labels. Width is bounded for small Android phones.
        val precise = if (DewaldSnapshotReferences.isActive())
            axisLevelTextPaint.measureText("VAL 89,409.5") + dp(8f) else 0f
        return max(base, min(width * .32f, precise))
    }

    private fun plotRight(): Float = width - axisWidth()

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
                parent?.requestDisallowInterceptTouchEvent(fullscreenMode || event.x < plotRight())
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
                if (!fullscreenMode && touchDownX >= plotRight()) {
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
                    val bar = max(1f, (plotRight() - dp(4f)) / visibleCount())
                    // Opposite-to-finger pan with bounded blank future region.
                    candleShift = (candleShift - dx / bar).coerceIn(
                        -maxFutureShift(),
                        max(0f, candles.length() - visibleCount().toFloat())
                    )
                    val visiblePriceRange = estimateVisibleRange()
                    verticalOffset += (-dy / max(1f, plotGeometry().price.height())) * visiblePriceRange
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
                    if (obPageControl?.contains(event.x, event.y) == true) {
                        obBadgePage += 1
                        KyvoriqHaptics.fire(this, KyvoriqHaptics.Cue.SELECT)
                        performClick()
                        invalidate()
                        return true
                    }
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

