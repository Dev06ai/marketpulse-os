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
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
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
    private lateinit var replay: TextView
    private lateinit var chart: MarketChartView
    private lateinit var accountEdit: EditText
    private lateinit var riskEdit: EditText
    private lateinit var updateButton: Button
    private lateinit var checkButton: Button
    private lateinit var alertsButton: Button
    private var selectedTf = "15m"
    private var lastStateReceivedMs = 0L
    private var latestRoot: JSONObject? = null
    private var lastSignalId: String? = null
    private var pendingUiUpdate = false
    private var lastUiRenderMs = 0L
    private var lastChartRequestMs = 0L
    private var chartRequestInFlight = false
    private var lastBootstrapMs = 0L
    private var bootstrapInFlight = false
    private var retryButton: Button? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var lastSocketActivityMs = 0L
    private var lastRetryRequestMs = 0L

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

        handler.postDelayed({
            safe { bootstrap(true) }
        }, 150L)
        handler.postDelayed({
            safe { connect() }
        }, 500L)
        handler.postDelayed({
            safe { watchdog() }
        }, 3000L)
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
                requestChartIfNeeded(true)
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

        val context = card("MARKET PULSE", "REGIME —  •  STRUCTURE —\n15m —  /  1h —  /  4h —\nCVD —  •  OI —  •  FVG —  •  OB —", 14f)
        features = context.value
        root.addView(context.container, margins(bottom = 12))

        val data = card("DATA FEED", "WebSocket  •  CONNECTING", 14f)
        integrity = data.value
        root.addView(data.container, margins(bottom = 12))

        val riskCard = card("RISK  /  MANUAL EXECUTION", "No active setup", 14f)
        risk = riskCard.value
        root.addView(riskCard.container, margins(bottom = 8))

        val riskRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        accountEdit = numberField("Account", "5000")
        riskEdit = numberField("Risk %", "1")
        riskRow.addView(accountEdit, LinearLayout.LayoutParams(0, dp(54), 2f).apply { rightMargin = dp(5) })
        riskRow.addView(riskEdit, LinearLayout.LayoutParams(0, dp(54), 1f).apply { leftMargin = dp(5) })
        root.addView(riskRow, margins(bottom = 8))

        val riskButton = actionButton("CALCULATE RISK")
        riskButton.setOnClickListener { safe { calculateRisk() } }
        root.addView(riskButton, margins(bottom = 12))

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

        val replayCard = card("REPLAY  /  BACKTEST", "Ready", 13f)
        replay = replayCard.value
        root.addView(replayCard.container, margins(bottom = 8))
        val replayButton = actionButton("RUN RECENT REPLAY")
        replayButton.setOnClickListener { safe { runReplay() } }
        root.addView(replayButton, margins(bottom = 16))

        root.addView(label(
            "AUTO-START  •  FAST SETUP SCAN  •  MANUAL TRADING ONLY  •  NO AUTO EXECUTION",
            9f, Color.rgb(112, 116, 126), 0.06f
        ).apply { gravity = Gravity.CENTER })
    }

    private fun label(text: String, size: Float, color: Int, spacing: Float): TextView {
        return TextView(this).apply {
            this.text = text
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
            text = title
            textSize = 11f
            setTextColor(Color.rgb(150, 154, 164))
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            letterSpacing = 0.11f
        }
        box.addView(heading)

        val value = TextView(this).apply {
            text = initial
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
            text = label
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
            handler.removeCallbacksAndMessages(null)
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
                                    safe { renderState(root) }
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
        if (stopped || socket != null) return
        if (immediate) {
            reconnectScheduled.set(false)
            handler.post {
                if (!stopped) {
                    bootstrap(true)
                    connect(force = true)
                }
            }
            return
        }
        if (!reconnectScheduled.compareAndSet(false, true)) return
        val attempt = reconnectAttempt.coerceAtMost(4)
        val delay = minOf(15000L, 1000L * (1L shl attempt))
        reconnectAttempt = minOf(reconnectAttempt + 1, 4)
        handler.postDelayed({
            reconnectScheduled.set(false)
            if (!stopped && socket == null) {
                bootstrap(false)
                connect()
            }
        }, delay)
    }

    private fun forceReconnectFromUser() {
        val now = System.currentTimeMillis()
        if (now - lastRetryRequestMs < 1500L) return
        lastRetryRequestMs = now
        reconnectAttempt = 0
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
                    if (lastStateReceivedMs == 0L) {
                        status.text = "BACKEND SYNC FAILED"
                        integrity.text = "HTTP  •  UNAVAILABLE  •  RETRYING"
                    }
                    return@post
                }
                safe {
                    val root = JSONObject(body)
                    latestRoot = root
                    lastStateReceivedMs = System.currentTimeMillis()
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

        status.text = when {
            health == "HEALTHY" -> "LIVE"
            health == "DEGRADED" -> "LIVE  •  REST FALLBACK"
            health == "CONNECTING" -> "CONNECTING…"
            health == "RECONNECTING" -> "RECONNECTING…"
            else -> health
        }
        price.text = "BTC  " + if (priceValue.isNaN()) "—"
            else String.format(Locale.US, "%,.2f", priceValue) +
            "\nOI   " + if (oi.isNaN()) "—"
            else String.format(Locale.US, "%,.2f", oi)
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
                    lead.optInt("score") + "/" + lead.optInt("max_score") + " • " + lead.optString("setup")
            } else "No live opportunity detected"
            val secondText = if (second != null) {
                second.optString("direction") + " " + second.optString("tier") + " " +
                    second.optInt("score") + "/" + second.optInt("max_score")
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
            signal.text = "OPPORTUNITY RADAR  •  LOOSE MODE\n" +
                leadText + if (secondText.isBlank()) "" else "\n" + secondText +
                if (sfpText.isBlank()) "" else "\n" + sfpText +
                if (breakoutText.isBlank()) "" else "\n" + breakoutText +
                if (scenario.isBlank()) "" else "\nSCENARIOS  •  " + scenario +
                "\nThe radar can flag early setups before full confirmation."
            risk.text = "No active setup"
        } else {
            val lifecycle = signalObj.optString("lifecycle", "ACTIVE")
            val thesis = signalObj.optJSONArray("thesis")
            val reason = if (thesis != null && thesis.length() > 0) thesis.optString(0) else ""
            val management = signalObj.optJSONObject("evidence")?.optJSONObject("position_management")
            val managementText = if (management != null) {
                "\n" + management.optString("status", "REVERSAL") + "  •  " +
                    management.optString("action", "Manage existing position") +
                    "\nWhy: " + management.optString("reason", "")
            } else ""
            signal.text = "TRADE CALL  •  " + signalObj.optString("direction") + "  •  " + lifecycle +
                "\n" + signalObj.optString("setup") +
                "\nEntry  " + String.format(Locale.US, "%.2f", signalObj.optDouble("entry")) +
                "    SL  " + String.format(Locale.US, "%.2f", signalObj.optDouble("stop")) +
                "\nTP1  " + String.format(Locale.US, "%.2f", signalObj.optDouble("target1")) +
                "    TP2  " + String.format(Locale.US, "%.2f", signalObj.optDouble("target2")) +
                "\nRR  " + String.format(Locale.US, "%.2f", signalObj.optDouble("rr")) +
                "  •  Conf " + String.format(Locale.US, "%.0f%%", signalObj.optDouble("confidence") * 100) +
                if (reason.isBlank()) "" else "\n" + reason +
                managementText

            val id = signalObj.optString("id")
            if (id.isNotBlank() && id != lastSignalId) {
                lastSignalId = id
                appendJournal(signalObj)
                loadJournal()
                safe { calculateRisk() }
            }
        }

        val story = engine?.optString("multi_timeframe_story", "").orEmpty()
        features.text =
            (if (story.isBlank()) "" else "STORY  " + story + "\n") +
            "REGIME  " + (f?.optString("regime") ?: "—") +
            "\nSTRUCTURE  " + (f?.optString("market_structure") ?: "—") +
            "\n15m / 1h / 4h  " + (f?.optString("trend_15") ?: "—") + " / " +
                (f?.optString("trend_60") ?: "—") + " / " + (f?.optString("trend_240") ?: "—") +
            "\nCVD  " + (f?.optString("cvd_price_divergence") ?: "NONE") +
            "\nOI 5m  " + String.format(Locale.US, "%.2f%%", f?.optDouble("oi_change_5m_pct", 0.0) ?: 0.0) +
            "\nFVG  " + (f?.optString("fvg_direction") ?: "NONE") +
            "\nOB  " + (f?.optString("order_block_direction") ?: "NONE") +
            "\nGolden pocket  " + (f?.optString("golden_pocket") ?: "NONE")

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
                "BTC " + signalObj.optString("direction") + " • " +
                    signalObj.optString("setup")
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

        when {
            stateAge > 5000L -> {
                integrity.text = "Feed  •  RECOVERING •  REST SNAPSHOT ACTIVE"
                status.text = "DATA RECOVERY"
                bootstrap(false)
            }
            stateAge > 9000L || socketAge > 12000L -> {
                integrity.text = "Feed  •  STALE •  REBUILDING WEBSOCKET"
                status.text = "RECONNECTING…"
                reconnect(immediate = true)
            }
        }

        handler.postDelayed({ safe { watchdog() } }, 2500L)
    }

    private fun calculateRisk() {
        val signalObj = latestRoot?.optJSONObject("signal")
        if (signalObj == null) {
            risk.text = "Waiting for a validated setup…"
            return
        }
        val entry = signalObj.optDouble("entry", Double.NaN)
        val stop = signalObj.optDouble("stop", Double.NaN)
        val target = signalObj.optDouble("target2", Double.NaN)
        if (entry.isNaN() || stop.isNaN()) return
        val account = accountEdit.text.toString().toDoubleOrNull() ?: 5000.0
        val pct = riskEdit.text.toString().toDoubleOrNull() ?: 1.0
        val url = backendBase + "/risk?account_balance=" +
            account + "&risk_pct=" + pct + "&entry=" + entry +
            "&stop=" + stop + "&target=" + target
        getJson(url) { ok, body ->
            handler.post {
                if (!ok) {
                    risk.text = "Risk engine unavailable."
                    return@post
                }
                safe {
                    val j = JSONObject(body)
                    risk.text =
                        "Risk " + String.format(Locale.US, "%.2f", j.optDouble("applied_risk_pct")) +
                        "%  •  Amount " + String.format(Locale.US, "%.2f", j.optDouble("risk_amount")) +
                        "\nStop distance " + String.format(Locale.US, "%.2f", j.optDouble("stop_distance")) +
                        " (" + String.format(Locale.US, "%.3f", j.optDouble("stop_distance_pct")) + "%)" +
                        "\nUnits @1x " + String.format(Locale.US, "%.6f", j.optDouble("units_at_1x")) +
                        "  •  RR " + String.format(Locale.US, "%.2f", j.optDouble("rr")) +
                        "\nHard cap enforced  •  Manual execution only"
                }
            }
        }
    }

    private fun journalPrefs() =
        getSharedPreferences("dev_trader_journal", Context.MODE_PRIVATE)

    private fun appendJournal(signalObj: JSONObject) {
        val old = try {
            JSONArray(journalPrefs().getString("items", "[]"))
        } catch (_: Throwable) {
            JSONArray()
        }
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
        val next = JSONArray().put(item)
        for (i in 0 until minOf(old.length(), 24)) next.put(old.optJSONObject(i))
        journalPrefs().edit().putString("items", next.toString()).apply()
    }

    private fun loadJournal() {
        val arr = try {
            JSONArray(journalPrefs().getString("items", "[]"))
        } catch (_: Throwable) {
            JSONArray()
        }
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
                    val healthy = market?.optString("data_health") == "HEALTHY"
                    val ws = market?.optBoolean("ws_connected", false) == true
                    val scanning = strategy?.optString("status") == "SCANNING"
                    val notifications = Build.VERSION.SDK_INT < 33 ||
                        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

                    val apiText = if (api) "PASS" else "FAIL"
                    val bybitText = if (healthy) "HEALTHY" else "NOT HEALTHY"
                    val wsText = if (ws) "CONNECTED" else "DISCONNECTED"
                    val strategyText = if (scanning) "SCANNING" else "NOT READY"
                    val alertText = if (notifications) "READY" else "NOT ENABLED"
                    val featureJson = j.optJSONObject("features")
                    check.text = "API  " + apiText +
                        "\nBybit  " + bybitText +
                        "\nEngine WS  " + wsText +
                        "\nStrategy  " + strategyText +
                        "\nSignal  " + (strategy?.optString("signal_state", "NONE") ?: "NONE") +
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
            client.newCall(
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
        handler.postDelayed({
            safe { connect() }
        }, 300L)
    }

    override fun onDestroy() {
        stopped = true
        runCatching {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            networkCallback?.let { cm.unregisterNetworkCallback(it) }
        }
        networkCallback = null
        handler.removeCallbacksAndMessages(null)
        reconnectScheduled.set(false)
        runCatching { socket?.close(1000, "activity destroyed") }
        socket = null
        super.onDestroy()
    }
}
