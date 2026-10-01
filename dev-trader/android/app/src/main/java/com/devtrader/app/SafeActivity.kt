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
                index + 3,
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
    private lateinit var signal: TextView
    private lateinit var integrity: TextView
    private lateinit var features: TextView
    private lateinit var update: TextView
    private lateinit var check: TextView
    private lateinit var risk: TextView
    private lateinit var journal: TextView
    private lateinit var tradeHistory: TextView
    private lateinit var replay: TextView
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
    private var lastBootstrapMs = 0L
    private var lastBootstrapSuccessMs = 0L
    private var bootstrapInFlight = false
    private val snapshotPollRunnable = object : Runnable {
        override fun run() {
            if (stopped) return
            bootstrap(false)
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

    private val backendBase = "https://dev-trader-engine.onrender.com"

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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        window.statusBarColor = Color.rgb(8, 9, 12)
        window.navigationBarColor = Color.rgb(8, 9, 12)
        installCrashReporter()
        buildUi()
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

    private fun setTradeSetupText(text: String) {
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
        colorAll("NO CONFIRMED TRADE YET", Color.rgb(167, 139, 250))
        signal.text = styled
    }

    private fun buildUi() {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.rgb(7, 8, 11))
            isFillViewport = true
            overScrollMode = View.OVER_SCROLL_NEVER
            isClickable = false
            isFocusable = false
            descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            isClickable = false
            isFocusable = false
            setPadding(dp(16), dp(18), dp(16), dp(30))
            background = gradient(
                intArrayOf(Color.rgb(7, 8, 11), Color.rgb(17, 18, 23), Color.rgb(8, 9, 12)),
                GradientDrawable.Orientation.TL_BR
            )
        }

        ViewCompat.setOnApplyWindowInsetsListener(scroll) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            root.setPadding(dp(16), bars.top + dp(12), dp(16), bars.bottom + dp(28))
            insets
        }

        scroll.addView(root)
        setContentView(scroll)

        val topRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        topRow.addView(
            label("DEV TRADER  •  BTCUSDT PERPETUAL", 11f, Color.rgb(154, 158, 170), 0.09f),
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        retryButton = actionButton("↻ RETRY").apply {
            textSize = 11f
            minHeight = dp(38)
            minWidth = dp(86)
            setPadding(dp(8), 0, dp(8), 0)
            setOnClickListener { safe { forceReconnectFromUser() } }
        }
        topRow.addView(retryButton, LinearLayout.LayoutParams(dp(92), dp(40)).apply {
            leftMargin = dp(8)
        })
        root.addView(topRow, margins(bottom = 2))
        root.addView(label("BTC trading bot", 32f, Color.WHITE, 0f), margins(top = 5, bottom = 2))
        // 0.9.6 release: directional SFP radar + clearer active-scan state
        // 0.9.4 release: stable WebSocket supervisor + manual retry + cleaner MTF story
        root.addView(label("FAST SETUP SCANNER  •  MANUAL EXECUTION", 13f, Color.rgb(173, 177, 188), 0f), margins(bottom = 14))

        val live = card("MARKET STATUS", "LIVE  •  DATA CONNECTING", 16f)
        status = live.value
        root.addView(live.container, margins(bottom = 10))

        val market = card("BTCUSDT  /  LIVE MARKET", "BTC  —\nOI  —", 25f)
        price = market.value
        root.addView(market.container, margins(bottom = 12))

        root.addView(label("PRICE ACTION", 11f, Color.rgb(156, 160, 171), 0.11f), margins(bottom = 6))
        chart = MarketChartView(this).apply {
            minimumHeight = dp(410)
            isClickable = false
            isFocusable = false
            setOnTouchListener { _, _ -> false }
        }
        root.addView(chart, LinearLayout.LayoutParams(-1, dp(410)).apply { bottomMargin = dp(10) })

        val tfRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 0, 0, 0)
        }
        listOf("5m", "15m", "1h", "4h").forEach { tf ->
            val b = actionButton(tf)
            b.isClickable = true
            b.isFocusable = true
            b.setOnClickListener {
                selectedTf = tf
                chart.setTimeframe(tf)
                bootstrap(true)
            }
            tfRow.addView(b, LinearLayout.LayoutParams(0, dp(46), 1f).apply {
                leftMargin = dp(3)
                rightMargin = dp(3)
            })
        }
        root.addView(tfRow, margins(bottom = 14))

        val setup = card("TRADE SETUP", "SCANNING  •  LOOSE MODE\nSFP  •  D-Line  •  MSS", 18f)
        signal = setup.value
        root.addView(setup.container, margins(bottom = 12))

        val context = card("MARKET STORY", "BIAS —\n4H —  •  1H —  •  15m —\nWAVE 15m —  •  1H —\nTRIGGERS —", 13f)
        features = context.value
        root.addView(context.container, margins(bottom = 12))

        val data = card("DATA FEED", "WebSocket  •  CONNECTING", 14f)
        integrity = data.value
        root.addView(data.container, margins(bottom = 12))

        val riskCard = card("PNL CALCULATOR  /  USDT", "Measure profit or loss from entry to exit.", 14f)
        risk = riskCard.value
        root.addView(riskCard.container, margins(bottom = 8))

        val pnlButton = actionButton("OPEN PNL CALCULATOR")
        pnlButton.setOnClickListener { safe { showPnlCalculator() } }
        root.addView(pnlButton, margins(bottom = 12))

        val toolsRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        updateButton = actionButton("UPDATE")
        updateButton.setOnClickListener { safe { checkUpdate() } }
        checkButton = actionButton("SYSTEM CHECK")
        checkButton.setOnClickListener { safe { systemCheck() } }
        toolsRow.addView(updateButton, LinearLayout.LayoutParams(0, dp(50), 1f).apply { rightMargin = dp(5) })
        toolsRow.addView(checkButton, LinearLayout.LayoutParams(0, dp(50), 1f).apply { leftMargin = dp(5) })
        root.addView(toolsRow, margins(bottom = 10))

        val appUpdate = card("APP UPDATE", "Ready", 13f)
        update = appUpdate.value
        root.addView(appUpdate.container, margins(bottom = 12))

        val diagnostics = card("SYSTEM CHECK", "Not run yet", 13f)
        check = diagnostics.value
        root.addView(diagnostics.container, margins(bottom = 12))

        alertsButton = actionButton("ENABLE SIGNAL ALERTS")
        alertsButton.setOnClickListener { requestAlertPermission() }
        root.addView(alertsButton, margins(bottom = 12))

        val journalCard = card("TRADING JOURNAL", "No setups recorded yet.", 13f)
        journal = journalCard.value
        root.addView(journalCard.container, margins(bottom = 10))
        val journalButton = actionButton("REFRESH JOURNAL")
        journalButton.setOnClickListener { loadJournal() }
        root.addView(journalButton, margins(bottom = 12))

        val tradeHistoryCard = card("BITGET DEMO  /  EXECUTED TRADE HISTORY", "Connecting to Bitget Demo execution status…", 12f)
        tradeHistory = tradeHistoryCard.value
        root.addView(tradeHistoryCard.container, margins(bottom = 10))
        val tradeHistoryButton = actionButton("REFRESH DEMO TRADE HISTORY")
        tradeHistoryButton.setOnClickListener { safe { loadTradeHistory() } }
        root.addView(tradeHistoryButton, margins(bottom = 12))

        val replayCard = card("REPLAY  /  BACKTEST", "Ready", 13f)
        replay = replayCard.value
        root.addView(replayCard.container, margins(bottom = 8))
        val replayButton = actionButton("RUN RECENT REPLAY")
        replayButton.setOnClickListener { safe { runReplay() } }
        root.addView(replayButton, margins(bottom = 16))

        root.addView(label(
            "AUTO-START  •  FAST SETUP SCAN  •  BITGET DEMO AUTO-EXECUTION  •  LIVE MONEY DISABLED",
            9f, Color.rgb(112, 116, 126), 0.06f
        ).apply { gravity = Gravity.CENTER })
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
                .url("wss://dev-trader-engine.onrender.com/ws")
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
                    bootstrap(true)
                }

                override fun onMessage(ws: WebSocket, text: String) {
                    lastSocketActivityMs = System.currentTimeMillis()
                    safe {
                        val root = JSONObject(text)
                        if (root.optString("type") == "state") {
                            latestRoot = root
                            lastStateReceivedMs = System.currentTimeMillis()
                            val now = System.currentTimeMillis()
                            if (now - lastUiRenderMs >= 350L && !pendingUiUpdate) {
                                pendingUiUpdate = true
                                handler.post {
                                    pendingUiUpdate = false
                                    lastUiRenderMs = System.currentTimeMillis()
                                    safe { renderState(root, requestChart = false) }
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
        retryButton?.text = "RETRYING…"
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
        getJson(backendBase + "/bootstrap?interval=" + selectedTf) { ok, body ->
            handler.post {
                bootstrapInFlight = false
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
                    latestRoot = root
                    val receivedAt = System.currentTimeMillis()
                    lastStateReceivedMs = receivedAt
                    lastBootstrapSuccessMs = receivedAt
                    renderState(root, requestChart = false)
                    val chartObj = root.optJSONObject("chart")
                    val candles = chartObj?.optJSONArray("candles") ?: JSONArray()
                    if (candles.length() > 0) {
                        val lastPrice = chartObj.optDouble("last_price", root.optDouble("last_price", Double.NaN))
                        chart.setTimeframe(selectedTf)
                        chart.setLivePrice(lastPrice)
                        chart.setData(
                            candles,
                            root.optJSONObject("signal"),
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

        // REST/bootstrap can be fresh while the WebSocket is negotiating. Show the
        // truth about market-data freshness rather than briefly calling fresh data
        // "DATA RECOVERY".
        status.text = when {
            freshMarket && health == "DEGRADED" -> "LIVE  •  REST FALLBACK"
            freshMarket -> "LIVE"
            health == "HEALTHY" -> "LIVE"
            health == "DEGRADED" -> "LIVE  •  REST FALLBACK"
            health == "CONNECTING" -> "CONNECTING…"
            health == "RECONNECTING" -> "RECONNECTING…"
            else -> health
        }
        price.text = priceBtcAccent(
            "BTC  " + if (priceValue.isNaN()) "—"
                else String.format(Locale.US, "%,.2f", priceValue) +
                    "\nOI   " + if (oi.isNaN()) "—"
                else String.format(Locale.US, "%,.2f", oi)
        )
        val upstream = root.optJSONObject("upstream")
        val source = upstream?.optString("source", "").orEmpty()
        integrity.text = "WebSocket  •  " + if (ws) "CONNECTED" else "DISCONNECTED" +
            if (source.isBlank()) "" else "  •  " + source.replace("_", " ")

        if (signalObj == null) {
            val radar = engine?.optJSONArray("opportunity_radar")
            val lead = radar?.optJSONObject(0)
            val second = radar?.optJSONObject(1)
            val scenario = engine?.optJSONArray("scenario_tree")?.let { arr ->
                (0 until minOf(2, arr.length())).mapNotNull { arr.optJSONObject(it) }
                    .joinToString("  •  ") { it.optString("name") + " " + it.optString("state") }
            }.orEmpty()
            val leadText = if (lead != null) {
                lead.optString("direction") + " " + lead.optString("tier") + " " +
                    lead.optInt("score") + "/" + lead.optInt("max_score") +
                    " • " + lead.optString("setup") +
                    " • " + lead.optString("action", "watch")
            } else "No live opportunity detected"
            val secondText = if (second != null) {
                second.optString("direction") + " " + second.optString("tier") + " " +
                    second.optInt("score") + "/" + second.optInt("max_score") +
                    " • " + second.optString("action", "watch")
            } else ""
            val sfp = engine?.optJSONObject("sfp_hunter")
            val breakout = engine?.optJSONObject("breakout_watch")
            val sfpText = if (sfp != null) {
                "SFP  •  " + sfp.optString("status", "WATCH") + "  •  " +
                    sfp.optString("direction", "—") + " @ " +
                    String.format(Locale.US, "%.2f", sfp.optDouble("target_level", Double.NaN))
            } else ""
            val breakoutText = if (breakout != null) {
                "BREAKOUT  •  " + breakout.optString("status", "WATCH") + "  •  " +
                    breakout.optString("event", "NONE")
            } else ""
            setTradeSetupText("OPPORTUNITY RADAR  •  ACTIVE SCAN\n" +
                leadText + if (secondText.isBlank()) "" else "\n" + secondText +
                if (sfpText.isBlank()) "" else "\n" + sfpText +
                if (breakoutText.isBlank()) "" else "\n" + breakoutText +
                if (scenario.isBlank()) "" else "\nSCENARIOS  •  " + scenario +
                "\nNO CONFIRMED TRADE YET • radar is actively monitoring triggers.")
            risk.text = "USDT P&L calculator • quantity or cost • long/short • leverage"
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
            val styleReason = signalObj.optString("style_reason", signalObj.optJSONObject("evidence")?.optString("style_reason", ""))
            val evidenceObj = signalObj.optJSONObject("evidence")
            val riskDistance = evidenceObj?.optDouble("risk_distance", Double.NaN) ?: Double.NaN
            setTradeSetupText("TRADE CALL  •  " + signalObj.optString("direction") + "  •  " + tradeStyle + "  •  " + lifecycle +
                "\n" + signalObj.optString("setup") +
                "\nEntry  " + String.format(Locale.US, "%.2f", signalObj.optDouble("entry")) +
                "    SL  " + String.format(Locale.US, "%.2f", signalObj.optDouble("stop")) +
                "\nTP1  " + String.format(Locale.US, "%.2f", signalObj.optDouble("target1")) +
                "    TP2  " + String.format(Locale.US, "%.2f", signalObj.optDouble("target2")) +
                "\nRisk  " + (if (riskDistance.isNaN()) "—" else String.format(Locale.US, "%.2f pts", riskDistance)) +
                "  •  RR  " + String.format(Locale.US, "%.2f", signalObj.optDouble("rr")) +
                "  •  Conf " + String.format(Locale.US, "%.0f%%", signalObj.optDouble("confidence") * 100) +
                if (styleReason.isBlank()) "" else "\n" + styleReason +
                if (reason.isBlank()) "" else "\n" + reason +
                managementText)

            val id = signalObj.optString("id")
            if (id.isNotBlank() && id != lastSignalId) {
                lastSignalId = id
                appendJournal(signalObj)
                loadJournal()
            }
        }

        val execution = root.optJSONObject("execution")
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

        features.text =
            "BIAS  " + storyBias +
            "\n" + (if (storySummary.isBlank()) compactStory else storySummary) +
            "\n15m WAVE  " + (wave15Obj?.optString("phase", "UNKNOWN") ?: "UNKNOWN") +
                " • " + (wave15Obj?.optString("wave", "UNCOUNTED") ?: "UNCOUNTED") +
                " • " + (wave15Obj?.optString("direction", "NEUTRAL") ?: "NEUTRAL") +
            "\n1h WAVE  " + (wave1hObj?.optString("phase", "UNKNOWN") ?: "UNKNOWN") +
                " • " + (wave1hObj?.optString("direction", "NEUTRAL") ?: "NEUTRAL") +
            "\nTRIGGERS  " + triggerText +
            "\nSCENARIO SCORE  L " + longScore + "  •  S " + shortScore +
            "\n" + narrativeText +
            (if (noTradeReason.isBlank()) "" else "\nNO-TRADE RULE  " + noTradeReason) +
            "\nREGIME  " + (f?.optString("regime") ?: "—") +
            "  •  STRUCTURE  " + (f?.optString("market_structure") ?: "—") +
            "\nCVD  " + (f?.optString("cvd_price_divergence") ?: "NONE") +
            "  •  OI 5m  " + String.format(Locale.US, "%.2f%%", f?.optDouble("oi_change_5m_pct", 0.0) ?: 0.0) +
            "  •  FVG  " + (f?.optString("fvg_direction") ?: "NONE") +
            "  •  OB  " + (f?.optString("order_block_direction") ?: "NONE")

        chart.setLivePrice(priceValue)
        if (requestChart) requestChartIfNeeded()
    }

    private fun requestChartIfNeeded(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (chartRequestInFlight) return
        if (!force && now - lastChartRequestMs < 900L) return
        lastChartRequestMs = now
        chartRequestInFlight = true
        getJson(backendBase + "/chart?interval=" + selectedTf) { ok, body ->
            handler.post {
                chartRequestInFlight = false
                if (!ok) return@post
                safe {
                    val j = JSONObject(body)
                    val candles = j.optJSONArray("candles") ?: JSONArray()
                    val live = latestRoot?.optDouble("last_price", Double.NaN) ?: Double.NaN
                    val lastPrice = if (!live.isNaN()) live else j.optDouble("last_price", Double.NaN)
                    chart.setTimeframe(selectedTf)
                    chart.setData(candles, latestRoot?.optJSONObject("signal"), calculateEma(candles, 50), lastPrice)
                }
            }
        }
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
            alertsButton.text = "ALLOW SIGNAL ALERTS"
            alertsButton.isEnabled = true
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4101)
            return
        }
        runCatching {
            ContextCompat.startForegroundService(this, Intent(this, SignalService::class.java))
            alertsButton.text = "BACKGROUND ALERTS ACTIVE"
            alertsButton.isEnabled = false
        }.onFailure {
            alertsButton.text = "START ALERTS AGAIN"
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
                alertsButton.text = "ALLOW SIGNAL ALERTS IN SETTINGS"
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
                    tradeHistory.text = "Bitget Demo trade history unavailable."
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
                        tradeHistory.text =
                            "BITGET DEMO  •  NOT CONFIGURED\n" +
                            "Add a Bitget Demo API key, secret and passphrase on the backend.\n" +
                            "No live-money execution is enabled."
                        return@safe
                    }

                    val demoState = when {
                        ready -> "READY"
                        clientReason.contains("40099") ||
                            clientReason.contains("exchange environment is incorrect", ignoreCase = true) ->
                            "WRONG DEMO ENVIRONMENT"
                        clientReason.contains("credentials", ignoreCase = true) ->
                            "CREDENTIALS ISSUE"
                        clientReason.contains("balance", ignoreCase = true) ->
                            "BALANCE CHECK ISSUE"
                        else -> "CONNECTION ISSUE"
                    }
                    val header =
                        "BITGET DEMO  •  " + demoState +
                        "\nClosed  $total  •  Open  $openTrades  •  W $wins / L $losses" +
                        if (!ready && clientReason.isNotBlank()) "\n" + clientReason.take(180) else "" +
                        "\nWin rate  " + if (winRate.isNaN()) "—" else String.format(Locale.US, "%.1f%%", winRate * 100.0) +
                        "  •  Net P&L  " + String.format(Locale.US, "%+.2f USDT", totalNet)

                    val rows = root.optJSONArray("trades") ?: JSONArray()
                    val out = StringBuilder(header)
                    val count = minOf(10, rows.length())
                    if (count == 0) {
                        out.append("\n\nNo executed demo trades yet.")
                    } else {
                        out.append("\n")
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
                            out.append("\n")
                                .append(direction).append(" • ").append(status).append(" • ").append(setup)
                                .append("\nEntry  ").append(formatCompact(entry))
                                .append("   Exit  ").append(
                                    if (status == "CLOSED" && exit.isFinite() && exit > 0) formatCompact(exit) else "—"
                                )
                                .append("\nSL  ").append(formatCompact(sl))
                                .append("   TP  ").append(formatCompact(tp))
                                .append("\nQty  ").append(if (qty.isFinite()) String.format(Locale.US, "%.6f BTC", qty) else "—")
                                .append("   P&L  ").append(sign).append(String.format(Locale.US, "%.2f USDT", pnl))
                                .append("   R  ").append(if (resultR.isFinite()) String.format(Locale.US, "%.2f", resultR) else "—")
                            if (reason.isNotBlank()) out.append("\nClose  ").append(reason)
                            val fee = t.optDouble("fees_usdt", 0.0)
                            val funding = t.optDouble("funding_usdt", 0.0)
                            out.append("\nFees  ").append(String.format(Locale.US, "%.2f", fee))
                                .append("  Funding  ").append(String.format(Locale.US, "%.2f", funding))
                                .append("\n")
                        }
                    }
                    tradeHistory.text = out.toString().trim()
                }
            }
        }
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
                    val signalState = strategy?.optString("signal_state", "NONE") ?: "NONE"
                    val scanning = strategy?.optString("status") == "SCANNING"
                    val notifications = Build.VERSION.SDK_INT < 33 ||
                        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

                    val apiText = if (api) "PASS" else "FAIL"
                    val bybitText = when (dataHealth.uppercase(Locale.US)) {
                        "HEALTHY" -> "HEALTHY"
                        "DEGRADED" -> "DEGRADED"
                        else -> "NOT HEALTHY"
                    }
                    val wsText = if (ws) "CONNECTED" else "DISCONNECTED"
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
                        "\nBybit  " + bybitText +
                        "\nEngine WS  " + wsText +
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

    private fun checkUpdate() {
        updateButton.isEnabled = false
        update.text = "Checking release channel…"

        getJson("https://raw.githubusercontent.com/Dev06ai/marketpulse-os/dev-trader-v1/dev-trader/update.json") { ok, body ->
            handler.post {
                updateButton.isEnabled = true
                if (!ok) {
                    update.text = "Update check unavailable."
                    return@post
                }

                safe {
                    val j = JSONObject(body)
                    val remoteCode = j.optLong("versionCode", 0L)
                    val currentCode = packageManager.getPackageInfo(packageName, 0).longVersionCode
                    val remoteName = j.optString("versionName", "new")

                    if (!j.optBoolean("enabled", false) || remoteCode <= currentCode) {
                        update.text = "UP TO DATE  •  build " + currentCode
                    } else {
                        val apkUrl = j.optString("apkUrl", "")
                        val expectedSha = j.optString("sha256", "")
                        if (apkUrl.isBlank() || expectedSha.length < 32) {
                            update.text = "UPDATE METADATA INVALID"
                        } else {
                            update.text = "DOWNLOADING  •  v" + remoteName
                            downloadAndInstallUpdate(apkUrl, expectedSha, remoteName)
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
                    handler.post { update.text = "UPDATE DOWNLOAD FAILED  •  RETRY" }
                }

                override fun onResponse(call: okhttp3.Call, response: Response) {
                    response.use {
                        if (!it.isSuccessful || it.body == null) {
                            handler.post { update.text = "UPDATE DOWNLOAD FAILED  •  HTTP " + it.code }
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
                            handler.post { update.text = "UPDATE BLOCKED  •  CHECKSUM FAILED" }
                            return
                        }
                        handler.post {
                            update.text = "UPDATE VERIFIED  •  INSTALLING v" + versionName
                            installApk(apk)
                        }
                    }
                }
            })
        }.onFailure {
            update.text = "UPDATE FAILED  •  RETRY"
        }
    }

    private fun installApk(apk: File) {
        runCatching {
            val uri = FileProvider.getUriForFile(this, packageName + ".fileprovider", apk)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
        }.onFailure {
            update.text = "INSTALL BLOCKED  •  ALLOW INSTALLING FROM THIS SOURCE"
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
        stopped = false

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
