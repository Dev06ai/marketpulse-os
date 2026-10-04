// Build 98: responsive Trade / Positions / Insights workspaces.
// Build 83: show Bitget Demo funding readiness and demo execution state.
package com.devtrader.app

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
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
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.content.FileProvider
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
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
class SafeActivity : Activity() {
    private val btcOrange = Color.rgb(247, 147, 26)

    // Keep all ordinary asset labels white. Only the BTC ticker immediately
    // beside the live price receives the Bitcoin-orange accent.
    private fun marketAssetAccent(value: CharSequence): CharSequence = value

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
    private lateinit var price: TextView
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
    private lateinit var workspaceHost: FrameLayout
    private val workspacePages = mutableListOf<LinearLayout>()
    private val navigationButtons = mutableListOf<Button>()
    private lateinit var positionSummary: TextView
    private lateinit var ledgerView: TextView
    private lateinit var decisionView: TextView
    private lateinit var insightContext: TextView
    private lateinit var curve: PerformanceCurveView
    private var selectedWorkspace = 0
    private var fullTradeHistoryText = "No executed demo trades yet."
    private lateinit var chart: MarketChartView
    private lateinit var updateButton: Button
    private lateinit var checkButton: Button
    private lateinit var alertsButton: Button
    private var selectedTf = "15m"
    private var lastStateReceivedMs = 0L
    private var latestRoot: JSONObject? = null
    private var lastSignalId: String? = null
    private var lastExecutionEventKey: String? = null
    private var pendingUiUpdate = false
    private var lastUiRenderMs = 0L
    private var lastChartRequestMs = 0L
    private var chartRequestInFlight = false
    private var chartRequestToken = 0L
    private var lastBootstrapMs = 0L
    private var lastBootstrapSuccessMs = 0L
    private var bootstrapInFlight = false
    private val snapshotPollRunnable = object : Runnable {
        override fun run() {
            if (stopped) return
            val now = System.currentTimeMillis()
            if (socket == null || now - lastStateReceivedMs > 5000L) bootstrap(false)
            else requestChartIfNeeded()
            handler.postDelayed(this, 3000L)
        }
    }

    private var retryButton: Button? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var lastSocketActivityMs = 0L
    private var lastRetryRequestMs = 0L
    private var lastSocketRebuildMs = 0L
    private var reconnectRunnable: Runnable? = null

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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isStatusBarContrastEnforced = false
            window.isNavigationBarContrastEnforced = false
        }
        installCrashReporter()
        buildUi()
        // The fixture exists only in src/debug/assets. Release builds cannot
        // enter this path or package synthetic account/market data.
        debugPreview = BuildConfig.DEBUG && intent.getBooleanExtra("visual_preview", false)
        if (debugPreview) {
            val preview = JSONObject(assets.open("ui_preview.json").bufferedReader().use { it.readText() })
            val now = System.currentTimeMillis()
            preview.put("received_ts", now).put("last_market_update_ts", now)
            latestRoot = preview
            renderState(preview, requestChart = false)
            val candles = preview.getJSONObject("chart").getJSONArray("candles")
            chart.setData(candles, preview.optJSONObject("signal"), calculateEma(candles, 50), preview.getDouble("last_price"))
            check.text = "Build 98  •  Visual verification"
            selectWorkspace(intent.getIntExtra("visual_workspace", 0).coerceIn(0, 2))
            return
        }
        registerNetworkCallback()
        ensureChannel()
        startBackgroundAlerts()
        loadJournal()
        loadTradeHistory()

        handler.postDelayed({
            safe {
                bootstrap(true)
                loadTradeHistory()
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
        colorAll("NO TRADE", Color.rgb(167, 139, 250))
        signal.text = styled
    }

    private fun buildUi() {
        val compactViewport = resources.configuration.screenHeightDp < 760
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(10, 11, 15))
            setPadding(dp(14), dp(8), dp(14), dp(8))
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(dp(14), bars.top + dp(8), dp(14), bars.bottom + dp(8))
            insets
        }
        setContentView(root)
        val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        val brand = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        brand.addView(label("DEV TRADER", 19f, Color.WHITE, 0.045f))
        brand.addView(label("PERSONAL TRADING WORKSPACE", 8.5f, Color.rgb(136, 142, 161), 0.06f), margins(top = 4))
        header.addView(brand, LinearLayout.LayoutParams(0, dp(48), 1f))
        alertsButton = compactPillButton("ALERTS").apply { contentDescription = "Enable trade alerts" }
        alertsButton.setOnClickListener { safe { requestAlertPermission() } }
        header.addView(alertsButton, LinearLayout.LayoutParams(dp(66), dp(44)).apply { rightMargin = dp(6) })
        retryButton = compactPillButton("RETRY").apply { contentDescription = "Reconnect market data" }
        retryButton?.setOnClickListener { safe { forceReconnectFromUser() } }
        header.addView(retryButton, LinearLayout.LayoutParams(dp(56), dp(44)))
        root.addView(header, margins(bottom = 8))

        workspaceHost = FrameLayout(this)
        root.addView(workspaceHost, LinearLayout.LayoutParams(-1, 0, 1f))
        fun page(): LinearLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            workspacePages.add(this)
            workspaceHost.addView(this, FrameLayout.LayoutParams(-1, -1))
        }
        val tradePage = page()
        val hero = heroCard()
        price = hero.price; oiView = hero.oi; status = hero.status
        tradePage.addView(hero.container, margins(bottom = 8))
        val tfRow = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        listOf("5m", "15m", "1h", "4h").forEach { tf ->
            val button = compactPillButton(tf).apply { contentDescription = "Chart $tf" }
            button.setOnClickListener {
                selectedTf = tf
                chart.setTimeframe(tf)
                refreshTimeframeButtons(tfRow)
                requestChartIfNeeded(force = true)
            }
            tfRow.addView(button, LinearLayout.LayoutParams(0, dp(if (compactViewport) 36 else 40), 1f).apply { leftMargin = dp(2); rightMargin = dp(2) })
        }
        timeframeButtonRow = tfRow
        tradePage.addView(tfRow, margins(bottom = 6))
        chart = MarketChartView(this).apply { minimumHeight = 0; contentDescription = "Interactive price chart" }
        tradePage.addView(chart, LinearLayout.LayoutParams(-1, 0, 1f).apply { bottomMargin = dp(8) })
        val setup = premiumCard("DECISION CENTER", "NO TRADE  •  SCANNING\nWaiting for verified market data.", if (compactViewport) 11.5f else 13f)
        signal = setup.second
        signal.maxLines = if (compactViewport) 4 else 5
        signal.ellipsize = android.text.TextUtils.TruncateAt.END
        setup.first.setOnClickListener { showTradeDetails() }
        setup.first.contentDescription = "Open complete trade setup"
        tradePage.addView(setup.first, LinearLayout.LayoutParams(-1, dp(if (compactViewport) 110 else 132)).apply { bottomMargin = dp(8) })
        val tradeTools = LinearLayout(this)
        val details = compactPillButton("SETUP DETAILS")
        details.setOnClickListener { showTradeDetails() }
        tradeTools.addView(details, LinearLayout.LayoutParams(0, dp(44), 1f).apply { rightMargin = dp(6) })
        val pnl = compactPillButton("P&L CALCULATOR")
        pnl.setOnClickListener { safe { showPnlCalculator() } }
        tradeTools.addView(pnl, LinearLayout.LayoutParams(0, dp(44), 1f))
        tradePage.addView(tradeTools)
        refreshTimeframeButtons(tfRow)

        val positionsPage = page()
        val overview = premiumCard("DEMO PERFORMANCE", "Waiting for exchange accounting…", 18f)
        positionSummary = overview.second
        positionsPage.addView(overview.first, margins(bottom = 10))
        curve = PerformanceCurveView(this)
        positionsPage.addView(curve, LinearLayout.LayoutParams(-1, dp(if (compactViewport) 90 else 130)).apply { bottomMargin = dp(10) })
        val ledgerCard = compactCard("ACCOUNTING & RISK", "Checking fills and exposure…", 12f)
        ledgerView = ledgerCard.value
        positionsPage.addView(ledgerCard.container, margins(bottom = 10))
        val exposureCard = scrollableCard("EXCHANGE POSITIONS", "No verified position data yet.", 13f, dp(120))
        tradeHistory = exposureCard.value
        positionsPage.addView(exposureCard.container, LinearLayout.LayoutParams(-1, 0, 1f).apply { bottomMargin = dp(10) })
        val historyButton = compactPillButton("OPEN EXECUTION HISTORY")
        historyButton.setOnClickListener { safe { loadTradeHistory(); showInfoDialog("Execution history", fullTradeHistoryText) } }
        positionsPage.addView(historyButton, LinearLayout.LayoutParams(-1, dp(44)))

        val insightsPage = page()
        val story = premiumCard("MARKET CONTEXT", "Building the market picture…", 13f)
        features = story.second
        features.maxLines = 5
        insightsPage.addView(story.first, margins(bottom = 10))
        val decisions = scrollableCard("ENTRY CHECKS", "Waiting for a qualified setup…", 12f, dp(150))
        decisionView = decisions.value
        insightsPage.addView(decisions.container, LinearLayout.LayoutParams(-1, 0, 1f).apply { bottomMargin = dp(10) })
        val levels = compactCard("LEVELS & FLOW", "Loading confirmed context…", 12f)
        insightContext = levels.value
        insightsPage.addView(levels.container, margins(bottom = 10))
        val feed = compactCard("CONNECTION", "BITGET  •  CONNECTING", 11.5f)
        integrity = feed.value
        insightsPage.addView(feed.container, margins(bottom = 10))
        val sys = compactCard("SYSTEM", "Build 98  •  Checking…", 11.5f)
        check = sys.value
        insightsPage.addView(sys.container, margins(bottom = 10))
        val tools = LinearLayout(this)
        checkButton = compactPillButton("SYSTEM CHECK")
        checkButton.setOnClickListener { safe { systemCheck() } }
        tools.addView(checkButton, LinearLayout.LayoutParams(0, dp(44), 1f).apply { rightMargin = dp(6) })
        updateButton = compactPillButton("UPDATE")
        updateButton.setOnClickListener { safe { checkUpdate() } }
        tools.addView(updateButton, LinearLayout.LayoutParams(0, dp(44), 1f))
        insightsPage.addView(tools)

        val navigation = LinearLayout(this).apply { setPadding(0, dp(10), 0, 0) }
        listOf("TRADE", "POSITIONS", "INSIGHTS").forEachIndexed { index, title ->
            val button = compactPillButton(title).apply { contentDescription = "Workspace $title"; textSize = 11.5f }
            button.setOnClickListener { selectWorkspace(index) }
            navigationButtons.add(button)
            navigation.addView(button, LinearLayout.LayoutParams(0, dp(48), 1f).apply { leftMargin = dp(3); rightMargin = dp(3) })
        }
        root.addView(navigation)
        update = TextView(this); risk = TextView(this); journal = TextView(this); replay = TextView(this)
        selectWorkspace(0)
    }

    private fun selectWorkspace(index: Int) {
        selectedWorkspace = index
        workspacePages.forEachIndexed { i, page -> page.visibility = if (i == index) View.VISIBLE else View.GONE }
        navigationButtons.forEachIndexed { i, button ->
            button.setTextColor(if (i == index) Color.WHITE else Color.rgb(138, 145, 162))
            button.background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                if (i == index) intArrayOf(Color.rgb(68, 60, 118), Color.rgb(37, 64, 103))
                else intArrayOf(Color.rgb(24, 27, 36), Color.rgb(20, 23, 31))).apply {
                cornerRadius = dp(14).toFloat()
                setStroke(dp(1), if (i == index) Color.rgb(121, 107, 198) else Color.rgb(46, 52, 67))
            }
        }
        latestRoot?.let { renderWorkspace(it) }
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

    private fun sectionLabel(text: String): TextView =
        label(text, 9.5f, Color.rgb(130, 136, 149), 0.13f)

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
            child.setTextColor(
                if (selected) Color.WHITE else Color.rgb(154, 160, 174)
            )
            child.background = gradient(
                if (selected) {
                    intArrayOf(Color.rgb(86, 76, 132), Color.rgb(48, 64, 101))
                } else {
                    intArrayOf(Color.rgb(36, 39, 48), Color.rgb(22, 24, 31))
                },
                GradientDrawable.Orientation.LEFT_RIGHT
            ).apply {
                cornerRadius = dp(11).toFloat()
                setStroke(
                    dp(1),
                    if (selected) Color.rgb(124, 108, 180) else Color.rgb(55, 60, 72)
                )
            }
        }
    }

    private fun compactPillButton(text: String): Button =
        Button(this).apply {
            this.text = text
            textSize = 10.5f
            setTextColor(Color.rgb(236, 239, 245))
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            isAllCaps = false
            isEnabled = true
            isClickable = true
            isFocusable = true
            minHeight = 0
            minWidth = 0
            stateListAnimator = null
            elevation = 0f
            setPadding(dp(5), 0, dp(5), 0)
            background = gradient(
                intArrayOf(Color.rgb(40, 43, 52), Color.rgb(24, 26, 33)),
                GradientDrawable.Orientation.LEFT_RIGHT
            ).apply {
                cornerRadius = dp(12).toFloat()
                setStroke(dp(1), Color.rgb(65, 70, 82))
            }
        }

    private data class HeroRefs(
        val price: TextView,
        val oi: TextView,
        val status: TextView,
        val container: LinearLayout
    )

    private fun heroCard(): HeroRefs {
        val compactViewport = resources.configuration.screenHeightDp < 760
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(if (compactViewport) 8 else 10), dp(14), dp(if (compactViewport) 8 else 10))
            background = gradient(
                intArrayOf(Color.rgb(24, 26, 33), Color.rgb(12, 14, 19)),
                GradientDrawable.Orientation.TL_BR
            ).apply {
                cornerRadius = dp(18).toFloat()
                setStroke(dp(1), Color.rgb(52, 57, 68))
            }
        }

        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        top.addView(label("BTCUSDT", 10f, Color.rgb(152, 158, 171), 0.08f),
            LinearLayout.LayoutParams(0, dp(if (compactViewport) 18 else 22), 1f))
        val livePill = label("USDT", 10f, Color.rgb(54, 211, 153), 0.08f)
        top.addView(livePill, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(if (compactViewport) 18 else 22)))
        box.addView(top)

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val priceView = TextView(this).apply {
            text = priceBtcAccent("BTC  —")
            textSize = if (compactViewport) 22f else 26f
            setTextColor(Color.WHITE)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            includeFontPadding = false
        }
        row.addView(priceView, LinearLayout.LayoutParams(0, dp(if (compactViewport) 32 else 38), 1f))

        val statusView = TextView(this).apply {
            text = "DATA CONNECTING"
            textSize = 9.5f
            setTextColor(Color.rgb(179, 185, 198))
            gravity = Gravity.CENTER
            setPadding(dp(9), 0, dp(9), 0)
            background = GradientDrawable().apply {
                cornerRadius = dp(10).toFloat()
                setColor(Color.rgb(29, 32, 40))
                setStroke(dp(1), Color.rgb(69, 74, 87))
            }
        }
        row.addView(statusView, LinearLayout.LayoutParams(dp(112), dp(30)))
        box.addView(row)

        val oi = label("OI  —", 9f, Color.rgb(133, 139, 151), 0.02f)
        box.addView(oi, margins(top = 1))
        return HeroRefs(priceView, oi, statusView, box)
    }

    private fun compactCard(title: String, initial: String, valueSize: Float): CardRefs {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(9), dp(12), dp(8))
            background = gradient(
                intArrayOf(Color.rgb(24, 26, 33), Color.rgb(15, 17, 22)),
                GradientDrawable.Orientation.TL_BR
            ).apply {
                cornerRadius = dp(15).toFloat()
                setStroke(dp(1), Color.rgb(48, 53, 64))
            }
        }
        val heading = label(title, 8.5f, Color.rgb(125, 131, 144), 0.11f)
        val value = TextView(this).apply {
            text = initial
            textSize = valueSize
            setTextColor(Color.WHITE)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            includeFontPadding = false
            setLineSpacing(0f, 1.02f)
            setHorizontallyScrolling(false)
        }
        box.addView(heading)
        box.addView(value, margins(top = 5))
        return CardRefs(box, value)
    }

    private fun premiumCard(title: String, initial: String, valueSize: Float): Pair<LinearLayout, TextView> {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(11), dp(14), dp(10))
            background = gradient(
                intArrayOf(Color.rgb(33, 31, 47), Color.rgb(16, 17, 23)),
                GradientDrawable.Orientation.TL_BR
            ).apply {
                cornerRadius = dp(17).toFloat()
                setStroke(dp(1), Color.rgb(74, 66, 96))
            }
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(label(title, 9f, Color.rgb(157, 149, 181), 0.12f),
            LinearLayout.LayoutParams(0, dp(18), 1f))
        header.addView(label(if (title == "DECISION CENTER") "DETAILS  ›" else "DEMO", 8.5f, Color.rgb(167, 139, 250), 0.08f))
        box.addView(header)

        val value = TextView(this).apply {
            text = initial
            textSize = valueSize
            setTextColor(Color.WHITE)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            includeFontPadding = false
            setLineSpacing(0f, 1.10f)
        }
        box.addView(value, margins(top = 5))
        return Pair(box, value)
    }

    private fun label(text: String, size: Float, color: Int, spacing: Float): TextView {
        return TextView(this).apply {
            this.text = marketAssetAccent(text)
            textSize = size
            setTextColor(color)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            letterSpacing = spacing
            includeFontPadding = false
        }
    }

    private data class CardRefs(val container: LinearLayout, val value: TextView)

    private fun scrollableCard(
        title: String,
        initial: String,
        valueSize: Float,
        scrollHeightPx: Int
    ): CardRefs {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(17), dp(15), dp(17), dp(16))
            background = gradient(
                intArrayOf(Color.rgb(30, 31, 38), Color.rgb(17, 18, 23)),
                GradientDrawable.Orientation.TL_BR
            ).apply {
                cornerRadius = dp(18).toFloat()
                setStroke(dp(1), Color.rgb(55, 57, 66))
            }
        }

        val heading = TextView(this).apply {
            text = marketAssetAccent(title)
            textSize = 11f
            setTextColor(Color.rgb(150, 154, 164))
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            letterSpacing = 0.11f
            includeFontPadding = false
        }
        box.addView(heading)

        val value = TextView(this).apply {
            text = marketAssetAccent(initial)
            textSize = valueSize
            setTextColor(Color.WHITE)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            includeFontPadding = false
            setLineSpacing(0f, 1.24f)
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
                0, 1f
            ).apply {
                topMargin = dp(8)
            }
        )

        return CardRefs(box, value)
    }

    private fun card(title: String, initial: String, valueSize: Float): CardRefs {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(17), dp(15), dp(17), dp(16))
            background = gradient(
                intArrayOf(Color.rgb(30, 31, 38), Color.rgb(17, 18, 23)),
                GradientDrawable.Orientation.TL_BR
            ).apply {
                cornerRadius = dp(18).toFloat()
                setStroke(dp(1), Color.rgb(55, 57, 66))
            }
        }

        val heading = TextView(this).apply {
            text = marketAssetAccent(title)
            textSize = 11f
            setTextColor(Color.rgb(150, 154, 164))
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            letterSpacing = 0.11f
        }
        box.addView(heading)

        val value = TextView(this).apply {
            text = marketAssetAccent(initial)
            textSize = valueSize
            setTextColor(Color.WHITE)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            includeFontPadding = false
            setLineSpacing(0f, 1.24f)
        }
        box.addView(value, margins(top = 8))
        return CardRefs(box, value)
    }

    private fun actionButton(label: String): Button {
        return Button(this).apply {
            text = marketAssetAccent(label)
            textSize = 13f
            setTextColor(Color.WHITE)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            isAllCaps = false
            isEnabled = true
            isClickable = true
            isFocusable = true
            isFocusableInTouchMode = true
            minHeight = dp(52)
            minWidth = 0
            stateListAnimator = null
            elevation = 0f
            background = gradient(
                intArrayOf(Color.rgb(58, 60, 69), Color.rgb(34, 35, 42)),
                GradientDrawable.Orientation.LEFT_RIGHT
            ).apply {
                cornerRadius = dp(16).toFloat()
                setStroke(dp(1), Color.rgb(84, 87, 98))
            }
            setPadding(dp(8), 0, dp(8), 0)
            setOnTouchListener { v, event ->
                when (event.actionMasked) {
                    android.view.MotionEvent.ACTION_DOWN -> alpha = 0.72f
                    android.view.MotionEvent.ACTION_UP -> {
                        alpha = 1f
                        v.performClick()
                    }
                    android.view.MotionEvent.ACTION_CANCEL -> alpha = 1f
                }
                false
            }
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

    private fun connect(force: Boolean = false) {
        if (stopped) return
        if (force) {
            reconnectRunnable?.let { handler.removeCallbacks(it) }
            reconnectRunnable = null
            reconnectScheduled.set(false)
            runCatching { socket?.cancel() }
            socket = null
        }
        if (socket != null) return

        status.text = "CONNECTING…"
        integrity.text = "WebSocket  •  CONNECTING •  SECURE RETRY LOOP"
        socket = client.newWebSocket(
            Request.Builder()
                .url(BackendEndpoint.socket("dashboard"))
                .build(),
            object : WebSocketListener() {
                override fun onOpen(ws: WebSocket, response: Response) {
                    socket = ws
                    reconnectAttempt = 0
                    reconnectScheduled.set(false)
                    lastSocketActivityMs = System.currentTimeMillis()
                    runCatching {
                        ws.send(
                            JSONObject().apply {
                                put("type", "keepalive")
                                put("client_ts", System.currentTimeMillis())
                            }.toString()
                        )
                    }
                    handler.post {
                        status.text = "SYNCING…"
                        integrity.text = "WebSocket  •  CONNECTED  •  LIVE FEED SUPERVISOR"
                    }
                    if (latestRoot == null) bootstrap(false)
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
                            lastStateReceivedMs = System.currentTimeMillis()
                            val now = System.currentTimeMillis()
                            if (now - lastUiRenderMs >= 350L && !pendingUiUpdate) {
                                pendingUiUpdate = true
                                handler.post {
                                    pendingUiUpdate = false
                                    lastUiRenderMs = System.currentTimeMillis()
                                    safe { latestRoot?.let { renderState(it, requestChart = false) } }
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
                        status.text = "RECONNECTING…"
                        integrity.text = "WebSocket  •  DISCONNECTED  •  RETRY SCHEDULED"
                    }
                    reconnect(false)
                }

                override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                    val owned = socket === ws
                    if (owned) socket = null
                    if (!owned || stopped) return
                    handler.post {
                        status.text = "RECONNECTING…"
                        integrity.text = "WebSocket  •  CLOSED •  RETRY SCHEDULED"
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
            retryButton?.text = "↻ RETRY"
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
        val now = System.currentTimeMillis()
        if (!force && now - lastBootstrapMs < 4000L) return
        lastBootstrapMs = now
        bootstrapInFlight = true
        integrity.text = "HTTP  •  SYNCING MARKET SNAPSHOT"
        val requestTf = selectedTf
        getJson(backendBase + "/bootstrap?profile=dashboard&interval=" + requestTf) { ok, body ->
            handler.post {
                bootstrapInFlight = false
                if (stopped) return@post
                if (!ok) {
                    val nowFail = System.currentTimeMillis()
                    if (lastBootstrapSuccessMs == 0L || nowFail - lastBootstrapSuccessMs > 10_000L) {
                        status.text = if (socket == null) "RECONNECTING…" else "SYNCING…"
                        integrity.text = "HTTP  •  SNAPSHOT FAILED  •  RETRYING"
                    }
                    return@post
                }
                safe {
                    val root = JSONObject(body)
                    val receivedAt = System.currentTimeMillis()
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
                        chart.setData(
                            candles,
                            latestRoot?.optJSONObject("signal"),
                            calculateEma(candles, 50),
                            lastPrice
                        )
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
        chart.setFeedHealthy(authoritativeFeedHealthy)
        status.text = when {
            authoritativeFeedHealthy -> "LIVE"
            health == "DEGRADED" -> "DATA DEGRADED"
            health == "CONNECTING" -> "CONNECTING…"
            health == "RECONNECTING" -> "RECONNECTING…"
            !ws -> "BACKEND WS OFFLINE"
            !freshMarket -> "DATA STALE"
            else -> health
        }
        price.text = priceBtcAccent(
            "BTC  " + if (priceValue.isNaN()) "—"
            else String.format(Locale.US, "%,.2f", priceValue)
        )
        oiView.text = "OI  " + if (oi.isNaN()) "—"
            else String.format(Locale.US, "%,.2f", oi)
        integrity.text = when {
            authoritativeFeedHealthy -> "BITGET WS  •  LIVE"
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
        val triggerCompact = triggerText.replace("\n", " ").trim().take(32)
        features.text =
            "BIAS  $storyBias" +
            "\nMTF   4H $mtf4h  •  1H $mtf1h  •  15m $mtf15" +
            "\nREGIME  $regime  •  $structure" +
            "\nTRIGGERS  " + if (triggerCompact.isBlank()) "WATCH" else triggerCompact

        chart.setLivePrice(priceValue)
        if (requestChart) requestChartIfNeeded()
        renderWorkspace(root)
    }

    private fun formatClock(timestamp: Long): String = if (timestamp <= 0) "—" else
        java.text.SimpleDateFormat("HH:mm:ss", Locale.US).format(java.util.Date(timestamp))

    private fun renderWorkspace(root: JSONObject) {
        fun money(value: Double, signed: Boolean = false): String =
            if (!value.isFinite()) "—" else String.format(Locale.US, if (signed) "%+.2f" else "%,.2f", value)
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
        positionSummary.text = "EQUITY  ${money(equity)} USDT\nAvailable  ${money(available)}  •  Unrealized  ${money(unrealized, true)}"
        positionSummary.textSize = 15f
        curve.setPoints(ledger.optJSONArray("curve") ?: JSONArray())
        ledgerView.text = "FILLS  ${ledger.optInt("fill_count")}  •  Net ${money(fillNet, true)} USDT\n" +
            "Fees ${money(ledger.optDouble("fees_usdt", Double.NaN))}  •  Excludes funding / transfers\n" +
            "Risk ≤ ${summary.optDouble("risk_pct", 0.25)}%  •  Entries ${summary.optInt("daily_executions")}/${summary.optInt("daily_cap", 3)} today\n" +
            (if (ledger.optString("error").isNotBlank() && !ledger.isNull("error")) "Accounting refresh failed; showing last snapshot"
             else if (unknown > 0) "$unknown order submissions await exchange confirmation"
             else if (unresolved > 0) "$unresolved historical entries need attribution"
             else if (!ledger.optBoolean("complete_window", false) || !ledger.optBoolean("fee_accounting_complete", false)) "Fill accounting window is incomplete"
             else "30-day fill accounting  •  Updated ${formatClock(ledger.optLong("window_end_ts"))}")
        ledgerView.setTextColor(if (unresolved > 0) Color.rgb(240, 194, 110) else Color.rgb(196, 204, 222))
        val positionText = StringBuilder()
        for (i in 0 until positions.length()) {
            val p = positions.optJSONObject(i) ?: continue
            if (positionText.isNotEmpty()) positionText.append("\n\n")
            positionText.append(p.optString("holdSide", "—").uppercase(Locale.US))
                .append("  •  ").append(p.optString("total", "—")).append(" BTC")
                .append("\nAverage entry  ").append(money(p.optDouble("openPriceAvg", Double.NaN)))
                .append("\nUnrealized  ").append(money(p.optDouble("unrealizedPL", Double.NaN), true)).append(" USDT")
        }
        tradeHistory.text = if (positionText.isEmpty()) "No exchange position confirmed.\nEntry checks remain active." else positionText.toString()

        val e = root.optJSONObject("engine") ?: JSONObject()
        val f = root.optJSONObject("features") ?: JSONObject()
        val s = root.optJSONObject("signal")
        val rejection = e.optJSONObject("trade_governor")?.optString("last_quality_rejection").orEmpty()
        val reason = when {
            !sourceHealthy -> "Waiting for healthy, fresh market data."
            unknown > 0 -> "Order response is uncertain. Awaiting exchange confirmation; additional entries are blocked."
            unresolved > 0 -> "Historical partial exits need reconciliation. New exposure is blocked."
            openCount > 0 -> "Existing exchange exposure is being tracked. Additional entries are blocked."
            decision.optString("status") == "SKIPPED" || decision.optString("status") == "ERROR" -> decision.optString("reason")
            rejection.isNotBlank() -> rejection
            else -> e.optString("wait_reason", "Scanning for a confirmed setup.")
        }
        val details = StringBuilder("ENTRY STATUS\n$reason\n\n")
        details.append("MARKET CONTEXT\n15m ${f.optString("trend_15", "—")}  •  1h ${f.optString("trend_60", "—")}  •  4h ${f.optString("trend_240", "—")}\n")
            .append("${f.optString("regime", "—")}  •  ${f.optString("market_structure", "—")}\n\n")
            .append("EXECUTION POLICY\nOne position at a time\nFee-adjusted reward / risk ≥ ${summary.optDouble("min_net_rr", 1.5)}\nPause after 2 consecutive daily losses\nObserved daily equity loss limit 1%\n\n")
            .append("EVIDENCE\nScores rank setups; they are not win probabilities.\n")
        decisionView.text = details.toString()
        insightContext.text = "CVD  ${f.optString("cvd_price_divergence", "—")}\n" +
            "OI 5m  ${money(f.optDouble("oi_change_5m_pct", Double.NaN), true)}%\n" +
            "Structure  ${f.optString("market_structure", "—")}"
        if (s != null) {
            val direction = s.optString("direction", "WAIT")
            val lifecycle = s.optString("lifecycle", "ACTIVE")
            val resolved = lifecycle in setOf("TARGET_REACHED", "INVALIDATED", "CLOSED", "EXECUTION_FAILED", "RESOLVED")
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
            setTradeSetupText("NO TRADE  •  ${if (openCount > 0) "EXPOSURE OPEN" else "SCANNING"}\n$reason\nTap details for entry checks.")
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
                    val live = latestRoot?.optDouble("last_price", Double.NaN) ?: Double.NaN
                    val lastPrice = if (!live.isNaN()) live else j.optDouble("last_price", Double.NaN)

                    // Never let an older timeframe response overwrite the
                    // currently selected timeframe.
                    if (selectedTf != requestTf) return@safe

                    chart.setTimeframe(requestTf)
                    chart.setData(
                        candles,
                        latestRoot?.optJSONObject("signal"),
                        calculateEma(candles, 50),
                        lastPrice
                    )
                    refreshTimeframeButtonsForCurrentSelection()
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
            setTextColor(Color.WHITE)
            setHintTextColor(Color.rgb(120, 124, 134))
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            setPadding(dp(12), 0, dp(12), 0)
            background = gradient(
                intArrayOf(Color.rgb(28, 29, 35), Color.rgb(17, 18, 23)),
                GradientDrawable.Orientation.LEFT_RIGHT
            ).apply {
                cornerRadius = dp(14).toFloat()
                setStroke(dp(1), Color.rgb(55, 57, 66))
            }
        }
    }

    private fun ensureChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(
                "dev_trader_signals",
                "Dev Trader Signals",
                NotificationManager.IMPORTANCE_HIGH
            )
        )
    }

    private fun startBackgroundAlerts() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            alertsButton.text = "ALLOW ALERTS"
            alertsButton.isEnabled = true
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4101)
            return
        }
        runCatching {
            ContextCompat.startForegroundService(this, Intent(this, SignalService::class.java))
            alertsButton.text = "ALERTS ON"
            alertsButton.isEnabled = false
        }.onFailure {
            alertsButton.text = "ALERTS RETRY"
            alertsButton.isEnabled = true
        }
    }

    private fun requestAlertPermission() {
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
                alertsButton.text = "ALLOW ALERTS"
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
            if (!bootstrapFresh) {
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
            status.text = "RECONNECTING…"
            reconnect(immediate = true)
        }

        handler.postDelayed({ safe { watchdog() } }, 2000L)
    }

    private fun showPnlCalculator() {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.rgb(7, 8, 11))
            isFillViewport = true
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(18), dp(16), dp(30))
            background = gradient(
                intArrayOf(Color.rgb(7, 8, 11), Color.rgb(17, 18, 23), Color.rgb(8, 9, 12)),
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
            minWidth = dp(48)
            minHeight = dp(44)
            textSize = 24f
            setOnClickListener { buildUi() }
        }
        header.addView(back, LinearLayout.LayoutParams(dp(52), dp(46)))
        header.addView(
            label("Calculator", 26f, Color.WHITE, 0f),
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { leftMargin = dp(10) }
        )
        root.addView(header, margins(bottom = 16))

        root.addView(label("PNL", 13f, Color.WHITE, 0f), margins(bottom = 8))
        root.addView(label("BTCUSDT Perpetual  •  USDT settlement", 14f, Color.rgb(168, 171, 181), 0f), margins(bottom = 14))

        var direction = "LONG"
        var unitMode = "COST"
        var leverage = 20

        val sideRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val longButton = actionButton("LONG")
        val shortButton = actionButton("SHORT")
        fun refreshSides() {
            longButton.alpha = if (direction == "LONG") 1f else 0.45f
            shortButton.alpha = if (direction == "SHORT") 1f else 0.45f
        }
        longButton.setOnClickListener { direction = "LONG"; refreshSides() }
        shortButton.setOnClickListener { direction = "SHORT"; refreshSides() }
        sideRow.addView(longButton, LinearLayout.LayoutParams(0, dp(52), 1f).apply { rightMargin = dp(4) })
        sideRow.addView(shortButton, LinearLayout.LayoutParams(0, dp(52), 1f).apply { leftMargin = dp(4) })
        root.addView(sideRow, margins(bottom = 14))
        refreshSides()

        root.addView(label("UNIT SETTINGS", 11f, Color.rgb(154, 158, 170), 0.08f), margins(bottom = 7))
        val amountLabel = label("Position Cost (USDT)", 12f, Color.rgb(166, 169, 179), 0f)
        root.addView(amountLabel, margins(bottom = 5))
        val amountEdit = numberField("Cost / Quantity", "100")
        root.addView(amountEdit, margins(bottom = 12))

        val unitRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val quantityButton = actionButton("QUANTITY / BTC")
        val costButton = actionButton("POSITION COST / USDT")
        fun refreshUnits() {
            quantityButton.alpha = if (unitMode == "QUANTITY") 1f else 0.45f
            costButton.alpha = if (unitMode == "COST") 1f else 0.45f
        }
        quantityButton.setOnClickListener {
            unitMode = "QUANTITY"
            refreshUnits()
            amountLabel.text = "Quantity (BTC)"
            amountEdit.hint = "e.g. 0.01"
        }
        costButton.setOnClickListener {
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
        root.addView(label("Open Price (USDT)", 12f, Color.rgb(166, 169, 179), 0f), margins(bottom = 5))
        root.addView(openEdit, margins(bottom = 12))
        root.addView(label("Closing Price (USDT)", 12f, Color.rgb(166, 169, 179), 0f), margins(bottom = 5))
        root.addView(closeEdit, margins(bottom = 14))

        val leverageLabel = label("Leverage  •  20x", 12f, Color.rgb(166, 169, 179), 0f)
        root.addView(leverageLabel, margins(bottom = 4))
        val leverageBar = SeekBar(this).apply { max = 149; progress = 19; splitTrack = false }
        leverageBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                leverage = progress + 1
                leverageLabel.text = "Leverage  •  " + leverage + "x"
            }
            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        })
        root.addView(leverageBar, margins(bottom = 16))

        val resultsCard = card("RESULTS", "Margin  —\nP&L  — USDT\nROI  —\nPrice Move  —", 15f)
        root.addView(resultsCard.container, margins(bottom = 10))
        val results = resultsCard.value

        val calcButton = actionButton("CALCULATE P&L")
        calcButton.setOnClickListener {
            safe {
                val amount = amountEdit.text.toString().toDoubleOrNull()
                val entry = openEdit.text.toString().toDoubleOrNull()
                val exit = closeEdit.text.toString().toDoubleOrNull()
                if (amount == null || amount <= 0 || entry == null || entry <= 0 || exit == null || exit <= 0 || leverage <= 0) {
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
            }
        }
        root.addView(calcButton, margins(bottom = 14))

        root.addView(label(
            "Note  •  Cost mode treats the entered amount as position margin and scales notional by leverage. A 0.15% reserve is applied. Actual fees, funding and slippage can differ.",
            12f, Color.rgb(142, 146, 157), 0f
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
                            .append("   P&L ").append(sign).append(String.format(Locale.US, "%.2f", pnl))
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
            setTextColor(Color.WHITE)
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
                    setColor(Color.rgb(18, 20, 26))
                    cornerRadius = dp(18).toFloat()
                    setStroke(dp(1), Color.rgb(63, 68, 80))
                }
            )
            dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE)?.setTextColor(Color.rgb(167, 139, 250))
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
                    check.text = "Backend diagnostics failed."
                    checkButton.isEnabled = true
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
                        if (apkUrl.isBlank() || expectedSha.length < 32) {
                            updateButton.isEnabled = true
                            setUpdateStatus("UPDATE METADATA INVALID")
                        } else {
                            setUpdateStatus("DOWNLOADING • v" + remoteName)
                            val freshApkUrl = apkUrl + if (apkUrl.contains("?")) "&" else "?" + "ts=" + System.currentTimeMillis()
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
            client.newCall(request).enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                    handler.post {
                        updateButton.isEnabled = true
                        setUpdateStatus("UPDATE DOWNLOAD FAILED • RETRY")
                    }
                }

                override fun onResponse(call: okhttp3.Call, response: Response) {
                    response.use {
                        if (!it.isSuccessful || it.body == null) {
                            handler.post {
                                updateButton.isEnabled = true
                                setUpdateStatus("UPDATE DOWNLOAD FAILED • HTTP " + it.code)
                            }
                            return
                        }
                        val dir = File(cacheDir, "updates")
                        dir.mkdirs()
                        val apk = File(dir, "dev-trader-" + versionName + ".apk")
                        val digest = MessageDigest.getInstance("SHA-256")
                        FileOutputStream(apk).use { out ->
                            it.body!!.byteStream().use { input ->
                                val buffer = ByteArray(32 * 1024)
                                while (true) {
                                    val count = input.read(buffer)
                                    if (count <= 0) break
                                    digest.update(buffer, 0, count)
                                    out.write(buffer, 0, count)
                                }
                            }
                        }
                        val actualSha = digest.digest().joinToString("") { b -> "%02x".format(b) }
                        if (!actualSha.equals(expectedSha, ignoreCase = true)) {
                            apk.delete()
                            handler.post {
                                updateButton.isEnabled = true
                                setUpdateStatus("UPDATE BLOCKED • CHECKSUM FAILED")
                            }
                            return
                        }
                        handler.post {
                            updateButton.isEnabled = true
                            setUpdateStatus("UPDATE VERIFIED • INSTALLING v" + versionName)
                            installApk(apk)
                        }
                    }
                }
            })
        }.onFailure {
            handler.post {
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
                clipData = android.content.ClipData.newRawUri("Dev Trader update", uri)
            }
            startActivity(intent)
            setUpdateStatus("INSTALLER OPEN • v" + apk.name.substringAfter("dev-trader-").removeSuffix(".apk"))
        }.onFailure {
            updateButton.isEnabled = true
            setUpdateStatus("INSTALL BLOCKED • CHECK ANDROID PERMISSION")
        }
    }

    private fun getJson(url: String, callback: (Boolean, String) -> Unit) {
        runCatching {
            restClient.newCall(
                Request.Builder()
                    .url(url)
                    .get()
                    .build()
            ).enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                    handler.post { callback(false, "") }
                }

                override fun onResponse(call: okhttp3.Call, response: Response) {
                    response.use {
                        val success = it.isSuccessful
                        val body = it.body?.string().orEmpty()
                        handler.post { callback(success, body) }
                    }
                }
            })
        }.onFailure {
            handler.post { callback(false, "") }
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
        handler.postDelayed({
            safe { watchdog() }
        }, 1800L)
        handler.postDelayed(snapshotPollRunnable, 1200L)
    }

    override fun onStop() {
        stopped = true
        handler.removeCallbacks(snapshotPollRunnable)
        handler.removeCallbacks(keepaliveRunnable)
        reconnectRunnable?.let { handler.removeCallbacks(it) }
        reconnectRunnable = null
        reconnectScheduled.set(false)
        val old = socket
        socket = null
        runCatching { old?.close(1000, "dashboard in background") }
        super.onStop()
    }

    override fun onDestroy() {
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
