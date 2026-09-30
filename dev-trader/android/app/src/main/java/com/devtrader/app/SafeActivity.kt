package com.devtrader.app

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
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

    private val client by lazy {
        OkHttpClient.Builder()
            .pingInterval(15, TimeUnit.SECONDS)
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

        handler.postDelayed({
            safe { connect() }
        }, 700L)
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
            setBackgroundColor(Color.rgb(8, 9, 12))
            isFillViewport = true
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(18), dp(18), dp(28))
            background = gradient(
                intArrayOf(Color.rgb(8, 9, 12), Color.rgb(18, 19, 24), Color.rgb(7, 8, 11)),
                GradientDrawable.Orientation.TL_BR
            )
        }

        ViewCompat.setOnApplyWindowInsetsListener(scroll) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            root.setPadding(dp(18), bars.top + dp(16), dp(18), bars.bottom + dp(24))
            insets
        }

        scroll.addView(root)
        setContentView(scroll)

        val eyebrow = TextView(this).apply {
            text = "DEV TRADER  /  KLEIN"
            textSize = 12f
            setTextColor(Color.rgb(151, 156, 166))
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            letterSpacing = 0.12f
        }
        root.addView(eyebrow)

        val title = TextView(this).apply {
            text = "Trading engine"
            textSize = 31f
            setTextColor(Color.WHITE)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            includeFontPadding = false
        }
        root.addView(title, margins(top = 5, bottom = 3))

        val subtitle = TextView(this).apply {
            text = "Manual execution  •  SFP  •  D-Line  •  MSS"
            textSize = 14f
            setTextColor(Color.rgb(174, 178, 188))
        }
        root.addView(subtitle, margins(bottom = 16))

        val engine = card("MARKET ENGINE", "Connecting…", 22f)
        status = engine.value
        root.addView(engine.container, margins(bottom = 10))

        val market = card("BITCOIN  /  LIVE MARKET", "BTC  —\\nOI   —", 22f)
        price = market.value
        root.addView(market.container, margins(bottom = 10))

        root.addView(label("PRICE ACTION  •  50 EMA", 11f, Color.rgb(150, 154, 164), 0.11f), margins(bottom = 6))
        chart = MarketChartView(this)
        chart.minimumHeight = dp(280)
        root.addView(chart, LinearLayout.LayoutParams(-1, dp(280)).apply { bottomMargin = dp(6) })

        val tfRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        listOf("15m", "1h", "4h").forEach { tf ->
            val b = actionButton(tf)
            b.setOnClickListener {
                selectedTf = tf
                chart.setTimeframe(tf)
                renderChartFromState()
            }
            tfRow.addView(b, LinearLayout.LayoutParams(0, dp(44), 1f).apply {
                leftMargin = dp(3)
                rightMargin = dp(3)
            })
        }
        root.addView(tfRow, margins(bottom = 12))

        val scan = card("SIGNAL ENGINE", "Scanning validated setups…", 18f)
        signal = scan.value
        root.addView(scan.container, margins(bottom = 10))

        val data = card("DATA INTEGRITY", "WebSocket  •  Connecting", 16f)
        integrity = data.value
        root.addView(data.container, margins(bottom = 10))

        val appUpdate = card("APP UPDATE", "Ready", 16f)
        update = appUpdate.value
        root.addView(appUpdate.container, margins(bottom = 10))

        updateButton = actionButton("CHECK FOR UPDATES")
        updateButton.setOnClickListener { safe { checkUpdate() } }
        root.addView(updateButton, margins(bottom = 10))

        val contextCard = card("MARKET CONTEXT", "Loading regime and structure…", 14f)
        features = contextCard.value
        root.addView(contextCard.container, margins(bottom = 10))

        val riskCard = card("PROP RISK ENGINE", "Waiting for a validated setup…", 14f)
        risk = riskCard.value
        root.addView(riskCard.container, margins(bottom = 8))

        val riskRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        accountEdit = numberField("Account", "5000")
        riskEdit = numberField("Risk %", "1")
        riskRow.addView(accountEdit, LinearLayout.LayoutParams(0, dp(52), 2f).apply { rightMargin = dp(5) })
        riskRow.addView(riskEdit, LinearLayout.LayoutParams(0, dp(52), 1f).apply { leftMargin = dp(5) })
        root.addView(riskRow, margins(bottom = 8))

        val riskButton = actionButton("CALCULATE RISK")
        riskButton.setOnClickListener { safe { calculateRisk() } }
        root.addView(riskButton, margins(bottom = 10))

        val journalCard = card("TRADING JOURNAL", "No signals recorded yet.", 14f)
        journal = journalCard.value
        root.addView(journalCard.container, margins(bottom = 8))
        val journalButton = actionButton("REFRESH JOURNAL")
        journalButton.setOnClickListener { loadJournal() }
        root.addView(journalButton, margins(bottom = 10))

        val replayCard = card("MARKET REPLAY / BACKTEST", "Not run yet.", 14f)
        replay = replayCard.value
        root.addView(replayCard.container, margins(bottom = 8))
        val replayButton = actionButton("RUN RECENT 15M REPLAY")
        replayButton.setOnClickListener { safe { runReplay() } }
        root.addView(replayButton, margins(bottom = 10))

        val diagnostics = card("SYSTEM CHECK", "Not run yet", 16f)
        check = diagnostics.value
        root.addView(diagnostics.container, margins(bottom = 10))

        checkButton = actionButton("RUN SYSTEM CHECK")
        checkButton.setOnClickListener { safe { systemCheck() } }
        root.addView(checkButton)

        val footer = TextView(this).apply {
            text = "ENGINE AUTO-STARTS  •  MANUAL TRADING ONLY"
            textSize = 11f
            setTextColor(Color.rgb(122, 126, 136))
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            letterSpacing = 0.08f
            gravity = Gravity.CENTER
        }
        root.addView(footer, margins(top = 18))
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
            setLineSpacing(0f, 1.12f)
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
            minHeight = dp(52)
            minWidth = 0
            background = gradient(
                intArrayOf(Color.rgb(58, 60, 69), Color.rgb(34, 35, 42)),
                GradientDrawable.Orientation.LEFT_RIGHT
            ).apply {
                cornerRadius = dp(16).toFloat()
                setStroke(dp(1), Color.rgb(84, 87, 98))
            }
            stateListAnimator = null
            elevation = 0f
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

    private fun connect() {
        if (stopped || socket != null) return

        status.text = "Connecting…"
        socket = client.newWebSocket(
            Request.Builder()
                .url("wss://dev-trader-engine.onrender.com/ws")
                .build(),
            object : WebSocketListener() {
                override fun onOpen(ws: WebSocket, response: Response) {
                    socket = ws
                    reconnectAttempt = 0
                    reconnectScheduled.set(false)
                    handler.post {
                        status.text = "LIVE"
                        integrity.text = "WebSocket  •  CONNECTED"
                    }
                }

                override fun onMessage(ws: WebSocket, text: String) {
                    safe {
                        val root = JSONObject(text)
                        if (root.optString("type") == "state") showState(root)
                    }
                }

                override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                    if (socket === ws) socket = null
                    handler.post {
                        status.text = "RECONNECTING…"
                        integrity.text = "WebSocket  •  DISCONNECTED"
                    }
                    reconnect()
                }

                override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                    if (socket === ws) socket = null
                    if (!stopped) reconnect()
                }
            }
        )
    }

    private fun reconnect() {
        if (stopped || !reconnectScheduled.compareAndSet(false, true)) return
        val attempt = reconnectAttempt.coerceAtMost(5)
        val delay = minOf(30000L, 1000L * (1L shl attempt))
        reconnectAttempt = minOf(reconnectAttempt + 1, 5)
        handler.postDelayed({
            reconnectScheduled.set(false)
            if (!stopped) {
                socket = null
                connect()
            }
        }, delay)
    }

    private fun showState(root: JSONObject) {
        latestRoot = root
        lastStateReceivedMs = System.currentTimeMillis()
        val priceValue = root.optDouble("last_price", Double.NaN)
        val health = root.optString("data_health", "UNKNOWN")
        val ws = root.optBoolean("ws_connected", false)
        val oi = root.optDouble("open_interest", Double.NaN)
        val signalObj = root.optJSONObject("signal")
        val engine = root.optJSONObject("engine")
        val f = root.optJSONObject("features")

        handler.post {
            status.text = if (health == "HEALTHY") "LIVE" else health
            price.text = "BTC  " + if (priceValue.isNaN()) "—"
                else String.format(Locale.US, "%,.2f", priceValue) +
                "\nOI   " + if (oi.isNaN()) "—"
                else String.format(Locale.US, "%,.2f", oi)
            integrity.text = "WebSocket  •  " + if (ws) "CONNECTED" else "DISCONNECTED"

            if (signalObj == null) {
                val reason = engine?.optString("wait_reason").orEmpty()
                signal.text = "NO VALIDATED SETUP\nSFP  •  D-Line  •  MSS" +
                    if (reason.isBlank()) "" else "\n" + reason.take(240)
                risk.text = "Waiting for a validated setup…"
            } else {
                val lifecycle = signalObj.optString("lifecycle", "ACTIVE")
                val thesis = signalObj.optJSONArray("thesis")
                val reason = if (thesis != null && thesis.length() > 0) thesis.optString(0) else ""
                signal.text = "TRADE CALL  •  " + signalObj.optString("direction") + "  •  " + lifecycle +
                    "\n" + signalObj.optString("setup") +
                    "\nEntry  " + String.format(Locale.US, "%.2f", signalObj.optDouble("entry")) +
                    "    SL  " + String.format(Locale.US, "%.2f", signalObj.optDouble("stop")) +
                    "\nTP1  " + String.format(Locale.US, "%.2f", signalObj.optDouble("target1")) +
                    "    TP2  " + String.format(Locale.US, "%.2f", signalObj.optDouble("target2")) +
                    "\nR:R  " + String.format(Locale.US, "%.2f", signalObj.optDouble("rr")) +
                    "  •  Conf " + String.format(Locale.US, "%.0f%%", signalObj.optDouble("confidence") * 100) +
                    if (reason.isBlank()) "" else "\n" + reason
                val id = signalObj.optString("id")
                if (id.isNotBlank() && id != lastSignalId) {
                    lastSignalId = id
                    appendJournal(signalObj)
                    loadJournal()
                    safe { calculateRisk() }
                    sendLocalSignalAlert(signalObj)
                }
            }

            features.text =
                "REGIME  " + (f?.optString("regime") ?: "—") +
                "\nSTRUCTURE  " + (f?.optString("market_structure") ?: "—") +
                "\n15m / 1h / 4h  " + (f?.optString("trend_15") ?: "—") + " / " +
                    (f?.optString("trend_60") ?: "—") + " / " + (f?.optString("trend_240") ?: "—") +
                "\nCVD  " + (f?.optString("cvd_price_divergence") ?: "NONE") +
                "    OI15m  " + String.format(Locale.US, "%.2f%%", f?.optDouble("oi_change_15m_pct", 0.0) ?: 0.0) +
                "\nFVG  " + (f?.optString("fvg_direction") ?: "NONE") +
                "    OB  " + (f?.optString("order_block_direction") ?: "NONE") +
                "\nGolden pocket  " + (f?.optString("golden_pocket") ?: "NONE") +
                "\nWeekly open  " + String.format(Locale.US, "%.2f", f?.optDouble("weekly_open", 0.0) ?: 0.0)
            renderChartFromState()
        }
    }

    private fun renderChartFromState() {
        val root = latestRoot ?: return
        val key = when (selectedTf) { "1h" -> "candles_60"; "4h" -> "candles_4h"; else -> "candles_15" }
        val candles = root.optJSONArray(key) ?: JSONArray()
        chart.setTimeframe(selectedTf)
        chart.setData(candles, root.optJSONObject("signal"), calculateEma(candles, 50), root.optDouble("last_price", Double.NaN))
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

    private fun requestAlertPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4101)
        } else {
            alertsButton.text = "SIGNAL ALERTS ENABLED"
            alertsButton.isEnabled = false
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
        val age = if (lastStateReceivedMs == 0L) Long.MAX_VALUE
            else System.currentTimeMillis() - lastStateReceivedMs
        if (age > 8000L && socket != null) {
            integrity.text = "WebSocket  •  STALE (>8s)"
            status.text = "DATA STALE"
        }
        handler.postDelayed({ safe { watchdog() } }, 3000L)
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
        val url = "https://dev-trader-engine.onrender.com/risk?account_balance=" +
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
        getJson("https://dev-trader-engine.onrender.com/backtest/recent?lookback=240") { ok, body ->
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
        getJson("https://dev-trader-engine.onrender.com/system-check") { ok, body ->
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
                    check.text = "API  " + apiText +
                        "\nBybit  " + bybitText +
                        "\nEngine WS  " + wsText +
                        "\nStrategy  " + strategyText +
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

                    update.text = if (!j.optBoolean("enabled", false) || remoteCode <= currentCode) {
                        "UP TO DATE  •  build " + currentCode
                    } else {
                        "UPDATE AVAILABLE  •  v" + remoteName
                    }
                }
            }
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
        handler.removeCallbacksAndMessages(null)
        reconnectScheduled.set(false)
        socket?.close(1000, "activity destroyed")
        socket = null
        runCatching { client.dispatcher.executorService.shutdown() }
        super.onDestroy()
    }
}
