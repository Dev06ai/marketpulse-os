// Build 119: deep gold / ember / charcoal design system and lifecycle-aware motion.
// Build 101: KYVORIQ visual identity — gold/charcoal system, branded navigation and mark.
// Build 99: free-host migration with compact mobile delivery.
// Build 117: Decision Engine Audit v3.5 companion release.
// Build 115: KYVORIQ Motion Studio — launch, decision, chart reaction/execution and Insights motion graphics.
// Build 114: premium KYVORIQ Privacy Shield bottom sheet.
// Build 113: reaction-aware chart level map + multi-timeframe OB presentation.
// Build 112: high-refresh VSYNC price motion for the in-app BTC hero.
// Price animation follows Android VSYNC; the display-mode request is capped at 120 Hz.
 // Build 110: KYVORIQ Premium Experience Pack — motion, ambience, risk/alert intelligence, privacy and widget.
// Build 109: KYVORIQ premium semantic haptics across navigation, chart tools and calculator.
// Build 108: confidence-sized demo execution UI with live-backend capability detection.
// Build 83: show Bitget Demo funding readiness and demo execution state.
package com.devtrader.app

import android.Manifest
import android.animation.ArgbEvaluator
import android.animation.ValueAnimator
import android.app.NotificationChannel
import android.appwidget.AppWidgetManager
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.text.InputType
import android.text.SpannableString
import android.text.style.ForegroundColorSpan
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.app.NotificationCompat
import androidx.core.content.FileProvider
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.FragmentActivity
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

// Build 87: backend executes every emitted trade call; Android client remains signal/event driven.
// Build 126: final Palette & Chart release trigger.
// Build 125: final palette/chart lifecycle validation trigger.
// Build 125: exact brand-palette UI + expanded chart canvas + consumed-level retirement.
 // Build 124: visual-accessibility compatibility fix.
// Build 124: final chart-control release trigger after versioned workflow.
// Build 124: quiet developing alerts + chart level filters + immersive fullscreen.
// Build 123: client-release health gate separation trigger.
// Build 123: final retry-hardened reaction-map release trigger.
// Build 123: final verified reaction-map label-lane release trigger.
// Build 123: separate execution chips from reaction-map label lane for clean chart readability.
// Build 122: Dewald reaction-map fallback verified; publish-permission release trigger.
// Build 121: final reaction-map verification trigger.
class SafeActivity : FragmentActivity() {
    private val kyGold = KyvoriqTheme.gold
    private val kyAmber = KyvoriqTheme.ember
    private val kyDeepGold = KyvoriqTheme.deepGold
    private val kyCharcoal = KyvoriqTheme.charcoal
    private val kySlate = KyvoriqTheme.surface
    private val kyGraphite = KyvoriqTheme.raised
    private val kyGray = KyvoriqTheme.muted
    private val kyWhite = KyvoriqTheme.white
    private val kyLine = KyvoriqTheme.border
    private val btcOrange = kyGold

    // KYVORIQ uses its gold accent for the instrument emphasis while ordinary
    // asset labels stay neutral so trading semantics remain easy to scan.
    private fun marketAssetAccent(value: CharSequence): CharSequence = value

    private fun haptic(view: View?, cue: KyvoriqHaptics.Cue = KyvoriqHaptics.Cue.TAP) {
        KyvoriqHaptics.fire(view, cue)
    }

    private fun priceBtcAccent(value: CharSequence): CharSequence {
        val text = value.toString()
        val styled = SpannableString(text)
        val index = text.indexOf("BTC", ignoreCase = true)
        if (index >= 0) {
            styled.setSpan(
                ForegroundColorSpan(btcOrange),
                index,
                text.length,
                SpannableString.SPAN_EXCLUSIVE_EXCLUSIVE
            )
        }
        return styled
    }

    private val handler = Handler(Looper.getMainLooper())
    private var socket: WebSocket? = null
    private var reconnectAttempt = 0
    private val reconnectScheduled = AtomicBoolean(false)
    private var stopped = false

    private lateinit var status: TextView
    private lateinit var price: PremiumPriceView
    private lateinit var oiView: TextView
    private lateinit var signal: TextView
    private lateinit var integrity: TextView
    private lateinit var features: TextView
    private lateinit var update: TextView
    private lateinit var check: TextView
    private lateinit var risk: TextView
    private lateinit var journal: TextView
    private lateinit var tradeHistory: TextView
    private lateinit var replay: TextView
    private var musicIsland: KyvoriqMusicIsland? = null
    private var pendingMusicSlot = 0
    private val pickMusicFile = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) musicIsland?.importFile(pendingMusicSlot, uri)
    }
    private val pickMusicBundle = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) musicIsland?.importPrivateBundle(uri)
    }
    private lateinit var workspaceHost: FrameLayout
    private val workspacePages = mutableListOf<View>()
    private val navigationButtons = mutableListOf<Button>()
    private lateinit var positionSummary: TextView
    private lateinit var ledgerView: TextView
    private lateinit var decisionView: TextView
    private var entryChecksFullText = "Awaiting verified entry checks."
    private lateinit var insightContext: TextView
    private lateinit var alertIntelligenceView: TextView
    private lateinit var riskHeatText: TextView
    private lateinit var riskHeatMeter: RiskHeatMeterView
    private lateinit var curve: PerformanceCurveView
    private lateinit var rootSurface: LinearLayout
    private lateinit var decisionContainer: LinearLayout
    private lateinit var decisionMotionView: DecisionMotionView
    private val insightsMotionViews = mutableListOf<View>()
    private var launchSequenceShown = false
    private var selectedWorkspace = 0
    private var fullTradeHistoryText = "No executed demo trades yet."
    private lateinit var chart: MarketChartView
    private var latestChartCandles = JSONArray()
    private var chartFullscreenHost: FrameLayout? = null
    private var chartHomeParent: ViewGroup? = null
    private var chartHomeIndex: Int = -1
    private var chartHomeLayoutParams: ViewGroup.LayoutParams? = null
    private var chartSystemUiFlags: Int = 0
    private lateinit var updateButton: Button
    private lateinit var checkButton: Button
    private lateinit var alertsButton: Button
    private lateinit var privacyButton: Button
    private lateinit var widgetButton: Button
    private var selectedTf = "1h"
    private var lastStateReceivedMs = 0L
    private var latestRoot: JSONObject? = null
    private var lastSignalId: String? = null
    private var lastExecutionEventKey: String? = null
    private var pendingUiUpdate = false
    private var lastUiRenderMs = 0L
    private var lastChartRequestMs = 0L
    private var chartRequestInFlight = false
    private var chartRequestToken = 0L
    private var lastOverlayRequestMs = 0L
    private var overlayFeatures: JSONObject? = null
    private var overlayStrategy: JSONObject? = null
    private var lastBootstrapMs = 0L
    private var lastBootstrapSuccessMs = 0L
    // Persistent HTTP routing/auth errors must not be hidden by the WS retry UI.
    private var lastHardHttpStatus: String? = null
    // Recover transient ingress-level 404 without exposing private data or
    // permanently trapping a paired owner in view-only mode.
    private var privateRouteFallback = false
    private var lastPrivateRouteProbeMs = 0L
    // Public BTC chart only on unpaired devices; no private account or signals.
    private var publicMarketOnly = false
    private var publicMarketMessage: TextView? = null
    private var bootstrapInFlight = false
    private val healthWatchdogRunnable = Runnable { safe { watchdog() } }
    private val snapshotPollRunnable = object : Runnable {
        override fun run() {
            if (stopped) return
            val now = System.currentTimeMillis()
            if (publicMarketOnly || !KyvoriqSecureSession.isPaired(this@SafeActivity)) {
                enterPublicMarketMode()
                requestChartIfNeeded()
                // Secure owner token remains mandatory; only request a private
                // snapshot once the paired device can authenticate again.
                if (privateRouteFallback &&
                    KyvoriqSecureSession.isPaired(this@SafeActivity) &&
                    now - lastPrivateRouteProbeMs >= 12_000L) {
                    lastPrivateRouteProbeMs = now
                    bootstrap(force = true)
                }
            } else if (socket == null || now - lastStateReceivedMs > 5000L) bootstrap(false)
            else requestChartIfNeeded()
            handler.postDelayed(this, 3000L)
        }
    }

    private var retryButton: Button? = null
    private var pairingButton: Button? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var lastSocketActivityMs = 0L
    private var lastRetryRequestMs = 0L
    private var lastSocketRebuildMs = 0L
    private var reconnectRunnable: Runnable? = null
    private var lastDecisionVisualKey = ""
    private var lastStatusVisualKey = ""
    private var lastAmbientKey = ""
    private var ambientColor = kyCharcoal
    private var ambientAnimator: ValueAnimator? = null
    private var privacyAuthenticated = true
    private var biometricPromptActive = false
    private var backgroundedAtMs = 0L

    private val keepaliveRunnable = object : Runnable {
        override fun run() {
            if (stopped) return
            val ws = socket
            if (ws != null) {
                val ok = runCatching {
                    ws.send(
                        JSONObject().apply {
                            put("type", "keepalive")
                            put("client_ts", System.currentTimeMillis())
                        }.toString()
                    )
                }.getOrDefault(false)
                if (!ok) {
                    handler.post {
                        if (!stopped) reconnect(immediate = true)
                    }
                }
            }
            handler.postDelayed(this, KEEPALIVE_INTERVAL_MS)
        }
    }

    companion object {
        private const val KEEPALIVE_INTERVAL_MS = 15_000L
    }

    private val backendBase = BackendEndpoint.base

    private val client by lazy {
        OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .writeTimeout(8, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .pingInterval(10, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    // REST requests must never inherit the WebSocket client's infinite read timeout.
    // A stalled HTTP request previously could hold bootstrapInFlight forever and
    // leave the UI parked on DATA RECOVERY after returning to the app.
    private val restClient by lazy {
        client.newBuilder()
            .readTimeout(8, TimeUnit.SECONDS)
            .callTimeout(12, TimeUnit.SECONDS)
            .build()
    }

    private var debugPreview = false
    private val calculatorBack = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() { returnToDashboard() }
    }
    private val chartFullscreenBack = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() { closeChartFullscreen() }
    }

    private fun returnToDashboard() {
        calculatorBack.isEnabled = false
        setContentView(rootSurface)
        latestRoot?.let { renderState(it, requestChart = false) }
        ViewCompat.requestApplyInsets(rootSurface)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = kyCharcoal
        window.navigationBarColor = kyCharcoal
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.navigationBarDividerColor = kyDeepGold
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isStatusBarContrastEnforced = false
            window.isNavigationBarContrastEnforced = false
        }
        onBackPressedDispatcher.addCallback(this, calculatorBack)
        onBackPressedDispatcher.addCallback(this, chartFullscreenBack)
        installCrashReporter()
        requestPremiumRefreshRate()
        // Resolve preview mode before building the UI so automated visual checks
        // never inherit a device's privacy-lock preference.
        debugPreview = BuildConfig.DEBUG && intent.getBooleanExtra("visual_preview", false)
        buildUi()
        if (debugPreview) {
            val preview = JSONObject(assets.open("ui_preview.json").bufferedReader().use { it.readText() })
            val now = System.currentTimeMillis()
            preview.put("received_ts", now).put("last_market_update_ts", now)
            latestRoot = preview
            renderState(preview, requestChart = false)
            val candles = preview.getJSONObject("chart").getJSONArray("candles")
            latestChartCandles = candles
            chart.setData(candles, preview.optJSONObject("signal"), calculateEma(candles, 50), preview.getDouble("last_price"), chartOverlays(preview))
            check.text = "Build ${BuildConfig.VERSION_CODE}  •  Visual verification"
            selectWorkspace(intent.getIntExtra("visual_workspace", 0).coerceIn(0, 2))
            if (intent.getBooleanExtra("visual_intro", false)) showLaunchSequence()
            return
        }
        val privacyLockEnabled = privacyPrefs().getBoolean("biometric_enabled", false)
        enforceInitialPrivacyGate()
        if (!privacyLockEnabled) { showLaunchSequence(); consumeWidgetDestination() }
        registerNetworkCallback()
        ensureChannel()
        if (KyvoriqSecureSession.isPaired(this)) {
            startBackgroundAlerts()
            loadJournal()
            loadTradeHistory()
        } else {
            enterPublicMarketMode()
        }

        handler.postDelayed({
            safe {
                bootstrap(true)
                if (KyvoriqSecureSession.isPaired(this)) loadTradeHistory()
            }
        }, 150L)
        handler.postDelayed({
            safe { connect() }
        }, 500L)
        handler.postDelayed({
            safe { watchdog() }
        }, 3000L)
        handler.postDelayed(keepaliveRunnable, KEEPALIVE_INTERVAL_MS)
    }

    private fun consumeWidgetDestination() {
        val destination = intent.getStringExtra("widget_destination") ?: return
        if (!privacyAuthenticated) return
        intent.removeExtra("widget_destination")
        when (destination) {
            "alerts" -> handler.post { if (!isFinishing && privacyAuthenticated) showBtcPriceAlerts() }
            "positions" -> selectWorkspace(1)
            "insights" -> selectWorkspace(2)
            else -> selectWorkspace(0)
        }
    }

    private fun showLaunchSequence() {
        if (!KyvoriqTheme.motionEnabled(this) || (debugPreview && !intent.getBooleanExtra("visual_intro", false)) || launchSequenceShown || isFinishing || isDestroyed) return
        launchSequenceShown = true
        val host = findViewById<ViewGroup>(android.R.id.content) ?: return
        val overlay = KyvoriqLaunchOverlay(this)
        host.addView(
            overlay,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        overlay.bringToFront()
        overlay.play {
            if (overlay.parent === host) host.removeView(overlay)
        }
    }

    private fun toggleChartFullscreen() {
        if (chartFullscreenHost == null) showChartFullscreen() else closeChartFullscreen()
    }

    private fun showBtcPriceAlerts() {
        // True native KYVORIQ card: no Android-default gray title/footer bars.
        // Presentation-only redesign; alert storage, gating and delivery unchanged.
        fun roundedCard(fill: Int, border: Int, radius: Int = 17) =
            GradientDrawable().apply {
                setColor(fill)
                cornerRadius = dp(radius).toFloat()
                setStroke(dp(1).coerceAtLeast(1), border)
            }

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(22), dp(20), dp(18))
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Color.rgb(22, 23, 26), Color.rgb(9, 10, 12))).apply {
                cornerRadius = dp(24).toFloat()
                setStroke(dp(1).coerceAtLeast(1), Color.rgb(86, 69, 45))
            }
        }

        val eyebrow = label("KYVORIQ    /    BTC  •  USDT", 10f, kyDeepGold, 0.10f)
        panel.addView(eyebrow, margins(bottom = 7))
        val heading = label("PRICE ALERTS", 23f, kyWhite, 0.025f).apply {
            typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
            contentDescription = "BTC PRICE ALERTS"
        }
        panel.addView(heading, margins(bottom = 5))
        panel.addView(label(
            "Your level. Your timing. No unnecessary noise.",
            12f, kyGray, 0f
        ), margins(bottom = 17))

        val live = latestRoot
        val quote = live?.optDouble("last_price", Double.NaN) ?: Double.NaN
        val age = System.currentTimeMillis() - (live?.optLong("last_market_update_ts", 0L) ?: 0L)
        val fresh = live != null && quote.isFinite() && quote > 0.0 &&
            live.optString("data_health") == "HEALTHY" &&
            live.optBoolean("ws_connected") &&
            live.optJSONObject("upstream")?.optString("source") == "BITGET_WS" &&
            age in -2_000L..8_000L
        val liveCard = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(13), dp(11), dp(13), dp(11))
            background = roundedCard(Color.rgb(29, 30, 33), Color.rgb(53, 52, 50), 15)
        }
        val liveLabels = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        liveLabels.addView(label("CURRENT BTC PRICE", 9f, kyGray, 0.065f))
        liveLabels.addView(label(
            if (fresh) String.format(Locale.US, "%,.2f  USDT", quote) else "WAITING FOR LIVE DATA",
            if (fresh) 18f else 12f, kyWhite, 0f
        ).apply { typeface = Typeface.create("sans-serif-medium", Typeface.BOLD) })
        liveCard.addView(liveLabels, LinearLayout.LayoutParams(0, -2, 1f))
        liveCard.addView(label(if (fresh) "● LIVE" else "● OFFLINE", 10f,
            if (fresh) Color.rgb(68, 215, 179) else kyGray, 0.025f))
        panel.addView(liveCard, margins(bottom = 18))

        panel.addView(label("TARGET PRICE  /  USDT", 10.5f, kyGold, 0.055f),
            margins(bottom = 8))
        val editor = numberField("e.g. 85,000.00", "").apply {
            contentDescription = "Enter custom BTC price alert target in USDT"
            textSize = 20f
            minHeight = dp(54)
            setSelectAllOnFocus(true)
            background = roundedCard(Color.rgb(12, 13, 16), Color.rgb(100, 82, 53), 15)
        }
        panel.addView(editor, LinearLayout.LayoutParams(-1, dp(56)))

        panel.addView(label(
            "We'll ping you once when the live Bitget price crosses this level. " +
                "This alert never places a trade.",
            11f, kyGray, 0f
        ), margins(top = 11, bottom = 17))

        val records = BtcPriceAlerts.all(this)
        val active = (0 until records.length()).mapNotNull { records.optJSONObject(it) }
            .filter { it.optString("status") == "ARMED" }.asReversed()
        val activeRow = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        activeRow.addView(label("ARMED LEVELS", 11f, kyWhite, 0.08f),
            LinearLayout.LayoutParams(0, -2, 1f))
        activeRow.addView(label("${active.size} / 20", 11f, kyGold, 0f))
        panel.addView(activeRow, margins(bottom = 10))

        val removeActions = mutableListOf<Pair<Button, String>>()
        if (active.isEmpty()) {
            val empty = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(dp(10), dp(19), dp(10), dp(19))
                background = roundedCard(Color.rgb(17, 18, 21), Color.rgb(45, 45, 48))
            }
            empty.addView(label("◇   NOTHING ARMED YET", 11.5f, kyWhite, 0.045f).apply {
                gravity = Gravity.CENTER
            })
            empty.addView(label("Add a price above or below BTC.", 10.5f, kyGray, 0f).apply {
                gravity = Gravity.CENTER
            }, margins(top = 7))
            panel.addView(empty, margins(bottom = 15))
        } else {
            active.forEach { alert ->
                val id = alert.optString("id")
                val target = alert.optDouble("level", Double.NaN)
                val direction = if (alert.optString("direction") == "ABOVE") "↑ ABOVE" else "↓ BELOW"
                val row = LinearLayout(this).apply {
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(12), dp(7), dp(8), dp(7))
                    background = roundedCard(Color.rgb(20, 21, 23), Color.rgb(51, 48, 43), 14)
                }
                val text = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
                text.addView(label(direction, 10f, kyDeepGold, 0.06f))
                text.addView(label(
                    String.format(Locale.US, "%,.2f  USDT", target),
                    15f, kyWhite, 0.01f
                ).apply { typeface = Typeface.create("sans-serif-medium", Typeface.BOLD) })
                row.addView(text, LinearLayout.LayoutParams(0, -2, 1f))
                val remove = compactPillButton("✕").apply {
                    contentDescription = "Remove BTC price alert at " +
                        String.format(Locale.US, "%.2f", target)
                }
                row.addView(remove, LinearLayout.LayoutParams(dp(45), dp(40)))
                removeActions.add(remove to id)
                panel.addView(row, margins(bottom = 8))
            }
        }

        val triggered = (0 until records.length()).mapNotNull { records.optJSONObject(it) }
            .filter { it.optString("status") == "TRIGGERED" }.takeLast(3).asReversed()
        if (triggered.isNotEmpty()) {
            panel.addView(label("RECENTLY REACHED", 10f, kyGray, 0.07f),
                margins(top = 8, bottom = 7))
            triggered.forEach { alert ->
                panel.addView(label(
                    "✓  BTC " + String.format(Locale.US, "%,.2f", alert.optDouble("level")) +
                        " USDT", 11f, kyWhite, 0f
                ), margins(bottom = 6))
            }
        }

        val controls = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        val close = compactPillButton("CLOSE").apply {
            contentDescription = "Close BTC price alerts"
        }
        controls.addView(close, LinearLayout.LayoutParams(0, dp(49), 0.37f).apply {
            rightMargin = dp(9)
        })
        val arm = Button(this).apply {
            text = "SET ALERT  →"
            isAllCaps = false
            textSize = 13f
            typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
            setTextColor(Color.rgb(11, 10, 9))
            contentDescription = "Set custom BTC price alert"
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(kyGold, kyDeepGold)).apply { cornerRadius = dp(14).toFloat() }
            minHeight = dp(49)
            stateListAnimator = null
        }
        controls.addView(arm, LinearLayout.LayoutParams(0, dp(49), 0.63f))
        panel.addView(controls, margins(top = 7))
        panel.addView(label(
            "ON-DEVICE MONITORING  •  KEEP ALERTS ENABLED",
            9f, kyGray, 0.025f
        ).apply { gravity = Gravity.CENTER }, margins(top = 14))

        val scroll = ScrollView(this).apply {
            isFillViewport = false
            clipToOutline = true
            background = roundedCard(Color.rgb(13, 14, 16), Color.rgb(86, 69, 45), 24)
            addView(panel, ViewGroup.LayoutParams(-1, -2))
        }
        val dialog = android.app.AlertDialog.Builder(this).setView(scroll).create()
        close.setOnClickListener { haptic(it); dialog.dismiss() }
        arm.setOnClickListener {
            val requested = editor.text.toString().trim().replace(",", "").toDoubleOrNull()
            if (requested == null) {
                editor.error = "Enter a valid BTC price"
                return@setOnClickListener
            }
            // Preserve strict real-time/Bitget-only admission; no cached quote
            // can determine the above/below direction when arming.
            val snapshot = latestRoot
            val now = System.currentTimeMillis()
            val quoteTs = snapshot?.optLong("last_market_update_ts", 0L) ?: 0L
            val livePrice = snapshot?.optDouble("last_price", Double.NaN) ?: Double.NaN
            val healthy = snapshot != null && snapshot.optString("data_health") == "HEALTHY" &&
                snapshot.optBoolean("ws_connected") &&
                snapshot.optJSONObject("upstream")?.optString("source") == "BITGET_WS" &&
                livePrice.isFinite() && livePrice > 0.0 &&
                quoteTs > 0 && now - quoteTs in -2_000L..8_000L
            if (!healthy) {
                Toast.makeText(this, "Wait for a fresh Bitget BTC price before arming.", Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            runCatching { BtcPriceAlerts.add(this, requested, livePrice) }
                .onSuccess {
                    chart.setCustomPriceAlerts(BtcPriceAlerts.armedLevels(this))
                    haptic(chart, KyvoriqHaptics.Cue.CONFIRM)
                    dialog.dismiss()
                    Toast.makeText(this, "BTC price alert armed ✦", Toast.LENGTH_SHORT).show()
                    if (Build.VERSION.SDK_INT >= 33 &&
                        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                    ) startBackgroundAlerts()
                }.onFailure { error ->
                    editor.error = error.message ?: "Unable to save price alert"
                    Toast.makeText(this, error.message ?: "Unable to save alert.", Toast.LENGTH_LONG).show()
                }
        }
        removeActions.forEach { (button, id) ->
            button.setOnClickListener {
                if (BtcPriceAlerts.remove(this, id)) {
                    chart.setCustomPriceAlerts(BtcPriceAlerts.armedLevels(this))
                    dialog.dismiss()
                    showBtcPriceAlerts()
                } else {
                    Toast.makeText(this, "Unable to remove this alert.", Toast.LENGTH_SHORT).show()
                }
            }
        }
        dialog.show()
        dialog.window?.apply {
            setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
            addFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            attributes = attributes.apply { dimAmount = 0.70f }
            setLayout((resources.displayMetrics.widthPixels * 0.91).toInt(),
                android.view.WindowManager.LayoutParams.WRAP_CONTENT)
            setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
    }

    private fun showTradingViewPreview() {
        if (latestChartCandles.length() == 0) {
            Toast.makeText(this, "Waiting for confirmed market candles. Refresh chart first.", Toast.LENGTH_SHORT).show()
            requestChartIfNeeded(force = true)
            return
        }
        // Optional, network-dependent WebView with PUBLIC candles/levels only.
        // Never send Bitget credentials or position/account state to this view.
        val dialog = android.app.Dialog(this)
        val surface = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(kyCharcoal)
        }
        val close = compactPillButton("CLOSE PREVIEW  ×").apply {
            contentDescription = "Close optional TradingView preview and return to KYVORIQ chart"
            setOnClickListener { dialog.dismiss() }
        }
        surface.addView(close, LinearLayout.LayoutParams(-1, dp(43)))
        surface.addView(
            TradingViewPreview(this, latestChartCandles, chartOverlays(latestRoot)),
            LinearLayout.LayoutParams(-1, 0, 1f)
        )
        dialog.setContentView(surface)
        dialog.show()
        dialog.window?.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
    }

    private fun showChartFullscreen() {
        if (!::chart.isInitialized || chartFullscreenHost != null) return
        val parent = chart.parent as? ViewGroup ?: return
        val content = findViewById<ViewGroup>(android.R.id.content) ?: return

        chartHomeParent = parent
        chartHomeIndex = parent.indexOfChild(chart)
        chartHomeLayoutParams = chart.layoutParams
        parent.removeView(chart)

        val host = FrameLayout(this).apply {
            setBackgroundColor(kyCharcoal)
            clipChildren = false
            clipToPadding = false
            contentDescription = "Fullscreen KYVORIQ chart"
        }
        chartFullscreenHost = host
        content.addView(host, FrameLayout.LayoutParams(-1, -1))
        host.addView(chart, FrameLayout.LayoutParams(-1, -1))
        chart.setFullscreenMode(true)
        chartFullscreenBack.isEnabled = true

        chartSystemUiFlags = window.decorView.systemUiVisibility
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        haptic(chart, KyvoriqHaptics.Cue.CONFIRM)
        chart.requestLayout()
        chart.invalidate()
    }

    private fun closeChartFullscreen() {
        val host = chartFullscreenHost ?: return
        val parent = chartHomeParent
        val content = host.parent as? ViewGroup

        host.removeView(chart)
        content?.removeView(host)

        if (parent != null) {
            val index = chartHomeIndex.coerceIn(0, parent.childCount)
            val lp = chartHomeLayoutParams ?: LinearLayout.LayoutParams(-1, 0, 1f)
            parent.addView(chart, index, lp)
        }

        chart.setFullscreenMode(false)
        chartFullscreenHost = null
        chartHomeParent = null
        chartHomeIndex = -1
        chartHomeLayoutParams = null
        chartFullscreenBack.isEnabled = false

        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = chartSystemUiFlags
        ViewCompat.requestApplyInsets(rootSurface)
        chart.requestLayout()
        chart.invalidate()
        haptic(chart, KyvoriqHaptics.Cue.ACTION)
    }

    private fun requestPremiumRefreshRate() {
        runCatching {
            val display = windowManager.defaultDisplay
            val current = display.mode
            val sameResolution = display.supportedModes.filter {
                it.physicalWidth == current.physicalWidth &&
                    it.physicalHeight == current.physicalHeight
            }
            val preferred = sameResolution
                .filter { it.refreshRate <= 120.5f }
                .maxByOrNull { it.refreshRate }
                ?: sameResolution.maxByOrNull { it.refreshRate }
                ?: current
            val attrs = window.attributes
            attrs.preferredDisplayModeId = preferred.modeId
            attrs.preferredRefreshRate = preferred.refreshRate
            window.attributes = attrs
        }
    }

    private fun installCrashReporter() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching {
                val trace = java.io.StringWriter()
                throwable.printStackTrace(java.io.PrintWriter(trace))
                getSharedPreferences("dev_trader_diagnostics", Context.MODE_PRIVATE)
                    .edit()
                    .putString("last_crash", trace.toString())
                    .apply()
            }
            previous?.uncaughtException(thread, throwable)
        }
    }

    private fun setTradeSetupText(rawText: String) {
        val text = rawText.trimEnd()
        val styled = SpannableString(text)
        fun colorAll(term: String, color: Int) {
            var start = text.indexOf(term)
            while (start >= 0) {
                styled.setSpan(ForegroundColorSpan(color), start, start + term.length, 0)
                start = text.indexOf(term, start + term.length)
            }
        }
        colorAll("LONG", Color.rgb(54, 211, 153))
        colorAll("SHORT", Color.rgb(255, 82, 105))
        colorAll("NO TRADE", kyGold)
        signal.text = styled
    }

    private fun buildUi() {
        workspacePages.clear()
        navigationButtons.clear()
        val compactViewport = resources.configuration.screenHeightDp < 760
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = gradient(
                intArrayOf(kyCharcoal, KyvoriqTheme.slate, kyCharcoal),
                GradientDrawable.Orientation.TOP_BOTTOM
            )
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        rootSurface = root
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(dp(12), bars.top + dp(8), dp(12), bars.bottom + dp(8))
            insets
        }
        setContentView(root)
        val config = resources.configuration
        val availableDp = minOf(config.screenWidthDp,
            (resources.displayMetrics.widthPixels / resources.displayMetrics.density).toInt())
        val layout = KyvoriqResponsiveLayout.forViewport(availableDp, config.screenHeightDp, config.fontScale)
        val narrowHeader = layout.stackedActions
        val header = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val identityRow = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        val actions = LinearLayout(this).apply { gravity = Gravity.START or Gravity.CENTER_VERTICAL }
        // Original emblem and custom outlines retain their aspect ratio at every width.
        val brandMark = KyvoriqEmblemMotionView(this)
        identityRow.addView(brandMark, LinearLayout.LayoutParams(dp(layout.emblemDp), dp(layout.emblemDp)).apply { rightMargin = dp(8) })
        val brand = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
        }
        brand.addView(KyvoriqRazorWordmarkView(this),
            LinearLayout.LayoutParams(dp(layout.wordmarkWidthDp), dp(layout.wordmarkHeightDp)))
        brand.addView(ImageView(this).apply {
            setImageResource(R.drawable.kyvoriq_trade_the_plot)
            scaleType = ImageView.ScaleType.FIT_CENTER
            contentDescription = "Trade the Plot"
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LinearLayout.LayoutParams(dp(layout.taglineWidthDp), dp(14)).apply {
            leftMargin = dp((layout.wordmarkWidthDp - layout.taglineWidthDp - 8).coerceAtLeast(0))
        })
        identityRow.addView(brand, LinearLayout.LayoutParams(0, dp(54), 1f))
        // In-app Dynamic Island: a real layout row below the status bar, never
        // SYSTEM_ALERT_WINDOW and never an overlay over price/chart gestures.
        musicIsland = KyvoriqMusicIsland(this, importAudio = { slot ->
            pendingMusicSlot = slot
            pickMusicFile.launch(arrayOf("audio/*"))
        }, importZip = {
            pickMusicBundle.launch(arrayOf("application/zip", "application/octet-stream"))
        })
        val musicToggle = TextView(this).apply {
            text = "♫"
            textSize = 23f
            gravity = Gravity.CENTER
            setTextColor(kyGold)
            contentDescription = "Open KYVORIQ music island"
            background = GradientDrawable().apply {
                setColor(kySlate)
                cornerRadius = dp(16).toFloat()
                setStroke(dp(1), kyLine)
            }
            setOnClickListener {
                haptic(it, KyvoriqHaptics.Cue.ACTION)
                musicIsland?.toggleIsland()
            }
        }
        identityRow.addView(musicToggle, LinearLayout.LayoutParams(dp(40), dp(40)).apply {
            rightMargin = dp(if (narrowHeader) 0 else 8)
        })
        alertsButton = compactPillButton(compactHeaderLabel("ALERTS")).apply {
            contentDescription = "Enable trade alerts"
            textSize = if (layout.compactActions) 11f else 12f
            isSingleLine = true
            setAutoSizeTextTypeUniformWithConfiguration(10, 13, 1, android.util.TypedValue.COMPLEX_UNIT_SP)
        }
        alertsButton.setOnClickListener {
            haptic(it, KyvoriqHaptics.Cue.ACTION)
            safe { requestAlertPermission() }
        }
        actions.addView(alertsButton,
            LinearLayout.LayoutParams(if (narrowHeader) 0 else dp(layout.alertsDp), dp(40), if (narrowHeader) 1f else 0f).apply {
                rightMargin = dp(5)
            })
        retryButton = compactPillButton(compactHeaderLabel("RETRY", retry = true)).apply {
            contentDescription = "Reconnect market data"
            isSingleLine = true
            setAutoSizeTextTypeUniformWithConfiguration(10, 13, 1, android.util.TypedValue.COMPLEX_UNIT_SP)
        }
        retryButton?.setOnClickListener {
            haptic(it, KyvoriqHaptics.Cue.ACTION)
            safe { forceReconnectFromUser() }
        }
        actions.addView(retryButton,
            LinearLayout.LayoutParams(if (narrowHeader) 0 else dp(layout.retryDp), dp(40), if (narrowHeader) 1f else 0f).apply {
                leftMargin = dp(5)
            })
        if (!narrowHeader) identityRow.addView(actions, LinearLayout.LayoutParams(-2, -2))
        header.addView(identityRow, LinearLayout.LayoutParams(-1, -2))
        musicIsland?.island?.let { panel ->
            header.addView(panel, LinearLayout.LayoutParams(-1, dp(76)).apply { topMargin = dp(7) })
        }
        if (narrowHeader) header.addView(actions, LinearLayout.LayoutParams(-1, dp(40)).apply { topMargin = dp(8) })
        root.addView(header, margins(bottom = 10))

        workspaceHost = FrameLayout(this)
        root.addView(workspaceHost, LinearLayout.LayoutParams(-1, 0, 1f))
        fun page(scrollable: Boolean = false): LinearLayout {
            val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            val viewport: View = if (scrollable) {
                ScrollView(this).apply {
                    isFillViewport = false
                    clipToPadding = false
                    overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
                    addView(content, FrameLayout.LayoutParams(-1, -2))
                }
            } else content
            workspacePages.add(viewport)
            workspaceHost.addView(viewport, FrameLayout.LayoutParams(-1, -1))
            return content
        }
        // The full-width chart gets dedicated height; controls remain below it.
        val tradePage = page(scrollable = true)
        val hero = heroCard()
        price = hero.price; oiView = hero.oi; status = hero.status
        tradePage.addView(hero.container, margins(bottom = 10))
        publicMarketMessage = label(
            "PUBLIC BTC CHART • VIEW ONLY\nPrivate signals and account tools require owner-approved pairing.",
            11f, kyGold, 0f
        ).apply {
            setPadding(dp(12), dp(11), dp(12), dp(11))
            background = KyvoriqTheme.surface(this@SafeActivity, radius = 12f)
            visibility = View.GONE
            contentDescription = "Public read-only chart. Owner pairing required for private tools."
            setOnClickListener { showPublicAccessInfo() }
        }
        tradePage.addView(publicMarketMessage!!, margins(bottom = 8))
        val tfRow = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        listOf("5m", "15m", "1h", "4h").forEach { tf ->
            val button = compactPillButton(tf).apply { contentDescription = "Chart $tf" }
            button.setOnClickListener {
                if (selectedTf != tf) haptic(it, KyvoriqHaptics.Cue.SELECT)
                selectedTf = tf
                chart.setTimeframe(tf)
                refreshTimeframeButtons(tfRow)
                requestChartIfNeeded(force = true)
            }
            tfRow.addView(button, LinearLayout.LayoutParams(0, dp(40), 1f).apply { leftMargin = dp(2); rightMargin = dp(2) })
        }
        timeframeButtonRow = tfRow
        tradePage.addView(tfRow, margins(bottom = 8))
        chart = MarketChartView(this).apply {
            minimumHeight = dp(layout.chartHeightDp)
            contentDescription = "Interactive price chart"
            onFullscreenRequested = { toggleChartFullscreen() }
        }
        tradePage.addView(
            chart,
            LinearLayout.LayoutParams(-1, dp(layout.chartHeightDp)).apply {
                leftMargin = 0
                rightMargin = 0
                bottomMargin = dp(12)
            }
        )
        chart.setCustomPriceAlerts(BtcPriceAlerts.armedLevels(this))
        val priceAlertsButton = compactPillButton("＋  BTC PRICE ALERTS").apply {
            contentDescription = "Create or remove custom BTC price alerts"
            setOnClickListener {
                haptic(it, KyvoriqHaptics.Cue.ACTION)
                showBtcPriceAlerts()
            }
        }
        tradePage.addView(priceAlertsButton, LinearLayout.LayoutParams(-1, dp(42)).apply {
            bottomMargin = dp(7)
        })
        // Native chart remains default; v5 lightweight renderer is a
        // manually opened beta preview with no order-placement capability.
        val tvPreviewButton = compactPillButton("TRADINGVIEW CHART  ↗").apply {
            contentDescription = "Open optional TradingView Lightweight Charts preview"
            setOnClickListener { showTradingViewPreview() }
        }
        tradePage.addView(tvPreviewButton, LinearLayout.LayoutParams(-1, dp(37)).apply {
            bottomMargin = dp(8)
        })
        val setup = premiumCard("DECISION CENTER", "NO TRADE  •  SCANNING\nWaiting for verified market data.", if (compactViewport) 11.5f else 13f)
        decisionContainer = setup.first
        signal = setup.second
        signal.maxLines = if (compactViewport) 4 else 5
        signal.setLineSpacing(0f, 1.12f)
        signal.ellipsize = android.text.TextUtils.TruncateAt.END
        setup.first.setOnClickListener {
            haptic(it, KyvoriqHaptics.Cue.TAP)
            showTradeDetails()
        }
        setup.first.contentDescription = "Open complete trade setup"
        val decisionHost = FrameLayout(this).apply {
            clipChildren = false
            clipToPadding = false
        }
        decisionHost.addView(setup.first, FrameLayout.LayoutParams(-1, -1))
        decisionMotionView = DecisionMotionView(this)
        decisionHost.addView(decisionMotionView, FrameLayout.LayoutParams(-1, -1))
        tradePage.addView(decisionHost, LinearLayout.LayoutParams(-1, dp(if (compactViewport) 96 else 118)).apply { bottomMargin = dp(6) })
        val tradeTools = LinearLayout(this)
        val details = compactPillButton("SETUP DETAILS")
        details.setOnClickListener {
            haptic(it, KyvoriqHaptics.Cue.TAP)
            showTradeDetails()
        }
        tradeTools.addView(details, LinearLayout.LayoutParams(0, dp(42), 1f).apply { rightMargin = dp(6) })
        val pnl = compactPillButton("P&L CALCULATOR")
        pnl.setOnClickListener {
            haptic(it, KyvoriqHaptics.Cue.ACTION)
            safe { showPnlCalculator() }
        }
        tradeTools.addView(pnl, LinearLayout.LayoutParams(0, dp(42), 1f))
        tradePage.addView(tradeTools)
        refreshTimeframeButtons(tfRow)

        val positionsPage = page(scrollable = true)
        positionsPage.addView(label("POSITIONS", 20f, kyWhite, 0.01f), margins(top = 6, bottom = 5))
        positionsPage.addView(label("Demo account  /  position monitoring", 10f, kyGray, 0.015f), margins(bottom = 12))
        val overview = premiumCard("DEMO PERFORMANCE", "Waiting for exchange accounting…", 18f)
        positionSummary = overview.second
        positionsPage.addView(overview.first, margins(bottom = 10))
        curve = PerformanceCurveView(this)
        positionsPage.addView(curve, LinearLayout.LayoutParams(-1, dp(if (compactViewport) 90 else 130)).apply { bottomMargin = dp(10) })
        val ledgerCard = compactCard("ACCOUNTING & RISK", "Checking fills and exposure…", 12f)
        ledgerView = ledgerCard.value
        positionsPage.addView(ledgerCard.container, margins(bottom = 10))
        val exposureCard = scrollableCard("EXCHANGE POSITIONS", "No verified position data yet.", 13f, dp(182), expandToFill = false)
        tradeHistory = exposureCard.value
        positionsPage.addView(exposureCard.container, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })
        val historyButton = compactPillButton("OPEN EXECUTION HISTORY")
        historyButton.setOnClickListener {
            haptic(it, KyvoriqHaptics.Cue.ACTION)
            safe { loadTradeHistory(); showInfoDialog("Execution history", fullTradeHistoryText) }
        }
        positionsPage.addView(historyButton, LinearLayout.LayoutParams(-1, dp(44)))

        val insightsPage = page()
        val insightsScroll = ScrollView(this).apply {
            isFillViewport = true
            overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
        }
        val insightsContent = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 0, 0, dp(4))
        }
        insightsScroll.addView(insightsContent, FrameLayout.LayoutParams(-1, -2))
        insightsPage.addView(insightsScroll, LinearLayout.LayoutParams(-1, 0, 1f))
        insightsContent.addView(label("INSIGHTS", 19f, kyWhite, 0.01f), margins(top = 6, bottom = 6))
        insightsContent.addView(label("Verified market intelligence", 11f, kyGray, 0.01f), margins(bottom = 14))

        // Filter only existing, truthful live telemetry. No invented holder, heatmap or flow data.
        var selectedInsightTab = 0
        val insightTabs = mutableListOf<Button>()
        val insightSections = mutableListOf<Pair<Int, View>>()
        val insightTabsRow = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        listOf("All", "Structure", "Risk", "System").forEachIndexed { tab, title ->
            val button = compactPillButton(title).apply {
                textSize = 10f
                isSelected = tab == 0
                setTextColor(if (tab == 0) kyCharcoal else kyWhite)
                background = KyvoriqTheme.button(this@SafeActivity, tab == 0, 10f)
            }
            button.setOnClickListener {
                if (selectedInsightTab != tab) haptic(it, KyvoriqHaptics.Cue.SELECT)
                selectedInsightTab = tab
                insightTabs.forEachIndexed { i, chip ->
                    val selected = i == selectedInsightTab
                    chip.isSelected = selected
                    chip.setTextColor(if (selected) kyCharcoal else kyWhite)
                    chip.background = KyvoriqTheme.button(this@SafeActivity, selected, 10f)
                }
                insightSections.forEach { (category, card) ->
                    card.visibility = if (tab == 0 || tab == category) View.VISIBLE else View.GONE
                }
            }
            insightTabs.add(button)
            insightTabsRow.addView(button, LinearLayout.LayoutParams(0, dp(38), 1f).apply {
                leftMargin = dp(2); rightMargin = dp(2)
            })
        }
        insightsContent.addView(insightTabsRow, margins(bottom = 12))

        val story = premiumCard("MARKET CONTEXT", "Reading the market…", 12.5f)
        features = story.second
        features.maxLines = 7
        features.ellipsize = android.text.TextUtils.TruncateAt.END
        story.first.setOnClickListener {
            haptic(it, KyvoriqHaptics.Cue.TAP)
            showInfoDialog("Market context", features.text.toString())
        }
        insightsContent.addView(story.first, margins(bottom = 12))

        // The page itself scrolls: a fixed-height nested report clipped critical text.
        // Keep a concise preview here and expose the entire verified policy on tap.
        val decisions = compactCard("ENTRY CHECKS", "Checking entry eligibility…", 12.5f)
        decisionView = decisions.value
        decisionView.maxLines = 5
        decisionView.ellipsize = android.text.TextUtils.TruncateAt.END
        decisions.container.addView(label("VIEW COMPLETE CHECKS  ↗", 9f, kyGold, 0.02f), margins(top = 9))
        decisions.container.setOnClickListener {
            haptic(it, KyvoriqHaptics.Cue.TAP)
            showInfoDialog("Entry checks", entryChecksFullText)
        }
        insightsContent.addView(decisions.container, margins(bottom = 12))

        val alertCard = compactCard("ALERT INTELLIGENCE", "Info • No spam, just the real updates.", 12.5f)
        alertIntelligenceView = alertCard.value
        insightsContent.addView(alertCard.container, margins(bottom = 10))

        val riskCard = compactCard("POSITION RISK HEAT", "Idle • No open demo position.", 12.5f)
        riskHeatText = riskCard.value
        riskHeatMeter = RiskHeatMeterView(this).apply {
            contentDescription = "Position risk heat meter"
            setRisk(0f, "IDLE", animate = false)
        }
        riskCard.container.addView(
            riskHeatMeter,
            1,
            LinearLayout.LayoutParams(-1, dp(42)).apply { topMargin = dp(4); bottomMargin = dp(2) }
        )
        insightsContent.addView(riskCard.container, margins(bottom = 10))

        val levels = compactCard("LEVELS & FLOW", "Loading confirmed context…", 12.5f)
        insightContext = levels.value
        insightsContent.addView(levels.container, margins(bottom = 10))
        val feed = compactCard("CONNECTION", "Bitget • Connecting", 12.5f)
        integrity = feed.value
        insightsContent.addView(feed.container, margins(bottom = 10))
        val sys = compactCard("SYSTEM", "Build ${BuildConfig.VERSION_CODE} • Checking…", 12.5f)
        check = sys.value
        insightsContent.addView(sys.container, margins(bottom = 10))

        val tools = LinearLayout(this)
        checkButton = compactPillButton("SYSTEM CHECK")
        checkButton.setOnClickListener {
            haptic(it, KyvoriqHaptics.Cue.ACTION)
            safe { systemCheck() }
        }
        tools.addView(checkButton, LinearLayout.LayoutParams(0, dp(44), 1f).apply { rightMargin = dp(6) })
        updateButton = compactPillButton("UPDATE")
        updateButton.setOnClickListener {
            haptic(it, KyvoriqHaptics.Cue.ACTION)
            safe { checkUpdate() }
        }
        tools.addView(updateButton, LinearLayout.LayoutParams(0, dp(44), 1f))
        insightsContent.addView(tools, margins(bottom = 8))

        val deviceTools = LinearLayout(this)
        privacyButton = compactPillButton("PRIVACY")
        privacyButton.setOnClickListener {
            haptic(it, KyvoriqHaptics.Cue.ACTION)
            showPrivacyControls()
        }
        deviceTools.addView(privacyButton, LinearLayout.LayoutParams(0, dp(44), 1f).apply { rightMargin = dp(6) })
        widgetButton = compactPillButton("ADD WIDGET")
        widgetButton.setOnClickListener {
            haptic(it, KyvoriqHaptics.Cue.ACTION)
            requestHomeWidgetPin()
        }
        deviceTools.addView(widgetButton, LinearLayout.LayoutParams(0, dp(44), 1f))
        insightsContent.addView(deviceTools)
        val pairButton = compactPillButton(
            if (KyvoriqSecureSession.isPaired(this)) "DEVICE PAIRED  •  SECURE" else "PAIR DEVICE  •  PRIVATE API"
        )
        pairingButton = pairButton
        pairButton.setOnClickListener {
            haptic(it, KyvoriqHaptics.Cue.ACTION)
            showPairingDialog(pairButton)
        }
        insightsContent.addView(pairButton, margins(top = 7, bottom = 8))
        insightSections.addAll(listOf(
            1 to story.first,
            1 to decisions.container,
            2 to alertCard.container,
            2 to riskCard.container,
            1 to levels.container,
            3 to feed.container,
            3 to sys.container,
            3 to tools,
            3 to deviceTools,
            3 to pairButton
        ))
        insightsMotionViews.clear()
        insightsMotionViews.addAll(
            listOf(
                story.first,
                decisions.container,
                alertCard.container,
                riskCard.container,
                levels.container,
                feed.container,
                sys.container,
                tools,
                deviceTools,
                pairButton
            )
        )
        refreshPrivacyButton()

        val navigation = LinearLayout(this).apply {
            setPadding(dp(3), dp(4), dp(3), dp(4))
            background = KyvoriqTheme.surface(this@SafeActivity, radius = 18f)
        }
        listOf("TRADE", "POSITIONS", "INSIGHTS").forEachIndexed { index, title ->
            val button = compactPillButton(title.lowercase(Locale.US).replaceFirstChar { it.titlecase(Locale.US) }).apply { contentDescription = "Workspace $title"; textSize = 11f
                compoundDrawablePadding = dp(5)
                val icon = getDrawable(listOf(R.drawable.ic_nav_trade, R.drawable.ic_nav_positions, R.drawable.ic_nav_insights)[index])!!.mutate()
                icon.setBounds(0, 0, dp(16), dp(16))
                setCompoundDrawablesRelative(icon, null, null, null)
                setPadding(dp(10), 0, dp(6), 0) }
            button.setOnClickListener {
                if (workspacePages.getOrNull(index)?.visibility != View.VISIBLE) {
                    haptic(it, KyvoriqHaptics.Cue.SELECT)
                }
                selectWorkspace(index)
            }
            navigationButtons.add(button)
            navigation.addView(button, LinearLayout.LayoutParams(0, dp(44), 1f).apply { leftMargin = dp(3); rightMargin = dp(3) })
        }
        root.addView(navigation, margins(top = 8))
        update = TextView(this); risk = TextView(this); journal = TextView(this); replay = TextView(this)
        selectWorkspace(0)
    }

    private fun selectWorkspace(index: Int) {
        val previous = selectedWorkspace
        selectedWorkspace = index
        workspacePages.forEachIndexed { i, page ->
            page.animate().cancel(); page.alpha = 1f; page.translationX = 0f
            page.visibility = if (i == index) View.VISIBLE else View.GONE
        }
        navigationButtons.forEachIndexed { i, button ->
            val active = i == index
            button.isSelected = active
            button.setTextColor(if (active) kyCharcoal else kyWhite)
            button.compoundDrawablesRelative.filterNotNull().forEach { it.setTint(if (active) kyCharcoal else kyGold) }
            button.background = KyvoriqTheme.button(this, active, 13f)
        }
        if (previous != index && !debugPreview && KyvoriqTheme.motionEnabled(this)) {
            workspacePages[index].apply {
                animate().cancel()
                alpha = 0f
                translationX = dp(if (index > previous) 12 else -12).toFloat()
                animate().alpha(1f).translationX(0f).setStartDelay(0).setDuration(300L)
                    .setInterpolator(KyvoriqTheme.motion).start()
            }
        }
        latestRoot?.let { renderWorkspace(it) }
        if (index == 2 && previous != 2 && !debugPreview && KyvoriqTheme.motionEnabled(this)) animateInsightsEntrance()
    }

    private fun animateInsightsEntrance() {
        insightsMotionViews.forEachIndexed { index, view ->
            view.animate().cancel()
            view.alpha = 0f
            view.translationY = dp(9).toFloat()
            view.scaleX = 0.992f
            view.scaleY = 0.992f
            view.animate()
                .alpha(1f)
                .translationY(0f)
                .scaleX(1f)
                .scaleY(1f)
                .setStartDelay(index * 38L)
                .setDuration(300L)
                .setInterpolator(android.view.animation.PathInterpolator(0.18f, 0.82f, 0.20f, 1f))
                .withLayer()
                .start()
        }
    }

    private fun showTradeDetails() {
        val s = latestRoot?.optJSONObject("signal")
        if (s == null) {
            showInfoDialog("Decision center", decisionView.text.toString())
            return
        }
        val thesis = s.optJSONArray("thesis") ?: JSONArray()
        val explanation = (0 until thesis.length()).joinToString("\n") { "• " + thesis.optString(it) }
        val entries = latestRoot?.optJSONObject("execution")?.optJSONArray("recent_trades") ?: JSONArray()
        val actual = (0 until entries.length()).mapNotNull { entries.optJSONObject(it) }
            .firstOrNull { it.optString("signal_id") == s.optString("id") }
        val fillDetails = if (actual != null && actual.optBoolean("actual_fill_confirmed"))
            "\nExchange fill  ${formatCompact(actual.optDouble("entry_price"))}\nQuantity  ${actual.optDouble("filled_qty")} BTC\n" else ""
        showInfoDialog("Trade plan", "${s.optString("direction")}  •  ${s.optString("trade_style")}\n${s.optString("setup")}\n\n" +
            "Planned entry  ${formatCompact(s.optDouble("entry"))}\nStop  ${formatCompact(s.optDouble("stop"))}\n" +
            "Target 1  ${formatCompact(s.optDouble("target1"))}\nTarget 2  ${formatCompact(s.optDouble("target2"))}\n" +
            "Evidence score  ${String.format(Locale.US, "%.0f", s.optDouble("confidence") * 100)}/100 (heuristic)\n$fillDetails\n" +
            "Execution  ${s.optString("execution_status", "PENDING CHECK")}\n${s.optString("execution_reason")}\n\n" +
            "Invalidation\n${s.optString("invalidation")}\n\n$explanation")
    }

    private fun LinearLayout.isFillViewportCompat() {
        // Kept as a no-op marker so the main root remains a normal fixed viewport.
    }

    // Presentation-only labels: never modify execution, safety or protocol keys.
    private fun humanHeading(raw: String): String = when (raw) {
        "MARKET CONTEXT" -> "Market context"
        "ENTRY CHECKS" -> "Entry checks"
        "ALERT INTELLIGENCE" -> "Alert intelligence"
        "POSITION RISK HEAT" -> "Position risk"
        "LEVELS & FLOW" -> "Levels & flow"
        "CONNECTION" -> "Connection"
        "SYSTEM" -> "System"
        "DECISION CENTER" -> "Decision center"
        "DEMO PERFORMANCE" -> "Demo performance"
        "ACCOUNTING & RISK" -> "Accounting & risk"
        "EXCHANGE POSITIONS" -> "Exchange positions"
        else -> raw
    }

    private fun sectionLabel(text: String): TextView =
        label(text, 10f, kyGray, 0.06f)

    private fun weightButton(): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(0, dp(42), 1f).apply {
            leftMargin = dp(2)
            rightMargin = dp(2)
        }

    private fun refreshTimeframeButtons(row: LinearLayout) {
        for (i in 0 until row.childCount) {
            val child = row.getChildAt(i) as? Button ?: continue
            val tf = child.text.toString()
            val selected = tf == selectedTf
            child.isSelected = selected
            child.setTextColor(if (selected) kyCharcoal else kyWhite)
            child.background = KyvoriqTheme.button(this, selected, 11f)
        }
    }

    private fun compactPillButton(text: String): Button =
        KyvoriqButton(this).apply {
            this.text = text
            textSize = 11f
            setTextColor(android.content.res.ColorStateList(
                arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()),
                intArrayOf(kyGray, kyWhite)))
            backgroundTintList = null
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            isAllCaps = false
            isEnabled = true
            isClickable = true
            isFocusable = true
            minHeight = 0
            minWidth = 0
            stateListAnimator = null
            elevation = 0f
            setPadding(dp(5), 0, dp(5), 0)
            background = KyvoriqTheme.button(this@SafeActivity)
        }

    private data class HeroRefs(
        val price: PremiumPriceView,
        val oi: TextView,
        val status: TextView,
        val container: LinearLayout
    )

    private fun heroCard(): HeroRefs {
        val compactViewport = resources.configuration.screenHeightDp < 760
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(if (compactViewport) 11 else 13), dp(14), dp(if (compactViewport) 11 else 13))
            background = KyvoriqTheme.surface(this@SafeActivity, prominent = true)
        }

        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        top.addView(label("BTC  /  USDT", 10.5f, kyWhite, 0.04f),
            LinearLayout.LayoutParams(0, dp(if (compactViewport) 18 else 22), 1f))
        val livePill = label("PERPETUAL", 8f, kyGray, 0.035f)
        top.addView(livePill, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(if (compactViewport) 18 else 22)))
        box.addView(top)

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val priceView = PremiumPriceView(this).apply {
            setTextSizeSp(if (compactViewport) 26f else 32f)
            setPrice(Double.NaN, animate = false)
        }
        row.addView(priceView, LinearLayout.LayoutParams(0, dp(if (compactViewport) 40 else 49), 1f))

        val statusView = TextView(this).apply {
            text = "DATA CONNECTING"
            textSize = 9.5f
            setTextColor(kyGray)
            gravity = Gravity.CENTER
            setPadding(dp(9), 0, dp(9), 0)
            background = GradientDrawable().apply {
                cornerRadius = dp(10).toFloat()
                setColor(kySlate)
                setStroke(dp(1), kyLine)
            }
        }
        row.addView(statusView, LinearLayout.LayoutParams(dp(92), dp(30)))
        box.addView(row)

        val oi = label("OI  —", 9f, kyGray, 0.02f)
        box.addView(oi, margins(top = 4))
        return HeroRefs(priceView, oi, statusView, box)
    }

    private fun compactCard(title: String, initial: String, valueSize: Float): CardRefs {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = KyvoriqTheme.surface(this@SafeActivity, prominent = false)
        }
        val heading = label(humanHeading(title), 12f, kyWhite, 0.012f)
        val value = TextView(this).apply {
            text = initial
            textSize = valueSize
            setTextColor(kyWhite)
            typeface = Typeface.create("sans-serif", Typeface.NORMAL)
            includeFontPadding = false
            setLineSpacing(0f, 1.12f)
            setHorizontallyScrolling(false)
        }
        box.addView(heading)
        box.addView(value, margins(top = 8))
        return CardRefs(box, value)
    }

    private fun premiumCard(title: String, initial: String, valueSize: Float): Pair<LinearLayout, TextView> {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(13), dp(14), dp(13))
            background = KyvoriqTheme.surface(this@SafeActivity, prominent = true)
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(label(humanHeading(title), 11.5f, kyWhite, 0.012f),
            LinearLayout.LayoutParams(0, dp(18), 1f))
        header.addView(label(if (title == "DECISION CENTER") "DETAILS  ›" else if (title == "DEMO PERFORMANCE") "DEMO" else "MARKET", 8.5f, kyGray, 0.08f))
        box.addView(header)

        val value = TextView(this).apply {
            text = initial
            textSize = valueSize
            setTextColor(kyWhite)
            typeface = Typeface.create("sans-serif", Typeface.NORMAL)
            includeFontPadding = false
            setLineSpacing(0f, 1.13f)
        }
        box.addView(value, margins(top = 8))
        return Pair(box, value)
    }

    private fun label(text: String, size: Float, color: Int, spacing: Float): TextView {
        return TextView(this).apply {
            this.text = marketAssetAccent(text)
            textSize = size
            setTextColor(color)
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            letterSpacing = spacing.coerceAtMost(0.035f)
            includeFontPadding = false
        }
    }

    private data class CardRefs(val container: LinearLayout, val value: TextView)

    private fun scrollableCard(
        title: String,
        initial: String,
        valueSize: Float,
        scrollHeightPx: Int,
        expandToFill: Boolean = false
    ): CardRefs {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = KyvoriqTheme.surface(this@SafeActivity, prominent = false)
        }

        val heading = TextView(this).apply {
            text = humanHeading(title)
            textSize = 11.5f
            setTextColor(kyWhite)
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            letterSpacing = 0.012f
            includeFontPadding = false
        }
        val headingRow = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        headingRow.addView(heading, LinearLayout.LayoutParams(0, -2, 1f))
        if (!expandToFill) headingRow.addView(label("SCROLL ↓", 8f, kyGray, 0.04f))
        box.addView(headingRow)

        val value = TextView(this).apply {
            text = marketAssetAccent(initial)
            textSize = valueSize
            setTextColor(kyWhite)
            typeface = Typeface.create("sans-serif", Typeface.NORMAL)
            includeFontPadding = false
            setLineSpacing(0f, 1.12f)
        }

        val historyScroll = ScrollView(this).apply {
            isFillViewport = true
            overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
            isVerticalScrollBarEnabled = true
            isScrollbarFadingEnabled = true
            scrollBarFadeDuration = 250
            scrollBarDefaultDelayBeforeFade = 500
            scrollBarStyle = View.SCROLLBARS_INSIDE_INSET
        }
        historyScroll.addView(
            value,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        )

        box.addView(
            historyScroll,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                if (expandToFill) 0 else scrollHeightPx, if (expandToFill) 1f else 0f
            ).apply {
                topMargin = dp(8)
            }
        )

        return CardRefs(box, value)
    }

    private fun card(title: String, initial: String, valueSize: Float): CardRefs {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = KyvoriqTheme.surface(this@SafeActivity, prominent = false)
        }

        val heading = TextView(this).apply {
            text = humanHeading(title)
            textSize = 11.5f
            setTextColor(kyGold)
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            letterSpacing = 0.012f
        }
        box.addView(heading)

        val value = TextView(this).apply {
            text = marketAssetAccent(initial)
            textSize = valueSize
            setTextColor(kyWhite)
            typeface = Typeface.create("sans-serif", Typeface.NORMAL)
            includeFontPadding = false
            setLineSpacing(0f, 1.12f)
        }
        box.addView(value, margins(top = 8))
        return CardRefs(box, value)
    }

    private fun actionButton(label: String): Button {
        return KyvoriqButton(this).apply {
            text = marketAssetAccent(label)
            textSize = 13f
            setTextColor(android.content.res.ColorStateList(
                arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()),
                intArrayOf(kyGray, kyWhite)))
            backgroundTintList = null
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            isAllCaps = false
            isEnabled = true
            isClickable = true
            isFocusable = true
            isFocusableInTouchMode = false
            minHeight = dp(52)
            minWidth = 0
            stateListAnimator = null
            elevation = 0f
            background = KyvoriqTheme.button(this@SafeActivity)
            setPadding(dp(8), 0, dp(8), 0)

        }
    }

    private fun gradient(colors: IntArray, orientation: GradientDrawable.Orientation): GradientDrawable {
        return GradientDrawable(orientation, colors)
    }

    private fun margins(top: Int = 0, bottom: Int = 0): LinearLayout.LayoutParams {
        return LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply {
            this.topMargin = dp(top)
            this.bottomMargin = dp(bottom)
        }
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    private fun safe(block: () -> Unit) {
        runCatching { block() }
    }

    private fun compactHeaderLabel(original: String, retry: Boolean = false): String {
        return if (retry) "Refresh" else when (original) {
            "ALERTS ON" -> "Alerts on"
            "ALLOW ALERTS" -> "Enable alerts"
            "ALERTS RETRY" -> "Retry alerts"
            "PRIVATE" -> "Pair device"
            else -> "Alerts"
        }
    }

    private fun showPublicAccessInfo() {
        showInfoDialog(
            "Public BTC chart • View only",
            "This phone can read public BTC market candles without an account. " +
                "Private KYVORIQ signals, order execution, position history, notifications " +
                "and owner settings stay locked. To enable private features, the owner must " +
                "explicitly authorize device pairing in Insights. Do not share the owner token casually."
        )
    }

    private fun enterPublicMarketMode() {
        if (debugPreview) return
        if (!publicMarketOnly) {
            publicMarketOnly = true
            runCatching { socket?.cancel() }
            socket = null
            reconnectRunnable?.let { handler.removeCallbacks(it) }
            reconnectRunnable = null
            reconnectScheduled.set(false)
            latestRoot = null
            overlayFeatures = null
            overlayStrategy = null
            if (::chart.isInitialized) {
                chart.setSignal(null)
                chart.setTradeEvent(null)
                chart.setOverlays(JSONArray())
                chart.setFeedHealthy(false)
            }
            if (::signal.isInitialized) signal.text = "PRIVATE SIGNALS LOCKED • PAIR DEVICE TO UNLOCK"
            if (::tradeHistory.isInitialized) tradeHistory.text = "Private exchange history is unavailable in public view."
            if (::positionSummary.isInitialized) positionSummary.text = "PRIVATE • PAIRING REQUIRED"
        }
        if (::status.isInitialized) {
            status.text = "VIEW ONLY"
            status.setTextColor(kyGray)
        }
        if (::integrity.isInitialized) integrity.text = "PUBLIC MARKET • VIEW ONLY • NO PRIVATE TRADES"
        publicMarketMessage?.visibility = View.VISIBLE
        if (::alertsButton.isInitialized) {
            alertsButton.text = compactHeaderLabel("PRIVATE")
            alertsButton.isEnabled = true
        }
    }

    private fun connect(force: Boolean = false) {
        if (stopped || publicMarketOnly || !KyvoriqSecureSession.isPaired(this)) return
        if (force) {
            reconnectRunnable?.let { handler.removeCallbacks(it) }
            reconnectRunnable = null
            reconnectScheduled.set(false)
            runCatching { socket?.cancel() }
            socket = null
        }
        if (socket != null) return

        if (lastHardHttpStatus == null &&
            (lastBootstrapSuccessMs == 0L || System.currentTimeMillis() - lastBootstrapSuccessMs > 10_000L)
        ) {
            status.text = "CONNECTING…"
            integrity.text = "WebSocket  •  CONNECTING •  SECURE RETRY LOOP"
        }
        socket = client.newWebSocket(
            KyvoriqSecureSession.authenticate(
                this, Request.Builder().url(BackendEndpoint.socket("dashboard")),
                BackendEndpoint.socket("dashboard")
            ).build(),
            object : WebSocketListener() {
                override fun onOpen(ws: WebSocket, response: Response) {
                    handler.post {
                        if (stopped || socket !== ws) {
                            ws.cancel()
                            return@post
                        }
                        reconnectAttempt = 0
                        reconnectScheduled.set(false)
                        lastSocketActivityMs = System.currentTimeMillis()
                        runCatching {
                            ws.send(JSONObject().apply {
                                put("type", "keepalive")
                                put("client_ts", System.currentTimeMillis())
                            }.toString())
                        }
                        if (lastHardHttpStatus == null &&
                            System.currentTimeMillis() - lastBootstrapSuccessMs > 10_000L
                        ) status.text = "SYNCING…"
                        integrity.text = "WebSocket  •  CONNECTED  •  LIVE FEED SUPERVISOR"
                        if (latestRoot == null) bootstrap(false)
                    }
                }

                override fun onMessage(ws: WebSocket, text: String) {
                    handler.post {
                      if (stopped || socket !== ws) return@post
                      lastSocketActivityMs = System.currentTimeMillis()
                      safe {
                        val root = JSONObject(text)
                        val type = root.optString("type")
                        if (type == "state" || type == "market_tick") {
                            val previous = latestRoot
                            if (previous != null && root.optLong("server_ts") < previous.optLong("server_ts")) return@safe
                            val merged = if (type == "market_tick") {
                                if (previous == null) return@safe
                                JSONObject(previous.toString()).apply {
                                    val keys = root.keys()
                                    while (keys.hasNext()) {
                                        val key = keys.next()
                                        if (key != "type") put(key, root.get(key))
                                    }
                                }
                            } else root
                            latestRoot = merged
                            lastHardHttpStatus = null
                            lastStateReceivedMs = System.currentTimeMillis()
                            val now = System.currentTimeMillis()
                            if (now - lastUiRenderMs >= 350L && !pendingUiUpdate) {
                                pendingUiUpdate = true
                                handler.post {
                                    pendingUiUpdate = false
                                    lastUiRenderMs = System.currentTimeMillis()
                                    if (!stopped) safe { latestRoot?.let { renderState(it, requestChart = false) } }
                                }
                            }
                        }
                      }
                    }
                }

                override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                    val owned = socket === ws
                    if (owned) socket = null
                    if (!owned || stopped) return
                    handler.post {
                        if (!stopped && socket == null) {
                            val httpFresh = lastBootstrapSuccessMs > 0L &&
                                System.currentTimeMillis() - lastBootstrapSuccessMs <= 10_000L
                            status.text = lastHardHttpStatus ?: if (httpFresh) "HTTP FALLBACK" else "RECONNECTING…"
                            integrity.text = if (httpFresh) "WebSocket OFFLINE  •  HTTP SNAPSHOT ACTIVE"
                                else "WebSocket  •  DISCONNECTED  •  RETRY SCHEDULED"
                        }
                    }
                    reconnect(false)
                }

                override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                    val owned = socket === ws
                    if (owned) socket = null
                    if (!owned || stopped) return
                    handler.post {
                        if (!stopped && socket == null) {
                            val httpFresh = lastBootstrapSuccessMs > 0L &&
                                System.currentTimeMillis() - lastBootstrapSuccessMs <= 10_000L
                            status.text = lastHardHttpStatus ?: if (httpFresh) "HTTP FALLBACK" else "RECONNECTING…"
                            integrity.text = if (httpFresh) "WebSocket CLOSED  •  HTTP SNAPSHOT ACTIVE"
                                else "WebSocket  •  CLOSED  •  RETRY SCHEDULED"
                        }
                    }
                    reconnect(false)
                }
            }
        )
    }

    private fun reconnect(immediate: Boolean = false) {
        if (stopped) return
        if (immediate) {
            reconnectScheduled.set(false)
            reconnectRunnable?.let { handler.removeCallbacks(it) }
            reconnectRunnable = null
            handler.post {
                if (!stopped) {
                    bootstrap(true)
                    connect(force = true)
                }
            }
            return
        }
        if (socket != null) return
        if (!reconnectScheduled.compareAndSet(false, true)) return
        val attempt = reconnectAttempt.coerceAtMost(4)
        val delay = minOf(15000L, 1000L * (1L shl attempt))
        reconnectAttempt = minOf(reconnectAttempt + 1, 4)
        val task = Runnable {
            reconnectRunnable = null
            reconnectScheduled.set(false)
            if (!stopped && socket == null) {
                bootstrap(false)
                connect()
            }
        }
        reconnectRunnable = task
        handler.postDelayed(task, delay)
    }

    private fun forceReconnectFromUser() {
        if (publicMarketOnly || !KyvoriqSecureSession.isPaired(this)) {
            enterPublicMarketMode()
            requestChartIfNeeded(force = true)
            if (privateRouteFallback && KyvoriqSecureSession.isPaired(this)) {
                lastPrivateRouteProbeMs = System.currentTimeMillis()
                bootstrap(force = true)
            }
            return
        }
        val now = System.currentTimeMillis()
        if (now - lastRetryRequestMs < 1500L) return
        lastRetryRequestMs = now
        reconnectAttempt = 0
        lastSocketRebuildMs = now
        retryButton?.isEnabled = false
        retryButton?.text = "…  "
        status.text = "DATA RECOVERY"
        integrity.text = "MANUAL RETRY  •  REBUILDING LIVE CONNECTION"
        bootstrap(true)
        connect(force = true)
        handler.postDelayed({
            retryButton?.isEnabled = true
            retryButton?.text = compactHeaderLabel("↻ RETRY", retry = true)
        }, 2000L)
    }

    private fun registerNetworkCallback() {
        runCatching {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    handler.postDelayed({
                        if (!stopped) forceReconnectFromNetwork()
                    }, 350L)
                }

                override fun onLost(network: Network) {
                    handler.post {
                        if (!stopped) {
                            status.text = "NETWORK CHANGE"
                            integrity.text = "NETWORK  •  LOST •  WAITING FOR RECOVERY"
                        }
                    }
                }
            }
            networkCallback = callback
            cm.registerDefaultNetworkCallback(callback)
        }
    }

    private fun forceReconnectFromNetwork() {
        if (publicMarketOnly || !KyvoriqSecureSession.isPaired(this)) {
            enterPublicMarketMode()
            requestChartIfNeeded(force = true)
            return
        }
        val now = System.currentTimeMillis()
        if (now - lastRetryRequestMs < 1500L) return
        lastRetryRequestMs = now
        reconnectAttempt = 0
        lastSocketRebuildMs = now
        bootstrap(true)
        connect(force = true)
    }

    private fun bootstrap(force: Boolean = false) {
        if (stopped || bootstrapInFlight) return
        if ((publicMarketOnly && !privateRouteFallback) || !KyvoriqSecureSession.isPaired(this)) {
            enterPublicMarketMode()
            requestChartIfNeeded(force)
            return
        }
        val now = System.currentTimeMillis()
        if (!force && now - lastBootstrapMs < 4000L) return
        lastBootstrapMs = now
        bootstrapInFlight = true
        if (lastHardHttpStatus == null) {
            integrity.text = "HTTP  •  SYNCING MARKET SNAPSHOT"
        }
        val requestTf = selectedTf
        getJson(backendBase + "/bootstrap?profile=dashboard&interval=" + requestTf) { ok, body ->
            handler.post {
                bootstrapInFlight = false
                if (stopped) return@post
                if (!ok) {
                    val nowFail = System.currentTimeMillis()
                    val fault = when (body) {
                        "HTTP 401" -> "PAIRING REQUIRED"
                        "HTTP 403" -> "ACCESS DENIED (403)"
                        "HTTP 404" -> "BACKEND ROUTE 404"
                        "HTTP 429" -> "RATE LIMITED (429)"
                        "HTTP 502", "HTTP 503", "HTTP 504" -> "HOST UNAVAILABLE"
                        "NETWORK TIMEOUT" -> "NETWORK TIMEOUT"
                        "NETWORK UNAVAILABLE" -> "NETWORK UNAVAILABLE"
                        else -> if (body.startsWith("HTTP ")) "BACKEND " + body else "RECONNECTING…"
                    }
                    lastHardHttpStatus = if (body in setOf("HTTP 401", "HTTP 403", "HTTP 404")) fault else null
                    if (body == "HTTP 404") {
                        // No credential bypass and no blind backend restart:
                        // /bootstrap occasionally 404s at Voroa ingress even
                        // though /health and /chart are routed correctly.
                        privateRouteFallback = true
                        lastHardHttpStatus = null
                        lastPrivateRouteProbeMs = nowFail
                        enterPublicMarketMode()
                        status.text = "ROUTE RETRY"
                        publicMarketMessage?.text =
                            "SECURE BACKEND ROUTE TEMPORARILY UNAVAILABLE\n" +
                            "Showing public BTC prices only. KYVORIQ is automatically retrying secure pairing."
                        requestChartIfNeeded(force = true)
                        return@post
                    }
                    if (body == "HTTP 401") {
                        pairingButton?.text = "SESSION EXPIRED  •  TAP TO RE-PAIR"
                        check.text = "This device needs owner-approved pairing. Public BTC market chart remains available."
                        enterPublicMarketMode()
                        requestChartIfNeeded(force = true)
                        return@post
                    }
                    if (lastBootstrapSuccessMs == 0L || nowFail - lastBootstrapSuccessMs > 10_000L) {
                        status.text = fault
                        integrity.text = "HTTP  •  " + body.ifEmpty { "SNAPSHOT FAILED" } + "  •  RETRY SCHEDULED"
                    }
                    return@post
                }
                safe {
                    val root = JSONObject(body)
                    // A proxy may send 200 with an error JSON; never treat it as a live market snapshot.
                    if (!root.has("data_health") || !root.optDouble("last_price", Double.NaN).isFinite()) {
                        status.text = "INVALID SNAPSHOT"
                        integrity.text = "HTTP  •  INVALID MARKET RESPONSE"
                        return@safe
                    }
                    val receivedAt = System.currentTimeMillis()
                    lastHardHttpStatus = null
                    val restoredPrivateRoute = privateRouteFallback
                    privateRouteFallback = false
                    publicMarketOnly = false
                    publicMarketMessage?.visibility = View.GONE
                    if (restoredPrivateRoute) {
                        // Re-open private WS only AFTER authenticated bootstrap
                        // succeeds. No order endpoint is called here.
                        connect(force = true)
                    }
                    lastBootstrapSuccessMs = receivedAt
                    if (latestRoot == null || root.optLong("server_ts") >= latestRoot!!.optLong("server_ts")) {
                        latestRoot = root
                        lastStateReceivedMs = receivedAt
                        renderState(root, requestChart = false)
                    }
                    val chartObj = root.optJSONObject("chart")
                    val candles = chartObj?.optJSONArray("candles") ?: JSONArray()
                    if (candles.length() > 0 && selectedTf == requestTf) {
                        lastChartRequestMs = receivedAt
                        val lastPrice = latestRoot?.optDouble("last_price", Double.NaN)
                            ?: chartObj.optDouble("last_price", Double.NaN)
                        chart.setTimeframe(requestTf)
                        chart.setLivePrice(lastPrice)
                        latestChartCandles = candles
                        chart.setData(
                            candles,
                            latestRoot?.optJSONObject("signal"),
                            calculateEma(candles, 50),
                            lastPrice,
                            chartOverlays(latestRoot)
                        )
                        requestChartOverlays(force)
                    }
                }
            }
        }
    }

    private fun renderState(root: JSONObject, requestChart: Boolean = true) {
        val priceValue = root.optDouble("last_price", Double.NaN)
        val health = root.optString("data_health", "UNKNOWN")
        val ws = root.optBoolean("ws_connected", false)
        val oi = root.optDouble("open_interest", Double.NaN)
        val signalObj = root.optJSONObject("signal")
        val engine = root.optJSONObject("engine")
        val f = root.optJSONObject("features")

        val nowMs = System.currentTimeMillis()
        val receivedTs = root.optLong("received_ts", 0L)
        val marketUpdateTs = root.optLong("last_market_update_ts", 0L)
        val freshestTs = maxOf(receivedTs, marketUpdateTs)
        val freshMarket = priceValue.isFinite() && freshestTs > 0L && (nowMs - freshestTs) <= 8_000L
        val upstream = root.optJSONObject("upstream")
        val source = upstream?.optString("source", "").orEmpty()
        val authoritativeFeedHealthy = health == "HEALTHY" && ws && source == "BITGET_WS" && freshMarket
        val verifiedRestSnapshot = freshMarket && source.contains("REST", ignoreCase = true) &&
            health in setOf("HEALTHY", "DEGRADED")
        chart.setFeedHealthy(authoritativeFeedHealthy)
        chart.setCustomPriceAlerts(BtcPriceAlerts.armedLevels(this))
        chart.setSignal(signalObj)
        val statusLabel = when {
            authoritativeFeedHealthy -> "LIVE"
            verifiedRestSnapshot -> "REST FALLBACK"
            health == "DEGRADED" -> "DATA DEGRADED"
            health == "CONNECTING" -> "CONNECTING…"
            health == "RECONNECTING" -> "RECONNECTING…"
            !ws -> "BACKEND WS OFFLINE"
            !freshMarket -> "DATA STALE"
            else -> health
        }
        // Teal status dot is reserved for verified, fresh Bitget websocket data.
        setStatusAnimated(if (authoritativeFeedHealthy) "● LIVE" else statusLabel)
        status.setTextColor(if (authoritativeFeedHealthy) Color.rgb(71, 218, 192) else kyGray)
        price.setPrice(priceValue, animate = !debugPreview)
        oiView.text = "OI  " + if (oi.isNaN()) "—"
            else String.format(Locale.US, "%,.2f", oi)
        integrity.text = when {
            authoritativeFeedHealthy -> "BITGET WS  •  LIVE"
            verifiedRestSnapshot -> "BITGET REST  •  FRESH SNAPSHOT"
            health == "DEGRADED" && source.contains("REST", ignoreCase = true) -> "BITGET REST  •  DEGRADED"
            health == "DEGRADED" -> "BITGET FEED  •  DEGRADED"
            health == "CONNECTING" || health == "RECONNECTING" -> "BITGET WS  •  CONNECTING"
            !ws -> "BACKEND WS  •  OFFLINE"
            else -> "BITGET FEED  •  " + health
        }

        val execution = root.optJSONObject("execution")
        val recentTrades = execution?.optJSONArray("recent_trades")
        var signalExecution: JSONObject? = null
        if (recentTrades != null && signalObj != null) {
            for (i in 0 until recentTrades.length()) {
                val trade = recentTrades.optJSONObject(i) ?: continue
                val tradeSignalId = trade.optString("signal_id")
                val tradeStatus = trade.optString("status").uppercase(Locale.US)
                if (tradeSignalId == signalObj.optString("id") && tradeStatus in setOf("OPEN", "ORDER_PENDING", "CLOSED", "FAILED")) {
                    signalExecution = trade
                    break
                }
            }
        }
        val executionStatus = signalExecution?.optString("status", "NONE")?.uppercase(Locale.US) ?: "NONE"
        val openExecution = if (executionStatus == "OPEN") signalExecution else null

        val signalLifecycle = signalObj?.optString(
            "lifecycle",
            signalObj.optString("lifecycle_stage", "ACTIVE")
        )?.uppercase(Locale.US).orEmpty()
        val signalResolved = signalLifecycle in setOf(
            "TARGET_REACHED", "INVALIDATED", "EXECUTION_FAILED",
            "CLOSED", "RESOLVED", "TP2_HIT", "SL_HIT", "EXECUTION_FAILED"
        )

        if (signalObj == null || signalResolved) {
            if (signalObj != null && signalResolved) {
                val direction = signalObj.optString("direction", "—")
                val setupName = signalObj.optString("setup", "Trade")
                val outcome = when (signalLifecycle) {
                    "TARGET_REACHED", "TP2_HIT" -> "TARGET REACHED"
                    "INVALIDATED", "SL_HIT" -> "STOP / INVALIDATED"
                    "EXECUTION_FAILED" -> "EXECUTION FAILED"
                    else -> signalLifecycle.replace('_', ' ')
                }
                val executionClosed = execution?.optJSONArray("recent_trades")
                var closedMatch: JSONObject? = null
                if (executionClosed != null) {
                    for (i in 0 until executionClosed.length()) {
                        val trade = executionClosed.optJSONObject(i) ?: continue
                        if (trade.optString("signal_id") == signalObj.optString("id") &&
                            trade.optString("status").uppercase(Locale.US) == "CLOSED"
                        ) {
                            closedMatch = trade
                            break
                        }
                    }
                }
                val entry = closedMatch?.optDouble("entry_price", signalObj.optDouble("entry", Double.NaN))
                    ?: signalObj.optDouble("entry", Double.NaN)
                val exit = closedMatch?.optDouble("exit_price", Double.NaN) ?: Double.NaN
                val pnl = closedMatch?.optDouble("net_profit_usdt", Double.NaN) ?: Double.NaN
                setTradeSetupText(
                    "TRADE CLOSED  •  $direction  •  $outcome" +
                        "\n$setupName" +
                        "\nEntry  " + if (entry.isFinite()) String.format(Locale.US, "%.2f", entry) else "—" +
                        "    Exit  " + if (exit.isFinite() && exit > 0) String.format(Locale.US, "%.2f", exit) else "—" +
                        "\nResult  " + if (pnl.isFinite()) String.format(Locale.US, "%+.2f USDT", pnl) else signalLifecycle.replace('_', ' ') +
                        "\nWaiting for the next confirmed setup."
                )
                risk.text = "Exchange lifecycle resolved • no active demo position"
            } else {
                val radar = engine?.optJSONArray("opportunity_radar")
                val lead = radar?.optJSONObject(0)
                val second = radar?.optJSONObject(1)
                val scenario = engine?.optJSONArray("scenario_tree")?.let { arr ->
                    (0 until minOf(2, arr.length())).mapNotNull { arr.optJSONObject(it) }
                        .joinToString("  •  ") { it.optString("name") + " " + it.optString("state") }
                }.orEmpty()
                val leadText = if (lead != null) {
                    lead.optString("direction", "—") + " " +
                        lead.optString("action", "WATCH").uppercase(Locale.US) +
                        " " + lead.optInt("score") + "/" + lead.optInt("max_score") +
                        " • " + lead.optString("setup", "Opportunity").take(20)
                } else "LONG WATCH  •  —"
                val secondText = if (second != null) {
                    second.optString("direction", "—") + " " +
                        second.optString("action", "WATCH").uppercase(Locale.US) +
                        " " + second.optInt("score") + "/" + second.optInt("max_score")
                } else "SHORT WATCH  •  —"
                val sfp = engine?.optJSONObject("sfp_hunter")
                val breakout = engine?.optJSONObject("breakout_watch")
                val sfpText = if (sfp != null) {
                    "SFP  •  " + sfp.optString("status", "WATCH").uppercase(Locale.US)
                } else "SFP  •  WATCH"
                val breakoutText = if (breakout != null) {
                    "BREAKOUT  •  " + breakout.optString("status", "WATCH").uppercase(Locale.US)
                } else "BREAKOUT  •  WATCH"
                val scenarioCompact = scenario.replace("  •  ", " • ").take(46)
                setTradeSetupText(
                    "OPPORTUNITY RADAR  •  LIVE\n" +
                        leadText +
                        "\n" + secondText +
                        "\n" + sfpText + "  •  " + breakoutText +
                        (if (scenarioCompact.isBlank()) "" else "\nSCENARIOS  •  " + scenarioCompact) +
                        "\nNO CONFIRMED TRADE  •  monitoring"
                )
                risk.text = "USDT P&L calculator • quantity or cost • long/short • leverage"
            }
        } else {
            val lifecycle = signalObj.optString("lifecycle_stage", signalObj.optString("lifecycle", "ACTIVE"))
            val thesis = signalObj.optJSONArray("thesis")
            val reason = if (thesis != null && thesis.length() > 0) thesis.optString(0) else ""
            val management = signalObj.optJSONObject("evidence")?.optJSONObject("position_management")
            val managementText = if (management != null) {
                "\n" + management.optString("status", "REVERSAL") + "  •  " +
                    management.optString("action", "Manage existing position") +
                    "\nWhy: " + management.optString("reason", "")
            } else ""
            val tradeStyle = signalObj.optString("trade_style", "SCALP")
            val styleReason = signalObj.optString("style_reason", signalObj.optJSONObject("evidence")?.optString("style_reason", "") ?: "").orEmpty()
            val evidenceObj = signalObj.optJSONObject("evidence")
            val riskDistance = evidenceObj?.optDouble("risk_distance", Double.NaN) ?: Double.NaN

            val plannedEntry = signalObj.optDouble("entry", Double.NaN)
            val actualEntry = openExecution?.optDouble("entry_price", Double.NaN) ?: signalExecution?.optDouble("entry_price", Double.NaN) ?: Double.NaN
            val entryLine = if (actualEntry.isFinite() && actualEntry > 0) {
                "Planned  " + String.format(Locale.US, "%.2f", plannedEntry) +
                    "    Actual fill  " + String.format(Locale.US, "%.2f", actualEntry)
            } else {
                "Planned entry  " + if (plannedEntry.isFinite()) String.format(Locale.US, "%.2f", plannedEntry) else "—"
            }
            val title = when {
                executionStatus == "OPEN" && authoritativeFeedHealthy ->
                    "POSITION OPEN  •  " + signalObj.optString("direction") + "  •  " + tradeStyle + "  •  ACTIVE"
                executionStatus == "OPEN" ->
                    "POSITION OPEN  •  " + signalObj.optString("direction") + "  •  RECONCILING"
                executionStatus == "ORDER_PENDING" ->
                    "ORDER PENDING  •  " + signalObj.optString("direction") + "  •  AWAITING FILL"
                !authoritativeFeedHealthy ->
                    "SIGNAL UNCONFIRMED  •  " + signalObj.optString("direction") + "  •  FEED DEGRADED"
                else ->
                    "TRADE CALL  •  " + signalObj.optString("direction") + "  •  " + tradeStyle + "  •  " + lifecycle
            }
            val feedGuard = if (!authoritativeFeedHealthy) {
                "\n⚠ Exchange state is authoritative; waiting for healthy Bitget feed." 
            } else ""

            setTradeSetupText(
                title +
                    "\n" + signalObj.optString("setup") +
                    "\n" + entryLine +
                    "\nSL  " + String.format(Locale.US, "%.2f", signalObj.optDouble("stop")) +
                    "\nTP1  " + String.format(Locale.US, "%.2f", signalObj.optDouble("target1")) +
                    "    TP2  " + String.format(Locale.US, "%.2f", signalObj.optDouble("target2")) +
                    "\nRisk  " + (if (riskDistance.isNaN()) "—" else String.format(Locale.US, "%.2f pts", riskDistance)) +
                    "  •  RR  " + String.format(Locale.US, "%.2f", signalObj.optDouble("rr")) +
                    "  •  Conf " + String.format(Locale.US, "%.0f%%", signalObj.optDouble("confidence") * 100) +
                    if (styleReason.isBlank()) "" else "\n" + styleReason +
                    if (reason.isBlank()) "" else "\n" + reason +
                    managementText +
                    feedGuard
            )

            val id = signalObj.optString("id")
            if (id.isNotBlank() && id != lastSignalId) {
                lastSignalId = id
                appendJournal(signalObj)
                loadJournal()
            }
        }

        val executionEvent = execution?.optJSONObject("last_event")
        val executionEventKey = executionEvent?.optString("key").orEmpty()
        if (executionEventKey.isNotBlank() && executionEventKey != lastExecutionEventKey) {
            lastExecutionEventKey = executionEventKey
            loadTradeHistory()
        }

        val tradeEvent = root.optJSONObject("trade_event")
        chart.setTradeEvent(tradeEvent)
        if (tradeEvent != null && tradeEvent.optString("key").isNotBlank()) {
            val eventType = tradeEvent.optString("type", "TRADE_EVENT").replace("_", " ")
            val eventPrice = tradeEvent.optDouble("price", Double.NaN)
            val eventNote = tradeEvent.optString("note", "")
            risk.text = eventType + "  •  " +
                if (eventPrice.isNaN()) "—" else String.format(Locale.US, "%.2f", eventPrice) +
                if (eventNote.isBlank()) "" else "\n" + eventNote
        }

        val story = engine?.optString("multi_timeframe_story", "").orEmpty()
        val storyParts = story.split(";")
            .map { it.trim() }
            .filter { it.isNotBlank() }
        val compactStory = when {
            storyParts.isEmpty() -> "MTF STORY\n4H —  •  1H —  •  15m —"
            storyParts.size == 1 -> "MTF STORY\n" + storyParts[0]
            else -> {
                val first = storyParts.take(3).joinToString("  •  ")
                val remainder = storyParts.drop(3).joinToString("  •  ")
                "MTF STORY\n" + first + if (remainder.isBlank()) "" else "\n" + remainder
            }
        }
        val storyObj = engine?.optJSONObject("market_story")
        val storyBias = storyObj?.optString("bias", "BALANCED") ?: "BALANCED"
        val storySummary = storyObj?.optString("summary", "").orEmpty()
        val wave15Obj = storyObj?.optJSONObject("wave_context")?.optJSONObject("15m")
        val wave1hObj = storyObj?.optJSONObject("wave_context")?.optJSONObject("1h")
        val storyTriggers = storyObj?.optJSONArray("trigger_map")
        val triggerText = if (storyTriggers != null && storyTriggers.length() > 0) {
            (0 until minOf(3, storyTriggers.length())).joinToString(" • ") { storyTriggers.optString(it) }
        } else "Waiting for a confirmed trigger"
        val storyNarrative = storyObj?.optJSONArray("narrative")
        val narrativeText = if (storyNarrative != null && storyNarrative.length() > 0) {
            (0 until minOf(3, storyNarrative.length())).joinToString("\n") { "• " + storyNarrative.optString(it) }
        } else "• Building market narrative from live structure and flow"
        val noTradeReason = storyObj?.optString("no_trade_reason", "").orEmpty()
        val longScore = storyObj?.optInt("long_score", 0) ?: 0
        val shortScore = storyObj?.optInt("short_score", 0) ?: 0

        val mtf15 = wave15Obj?.optString("direction")?.takeUnless { it.isBlank() || it == "UNKNOWN" } ?: f?.optString("trend_15", "UNKNOWN") ?: "UNKNOWN"
        val mtf1h = wave1hObj?.optString("direction")?.takeUnless { it.isBlank() || it == "UNKNOWN" } ?: f?.optString("trend_60", "UNKNOWN") ?: "UNKNOWN"
        val mtf4h = f?.optString("trend_240", "UNKNOWN") ?: "UNKNOWN"
        val regime = f?.optString("regime", "—") ?: "—"
        val structure = f?.optString("market_structure", "—") ?: "—"
        val triggerCompact = triggerText.replace("\n", " ").trim().take(46)
        val marketAside = when {
            !authoritativeFeedHealthy -> "Feed unverified — entries stay on hold."
            signalObj != null -> "Setup in focus. Risk checks call the shots."
            regime.contains("RANGE", ignoreCase = true) -> "Range market? The chart's on a side quest."
            else -> "No FOMO. Clean triggers only."
        }
        features.text =
            "Bias • $storyBias" +
            "\nTrend • 4H $mtf4h / 1H $mtf1h / 15m $mtf15" +
            "\nRegime • $regime / $structure" +
            "\nTrigger • " + (if (triggerCompact.isBlank()) "Waiting for confirmation" else triggerCompact) +
            "\n" + marketAside

        chart.setLivePrice(priceValue)
        if (requestChart) requestChartIfNeeded()
        renderWorkspace(root)
        renderAlertIntelligence(root)
        renderRiskHeat(root)
        animateDecisionState(root)
        applyAdaptiveAmbience(root)
        KyvoriqWidgetProvider.updateFromState(this, root)
    }

    private fun formatClock(timestamp: Long): String = if (timestamp <= 0) "—" else
        java.text.SimpleDateFormat("HH:mm:ss", Locale.US).format(java.util.Date(timestamp))

    private fun renderWorkspace(root: JSONObject) {
        fun money(value: Double, signed: Boolean = false): String =
            if (!value.isFinite()) "—" else String.format(Locale.US, if (signed) "%+.2f" else "%,.2f", value)
        val hideAmounts = getSharedPreferences("kyvoriq_privacy", Context.MODE_PRIVATE)
            .getBoolean("hide_amounts", false)
        fun sensitiveMoney(value: Double, signed: Boolean = false): String =
            if (hideAmounts) "••••" else money(value, signed)
        val execution = root.optJSONObject("execution") ?: JSONObject()
        val summary = execution.optJSONObject("summary") ?: JSONObject()
        val performance = execution.optJSONObject("performance") ?: JSONObject()
        val account = execution.optJSONObject("account") ?: JSONObject()
        val ledger = performance.optJSONObject("ledger") ?: JSONObject()
        val clientStatus = summary.optJSONObject("client_status") ?: JSONObject()
        val positions = clientStatus.optJSONArray("open_positions") ?: JSONArray()
        val decision = execution.optJSONObject("last_decision") ?: JSONObject()
        val unresolved = summary.optInt("unreconciled_entries")
        val unknown = summary.optInt("unknown_submissions")
        val openCount = summary.optInt("open_trades")
        val age = System.currentTimeMillis() - root.optLong("received_ts", 0L)
        val sourceHealthy = root.optString("data_health") == "HEALTHY" && root.optBoolean("ws_connected") &&
            root.optJSONObject("upstream")?.optString("source") == "BITGET_WS" && age in 0L..8000L
        val equity = account.optDouble("equity_usdt", Double.NaN)
        val available = account.optDouble("available_balance_usdt", clientStatus.optDouble("available_balance_usdt", Double.NaN))
        val fillNet = ledger.optDouble("realized_after_fees_usdt", Double.NaN)
        val unrealized = summary.optDouble("unrealized_pnl_usdt", Double.NaN)
        val marginSizing = summary.optJSONObject("margin_sizing")
        val confidenceSized = marginSizing != null && summary.optInt("leverage", 0) > 0
        val leverage = if (confidenceSized) summary.optInt("leverage") else 0
        val mediumMin = marginSizing?.optDouble("medium_min_usdt", Double.NaN) ?: Double.NaN
        val mediumMax = marginSizing?.optDouble("medium_max_usdt", Double.NaN) ?: Double.NaN
        val highMin = marginSizing?.optDouble("high_min_usdt", Double.NaN) ?: Double.NaN
        val highMax = marginSizing?.optDouble("high_max_usdt", Double.NaN) ?: Double.NaN
        positionSummary.text = "EQUITY  ${sensitiveMoney(equity)} USDT\nAvailable  ${sensitiveMoney(available)}  •  Unrealized  ${sensitiveMoney(unrealized, true)}"
        positionSummary.textSize = 15f
        curve.setPoints(ledger.optJSONArray("curve") ?: JSONArray())
        val sizingLine = if (confidenceSized) {
            "Sizing  ${leverage}x  •  MED ${money(mediumMin)}–${money(mediumMax)}  •  HIGH ${money(highMin)}–${money(highMax)} USDT\n" +
                "Entries ${summary.optInt("daily_executions")}/${summary.optInt("daily_cap", 3)} today  •  Planned-loss guard ≤ ${summary.optDouble("max_planned_loss_pct", 2.0)}%\n"
        } else {
            "Legacy backend sizing  •  Risk ≤ ${summary.optDouble("risk_pct", 0.25)}%  •  Entries ${summary.optInt("daily_executions")}/${summary.optInt("daily_cap", 3)} today\n"
        }
        ledgerView.text = "FILLS  ${ledger.optInt("fill_count")}  •  Net ${sensitiveMoney(fillNet, true)} USDT\n" +
            "Fees ${money(ledger.optDouble("fees_usdt", Double.NaN))}  •  Excludes funding / transfers\n" +
            sizingLine +
            (if (ledger.optString("error").isNotBlank() && !ledger.isNull("error")) "Accounting refresh failed; showing last snapshot"
             else if (unknown > 0) "$unknown order submissions await exchange confirmation"
             else if (unresolved > 0) "$unresolved historical entries need attribution"
             else if (!ledger.optBoolean("complete_window", false) || !ledger.optBoolean("fee_accounting_complete", false)) "Fill accounting window is incomplete"
             else "30-day fill accounting  •  Updated ${formatClock(ledger.optLong("window_end_ts"))}")
        ledgerView.setTextColor(if (unresolved > 0) kyAmber else kyGray)
        val positionText = StringBuilder()
        for (i in 0 until positions.length()) {
            val p = positions.optJSONObject(i) ?: continue
            if (positionText.isNotEmpty()) positionText.append("\n\n")
            positionText.append(p.optString("holdSide", "—").uppercase(Locale.US))
                .append("  •  ").append(if (hideAmounts) "••••" else p.optString("total", "—")).append(" BTC")
                .append("\nAverage entry  ").append(money(p.optDouble("openPriceAvg", Double.NaN)))
                .append("\nUnrealized  ").append(sensitiveMoney(p.optDouble("unrealizedPL", Double.NaN), true)).append(" USDT")
        }
        tradeHistory.text = if (positionText.isEmpty()) "No exchange position confirmed.\nEntry checks remain active." else positionText.toString()

        val e = root.optJSONObject("engine") ?: JSONObject()
        val f = root.optJSONObject("features") ?: JSONObject()
        val s = root.optJSONObject("signal")
        val currentDecision = s != null && decision.optString("signal_id").isNotBlank() &&
            decision.optString("signal_id") == s.optString("id")
        val rejection = e.optJSONObject("trade_governor")?.optString("last_quality_rejection").orEmpty()
        val reason = when {
            !sourceHealthy -> "Waiting for healthy, fresh market data."
            unknown > 0 -> "Order response is uncertain. Awaiting exchange confirmation; additional entries are blocked."
            unresolved > 0 -> "Historical partial exits need reconciliation. New exposure is blocked."
            openCount > 0 -> "Existing exchange exposure is being tracked. Additional entries are blocked."
            currentDecision && decision.optString("status") in setOf("SKIPPED", "ERROR") -> decision.optString("reason")
            rejection.isNotBlank() -> rejection
            else -> e.optString("wait_reason", "Scanning for a confirmed setup.")
        }
        val details = StringBuilder("ENTRY STATUS\n$reason\n\n")
        if (decision.optString("status") in setOf("SKIPPED", "ERROR")) {
            details.append("LAST ENTRY ATTEMPT  •  ${formatClock(decision.optLong("ts"))}\n")
                .append("${decision.optString("status")}  •  ${decision.optString("reason")}\n")
                .append("This describes the previous attempt, not a current entry instruction.\n\n")
        }
        val executionPolicy = if (confidenceSized) {
            "One position at a time\n${leverage}x isolated demo leverage\nMedium confidence: ${money(mediumMin)}–${money(mediumMax)} USDT margin\nHigh confidence: ${money(highMin)}–${money(highMax)} USDT margin\n"
        } else {
            "One position at a time\nLegacy backend risk sizing is still active\n"
        }
        details.append("MARKET CONTEXT\n15m ${f.optString("trend_15", "—")}  •  1h ${f.optString("trend_60", "—")}  •  4h ${f.optString("trend_240", "—")}\n")
            .append("${f.optString("regime", "—")}  •  ${f.optString("market_structure", "—")}\n\n")
            .append("EXECUTION POLICY\n").append(executionPolicy)
            .append("Fee-adjusted reward / risk ≥ ${summary.optDouble("min_net_rr", 1.5)}\nPause after 2 consecutive daily losses\nObserved daily equity loss limit 1%\n\n")
            .append("EVIDENCE\nScores rank setups; they are not win probabilities.\n")
        entryChecksFullText = details.toString()
        val entryStatus = when {
            !sourceHealthy -> "DATA NOT FRESH"
            unknown > 0 || unresolved > 0 -> "BLOCKED • RECONCILE"
            openCount > 0 -> "POSITION OPEN"
            else -> "CHECKING"
        }
        decisionView.text =
            "STATUS  •  $entryStatus\n" +
            reason.replace("\n", " ").trim() +
            "\n15m ${f.optString("trend_15", "—")}  •  1h ${f.optString("trend_60", "—")}  •  4h ${f.optString("trend_240", "—")}"
        val reactionMap = e.optJSONObject("level_reactions")
        val reactionTrigger = reactionMap?.optJSONObject("trigger")
        val armedLevels = reactionMap?.optJSONArray("armed")
        val nearestLevel = reactionTrigger ?: armedLevels?.optJSONObject(0)
        val levelState = when {
            reactionTrigger != null -> "READY"
            reactionMap?.optString("status") == "CONFIRMING" -> "CONFIRMING"
            reactionMap?.optString("status") == "ARMED" -> "ARMED"
            else -> "WATCH"
        }
        val activeLevelText = if (nearestLevel != null) {
            val score = nearestLevel.optInt("reaction_score", 0)
            val required = nearestLevel.optInt("required_confirmation_score", reactionMap?.optInt("min_confirmation_score", 3) ?: 3)
            nearestLevel.optString("label", "LEVEL") + "  " +
                String.format(Locale.US, "%,.1f", nearestLevel.optDouble("price", Double.NaN)) +
                "  •  " + nearestLevel.optString("direction", "BOTH") +
                if (score > 0) "  •  $score/$required" else ""
        } else "Waiting for price to approach mapped levels"
        insightContext.text =
            "LEVEL MAP  $levelState\n" +
            activeLevelText +
            "\nCVD  ${f.optString("cvd_price_divergence", "—")}  •  OI5m ${money(f.optDouble("oi_change_5m_pct", Double.NaN), true)}%\n" +
            "Structure  ${f.optString("market_structure", "—")}"
        if (s != null) {
            val direction = s.optString("direction", "WAIT")
            val lifecycle = s.optString("lifecycle", "ACTIVE")
            val resolved = lifecycle in setOf("TARGET_REACHED", "INVALIDATED", "CLOSED", "EXECUTION_FAILED", "RESOLVED", "NOT_EXECUTED")
            val executionStatus = s.optString("execution_status", "CHECKING")
            val entries = execution.optJSONArray("recent_trades") ?: JSONArray()
            val actual = (0 until entries.length()).mapNotNull { entries.optJSONObject(it) }
                .firstOrNull { it.optString("signal_id") == s.optString("id") }
            val filled = actual != null && actual.optString("status") == "OPEN" && actual.optBoolean("actual_fill_confirmed")
            val heading = if (filled) "EXPOSURE OPEN" else if (resolved) "SETUP RESOLVED" else if (openCount > 0 || executionStatus in setOf("SKIPPED", "FAILED")) "SETUP WATCH" else "TRADE SETUP"
            val entry = if (filled) actual!!.optDouble("entry_price", Double.NaN) else s.optDouble("entry", Double.NaN)
            val stop = if (filled) actual!!.optDouble("stop_loss", Double.NaN) else s.optDouble("stop", Double.NaN)
            setTradeSetupText("$heading  •  $direction  •  ${s.optString("trade_style", "SCALP")}\n" +
                "${s.optString("setup")}\n${if (filled) "Fill" else "Plan"} ${money(entry)}  •  Stop ${money(stop)}\n" +
                "TP1 ${money(s.optDouble("target1", Double.NaN))}  •  TP2 ${money(s.optDouble("target2", Double.NaN))}\n" +
                (if (!sourceHealthy || unresolved > 0 || executionStatus in setOf("SKIPPED", "FAILED")) reason
                 else if (resources.configuration.screenHeightDp < 760) ""
                 else "Evidence ${money(s.optDouble("confidence", 0.0) * 100)} / 100  •  Heuristic score"))
        } else {
            setTradeSetupText("NO TRADE  •  ${if (openCount > 0) "EXPOSURE OPEN" else "SCANNING"}\n$reason\n" +
                (if (sourceHealthy && openCount == 0 && unresolved == 0 && unknown == 0)
                    "No FOMO. Clean setups only." else "Tap details for entry checks."))
        }
    }

    private fun setStatusAnimated(value: String) {
        if (!::status.isInitialized) return
        if (value == lastStatusVisualKey) {
            status.text = value
            return
        }
        lastStatusVisualKey = value
        status.animate().cancel()
        if (!KyvoriqTheme.motionEnabled(this) || debugPreview || !status.isShown) {
            status.alpha = 1f; status.translationY = 0f; status.text = value
            return
        }
        status.alpha = 0.45f
        status.translationY = dp(2).toFloat()
        status.text = value
        status.animate()
            .alpha(1f)
            .translationY(0f)
            .setDuration(220L)
            .start()
    }

    private fun decisionVisualKey(root: JSONObject): String {
        val signalObj = root.optJSONObject("signal")
        val execution = root.optJSONObject("execution") ?: JSONObject()
        val recent = execution.optJSONArray("recent_trades") ?: JSONArray()
        if (signalObj == null) return if (execution.optJSONObject("summary")?.optInt("open_trades", 0) ?: 0 > 0) "OPEN" else "WAIT"
        val id = signalObj.optString("id")
        for (i in 0 until recent.length()) {
            val trade = recent.optJSONObject(i) ?: continue
            if (trade.optString("signal_id") != id) continue
            return when (trade.optString("status").uppercase(Locale.US)) {
                "OPEN" -> "OPEN_" + signalObj.optString("direction")
                "ORDER_PENDING" -> "EXECUTING_" + signalObj.optString("direction")
                "CLOSED" -> "CLOSED"
                "FAILED" -> "FAILED"
                else -> "SIGNAL_" + signalObj.optString("direction")
            }
        }
        val lifecycle = signalObj.optString("lifecycle", signalObj.optString("lifecycle_stage", "ACTIVE")).uppercase(Locale.US)
        return when (lifecycle) {
            "TP1_HIT" -> "TP1"
            "TP2_HIT", "TARGET_REACHED" -> "TP2"
            "SL_HIT", "INVALIDATED" -> "SL"
            else -> "SIGNAL_" + signalObj.optString("direction", "WAIT").uppercase(Locale.US)
        }
    }

    private fun animateDecisionState(root: JSONObject) {
        if (!::signal.isInitialized) return
        val key = decisionVisualKey(root)
        if (::decisionMotionView.isInitialized) decisionMotionView.setDecisionState(key)
        if (key == lastDecisionVisualKey) return
        lastDecisionVisualKey = key
        signal.animate().cancel()
        if (!KyvoriqTheme.motionEnabled(this) || debugPreview || !signal.isShown) {
            signal.alpha = 1f; signal.translationY = 0f; signal.scaleX = 1f; signal.scaleY = 1f
            return
        }
        signal.alpha = 0.38f
        signal.translationY = dp(7).toFloat()
        signal.scaleX = 0.985f
        signal.scaleY = 0.985f
        signal.animate()
            .alpha(1f)
            .translationY(0f)
            .scaleX(1f)
            .scaleY(1f)
            .setDuration(320L)
            .start()
    }

    private fun renderAlertIntelligence(root: JSONObject) {
        if (!::alertIntelligenceView.isInitialized) return
        val event = root.optJSONObject("trade_event")
        val eventType = event?.optString("type", "").orEmpty()
        val signalObj = root.optJSONObject("signal")
        val confidence = signalObj?.optDouble("confidence", 0.0) ?: 0.0
        val health = root.optString("data_health", "UNKNOWN")
        val tier = when {
            eventType in setOf("SL_HIT", "EXECUTION_FAILED") -> "CRITICAL"
            health == "DEGRADED" || health == "STALE" -> "CRITICAL"
            eventType in setOf("TP1_HIT", "TP2_HIT", "EXECUTION_PENDING", "EXECUTION_OPEN", "EXECUTION_CLOSED") -> "EXECUTION"
            confidence >= 0.85 -> "PRIORITY"
            signalObj != null -> "INFO"
            else -> "INFO"
        }
        val explanation = when (tier) {
            "CRITICAL" -> "Safety, stop-loss and degraded-feed alerts take priority."
            "EXECUTION" -> "Orders, fills and TP lifecycle use execution-priority feedback."
            "PRIORITY" -> "High-confidence setups use priority notification + haptic routing."
            else -> "No spam. Only updates worth your attention."
        }
        val prefs = getSharedPreferences("kyvoriq_alert_intelligence", Context.MODE_PRIVATE)
        val lastTier = prefs.getString("last_tier", "—") ?: "—"
        val lastTitle = prefs.getString("last_title", "").orEmpty()
        val alertCopy = "Alert priority  •  $tier\n$explanation" +
            (if (lastTitle.isBlank()) "" else "\nLast delivered  •  $lastTier  •  " + lastTitle.take(42))
        val styledAlert = SpannableString(alertCopy)
        val tierAt = alertCopy.indexOf(tier)
        if (tierAt >= 0) styledAlert.setSpan(ForegroundColorSpan(
            if (tier == "CRITICAL") Color.rgb(255, 82, 105) else kyGold
        ), tierAt, tierAt + tier.length, 0)
        alertIntelligenceView.setTextColor(kyWhite)
        alertIntelligenceView.text = styledAlert
    }

    private fun renderRiskHeat(root: JSONObject) {
        if (!::riskHeatMeter.isInitialized || !::riskHeatText.isInitialized) return
        val execution = root.optJSONObject("execution") ?: JSONObject()
        val recent = execution.optJSONArray("recent_trades") ?: JSONArray()
        var openTrade: JSONObject? = null
        for (i in 0 until recent.length()) {
            val row = recent.optJSONObject(i) ?: continue
            if (row.optString("status").uppercase(Locale.US) == "OPEN") {
                openTrade = row
                break
            }
        }
        if (openTrade == null) {
            val summary = execution.optJSONObject("summary") ?: JSONObject()
            val exchangeCount = summary.optInt("exchange_open_positions", 0)
            val syncVerified = summary.optJSONObject("client_status")
                ?.optBoolean("position_sync_verified", false) ?: false
            when {
                exchangeCount > 0 -> {
                    // Never show a falsely reassuring IDLE state just because
                    // the exchange position was opened manually outside KYVORIQ.
                    riskHeatMeter.setRisk(0f, "UNVERIFIED", animate = false)
                    riskHeatText.text = "Bitget Demo: $exchangeCount open exchange position(s) • " +
                        "not attributed to KYVORIQ. Check stops in Bitget."
                    riskHeatText.setTextColor(kyAmber)
                }
                !syncVerified -> {
                    riskHeatMeter.setRisk(0f, "UNKNOWN", animate = false)
                    riskHeatText.text = "Bitget position status unavailable • reconnecting."
                    riskHeatText.setTextColor(kyAmber)
                }
                else -> {
                    riskHeatMeter.setRisk(0f, "IDLE", animate = lastDecisionVisualKey.isNotBlank())
                    riskHeatText.text = "No open demo position • no FOMO, just setups."
                    riskHeatText.setTextColor(kyGray)
                }
            }
            return
        }

        val trade = openTrade
        val direction = trade!!.optString("direction", "LONG").uppercase(Locale.US)
        val entry = trade.optDouble("entry_price", Double.NaN)
        val stop = trade.optDouble("stop_loss", Double.NaN)
        val current = root.optDouble("last_price", Double.NaN)
        val featuresNow = overlayFeatures ?: root.optJSONObject("features") ?: JSONObject()
        val reasons = mutableListOf<String>()
        var score = 0.0

        val initialRisk = kotlin.math.abs(entry - stop)
        if (entry.isFinite() && stop.isFinite() && current.isFinite() && initialRisk > 0.0) {
            val remaining = if (direction == "SHORT") (stop - current) / initialRisk else (current - stop) / initialRisk
            val stopPressure = (1.0 - remaining).coerceIn(0.0, 1.25)
            score += (stopPressure * 55.0).coerceAtMost(65.0)
            when {
                remaining <= 0.20 -> reasons += "Near stop zone"
                remaining <= 0.55 -> reasons += "Stop distance compressed"
            }
        }

        val volatility = featuresNow.optDouble("volatility_pct", Double.NaN)
        if (volatility.isFinite()) {
            if (volatility >= 1.5) { score += 14.0; reasons += "Volatility expanded" }
            else if (volatility >= 1.0) { score += 7.0; reasons += "Volatility elevated" }
        }
        val spread = featuresNow.optDouble("spread_bps", Double.NaN)
        if (spread.isFinite()) {
            if (spread >= 5.0) { score += 10.0; reasons += "Spread widened" }
            else if (spread >= 2.5) { score += 5.0; reasons += "Spread elevated" }
        }
        val cvd = featuresNow.optString("cvd_price_divergence", "NONE").uppercase(Locale.US)
        if ((direction == "LONG" && cvd == "BEARISH") || (direction == "SHORT" && cvd == "BULLISH")) {
            score += 10.0
            reasons += "CVD diverging"
        }
        val structure = featuresNow.optString("market_structure", "").uppercase(Locale.US)
        if ((direction == "LONG" && structure.contains("BEAR")) || (direction == "SHORT" && structure.contains("BULL"))) {
            score += 12.0
            reasons += "Structure against position"
        }
        if (root.optString("data_health") != "HEALTHY") {
            score += 20.0
            reasons += "Feed degraded"
        }

        val finalScore = score.coerceIn(0.0, 100.0)
        val state = when {
            finalScore >= 76 -> "CRITICAL"
            finalScore >= 51 -> "HIGH"
            finalScore >= 26 -> "ELEVATED"
            else -> "SAFE"
        }
        riskHeatMeter.setRisk(finalScore.toFloat(), state)
        riskHeatText.text = if (reasons.isEmpty()) {
            "$direction position  •  conditions remain orderly."
        } else {
            "$direction  •  " + reasons.distinct().take(3).joinToString("  •  ")
        }
        riskHeatText.setTextColor(
            when (state) {
                "CRITICAL" -> Color.rgb(255, 82, 105)
                "HIGH" -> kyAmber
                "ELEVATED" -> kyGold
                else -> Color.rgb(54, 211, 153)
            }
        )
    }

    private fun applyAdaptiveAmbience(root: JSONObject) {
        if (!::rootSurface.isInitialized) return
        val health = root.optString("data_health", "UNKNOWN")
        val direction = root.optJSONObject("signal")?.optString("direction", "").orEmpty().uppercase(Locale.US)
        val openTrades = root.optJSONObject("execution")?.optJSONObject("summary")?.optInt("open_trades", 0) ?: 0
        val key = when {
            health != "HEALTHY" -> "CAUTION"
            openTrades > 0 && direction == "LONG" -> "LONG"
            openTrades > 0 && direction == "SHORT" -> "SHORT"
            direction == "LONG" -> "BULLISH"
            direction == "SHORT" -> "BEARISH"
            else -> "NEUTRAL"
        }
        if (key == lastAmbientKey) return
        lastAmbientKey = key
        val target = when (key) {
            // Market direction must not recolor the monochrome terminal background.
            // Preserve directional meaning in price, trade levels and risk indicators.
            "LONG", "BULLISH" -> Color.rgb(14, 15, 17)
            "SHORT", "BEARISH" -> Color.rgb(15, 14, 17)
            "CAUTION" -> Color.rgb(19, 19, 21)
            else -> KyvoriqTheme.slate
        }
        ambientAnimator?.cancel()
        val start = ambientColor
        ambientAnimator = ValueAnimator.ofObject(ArgbEvaluator(), start, target).apply {
            duration = if (KyvoriqTheme.motionEnabled(this@SafeActivity) && !debugPreview) 420L else 0L
            addUpdateListener {
                ambientColor = it.animatedValue as Int
                rootSurface.background = gradient(
                    intArrayOf(kyCharcoal, ambientColor),
                    GradientDrawable.Orientation.TOP_BOTTOM
                )
            }
            start()
        }
        if (::decisionContainer.isInitialized) {
            decisionContainer.background = KyvoriqTheme.surface(this, prominent = true)

        }
    }

    private fun privacyPrefs() = getSharedPreferences("kyvoriq_privacy", Context.MODE_PRIVATE)

    private fun privacyAuthenticators(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
        } else {
            BiometricManager.Authenticators.BIOMETRIC_WEAK
        }

    private fun canUsePrivacyAuth(): Boolean =
        BiometricManager.from(this).canAuthenticate(privacyAuthenticators()) == BiometricManager.BIOMETRIC_SUCCESS

    private fun enforceInitialPrivacyGate() {
        val enabled = privacyPrefs().getBoolean("biometric_enabled", false)
        privacyAuthenticated = !enabled
        refreshPrivacyButton()
        if (!enabled) return
        rootSurface.visibility = View.INVISIBLE
        requestPrivacyAuthentication(
            title = "Unlock KYVORIQ",
            subtitle = "Authenticate to open your trading workspace.",
            onSuccess = {
                privacyAuthenticated = true
                rootSurface.visibility = View.VISIBLE
                rootSurface.alpha = 0f
                rootSurface.animate().alpha(1f).setDuration(220L).start()
                showLaunchSequence()
                consumeWidgetDestination()
            },
            onFailure = { finishAndRemoveTask() }
        )
    }

    private fun requestPrivacyAuthentication(
        title: String,
        subtitle: String,
        onSuccess: () -> Unit,
        onFailure: () -> Unit = {}
    ) {
        if (!canUsePrivacyAuth()) {
            onFailure()
            showInfoDialog("Privacy Shield", "Biometric or device authentication is not available on this device.")
            return
        }
        if (biometricPromptActive) return
        biometricPromptActive = true
        val prompt = BiometricPrompt(
            this,
            ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    super.onAuthenticationSucceeded(result)
                    biometricPromptActive = false
                    haptic(rootSurface, KyvoriqHaptics.Cue.CONFIRM)
                    onSuccess()
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    super.onAuthenticationError(errorCode, errString)
                    biometricPromptActive = false
                    if (errorCode != BiometricPrompt.ERROR_NEGATIVE_BUTTON &&
                        errorCode != BiometricPrompt.ERROR_USER_CANCELED &&
                        errorCode != BiometricPrompt.ERROR_CANCELED
                    ) {
                        haptic(rootSurface, KyvoriqHaptics.Cue.REJECT)
                    }
                    onFailure()
                }
            }
        )
        val builder = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(privacyAuthenticators())
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) builder.setNegativeButtonText("Cancel")
        prompt.authenticate(builder.build())
    }

    private fun showPrivacyControls() {
        val prefs = privacyPrefs()
        val dialog = android.app.Dialog(this)
        dialog.setCanceledOnTouchOutside(true)

        val sheet = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(10), dp(18), dp(18))
            background = gradient(
                intArrayOf(KyvoriqTheme.surface, kyCharcoal),
                GradientDrawable.Orientation.TL_BR
            ).apply {
                cornerRadius = dp(28).toFloat()
                setStroke(dp(1), kyDeepGold)
            }
        }

        val handle = View(this).apply {
            background = GradientDrawable().apply {
                cornerRadius = dp(3).toFloat()
                setColor(KyvoriqTheme.border)
            }
        }
        sheet.addView(
            handle,
            LinearLayout.LayoutParams(dp(42), dp(4)).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                bottomMargin = dp(14)
            }
        )

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val logoFrame = FrameLayout(this).apply {
            background = gradient(
                intArrayOf(KyvoriqTheme.graphite, KyvoriqTheme.slate),
                GradientDrawable.Orientation.TL_BR
            ).apply {
                cornerRadius = dp(14).toFloat()
                setStroke(dp(1), kyGold)
            }
        }
        logoFrame.addView(
            ImageView(this).apply {
                setImageResource(R.drawable.kyvoriq_mark)
                scaleType = ImageView.ScaleType.CENTER_INSIDE
                contentDescription = "KYVORIQ Privacy Shield"
                setPadding(dp(9), dp(9), dp(9), dp(9))
            },
            FrameLayout.LayoutParams(-1, -1)
        )
        header.addView(logoFrame, LinearLayout.LayoutParams(dp(52), dp(52)))

        val titleStack = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), 0, dp(8), 0)
        }
        titleStack.addView(label("PRIVACY SHIELD", 15.5f, kyWhite, 0.05f))
        titleStack.addView(
            TextView(this).apply {
                text = "Security & privacy controls"
                textSize = 10.5f
                setTextColor(kyGray)
                includeFontPadding = false
            },
            margins(top = 3)
        )
        header.addView(titleStack, LinearLayout.LayoutParams(0, -2, 1f))

        val close = TextView(this).apply {
            text = "×"
            textSize = 24f
            setTextColor(kyGray)
            gravity = Gravity.CENTER
            contentDescription = "Close Privacy Shield"
            background = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
                setColor(kyGraphite)
                setStroke(dp(1), KyvoriqTheme.border)
            }
        }
        header.addView(close, LinearLayout.LayoutParams(dp(42), dp(42)))
        sheet.addView(header)

        val summary = TextView(this).apply {
            textSize = 10.5f
            includeFontPadding = false
            setLineSpacing(0f, 1.08f)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            background = gradient(
                intArrayOf(KyvoriqTheme.graphite, KyvoriqTheme.slate),
                GradientDrawable.Orientation.LEFT_RIGHT
            ).apply {
                cornerRadius = dp(14).toFloat()
                setStroke(dp(1), kyLine)
            }
        }
        sheet.addView(summary, margins(top = 16, bottom = 12))

        fun styleToggle(chip: TextView, active: Boolean) {
            chip.text = if (active) "ON" else "OFF"
            chip.setTextColor(if (active) kyCharcoal else kyGray)
            chip.background = gradient(
                if (active) intArrayOf(kyGold, kyAmber) else intArrayOf(kyGraphite, kySlate),
                GradientDrawable.Orientation.LEFT_RIGHT
            ).apply {
                cornerRadius = dp(13).toFloat()
                setStroke(dp(1), if (active) kyDeepGold else KyvoriqTheme.border)
            }
        }

        fun updateSummary() {
            val biometric = prefs.getBoolean("biometric_enabled", false)
            val hidden = prefs.getBoolean("hide_amounts", false)
            val protection = when {
                biometric && hidden -> "MAX PROTECTION"
                biometric || hidden -> "PROTECTED"
                else -> "STANDARD"
            }
            summary.text = "$protection\n" +
                (if (biometric) "Biometric lock armed" else "Biometric lock off") +
                "  •  " +
                (if (hidden) "Sensitive values hidden" else "Balances visible")
            summary.setTextColor(if (biometric || hidden) kyGold else kyGray)
        }

        fun optionCard(
            iconText: String,
            title: String,
            subtitle: String,
            active: Boolean
        ): Pair<LinearLayout, TextView> {
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(12), dp(12), dp(12), dp(12))
                isClickable = true
                isFocusable = true
                background = gradient(
                    intArrayOf(kySlate, KyvoriqTheme.charcoal),
                    GradientDrawable.Orientation.TL_BR
                ).apply {
                    cornerRadius = dp(18).toFloat()
                    setStroke(dp(1), KyvoriqTheme.border)
                }
            }
            val icon = TextView(this).apply {
                text = iconText
                textSize = 11f
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
                setTextColor(kyGold)
                gravity = Gravity.CENTER
                includeFontPadding = false
                background = GradientDrawable().apply {
                    cornerRadius = dp(13).toFloat()
                    setColor(KyvoriqTheme.graphite)
                    setStroke(dp(1), kyDeepGold)
                }
            }
            card.addView(icon, LinearLayout.LayoutParams(dp(44), dp(44)))

            val copy = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(12), 0, dp(10), 0)
            }
            copy.addView(
                TextView(this).apply {
                    text = title
                    textSize = 12.5f
                    setTextColor(kyWhite)
                    typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
                    includeFontPadding = false
                }
            )
            copy.addView(
                TextView(this).apply {
                    text = subtitle
                    textSize = 9.5f
                    setTextColor(kyGray)
                    maxLines = 2
                    includeFontPadding = false
                    setLineSpacing(0f, 1.05f)
                },
                margins(top = 4)
            )
            card.addView(copy, LinearLayout.LayoutParams(0, -2, 1f))

            val chip = TextView(this).apply {
                textSize = 9.5f
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
                gravity = Gravity.CENTER
                includeFontPadding = false
                setPadding(dp(9), 0, dp(9), 0)
            }
            styleToggle(chip, active)
            card.addView(chip, LinearLayout.LayoutParams(dp(54), dp(30)))
            return card to chip
        }

        val biometricRow = optionCard(
            "BIO",
            "Biometric App Lock",
            "Require fingerprint, face or device authentication before KYVORIQ reveals your workspace.",
            prefs.getBoolean("biometric_enabled", false)
        )
        sheet.addView(biometricRow.first, margins(bottom = 10))

        val hideRow = optionCard(
            "••",
            "Hide Balances & P&L",
            "Mask balances, P&L and sensitive position values across the app and widget.",
            prefs.getBoolean("hide_amounts", false)
        )
        sheet.addView(hideRow.first, margins(bottom = 14))

        val note = TextView(this).apply {
            text = "Settings save instantly. KYVORIQ never receives or stores your biometric template."
            textSize = 8.8f
            setTextColor(KyvoriqTheme.muted)
            includeFontPadding = false
            gravity = Gravity.CENTER_HORIZONTAL
        }
        sheet.addView(note, margins(bottom = 14))

        val done = KyvoriqButton(this).apply {
            text = "DONE"
            textSize = 11.5f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            setTextColor(kyCharcoal)
            isAllCaps = false
            stateListAnimator = null
            minHeight = 0
            minWidth = 0
            background = gradient(
                intArrayOf(kyGold, kyAmber),
                GradientDrawable.Orientation.LEFT_RIGHT
            ).apply {
                cornerRadius = dp(15).toFloat()
                setStroke(dp(1), kyDeepGold)
            }
        }
        sheet.addView(done, LinearLayout.LayoutParams(-1, dp(48)))

        fun dismissPremiumSheet() {
            haptic(done, KyvoriqHaptics.Cue.TAP)
            sheet.animate().cancel()
            sheet.animate()
                .alpha(0f)
                .translationY(dp(34).toFloat())
                .setDuration(if (KyvoriqTheme.motionEnabled(this)) 150L else 0L)
                .withEndAction { if (dialog.isShowing) dialog.dismiss() }
                .start()
        }

        close.setOnClickListener { dismissPremiumSheet() }
        done.setOnClickListener {
            haptic(it, KyvoriqHaptics.Cue.CONFIRM)
            sheet.animate().cancel()
            sheet.animate()
                .alpha(0f)
                .translationY(dp(34).toFloat())
                .setDuration(if (KyvoriqTheme.motionEnabled(this)) 150L else 0L)
                .withEndAction { if (dialog.isShowing) dialog.dismiss() }
                .start()
        }

        biometricRow.first.setOnClickListener {
            haptic(it, KyvoriqHaptics.Cue.SELECT)
            val currentlyEnabled = prefs.getBoolean("biometric_enabled", false)
            requestPrivacyAuthentication(
                title = if (currentlyEnabled) "Disable Privacy Lock" else "Enable Privacy Lock",
                subtitle = "Confirm this security change.",
                onSuccess = {
                    val next = !currentlyEnabled
                    prefs.edit().putBoolean("biometric_enabled", next).apply()
                    privacyAuthenticated = true
                    styleToggle(biometricRow.second, next)
                    updateSummary()
                    refreshPrivacyButton()
                    Toast.makeText(
                        this,
                        if (next) "Biometric lock enabled" else "Biometric lock disabled",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            )
        }

        hideRow.first.setOnClickListener {
            haptic(it, KyvoriqHaptics.Cue.SELECT)
            val next = !prefs.getBoolean("hide_amounts", false)
            prefs.edit().putBoolean("hide_amounts", next).apply()
            styleToggle(hideRow.second, next)
            updateSummary()
            refreshPrivacyButton()
            latestRoot?.let {
                renderWorkspace(it)
                KyvoriqWidgetProvider.updateFromState(this, it)
            }
        }

        updateSummary()
        dialog.setContentView(sheet)
        dialog.window?.apply {
            setBackgroundDrawableResource(android.R.color.transparent)
            addFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            attributes = attributes.apply { dimAmount = 0.76f }
            setGravity(Gravity.BOTTOM)
        }
        dialog.setOnShowListener {
            dialog.window?.apply {
                setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                decorView.setPadding(dp(14), 0, dp(14), dp(18))
            }
            sheet.alpha = 0f
            sheet.translationY = dp(48).toFloat()
            sheet.scaleX = 0.985f
            sheet.scaleY = 0.985f
            sheet.animate()
                .alpha(1f)
                .translationY(0f)
                .scaleX(1f)
                .scaleY(1f)
                .setDuration(if (KyvoriqTheme.motionEnabled(this)) 280L else 0L)
                .setInterpolator(android.view.animation.PathInterpolator(0.18f, 0.82f, 0.20f, 1f))
                .start()
        }
        dialog.show()
    }

    private fun refreshPrivacyButton() {
        if (!::privacyButton.isInitialized) return
        val prefs = privacyPrefs()
        val enabled = prefs.getBoolean("biometric_enabled", false)
        val hidden = prefs.getBoolean("hide_amounts", false)
        privacyButton.text = when {
            enabled && hidden -> "PRIVACY • LOCKED"
            enabled -> "PRIVACY • ON"
            hidden -> "PRIVACY • HIDDEN"
            else -> "PRIVACY"
        }
    }

    private fun requestHomeWidgetPin() {
        val manager = AppWidgetManager.getInstance(this)
        val provider = ComponentName(this, KyvoriqWidgetProvider::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.isRequestPinAppWidgetSupported) {
            val requested = manager.requestPinAppWidget(provider, null, null)
            if (requested) {
                haptic(widgetButton, KyvoriqHaptics.Cue.CONFIRM)
                widgetButton.text = "WIDGET REQUESTED"
                handler.postDelayed({ if (::widgetButton.isInitialized) widgetButton.text = "ADD WIDGET" }, 2200L)
            } else {
                haptic(widgetButton, KyvoriqHaptics.Cue.REJECT)
                showInfoDialog("KYVORIQ Widget", "Your launcher did not accept the pin request. Add KYVORIQ from the Android widget picker.")
            }
        } else {
            showInfoDialog("KYVORIQ Widget", "Add KYVORIQ from your launcher’s widget picker.")
        }
    }

    private fun chartOverlays(root: JSONObject?): JSONArray {
        val out = JSONArray()
        val prices = mutableListOf<Double>()

        fun add(
            kind: String,
            label: String,
            price: Double,
            status: String = "",
            direction: String = "",
            playedAtMs: Long = 0L,
            hideAfterMs: Long = 0L,
            reaction: String = "",
            zoneLow: Double = Double.NaN,
            zoneHigh: Double = Double.NaN,
            source: String = "",
            manual: Boolean = false,
            packId: String = "",
            priority: Int = 0,
            estimated: Boolean = false,
            reactionScore: Int = 0,
            tappedAtMs: Long = 0L
        ) {
            if (!price.isFinite() || price <= 0.0) return
            if (prices.any { kotlin.math.abs(it - price) / kotlin.math.max(price, 1.0) < 0.00010 }) return
            if (out.length() >= 48) return
            prices.add(price)
            val item = JSONObject()
                .put("kind", kind).put("label", label).put("price", price)
                .put("status", status).put("direction", direction)
            if (playedAtMs > 0L) item.put("played_at_ms", playedAtMs)
            if (hideAfterMs > 0L) item.put("hide_after_ms", hideAfterMs)
            if (tappedAtMs > 0L) item.put("tapped_at_ms", tappedAtMs)
            if (reaction.isNotBlank()) item.put("reaction", reaction)
            if (zoneLow.isFinite() && zoneHigh.isFinite() && zoneLow > 0.0 && zoneHigh > 0.0) {
                item.put("zone_low", minOf(zoneLow, zoneHigh))
                item.put("zone_high", maxOf(zoneLow, zoneHigh))
            }
            if (source.isNotBlank()) item.put("source", source)
            if (manual) item.put("manual", true)
            if (packId.isNotBlank()) item.put("pack_id", packId)
            if (priority > 0) item.put("priority", priority)
            if (estimated) item.put("estimated", true)
            if (reactionScore > 0) item.put("reaction_score", reactionScore)
            out.put(item)
        }

        root?.optJSONArray("chart_overlays")?.let { arr ->
            for (i in 0 until arr.length()) {
                val row = arr.optJSONObject(i) ?: continue
                // Ignore stale server manual level map, never re-add retired Oct 7 levels.
                if (row.optString("pack_id", "") == "dewald_levels_2026_10_07") continue
                add(
                    row.optString("kind", "LEVEL"),
                    row.optString("label", row.optString("kind", "LEVEL")),
                    row.optDouble("price", Double.NaN),
                    row.optString("status", ""),
                    row.optString("direction", ""),
                    row.optLong("played_at_ms", 0L),
                    row.optLong("hide_after_ms", 0L),
                    row.optString("reaction", ""),
                    row.optDouble("zone_low", Double.NaN),
                    row.optDouble("zone_high", Double.NaN),
                    row.optString("source", ""),
                    row.optBoolean("manual", false),
                    row.optString("pack_id", ""),
                    row.optInt("priority", 0),
                    row.optBoolean("estimated", false),
                    row.optInt("reaction_score", 0),
                    row.optLong("tapped_at_ms", 0L)
                )
            }
        }

        // Do not embed private manual trading prices into a publicly downloadable
        // Android APK. The authenticated KYVORIQ backend is the authoritative map.
        // When the backend is unavailable, show no stale hardcoded manual references.

        val engine = root?.optJSONObject("engine")
        val sfp = overlayStrategy?.optJSONObject("sfp_hunter") ?: engine?.optJSONObject("sfp_hunter")
        add("SFP","SFP",sfp?.optDouble("target_level", Double.NaN) ?: Double.NaN,
            sfp?.optString("status","WATCH") ?: "WATCH",sfp?.optString("direction","") ?: "")
        val dline = overlayStrategy?.optJSONObject("setups")?.optJSONObject("D-Line")
        add("DLINE","D-LINE",dline?.optDouble("projected_line",Double.NaN) ?: Double.NaN,
            dline?.optString("status","") ?: "",dline?.optString("direction","") ?: "")

        val blocks = overlayFeatures?.optJSONObject("order_blocks")
        val obLabels = linkedMapOf("15m" to "15M OB","1h" to "1H OB","4h" to "4H OB","1D" to "1D OB","2D" to "2D OB")
        if (blocks != null) {
            obLabels.forEach { (tf,label) ->
                val detail = blocks.optJSONObject(tf) ?: return@forEach
                val rawDirection = detail.optString("direction","NONE")
                add("OB",label,detail.optDouble("mid",Double.NaN),"",rawDirection,
                    zoneLow=detail.optDouble("zone_low",Double.NaN),zoneHigh=detail.optDouble("zone_high",Double.NaN))
            }
        }
        val volume=overlayFeatures?.optJSONObject("volume_context")
        if (volume?.optBoolean("exact_npoc",false)==true) add("NPOC","NPOC",volume.optDouble("untouched_poc",Double.NaN),"UNTOUCHED")
        add("DAILY","D HIGH",overlayFeatures?.optDouble("previous_day_high",Double.NaN) ?: Double.NaN)
        add("DAILY","D LOW",overlayFeatures?.optDouble("previous_day_low",Double.NaN) ?: Double.NaN)
        add("WEEKLY_OPEN","W OPEN",overlayFeatures?.optDouble("weekly_open",Double.NaN) ?: Double.NaN)
        return out
    }

    private fun requestChartOverlays(force: Boolean = false) {
        // Structural overlays, owner levels and strategy context are private.
        if (publicMarketOnly || !KyvoriqSecureSession.isPaired(this)) return
        val now = System.currentTimeMillis()
        if (!force && now - lastOverlayRequestMs < 15_000L) return
        lastOverlayRequestMs = now

        fun apply() {
            if (::chart.isInitialized) chart.setOverlays(chartOverlays(latestRoot))
        }

        // Refresh structural context frequently enough for played levels to
        // disappear within their 15m/30m lifecycle without disturbing price ticks.
        getJson(backendBase + "/features") { ok, body ->
            handler.post {
                if (ok) safe {
                    overlayFeatures = JSONObject(body)
                    apply()
                }
            }
        }
        getJson(backendBase + "/strategy") { ok, body ->
            handler.post {
                if (ok) safe {
                    overlayStrategy = JSONObject(body)
                    apply()
                }
            }
        }
    }

    private fun requestChartIfNeeded(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && chartRequestInFlight) return
        if (!force && now - lastChartRequestMs < 30_000L) return

        lastChartRequestMs = now
        chartRequestInFlight = true
        val requestTf = selectedTf
        val token = ++chartRequestToken

        getJson(backendBase + "/chart?interval=" + requestTf) { ok, body ->
            handler.post {
                if (token == chartRequestToken) {
                    chartRequestInFlight = false
                }
                if (!ok || token != chartRequestToken) return@post

                safe {
                    val j = JSONObject(body)
                    val candles = j.optJSONArray("candles") ?: JSONArray()
                    val live = if (publicMarketOnly) Double.NaN
                        else latestRoot?.optDouble("last_price", Double.NaN) ?: Double.NaN
                    val lastPrice = if (!live.isNaN()) live else j.optDouble("last_price", Double.NaN)

                    // Never let an older timeframe response overwrite the
                    // currently selected timeframe.
                    if (selectedTf != requestTf) return@safe

                    chart.setTimeframe(requestTf)
                    if (publicMarketOnly && (candles.length() == 0 || !lastPrice.isFinite() || lastPrice <= 0.0)) {
                        status.text = "NO PUBLIC DATA"
                        publicMarketMessage?.text = "PUBLIC BTC DATA UNAVAILABLE • Tap RETRY to fetch fresh candles. No private access has been granted."
                        return@safe
                    }
                    latestChartCandles = candles
                    chart.setData(
                        candles,
                        latestRoot?.optJSONObject("signal"),
                        calculateEma(candles, 50),
                        lastPrice,
                        if (publicMarketOnly) JSONArray() else chartOverlays(latestRoot)
                    )
                    if (publicMarketOnly) {
                        price.setPrice(lastPrice, animate = false)
                        oiView.text = "OI  —  •  PRIVATE"
                        status.text = "VIEW ONLY"
                        integrity.text = "PUBLIC BTC CANDLES • VIEW ONLY • NO PRIVATE TRADING"
                        publicMarketMessage?.text = "PUBLIC BTC CHART • VIEW ONLY\nPrivate signals and account tools require owner-approved pairing."
                        publicMarketMessage?.visibility = View.VISIBLE
                        chart.setFeedHealthy(false)
                        chart.setSignal(null)
                    }
                    refreshTimeframeButtonsForCurrentSelection()
                    if (!publicMarketOnly) requestChartOverlays(force)
                }
            }
        }
    }

    private var timeframeButtonRow: LinearLayout? = null

    private fun refreshTimeframeButtonsForCurrentSelection() {
        timeframeButtonRow?.let { refreshTimeframeButtons(it) }
    }

    private fun renderChartFromState() {
        requestChartIfNeeded(true)
    }

    private fun calculateEma(candles: JSONArray, period: Int): Double? {
        if (candles.length() == 0) return null
        val alpha = 2.0 / (period + 1.0)
        var value = candles.optJSONObject(0)?.optDouble("close") ?: return null
        for (i in 1 until candles.length()) {
            val close = candles.optJSONObject(i)?.optDouble("close") ?: continue
            value = alpha * close + (1.0 - alpha) * value
        }
        return value
    }

    private fun numberField(hint: String, value: String): EditText {
        return EditText(this).apply {
            this.hint = hint
            setText(value)
            textSize = 15f
            setTextColor(kyWhite)
            setHintTextColor(kyGray)
            minHeight = dp(48)
            setSingleLine(true)
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            setPadding(dp(12), 0, dp(12), 0)
            background = gradient(
                intArrayOf(kySlate, kyCharcoal),
                GradientDrawable.Orientation.LEFT_RIGHT
            ).apply {
                cornerRadius = dp(14).toFloat()
                setStroke(dp(1), kyGraphite)
            }
        }
    }

    private fun ensureChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(
                "dev_trader_signals",
                "KYVORIQ Signals",
                NotificationManager.IMPORTANCE_HIGH
            )
        )
    }

    private fun startBackgroundAlerts() {
        if (publicMarketOnly || !KyvoriqSecureSession.isPaired(this)) {
            alertsButton.text = compactHeaderLabel("PRIVATE")
            alertsButton.isEnabled = true
            return
        }
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            alertsButton.text = compactHeaderLabel("ALLOW ALERTS")
            alertsButton.isEnabled = true
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4101)
            return
        }
        runCatching {
            ContextCompat.startForegroundService(this, Intent(this, SignalService::class.java))
            alertsButton.text = compactHeaderLabel("ALERTS ON")
            alertsButton.isEnabled = false
        }.onFailure {
            alertsButton.text = compactHeaderLabel("ALERTS RETRY")
            alertsButton.isEnabled = true
        }
    }

    private fun requestAlertPermission() {
        if (publicMarketOnly || !KyvoriqSecureSession.isPaired(this)) {
            showPublicAccessInfo()
            return
        }
        startBackgroundAlerts()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 4101) {
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED || Build.VERSION.SDK_INT < 33) {
                startBackgroundAlerts()
            } else {
                alertsButton.text = compactHeaderLabel("ALLOW ALERTS")
                alertsButton.isEnabled = true
            }
        }
    }

    private fun sendLocalSignalAlert(signalObj: JSONObject) {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val notification = NotificationCompat.Builder(this, "dev_trader_signals")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(
                marketAssetAccent("BTC " + signalObj.optString("direction") + " • " +
                    signalObj.optString("setup"))
            )
            .setContentText(
                "Entry " + String.format(Locale.US, "%.2f", signalObj.optDouble("entry")) +
                    " • SL " + String.format(Locale.US, "%.2f", signalObj.optDouble("stop")) +
                    " • RR " + String.format(Locale.US, "%.2f", signalObj.optDouble("rr"))
            )
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
        getSystemService(NotificationManager::class.java).notify(2001, notification)
    }

    private fun watchdog() {
        if (stopped) return
        if (publicMarketOnly || !KyvoriqSecureSession.isPaired(this)) {
            enterPublicMarketMode()
            requestChartIfNeeded()
            if (privateRouteFallback && KyvoriqSecureSession.isPaired(this) &&
                System.currentTimeMillis() - lastPrivateRouteProbeMs >= 12_000L) {
                lastPrivateRouteProbeMs = System.currentTimeMillis()
                bootstrap(force = true)
            }
            return
        }
        val now = System.currentTimeMillis()
        val stateAge = if (lastStateReceivedMs == 0L) Long.MAX_VALUE
            else now - lastStateReceivedMs
        val socketAge = if (lastSocketActivityMs == 0L) Long.MAX_VALUE
            else now - lastSocketActivityMs

        // HTTP bootstrap is the hard fallback. Do not label the UI DATA RECOVERY
        // merely because WebSocket messages are momentarily quiet: a successful
        // HTTP snapshot is a valid live market state.
        if (stateAge > 5000L) {
            val bootstrapFresh = lastBootstrapSuccessMs > 0L && now - lastBootstrapSuccessMs <= 10_000L
            if (!bootstrapFresh && lastHardHttpStatus == null) {
                integrity.text = "Feed  •  REFRESHING •  HTTP SNAPSHOT"
            }
            bootstrap(false)
        }

        // Do not tear down a healthy REST-backed market feed merely because
        // the WebSocket has been quiet. Rebuild the socket only when the actual
        // market state is stale; this prevents the reconnect loop from fighting
        // the HTTP fallback after Android resumes from background.
        if (stateAge > 12000L &&
            (lastBootstrapSuccessMs == 0L || now - lastBootstrapSuccessMs > 10_000L) &&
            socketAge > 15000L &&
            now - lastSocketRebuildMs > 10000L
        ) {
            lastSocketRebuildMs = now
            integrity.text = "Feed  •  STALE •  REBUILDING WEBSOCKET"
            if (lastHardHttpStatus == null) status.text = "RECONNECTING…"
            reconnect(immediate = true)
        }

        handler.postDelayed(healthWatchdogRunnable, 2000L)
    }

    private fun showPnlCalculator() {
        calculatorBack.isEnabled = true
        val scroll = ScrollView(this).apply {
            setBackgroundColor(kyCharcoal)
            isFillViewport = true
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(18), dp(16), dp(30))
            background = gradient(
                intArrayOf(kyCharcoal, KyvoriqTheme.slate, KyvoriqTheme.graphite, kyCharcoal),
                GradientDrawable.Orientation.TL_BR
            )
        }
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            root.setPadding(dp(16), bars.top + dp(10), dp(16), bars.bottom + dp(24))
            insets
        }
        scroll.addView(root)
        setContentView(scroll)

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val back = actionButton("‹").apply {
            contentDescription = "Back to trading workspace"
            minWidth = dp(48)
            minHeight = dp(44)
            textSize = 24f
            setOnClickListener {
                haptic(it, KyvoriqHaptics.Cue.TAP)
                returnToDashboard()
            }
        }
        header.addView(back, LinearLayout.LayoutParams(dp(52), dp(46)))
        header.addView(
            label("P&L calculator", 23f, kyGold, 0f),
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { leftMargin = dp(10) }
        )
        root.addView(header, margins(bottom = 16))

        root.addView(label("POSITION ESTIMATE", 10f, kyAmber, 0.12f), margins(bottom = 8))
        root.addView(label("BTCUSDT Perpetual  •  USDT settlement", 14f, kyGray, 0f), margins(bottom = 14))

        var direction = "LONG"
        var unitMode = "COST"
        var leverage = 20

        val sideRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val longButton = actionButton("LONG")
        val shortButton = actionButton("SHORT")
        fun refreshSides() {
            listOf(longButton to "LONG", shortButton to "SHORT").forEach { (button, side) ->
                button.isSelected = direction == side
                button.background = KyvoriqTheme.button(this, direction == side)
                button.setTextColor(if (direction == side) kyCharcoal else kyGold)
            }
        }
        longButton.setOnClickListener {
            if (direction != "LONG") haptic(it, KyvoriqHaptics.Cue.SELECT)
            direction = "LONG"
            refreshSides()
        }
        shortButton.setOnClickListener {
            if (direction != "SHORT") haptic(it, KyvoriqHaptics.Cue.SELECT)
            direction = "SHORT"
            refreshSides()
        }
        sideRow.addView(longButton, LinearLayout.LayoutParams(0, dp(52), 1f).apply { rightMargin = dp(4) })
        sideRow.addView(shortButton, LinearLayout.LayoutParams(0, dp(52), 1f).apply { leftMargin = dp(4) })
        root.addView(sideRow, margins(bottom = 14))
        refreshSides()

        root.addView(label("UNIT SETTINGS", 11f, kyGray, 0.08f), margins(bottom = 7))
        val amountLabel = label("Position Cost (USDT)", 12f, kyGray, 0f)
        root.addView(amountLabel, margins(bottom = 5))
        val amountEdit = numberField("Cost / Quantity", "100")
        root.addView(amountEdit, margins(bottom = 12))

        val unitRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val quantityButton = actionButton("QUANTITY / BTC")
        val costButton = actionButton("POSITION COST / USDT")
        fun refreshUnits() {
            listOf(quantityButton to "QUANTITY", costButton to "COST").forEach { (button, unit) ->
                button.isSelected = unitMode == unit
                button.background = KyvoriqTheme.button(this, unitMode == unit)
                button.setTextColor(if (unitMode == unit) kyCharcoal else kyGold)
            }
        }
        quantityButton.setOnClickListener {
            if (unitMode != "QUANTITY") haptic(it, KyvoriqHaptics.Cue.SELECT)
            unitMode = "QUANTITY"
            refreshUnits()
            amountLabel.text = "Quantity (BTC)"
            amountEdit.hint = "e.g. 0.01"
        }
        costButton.setOnClickListener {
            if (unitMode != "COST") haptic(it, KyvoriqHaptics.Cue.SELECT)
            unitMode = "COST"
            refreshUnits()
            amountLabel.text = "Position Cost (USDT)"
            amountEdit.hint = "e.g. 100"
        }
        unitRow.addView(quantityButton, LinearLayout.LayoutParams(0, dp(52), 1f).apply { rightMargin = dp(4) })
        unitRow.addView(costButton, LinearLayout.LayoutParams(0, dp(52), 1f).apply { leftMargin = dp(4) })
        root.addView(unitRow, margins(bottom = 14))
        refreshUnits()

        val livePrice = latestRoot?.optDouble("last_price", Double.NaN) ?: Double.NaN
        val defaultPrice = if (livePrice.isFinite()) String.format(Locale.US, "%.2f", livePrice) else ""
        val openEdit = numberField("Open Price", defaultPrice)
        val closeEdit = numberField("Closing Price", defaultPrice)
        root.addView(label("Open Price (USDT)", 12f, kyGray, 0f), margins(bottom = 5))
        root.addView(openEdit, margins(bottom = 12))
        root.addView(label("Closing Price (USDT)", 12f, kyGray, 0f), margins(bottom = 5))
        root.addView(closeEdit, margins(bottom = 14))

        val leverageLabel = label("Leverage  •  20x", 12f, kyGray, 0f)
        root.addView(leverageLabel, margins(bottom = 4))
        val leverageBar = SeekBar(this).apply { max = 149; progress = 19; splitTrack = false }
        var lastLeverageHaptic = leverage
        leverageBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                leverage = progress + 1
                leverageLabel.text = "Leverage  •  " + leverage + "x"
                if (fromUser && (leverage == 20 || leverage == 50 || leverage == 100 || kotlin.math.abs(leverage - lastLeverageHaptic) >= 5)) {
                    KyvoriqHaptics.frequentTick(seekBar)
                    lastLeverageHaptic = leverage
                }
            }
            override fun onStartTrackingTouch(seekBar: SeekBar?) {
                haptic(seekBar, KyvoriqHaptics.Cue.DRAG_START)
            }
            override fun onStopTrackingTouch(seekBar: SeekBar?) {
                haptic(seekBar, KyvoriqHaptics.Cue.DRAG_END)
            }
        })
        root.addView(leverageBar, margins(bottom = 16))

        val resultsCard = card("RESULTS", "Margin  —\nP&L  — USDT\nROI  —\nPrice Move  —", 15f)
        root.addView(resultsCard.container, margins(bottom = 10))
        val results = resultsCard.value

        val calcButton = actionButton("CALCULATE P&L").apply {
            background = KyvoriqTheme.button(this@SafeActivity, true)
            setTextColor(kyCharcoal)
        }
        calcButton.setOnClickListener {
            safe {
                val amount = amountEdit.text.toString().toDoubleOrNull()
                val entry = openEdit.text.toString().toDoubleOrNull()
                val exit = closeEdit.text.toString().toDoubleOrNull()
                if (amount == null || amount <= 0 || entry == null || entry <= 0 || exit == null || exit <= 0 || leverage <= 0) {
                    haptic(calcButton, KyvoriqHaptics.Cue.REJECT)
                    results.text = "Enter a valid position size/cost and both prices."
                    return@safe
                }
                val priceMove = if (direction == "LONG") exit - entry else entry - exit
                val margin = if (unitMode == "COST") amount / 1.0015 else (amount * entry) / leverage.toDouble()
                val notional = if (unitMode == "COST") margin * leverage.toDouble() else amount * entry
                val qty = if (unitMode == "COST") notional / entry else amount
                val pnl = qty * priceMove
                val roi = if (margin > 0) pnl / margin * 100.0 else 0.0
                val pnlSign = if (pnl > 0) "+" else ""
                val movePct = priceMove / entry * 100.0
                results.text =
                    "Margin  " + String.format(Locale.US, "%.2f USDT", margin) +
                    "\nP&L  " + pnlSign + String.format(Locale.US, "%.2f USDT", pnl) +
                    "\nROI  " + pnlSign + String.format(Locale.US, "%.2f%%", roi) +
                    "\nPrice Move  " + pnlSign + String.format(Locale.US, "%.2f%%", movePct) +
                    "\nQuantity  " + String.format(Locale.US, "%.6f BTC", qty) +
                    "\nNotional  " + String.format(Locale.US, "%.2f USDT", notional)
                haptic(calcButton, KyvoriqHaptics.Cue.CONFIRM)
            }
        }
        root.addView(calcButton, margins(bottom = 14))

        root.addView(label(
            "Note  •  Cost mode treats the entered amount as position margin and scales notional by leverage. A 0.15% reserve is applied. Actual fees, funding and slippage can differ.",
            12f, kyGray, 0f
        ), margins(bottom = 10))
    }


    private fun loadTradeHistory() {
        getJson(backendBase + "/trades?limit=20") { ok, body ->
            handler.post {
                if (!ok) {
                    tradeHistory.text = "Bitget Demo history unavailable."
                    fullTradeHistoryText = tradeHistory.text.toString()
                    return@post
                }
                safe {
                    val root = JSONObject(body)
                    val summary = root.optJSONObject("summary") ?: JSONObject()
                    val ready = summary.optBoolean("ready", false)
                    val configured = summary.optBoolean("configured", false)
                    val clientStatus = summary.optJSONObject("client_status") ?: JSONObject()
                    val clientReason = clientStatus.optString(
                        "reason",
                        clientStatus.optString("readiness_reason", "")
                    )
                    val total = summary.optInt("trades", 0)
                    val wins = summary.optInt("wins", 0)
                    val losses = summary.optInt("losses", 0)
                    val winRate = summary.optDouble("win_rate", Double.NaN)
                    val totalNet = summary.optDouble("total_net_profit_usdt", 0.0)
                    val openTrades = summary.optInt("open_trades", 0)

                    if (!configured) {
                        val text = "NOT CONFIGURED\nBitget Demo credentials required."
                        tradeHistory.text = text
                        fullTradeHistoryText = text
                        return@safe
                    }

                    val demoState = when {
                        ready -> "READY"
                        clientReason.contains("40099") ||
                            clientReason.contains("exchange environment is incorrect", ignoreCase = true) ->
                            "WRONG ENVIRONMENT"
                        clientReason.contains("credentials", ignoreCase = true) ->
                            "CREDENTIALS ISSUE"
                        clientReason.contains("balance", ignoreCase = true) ->
                            "BALANCE CHECK ISSUE"
                        else -> "CONNECTION ISSUE"
                    }

                    val summaryLine =
                        "BITGET DEMO  •  $demoState\n" +
                        "Open $openTrades  •  Closed $total  •  W $wins / L $losses\n" +
                        "Win " + if (winRate.isNaN()) "—" else String.format(Locale.US, "%.1f%%", winRate * 100.0) +
                        "  •  Net " + String.format(Locale.US, "%+.2f USDT", totalNet)

                    val rows = root.optJSONArray("trades") ?: JSONArray()
                    val full = StringBuilder(summaryLine)
                    val preview = StringBuilder(summaryLine)

                    val count = minOf(10, rows.length())
                    for (i in 0 until count) {
                        val t = rows.optJSONObject(i) ?: continue
                        val direction = t.optString("direction", "—")
                        val setup = t.optString("setup", "BITGET DEMO")
                        val status = t.optString("status", "—")
                        val entry = t.optDouble("entry_price", t.optDouble("entry_plan", Double.NaN))
                        val exit = t.optDouble("exit_price", Double.NaN)
                        val sl = t.optDouble("stop_loss", Double.NaN)
                        val tp = t.optDouble("take_profit", Double.NaN)
                        val qty = t.optDouble("filled_qty", t.optDouble("requested_qty", Double.NaN))
                        val plannedMargin = t.optDouble("planned_margin_usdt", Double.NaN)
                        val tradeLeverage = t.optInt("leverage", 20)
                        val confidenceBand = t.optString("confidence_band", "")
                        val pnl = t.optDouble("net_profit_usdt", 0.0)
                        val resultR = t.optDouble("result_r", Double.NaN)
                        val reason = t.optString("close_reason", "")
                        val sign = if (pnl >= 0) "+" else ""
                        val block = StringBuilder()
                            .append("\n\n")
                            .append(direction).append(" • ").append(status).append(" • ").append(setup)
                            .append("\nEntry ").append(formatCompact(entry))
                            .append("   Exit ").append(
                                if (status == "CLOSED" && exit.isFinite() && exit > 0) formatCompact(exit) else "—"
                            )
                            .append("\nSL ").append(formatCompact(sl))
                            .append("   TP ").append(formatCompact(tp))
                            .append("\nQty ").append(if (qty.isFinite()) String.format(Locale.US, "%.6f", qty) else "—")
                            .append(if (plannedMargin.isFinite()) "   Margin " + String.format(Locale.US, "%.2f", plannedMargin) + " @ " + tradeLeverage + "x" else "")
                            .append(if (confidenceBand.isNotBlank()) "   " + confidenceBand else "")
                            .append("\nP&L ").append(sign).append(String.format(Locale.US, "%.2f", pnl))
                            .append("   R ").append(if (resultR.isFinite()) String.format(Locale.US, "%.2f", resultR) else "—")
                        if (reason.isNotBlank()) block.append("\nClose ").append(reason)
                        full.append(block)
                        if (i < 2) preview.append(block)
                    }

                    if (rows.length() == 0) {
                        full.append("\n\nNo executed demo trades yet.")
                    }

                    fullTradeHistoryText = full.toString()
                    latestRoot?.let { renderWorkspace(it) }
                }
            }
        }
    }

    private fun showInfoDialog(title: String, body: String) {
        val content = TextView(this).apply {
            text = body
            textSize = 12f
            setTextColor(kyWhite)
            setPadding(dp(18), dp(14), dp(18), dp(14))
            setLineSpacing(0f, 1.12f)
        }
        val dialog = android.app.AlertDialog.Builder(this)
            .setTitle(title)
            .setView(ScrollView(this).apply { addView(content) })
            .setPositiveButton("CLOSE", null)
            .create()
        dialog.setOnShowListener {
            dialog.window?.setBackgroundDrawable(
                GradientDrawable().apply {
                    setColor(kySlate)
                    cornerRadius = dp(18).toFloat()
                    setStroke(dp(1), kyLine)
                }
            )
            dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE)?.setTextColor(kyGold)
        }
        dialog.show()
        dialog.window?.setLayout((resources.displayMetrics.widthPixels * 0.94).toInt(), (resources.displayMetrics.heightPixels * 0.80).toInt())
    }

    private fun formatCompact(value: Double): String =
        if (value.isFinite() && value > 0) String.format(Locale.US, "%.2f", value) else "—"

    private fun journalPrefs() =
        getSharedPreferences("dev_trader_journal", Context.MODE_PRIVATE)

    private fun journalKey(item: JSONObject): String {
        val id = item.optString("id").trim()
        if (id.isNotBlank()) return "id:$id"
        return listOf(
            item.optString("direction"),
            item.optString("setup"),
            String.format(Locale.US, "%.8f", item.optDouble("entry")),
            String.format(Locale.US, "%.8f", item.optDouble("stop")),
            String.format(Locale.US, "%.8f", item.optDouble("target")),
            String.format(Locale.US, "%.4f", item.optDouble("rr"))
        ).joinToString("|")
    }

    private fun dedupeJournal(source: JSONArray): JSONArray {
        val out = JSONArray()
        val seen = HashSet<String>()
        for (i in 0 until source.length()) {
            val item = source.optJSONObject(i) ?: continue
            if (seen.add(journalKey(item))) out.put(item)
        }
        return out
    }

    private fun appendJournal(signalObj: JSONObject) {
        val old = try {
            JSONArray(journalPrefs().getString("items", "[]"))
        } catch (_: Throwable) {
            JSONArray()
        }
        val cleaned = dedupeJournal(old)
        val item = JSONObject()
            .put("ts", System.currentTimeMillis())
            .put("id", signalObj.optString("id"))
            .put("direction", signalObj.optString("direction"))
            .put("setup", signalObj.optString("setup"))
            .put("entry", signalObj.optDouble("entry"))
            .put("stop", signalObj.optDouble("stop"))
            .put("target", signalObj.optDouble("target2"))
            .put("rr", signalObj.optDouble("rr"))
            .put("confidence", signalObj.optDouble("confidence"))

        val key = journalKey(item)
        var exists = false
        for (i in 0 until cleaned.length()) {
            if (journalKey(cleaned.optJSONObject(i) ?: JSONObject()) == key) {
                exists = true
                break
            }
        }
        val next = JSONArray()
        if (!exists) next.put(item)
        for (i in 0 until minOf(cleaned.length(), 24)) next.put(cleaned.optJSONObject(i))
        journalPrefs().edit().putString("items", next.toString()).apply()
    }

    private fun loadJournal() {
        val raw = try {
            JSONArray(journalPrefs().getString("items", "[]"))
        } catch (_: Throwable) {
            JSONArray()
        }
        val arr = dedupeJournal(raw)
        if (arr.length() != raw.length()) {
            journalPrefs().edit().putString("items", arr.toString()).apply()
        }
        arr.optJSONObject(0)?.optString("id")?.takeIf { it.isNotBlank() }?.let { lastSignalId = it }
        if (arr.length() == 0) {
            journal.text = "No signals recorded yet."
            return
        }
        val out = StringBuilder()
        for (i in 0 until minOf(5, arr.length())) {
            val item = arr.optJSONObject(i) ?: continue
            out.append(item.optString("direction"))
                .append(" • ")
                .append(item.optString("setup"))
                .append(" • RR ")
                .append(String.format(Locale.US, "%.2f", item.optDouble("rr")))
                .append("\n")
        }
        journal.text = out.toString().trim()
    }

    private fun runReplay() {
        replay.text = "Running recent 15m replay…"
        getJson(backendBase + "/backtest/recent?lookback=240") { ok, body ->
            handler.post {
                if (!ok) {
                    replay.text = "Replay unavailable."
                    return@post
                }
                safe {
                    val j = JSONObject(body)
                    if (!j.optBoolean("ready", false)) {
                        replay.text = j.optString("reason", "Not enough candles.")
                        return@safe
                    }
                    val s = j.optJSONObject("stats") ?: JSONObject()
                    val pf = s.optDouble("profit_factor", Double.NaN)
                    replay.text =
                        "Trades  " + s.optInt("trades") +
                        "\nWin rate  " + String.format(Locale.US, "%.1f%%", s.optDouble("win_rate_pct")) +
                        "\nTotal R  " + String.format(Locale.US, "%.2f", s.optDouble("total_r")) +
                        "\nMax DD  " + String.format(Locale.US, "%.2fR", s.optDouble("max_drawdown_r")) +
                        "\nExpectancy  " + String.format(Locale.US, "%.3fR", s.optDouble("expectancy_r")) +
                        "\nProfit factor  " + if (pf.isNaN()) "—" else String.format(Locale.US, "%.2f", pf)
                }
            }
        }
    }

    private fun systemCheck() {
        checkButton.isEnabled = false
        check.text = "Running diagnostics…"
        getJson(backendBase + "/system-check") { ok, body ->
            handler.post {
                if (!ok) {
                    val fault = when (body) {
                        "HTTP 401" -> "PAIRING EXPIRED (401)"
                        "HTTP 403" -> "ACCESS DENIED (403)"
                        "HTTP 404" -> "BACKEND ROUTE UNAVAILABLE (404)"
                        "HTTP 429" -> "RATE LIMITED (429)"
                        "HTTP 502", "HTTP 503", "HTTP 504" -> "HOST UNAVAILABLE (" + body + ")"
                        "NETWORK TIMEOUT" -> "REQUEST TIMED OUT"
                        "NETWORK UNAVAILABLE" -> "NETWORK UNAVAILABLE"
                        else -> if (body.startsWith("HTTP ")) "SERVER ERROR " + body else "DIAGNOSTICS UNAVAILABLE"
                    }
                    if (body == "HTTP 401") pairingButton?.text = "SESSION EXPIRED  •  TAP TO RE-PAIR"
                    check.text = "PRIVATE DIAGNOSTICS  •  " + fault + "\nChecking public backend health…"
                    // A public health response verifies the server only; it must
                    // never be presented as authenticated Bitget order readiness.
                    getJson(backendBase + "/health") { publicOk, publicBody ->
                        handler.post {
                            if (stopped) {
                                checkButton.isEnabled = true
                                return@post
                            }
                            val publicReport = if (publicOk) {
                                runCatching {
                                    val health = JSONObject(publicBody)
                                    val state = health.optString("data_health", "UNKNOWN")
                                    if (health.optBoolean("ok", false)) {
                                        "PUBLIC BACKEND  •  REACHABLE\nMarket feed  •  " + state
                                    } else "PUBLIC BACKEND  •  RESPONDING (NOT READY)"
                                }.getOrDefault("PUBLIC BACKEND  •  INVALID RESPONSE")
                            } else {
                                "PUBLIC BACKEND  •  " + when (publicBody) {
                                    "HTTP 404" -> "ROUTING OFFLINE (404)"
                                    "NETWORK TIMEOUT" -> "TIMEOUT"
                                    "NETWORK UNAVAILABLE" -> "UNREACHABLE"
                                    else -> publicBody.take(32)
                                }
                            }
                            check.text = "PRIVATE DIAGNOSTICS  •  " + fault +
                                "\n" + publicReport +
                                "\nBitget execution readiness  •  UNVERIFIED" +
                                if (body == "HTTP 401") "\nACTION  •  TAP RE-PAIR DEVICE" else "\nACTION  •  RETRY AFTER RESTORING CONNECTION"
                            checkButton.isEnabled = true
                        }
                    }
                    return@post
                }
                safe {
                    val j = JSONObject(body)
                    val market = j.optJSONObject("market")
                    val strategy = j.optJSONObject("strategy")
                    val api = j.optBoolean("backend_ok", false)
                    val dataHealth = market?.optString("data_health", "UNKNOWN") ?: "UNKNOWN"
                    val ws = market?.optBoolean("ws_connected", false) == true
                    val marketFeed = j.optJSONObject("market_feed")
                    val feedSource = marketFeed?.optString("source", "NONE") ?: "NONE"
                    val signalState = strategy?.optString("signal_state", "NONE") ?: "NONE"
                    val scanning = strategy?.optString("status") == "SCANNING"
                    val notifications = Build.VERSION.SDK_INT < 33 ||
                        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

                    val apiText = if (api) "PASS" else "FAIL"
                    val feedHealth = when (dataHealth.uppercase(Locale.US)) {
                        "HEALTHY" -> "HEALTHY"
                        "DEGRADED" -> "DEGRADED"
                        "CONNECTING", "RECONNECTING" -> "CONNECTING"
                        else -> "NOT HEALTHY"
                    }
                    val wsText = if (ws) "CONNECTED" else "DISCONNECTED"
                    val sourceText = feedSource.replace("_", " ")
                    val strategyText = when {
                        signalState == "ACTIVE" -> "ACTIVE"
                        scanning -> "SCANNING"
                        else -> "NOT READY"
                    }
                    val alertText = if (notifications) "READY" else "NOT ENABLED"
                    val featureJson = j.optJSONObject("features")
                    val demo = strategy?.optJSONObject("demo_execution")
                    val demoSummary = demo?.optJSONObject("summary")
                    val demoReady = demoSummary?.optBoolean("ready", false) == true
                    val demoClient = demoSummary?.optJSONObject("client_status")
                    val demoBalance = demoClient?.optDouble("available_balance_usdt", Double.NaN) ?: Double.NaN
                    val demoClientReason = demoClient?.optString(
                        "reason",
                        demoClient?.optString("readiness_reason", "")
                    ) ?: ""
                    val demoText = when {
                        demoReady -> "READY" + if (!demoBalance.isNaN()) " • " + String.format(Locale.US, "%.2f USDT", demoBalance) else ""
                        demoClientReason.contains("40099") ||
                            demoClientReason.contains("exchange environment is incorrect", ignoreCase = true) ->
                            "WRONG DEMO ENVIRONMENT"
                        !demoBalance.isNaN() && demoBalance <= 0.0 -> "WAITING FOR FUNDS"
                        else -> "CHECK CONNECTION"
                    }
                    check.text = "API  " + apiText +
                        "\nMarket Feed  " + feedHealth + " • " + sourceText +
                        "\nPrimary WS  " + wsText +
                        "\nStrategy  " + strategyText +
                        "\nSignal  " + (strategy?.optString("signal_state", "NONE") ?: "NONE") +
                        "\nBitget Demo  " + demoText +
                        "\nRegime  " + (featureJson?.optString("regime", "—") ?: "—") +
                        "\nStructure  " + (featureJson?.optString("market_structure", "—") ?: "—") +
                        "\nAlerts  " + alertText
                }
                checkButton.isEnabled = true
            }
        }
    }

    private fun setUpdateStatus(message: String) {
        update.text = message
        if (::check.isInitialized) check.text = message
        if (::updateButton.isInitialized) {
            updateButton.text = when {
                message.startsWith("Checking") -> "CHECKING…"
                message.startsWith("DOWNLOADING") -> "DOWNLOADING…"
                message.startsWith("UPDATE VERIFIED") -> "INSTALLING…"
                message.startsWith("UP TO DATE") -> "UP TO DATE"
                message.contains("FAILED", ignoreCase = true) ||
                    message.contains("BLOCKED", ignoreCase = true) ||
                    message.contains("INVALID", ignoreCase = true) -> "RETRY UPDATE"
                else -> "UPDATE"
            }
        }
    }

    private fun checkUpdate() {
        updateButton.isEnabled = false
        setUpdateStatus("Checking release channel…")

        val manifestUrl = "https://raw.githubusercontent.com/Dev06ai/marketpulse-os/dev-trader-v1/dev-trader/update.json?ts=" + System.currentTimeMillis()
        getJson(manifestUrl) { ok, body ->
            handler.post {
                if (isFinishing || isDestroyed) return@post
                if (!ok) {
                    updateButton.isEnabled = true
                    setUpdateStatus("UPDATE CHECK FAILED • TAP RETRY")
                    return@post
                }

                safe {
                    val j = JSONObject(body)
                    val remoteCode = j.optLong("versionCode", 0L)
                    val currentCode = packageManager.getPackageInfo(packageName, 0).longVersionCode
                    val remoteName = j.optString("versionName", "new")

                    if (!j.optBoolean("enabled", false) || remoteCode <= currentCode) {
                        updateButton.isEnabled = true
                        setUpdateStatus("UP TO DATE  • build " + currentCode)
                    } else {
                        val apkUrl = j.optString("apkUrl", "")
                        val expectedSha = j.optString("sha256", "")
                        if (!Regex("[0-9a-fA-F]{64}").matches(expectedSha) ||
                            !Regex("[0-9]+\\.[0-9]+\\.[0-9]+").matches(remoteName) ||
                            !Regex("https://github\\.com/Dev06ai/marketpulse-os/releases/download/dev-trader-v[0-9]+\\.[0-9]+\\.[0-9]+-[0-9]+/app-release\\.apk").matches(apkUrl)) {
                            updateButton.isEnabled = true
                            setUpdateStatus("UPDATE METADATA INVALID")
                        } else {
                            setUpdateStatus("DOWNLOADING • v" + remoteName)
                            val freshApkUrl = apkUrl + (if (apkUrl.contains("?")) "&" else "?") + "ts=" + System.currentTimeMillis()
                            downloadAndInstallUpdate(freshApkUrl, expectedSha, remoteName)
                        }
                    }
                }
            }
        }
    }

    private fun downloadAndInstallUpdate(apkUrl: String, expectedSha: String, versionName: String) {
        runCatching {
            val request = Request.Builder().url(apkUrl).get().build()
            restClient.newBuilder().readTimeout(30, TimeUnit.SECONDS)
                .callTimeout(180, TimeUnit.SECONDS).build().newCall(request).enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                    handler.post {
                        if (isFinishing || isDestroyed) return@post
                        updateButton.isEnabled = true
                        setUpdateStatus("UPDATE DOWNLOAD FAILED • RETRY")
                    }
                }

                override fun onResponse(call: okhttp3.Call, response: Response) {
                    val apk = File(File(cacheDir, "updates"), "dev-trader-" + versionName + ".apk")
                    try {
                        response.use {
                            if (!it.isSuccessful || it.body == null) {
                                handler.post {
                                    if (isFinishing || isDestroyed) return@post
                                    updateButton.isEnabled = true
                                    setUpdateStatus("UPDATE DOWNLOAD FAILED • HTTP " + it.code)
                                }
                                return
                            }
                            val maxBytes = 64L * 1024 * 1024
                            if (it.body!!.contentLength() > maxBytes) throw java.io.IOException("Update is too large")
                            if (apk.parentFile?.mkdirs() != true && apk.parentFile?.isDirectory != true) {
                                throw java.io.IOException("Update directory is unavailable")
                            }
                            val digest = MessageDigest.getInstance("SHA-256")
                            FileOutputStream(apk).use { out ->
                                it.body!!.byteStream().use { input ->
                                    var bytes = 0L
                                    val buffer = ByteArray(32 * 1024)
                                    while (true) {
                                        val count = input.read(buffer)
                                        if (count <= 0) break
                                        bytes += count
                                        if (bytes > maxBytes) throw java.io.IOException("Update is too large")
                                        digest.update(buffer, 0, count)
                                        out.write(buffer, 0, count)
                                    }
                                }
                            }
                            val actualSha = digest.digest().joinToString("") { b -> "%02x".format(b) }
                            if (!actualSha.equals(expectedSha, ignoreCase = true)) {
                                apk.delete()
                                handler.post {
                                    if (isFinishing || isDestroyed) return@post
                                    updateButton.isEnabled = true
                                    setUpdateStatus("UPDATE BLOCKED • CHECKSUM FAILED")
                                }
                                return
                            }
                            handler.post {
                                if (isFinishing || isDestroyed) return@post
                                updateButton.isEnabled = true
                                setUpdateStatus("UPDATE VERIFIED • INSTALLING v" + versionName)
                                installApk(apk)
                            }
                        }
                    } catch (_: Exception) {
                        apk.delete()
                        handler.post {
                            if (isFinishing || isDestroyed) return@post
                            updateButton.isEnabled = true
                            setUpdateStatus("UPDATE DOWNLOAD FAILED • RETRY")
                        }
                    }
                }
            })
        }.onFailure {
            handler.post {
                if (isFinishing || isDestroyed) return@post
                updateButton.isEnabled = true
                setUpdateStatus("UPDATE FAILED • RETRY")
            }
        }
    }


    private fun installApk(apk: File) {
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !packageManager.canRequestPackageInstalls()
            ) {
                val settings = Intent(
                    android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    android.net.Uri.parse("package:$packageName")
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(settings)
                updateButton.isEnabled = true
                setUpdateStatus("ALLOW INSTALLS • THEN TAP UPDATE AGAIN")
                return
            }

            val uri = FileProvider.getUriForFile(this, packageName + ".fileprovider", apk)
            val intent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                clipData = android.content.ClipData.newRawUri("KYVORIQ update", uri)
            }
            startActivity(intent)
            setUpdateStatus("INSTALLER OPEN • v" + apk.name.substringAfter("dev-trader-").removeSuffix(".apk"))
        }.onFailure {
            updateButton.isEnabled = true
            setUpdateStatus("INSTALL BLOCKED • CHECK ANDROID PERMISSION")
        }
    }

    private fun showPairingDialog(button: Button) {
        val field = EditText(this).apply {
            hint = "Server owner pairing secret"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            isSingleLine = true
            setPadding(dp(18), dp(16), dp(18), dp(16))
        }
        val title = if (KyvoriqSecureSession.isPaired(this)) "Renew secure device pairing" else "Pair this device"
        android.app.AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage("Enter the server pairing secret from your private hosting vault. It is used once and NEVER saved on this phone. The app stores only a 7-day encrypted device token.")
            .setView(field)
            .setNegativeButton("CANCEL", null)
            .setPositiveButton("PAIR") { _, _ ->
                val entered = field.text.toString()
                field.text.clear()
                if (entered.length !in 32..512) {
                    showInfoDialog("Pairing refused", "Enter the private server pairing secret. It must be at least 32 characters.")
                    return@setPositiveButton
                }
                button.text = "PAIRING…"
                button.isEnabled = false
                val payload = JSONObject().put("pairing_secret", entered).toString()
                val request = Request.Builder().url(backendBase + "/auth/pair")
                    .post(payload.toRequestBody("application/json; charset=utf-8".toMediaType()))
                    .build()
                restClient.newCall(request).enqueue(object : okhttp3.Callback {
                    override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                        handler.post {
                            button.isEnabled = true
                            button.text = "PAIR DEVICE  •  RETRY"
                            if (!isFinishing && !isDestroyed) showInfoDialog("Pairing unavailable", "The server could not be reached. Check the configured private host.")
                        }
                    }
                    override fun onResponse(call: okhttp3.Call, response: Response) {
                        val received = response.use { responseBody ->
                            if (!responseBody.isSuccessful) null else runCatching {
                                JSONObject(responseBody.body?.string().orEmpty())
                            }.getOrNull()
                        }
                        val saved = runCatching {
                            val reply = received ?: error("Pairing denied")
                            val token = reply.getString("access_token")
                            val expiry = reply.getLong("expires_at")
                            KyvoriqSecureSession.save(this@SafeActivity, token, expiry)
                        }.isSuccess
                        handler.post {
                            if (isFinishing || isDestroyed) return@post
                            button.isEnabled = true
                            if (saved) {
                                button.text = "DEVICE PAIRED  •  SECURE"
                                publicMarketOnly = false
                                publicMarketMessage?.visibility = View.GONE
                                showInfoDialog("Secure pairing active", "Your private trading session is encrypted on this device for up to 7 days. Renew it from this button when it expires.")
                                connect(force = true)
                                bootstrap(true)
                                ContextCompat.startForegroundService(
                                    this@SafeActivity,
                                    Intent(this@SafeActivity, SignalService::class.java).apply {
                                        action = "KYVORIQ_SECURE_SESSION_UPDATED"
                                    }
                                )
                            } else {
                                button.text = "PAIR DEVICE  •  RETRY"
                                showInfoDialog("Pairing refused", "The server rejected the secret, pairing is rate-limited, or server pairing is not configured. No credential was stored.")
                            }
                        }
                    }
                })
            }.show()
    }

    private fun getJson(url: String, callback: (Boolean, String) -> Unit) {
        runCatching {
            val request = KyvoriqSecureSession.authenticate(
                this, Request.Builder().url(url).get(), url
            ).build()
            restClient.newCall(request).enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                    val detail = if (e is java.net.SocketTimeoutException) "NETWORK TIMEOUT"
                        else "NETWORK UNAVAILABLE"
                    handler.post { callback(false, detail) }
                }

                override fun onResponse(call: okhttp3.Call, response: Response) {
                    val result = runCatching {
                        response.use {
                            if (it.isSuccessful) Pair(true, it.body?.string().orEmpty())
                            else Pair(false, "HTTP " + it.code) // Never display an untrusted error body.
                        }
                    }.getOrElse { Pair(false, "NETWORK UNAVAILABLE") }
                    handler.post {
                        if (!isFinishing && !isDestroyed) callback(result.first, result.second)
                    }
                }
            })
        }.onFailure {
            handler.post { callback(false, "NETWORK UNAVAILABLE") }
        }
    }

    override fun onResume() {
        super.onResume()
        if (debugPreview || biometricPromptActive) return
        if (privacyPrefs().getBoolean("biometric_enabled", false)) {
            val elapsed = if (backgroundedAtMs > 0L) System.currentTimeMillis() - backgroundedAtMs else 0L
            if (!privacyAuthenticated || elapsed >= 60_000L) {
                privacyAuthenticated = false
                rootSurface.visibility = View.INVISIBLE
                requestPrivacyAuthentication(
                    title = "Unlock KYVORIQ",
                    subtitle = "Privacy Shield locked this session.",
                    onSuccess = {
                        privacyAuthenticated = true
                        backgroundedAtMs = 0L
                        rootSurface.visibility = View.VISIBLE
                    },
                    onFailure = { finishAndRemoveTask() }
                )
            }
        }
    }

    override fun onStart() {
        super.onStart()
        if (debugPreview) return
        stopped = false
        handler.removeCallbacks(keepaliveRunnable)
        handler.postDelayed(keepaliveRunnable, KEEPALIVE_INTERVAL_MS)
        handler.removeCallbacks(snapshotPollRunnable)

        // Always rebuild the market snapshot when the activity returns to the
        // foreground. A previously-open socket can survive while its stream data
        // has gone stale, so connect() alone is not enough.
        handler.postDelayed({
            safe { bootstrap(true) }
        }, 150L)
        handler.postDelayed({
            safe { connect() }
        }, 450L)
        handler.removeCallbacks(healthWatchdogRunnable)
        handler.postDelayed(healthWatchdogRunnable, 1800L)
        handler.postDelayed(snapshotPollRunnable, 1200L)
    }

    override fun onStop() {
        // No media foreground service: avoid silently playing after the owner
        // leaves KYVORIQ or privacy shield hides the app.
        musicIsland?.pause()
        if (!debugPreview && !biometricPromptActive && privacyPrefs().getBoolean("biometric_enabled", false)) {
            backgroundedAtMs = System.currentTimeMillis()
        }
        stopped = true
        handler.removeCallbacks(snapshotPollRunnable)
        handler.removeCallbacks(keepaliveRunnable)
        handler.removeCallbacks(healthWatchdogRunnable)
        reconnectRunnable?.let { handler.removeCallbacks(it) }
        reconnectRunnable = null
        reconnectScheduled.set(false)
        val old = socket
        socket = null
        runCatching { old?.close(1000, "dashboard in background") }
        super.onStop()
    }

    override fun onDestroy() {
        musicIsland?.release()
        musicIsland = null
        ambientAnimator?.cancel()
        ambientAnimator = null
        stopped = true
        lastSocketRebuildMs = System.currentTimeMillis()
        runCatching {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            networkCallback?.let { cm.unregisterNetworkCallback(it) }
        }
        networkCallback = null
        reconnectRunnable?.let { handler.removeCallbacks(it) }
        reconnectRunnable = null
        handler.removeCallbacks(snapshotPollRunnable)
        handler.removeCallbacksAndMessages(null)
        reconnectScheduled.set(false)
        runCatching { socket?.close(1000, "activity destroyed") }
        socket = null
        super.onDestroy()
    }
}

