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
import android.widget.Button
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
    private lateinit var update: TextView
    private lateinit var check: TextView
    private lateinit var updateButton: Button
    private lateinit var checkButton: Button

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

        val market = card("BITCOIN  /  LIVE MARKET", "BTC  —
OI   —", 22f)
        price = market.value
        root.addView(market.container, margins(bottom = 10))

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
        root.addView(updateButton, margins(bottom = 12))

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
        val priceValue = root.optDouble("last_price", Double.NaN)
        val health = root.optString("data_health", "UNKNOWN")
        val ws = root.optBoolean("ws_connected", false)
        val oi = root.optDouble("open_interest", Double.NaN)
        val signalObj = root.optJSONObject("signal")

        handler.post {
            status.text = if (health == "HEALTHY") "LIVE" else health
            price.text = "BTC  " + if (priceValue.isNaN()) "—"
                else String.format(Locale.US, "%,.2f", priceValue) +
                "\nOI   " + if (oi.isNaN()) "—"
                else String.format(Locale.US, "%,.2f", oi)
            integrity.text = "WebSocket  •  " + if (ws) "CONNECTED" else "DISCONNECTED"

            if (signalObj == null) {
                signal.text = "NO VALIDATED SETUP\nSFP  •  D-Line  •  MSS"
            } else {
                signal.text = "TRADE CALL  •  " + signalObj.optString("direction") +
                    "\n" + signalObj.optString("setup") +
                    "\nEntry  " + String.format(Locale.US, "%.2f", signalObj.optDouble("entry")) +
                    "    SL  " + String.format(Locale.US, "%.2f", signalObj.optDouble("stop")) +
                    "\nTP1  " + String.format(Locale.US, "%.2f", signalObj.optDouble("target1")) +
                    "    TP2  " + String.format(Locale.US, "%.2f", signalObj.optDouble("target2")) +
                    "\nR:R  " + String.format(Locale.US, "%.2f", signalObj.optDouble("rr"))
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

                    check.text = "API  " + if (api) "PASS" else "FAIL" +
                        "\nBybit  " + if (healthy) "HEALTHY" else "NOT HEALTHY" +
                        "\nEngine WS  " + if (ws) "CONNECTED" else "DISCONNECTED" +
                        "\nStrategy  " + if (scanning) "SCANNING" else "NOT READY" +
                        "\nAlerts  " + if (notifications) "READY" else "NOT ENABLED"
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
                        "UP TO DATE  •  v" + BuildConfig.VERSION_NAME
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
