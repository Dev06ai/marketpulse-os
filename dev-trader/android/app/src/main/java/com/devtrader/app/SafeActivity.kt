package com.devtrader.app

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.content.FileProvider
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class SafeActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private var socket: WebSocket? = null
    private var reconnectAttempt = 0
    private val reconnectScheduled = AtomicBoolean(false)
    private var stopped = false
    private var lastSignalId: String? = null

    private lateinit var status: TextView
    private lateinit var price: TextView
    private lateinit var signal: TextView
    private lateinit var integrity: TextView
    private lateinit var update: TextView
    private lateinit var check: TextView
    private lateinit var updateButton: Button
    private lateinit var checkButton: Button

    private var updateVersion = ""
    private var updateUrl = ""
    private var updateSha = ""
    private var cachedApk: File? = null

    private val client by lazy {
        OkHttpClient.Builder()
            .pingInterval(15, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        installCrashReporter()

        buildUi()
        val previous = getSharedPreferences("dev_trader_diagnostics", Context.MODE_PRIVATE)
            .getString("last_crash", "")
            .orEmpty()
        if (previous.isNotBlank()) {
            check.text = "LAST CRASH CAPTURED\n" + previous.take(2600)
        }

        // Diagnostic-safe startup: no permission or network work runs automatically.
        updateButton.text = "START APP UPDATE CHECK"
        updateButton.setOnClickListener { safe { checkUpdate() } }

        checkButton.text = "START MARKET ENGINE"
        checkButton.setOnClickListener {
            checkButton.isEnabled = false
            safe { ensureChannel() }
            safe { requestNotificationPermission() }
            safe { connect() }
            status.text = "MARKET ENGINE\nStarting…"
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

    private fun buildUi() {
        val root = LinearLayout(this)
        root.orientation = LinearLayout.VERTICAL
        root.setPadding(dp(16), dp(16), dp(16), dp(16))
        root.setBackgroundColor(Color.rgb(11, 11, 16))

        val scroll = ScrollView(this)
        scroll.addView(root)
        setContentView(scroll)

        root.addView(label("DEV TRADER", 28f, true))
        root.addView(label("Klein • Manual Execution • Native Safe Mode", 14f, false), lp(8))

        status = card("MARKET ENGINE\nStarting…")
        price = card("BTC PRICE\n—")
        signal = card("MARKET SCANNING\nWaiting for validated setup…")
        integrity = card("DATA INTEGRITY\nStarting…")
        update = card("APP UPDATE\nChecking…")
        check = card("SYSTEM CHECK\nNot run yet.")

        root.addView(status, lp(14))
        root.addView(price, lp(10))
        root.addView(signal, lp(10))
        root.addView(integrity, lp(10))
        root.addView(update, lp(10))

        updateButton = Button(this)
        updateButton.text = "CHECK FOR APP UPDATE"
        root.addView(updateButton, lp(8))
        updateButton.setOnClickListener { checkUpdate() }

        root.addView(check, lp(10))
        checkButton = Button(this)
        checkButton.text = "RUN FULL SYSTEM CHECK"
        root.addView(checkButton, lp(8))
        checkButton.setOnClickListener { systemCheck() }
    }

    private fun label(value: String, size: Float, bold: Boolean): TextView {
        val v = TextView(this)
        v.text = value
        v.textSize = size
        v.setTextColor(Color.WHITE)
        if (bold) v.setTypeface(v.typeface, android.graphics.Typeface.BOLD)
        return v
    }

    private fun card(value: String): TextView {
        val v = label(value, 16f, false)
        v.setPadding(dp(16), dp(16), dp(16), dp(16))
        v.setBackgroundColor(Color.rgb(20, 20, 29))
        v.gravity = Gravity.CENTER_VERTICAL
        return v
    }

    private fun lp(top: Int): LinearLayout.LayoutParams {
        return LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(top) }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun safe(block: () -> Unit) { runCatching { block() } }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4101)
        }
    }

    private fun ensureChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel("dev_trader_signals", "Dev Trader Signals", NotificationManager.IMPORTANCE_HIGH)
        )
    }

    private fun connect() {
        if (stopped || socket != null) return
        status.text = "MARKET ENGINE\nConnecting…"
        socket = client.newWebSocket(
            Request.Builder().url("wss://dev-trader-engine.onrender.com/ws").build(),
            object : WebSocketListener() {
                override fun onOpen(ws: WebSocket, response: Response) {
                    socket = ws
                    reconnectAttempt = 0
                    reconnectScheduled.set(false)
                    handler.post { integrity.text = "DATA INTEGRITY\nWebSocket: CONNECTED" }
                }
                override fun onMessage(ws: WebSocket, text: String) { safe {
                    val root = JSONObject(text)
                    if (root.optString("type") == "state") showState(root)
                } }
                override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                    if (socket === ws) socket = null
                    handler.post {
                        status.text = "MARKET ENGINE\nRECONNECTING…"
                        integrity.text = "DATA INTEGRITY\nWebSocket: DISCONNECTED"
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
            if (!stopped) { socket = null; connect() }
        }, delay)
    }

    private fun showState(root: JSONObject) {
        val priceValue = root.optDouble("last_price", Double.NaN)
        val health = root.optString("data_health", "UNKNOWN")
        val ws = root.optBoolean("ws_connected", false)
        val oi = root.optDouble("open_interest", Double.NaN)
        val signalObj = root.optJSONObject("signal")
        handler.post {
            status.text = "MARKET ENGINE\n" + if (health == "HEALTHY") "LIVE" else health
            price.text = "BTC PRICE\n" + if (priceValue.isNaN()) "—" else String.format("%,.2f", priceValue) +
                "\nOI " + if (oi.isNaN()) "—" else String.format("%,.2f", oi)
            integrity.text = "DATA INTEGRITY\nWebSocket: " + if (ws) "CONNECTED" else "DISCONNECTED"
            if (signalObj == null) {
                signal.text = "MARKET SCANNING\nNo validated setup right now\nEvaluating SFP • D-Line • MSS"
            } else {
                val id = signalObj.optString("id")
                signal.text = "TRADE CALL\n" + signalObj.optString("direction") + " • " + signalObj.optString("setup") +
                    "\nEntry " + String.format("%.2f", signalObj.optDouble("entry")) +
                    "\nSL " + String.format("%.2f", signalObj.optDouble("stop")) +
                    "\nTP1 " + String.format("%.2f", signalObj.optDouble("target1")) +
                    "\nTP2 " + String.format("%.2f", signalObj.optDouble("target2")) +
                    "\nR:R " + String.format("%.2f", signalObj.optDouble("rr"))
                if (id.isNotBlank() && id != lastSignalId) {
                    lastSignalId = id
                    safe { notifySignal(signalObj) }
                }
            }
        }
    }

    private fun notifySignal(signalObj: JSONObject) {
        val n = NotificationCompat.Builder(this, "dev_trader_signals")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("BTC " + signalObj.optString("direction") + " • " + signalObj.optString("setup"))
            .setContentText("Entry " + String.format("%.2f", signalObj.optDouble("entry")) +
                " • SL " + String.format("%.2f", signalObj.optDouble("stop")) +
                " • R:R " + String.format("%.2f", signalObj.optDouble("rr")))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
        getSystemService(NotificationManager::class.java).notify(2001, n)
    }

    private fun systemCheck() {
        checkButton.isEnabled = false
        check.text = "SYSTEM CHECK\nRunning…"
        getJson("https://dev-trader-engine.onrender.com/system-check") { ok, body ->
            handler.post {
                if (!ok) {
                    check.text = "SYSTEM CHECK\nBackend diagnostics failed."
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
                    check.text = "SYSTEM CHECK\n" +
                        "Backend API: " + if (api) "PASS" else "FAIL" + "\n" +
                        "Bybit feed: " + if (healthy) "HEALTHY" else "NOT HEALTHY" + "\n" +
                        "Backend WebSocket: " + if (ws) "CONNECTED" else "DISCONNECTED" + "\n" +
                        "Strategy engine: " + if (scanning) "SCANNING" else "NOT READY" + "\n" +
                        "Local notifications: " + if (notifications) "PASS" else "NOT GRANTED"
                }
                checkButton.isEnabled = true
            }
        }
    }

    private fun checkUpdate() {
        getJson("https://raw.githubusercontent.com/Dev06ai/marketpulse-os/dev-trader-v1/dev-trader/update.json") { ok, body ->
            if (!ok) return@getJson
            safe {
                val j = JSONObject(body)
                val remoteCode = j.optLong("versionCode", 0L)
                val currentCode = packageManager.getPackageInfo(packageName, 0).longVersionCode
                if (!j.optBoolean("enabled", false) || remoteCode <= currentCode) {
                    handler.post { update.text = "APP UPDATE\nYou are up to date." }
                    return@safe
                }
                updateVersion = j.optString("versionName", "new")
                updateUrl = j.optString("apkUrl", "")
                updateSha = j.optString("sha256", "")
                handler.post {
                    update.text = "APP UPDATE\nVersion " + updateVersion + " is available."
                    updateButton.text = "INSTALL UPDATE"
                    updateButton.setOnClickListener { downloadUpdate() }
                }
            }
        }
    }

    private fun downloadUpdate() {
        if (updateUrl.isBlank() || updateSha.isBlank()) return
        cachedApk?.takeIf { it.exists() }?.let { installApk(it); return }
        updateButton.isEnabled = false
        update.text = "APP UPDATE\nDownloading and verifying…"
        client.newCall(Request.Builder().url(updateUrl).build()).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                handler.post { updateButton.isEnabled = true; update.text = "APP UPDATE\nDownload failed." }
            }
            override fun onResponse(call: okhttp3.Call, response: Response) {
                response.use {
                    try {
                        if (!it.isSuccessful) throw java.io.IOException("HTTP " + it.code)
                        val body = it.body ?: throw java.io.IOException("Empty APK")
                        val temp = File.createTempFile("devtrader-", ".tmp", cacheDir)
                        val target = File(cacheDir, "dev-trader-" + updateVersion + ".apk")
                        val digest = MessageDigest.getInstance("SHA-256")
                        body.byteStream().use { input -> FileOutputStream(temp).use { output ->
                            val buffer = ByteArray(16384)
                            while (true) { val n = input.read(buffer); if (n <= 0) break; digest.update(buffer, 0, n); output.write(buffer, 0, n) }
                        } }
                        val actual = digest.digest().joinToString("") { b -> "%02x".format(b) }
                        if (!actual.equals(updateSha, true)) throw java.io.IOException("Checksum mismatch")
                        target.delete()
                        if (!temp.renameTo(target)) throw java.io.IOException("Could not save update")
                        cachedApk = target
                        handler.post { updateButton.isEnabled = true; update.text = "APP UPDATE\nVerified. Opening installer…"; installApk(target) }
                    } catch (_: Throwable) {
                        handler.post { updateButton.isEnabled = true; update.text = "APP UPDATE\nUpdate rejected safely." }
                    }
                }
            }
        })
    }

    private fun installApk(file: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
            Toast.makeText(this, "Allow Dev Trader to install updates, then try again.", Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + packageName)))
            return
        }
        val uri = FileProvider.getUriForFile(this, packageName + ".fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        safe { startActivity(intent) }
    }

    private fun getJson(url: String, callback: (Boolean, String) -> Unit) {
        client.newCall(Request.Builder().url(url).get().build()).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: java.io.IOException) { handler.post { callback(false, "") } }
            override fun onResponse(call: okhttp3.Call, response: Response) { response.use { handler.post { callback(it.isSuccessful, it.body?.string().orEmpty()) } } }
        })
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