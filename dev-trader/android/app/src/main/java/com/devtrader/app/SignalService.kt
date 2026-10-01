package com.devtrader.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.math.min

// Build 73 release marker: explicit application keepalive + self-healing live connection.
class SignalService : Service() {
    companion object {
        private const val SERVICE_CHANNEL = "dev_trader_background"
        private const val SIGNAL_CHANNEL = "dev_trader_signals"
        private const val SERVICE_NOTIFICATION_ID = 3100
        private const val SIGNAL_NOTIFICATION_ID = 3101
        private const val PREFS = "dev_trader_signal_state"
        private const val PREF_LAST_SIGNAL_ID = "last_signal_id"
        private const val PREF_LAST_ALERT_KEY = "last_alert_key"
        private const val PREF_LAST_TRADE_EVENT_KEY = "last_trade_event_key"
        private const val WS_URL = "wss://dev-trader-engine.onrender.com/ws"
        private const val HEARTBEAT_URL = "https://dev-trader-engine.onrender.com/heartbeat"
        private const val KEEPALIVE_INTERVAL_MS = 15_000L
    }

    private val handler = Handler(Looper.getMainLooper())
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
                    socket = null
                    runCatching { ws.cancel() }
                    scheduleReconnect()
                }
            }
            handler.postDelayed(this, KEEPALIVE_INTERVAL_MS)
        }
    }
    private var socket: WebSocket? = null
    private var reconnectAttempt = 0
    private var stopped = false
    private var lastMessageMs = 0L
    private var reconnectScheduled = false
    private var staleChecks = 0
    private val client by lazy {
        OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .writeTimeout(8, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .pingInterval(10, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    override fun onCreate() {
        super.onCreate()
        stopped = false
        ensureChannels()
        startForegroundNotification()
        connect()
        handler.postDelayed(keepaliveRunnable, KEEPALIVE_INTERVAL_MS)
        scheduleHealthWatchdog()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        stopped = false
        if (socket == null) connect()
        scheduleHealthWatchdog()
        return START_STICKY
    }

    private fun ensureChannels() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                SERVICE_CHANNEL,
                "Dev Trader Background Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps live signal monitoring running in the background."
                setShowBadge(false)
            }
        )
        manager.createNotificationChannel(
            NotificationChannel(
                SIGNAL_CHANNEL,
                "Dev Trader Signal Alerts",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Immediate BTC long/short signal notifications."
                enableVibration(true)
                setShowBadge(true)
            }
        )
    }

    private fun startForegroundNotification() {
        val launchIntent = Intent(this, SafeActivity::class.java)
        val pending = PendingIntent.getActivity(
            this, 3100, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(this, SERVICE_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setContentTitle("Dev Trader")
            .setContentText("Background signal monitoring is active")
            .setContentIntent(pending)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(
                SERVICE_NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(SERVICE_NOTIFICATION_ID, notification)
        }
    }

    private fun connect(force: Boolean = false) {
        if (stopped) return
        if (force) {
            reconnectScheduled = false
            runCatching { socket?.cancel() }
            socket = null
        }
        if (socket != null) return
        lastMessageMs = System.currentTimeMillis()
        socket = client.newWebSocket(
            Request.Builder().url(WS_URL).build(),
            object : WebSocketListener() {
                override fun onOpen(ws: WebSocket, response: Response) {
                    reconnectAttempt = 0
                    reconnectScheduled = false
                    socket = ws
                    lastMessageMs = System.currentTimeMillis()
                    staleChecks = 0
                    runCatching {
                        ws.send(
                            JSONObject().apply {
                                put("type", "keepalive")
                                put("client_ts", System.currentTimeMillis())
                            }.toString()
                        )
                    }
                    updateServiceNotification("Live signal monitoring connected")
                }

                override fun onMessage(ws: WebSocket, text: String) {
                    lastMessageMs = System.currentTimeMillis()
                    runCatching {
                        val root = JSONObject(text)
                        if (root.optString("type") != "state") return
                        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)

                        val alert = root.optJSONObject("opportunity_alert")
                        if (alert != null) {
                            val alertKey = alert.optString("key")
                            val title = alert.optString("title")
                            val body = alert.optString("body")
                            val previousAlert = prefs.getString(PREF_LAST_ALERT_KEY, null)
                            if (alertKey.isNotBlank() && alertKey != previousAlert) {
                                prefs.edit().putString(PREF_LAST_ALERT_KEY, alertKey).apply()
                                notifyOpportunity(title, body)
                            }
                        }

                        val tradeEvent = root.optJSONObject("trade_event")
                        if (tradeEvent != null) {
                            val eventKey = tradeEvent.optString("key")
                            val previousEvent = prefs.getString(PREF_LAST_TRADE_EVENT_KEY, null)
                            if (eventKey.isNotBlank() && eventKey != previousEvent) {
                                prefs.edit().putString(PREF_LAST_TRADE_EVENT_KEY, eventKey).apply()
                                notifyTradeEvent(tradeEvent)
                            }
                        }

                        val signal = root.optJSONObject("signal") ?: return
                        val id = signal.optString("id")
                        if (id.isBlank()) return

                        val previous = prefs.getString(PREF_LAST_SIGNAL_ID, null)
                        if (id != previous) {
                            prefs.edit().putString(PREF_LAST_SIGNAL_ID, id).apply()
                            notifySignal(signal)
                        }
                    }
                }

                override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                    val owned = socket === ws
                    if (owned) socket = null
                    if (owned) scheduleReconnect()
                }

                override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                    val owned = socket === ws
                    if (owned) socket = null
                    if (owned) {
                        // Keep the persistent service quiet during a single transient
                        // socket failure; the reconnect loop is automatic. Surface the
                        // reconnect state only after repeated failures.
                        if (reconnectAttempt >= 2) {
                            updateServiceNotification("Reconnecting to live signal feed…")
                        }
                        scheduleReconnect()
                    }
                }
            }
        )
    }

    private fun scheduleReconnect() {
        if (stopped || socket != null || reconnectScheduled) return
        reconnectScheduled = true
        reconnectAttempt = min(reconnectAttempt + 1, 4)
        val delay = min(12_000L, 1_000L shl (reconnectAttempt - 1))
        handler.postDelayed({
            reconnectScheduled = false
            if (!stopped && socket == null) connect()
        }, delay)
    }

    private fun scheduleHealthWatchdog() {
        handler.removeCallbacks(healthWatchdog)
        handler.postDelayed(healthWatchdog, 4_000L)
    }

    private val healthWatchdog = object : Runnable {
        override fun run() {
            if (stopped) return
            val age = if (lastMessageMs == 0L) Long.MAX_VALUE
            else System.currentTimeMillis() - lastMessageMs

            if (age > 12_000L) {
                staleChecks += 1
                checkHeartbeatAndRecover()
            } else if (socket == null) {
                staleChecks = 0
                connect()
            }
            handler.postDelayed(this, 4_000L)
        }
    }

    private fun checkHeartbeatAndRecover() {
        if (stopped) return
        runCatching {
            client.newCall(
                Request.Builder().url(HEARTBEAT_URL).get().build()
            ).enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                    if (!stopped && staleChecks >= 3) {
                        updateServiceNotification("Live feed reconnecting…")
                        connect(force = true)
                    }
                }

                override fun onResponse(call: okhttp3.Call, response: Response) {
                    response.use {
                        if (!it.isSuccessful || it.body == null) {
                            if (!stopped && staleChecks >= 3) {
                                updateServiceNotification("Live feed reconnecting…")
                                connect(force = true)
                            }
                            return
                        }
                        val body = it.body!!.string()
                        runCatching {
                            val root = JSONObject(body)
                            val marketWs = root.optBoolean("market_ws", false)
                            val dataHealth = root.optString("data_health", "")
                            val receivedAge = root.optJSONObject("ages_ms")
                                ?.optLong("received_ms", Long.MAX_VALUE)
                                ?: Long.MAX_VALUE
                            val backendHealthy = marketWs &&
                                dataHealth in setOf("HEALTHY", "DEGRADED") &&
                                receivedAge < 10_000L

                            if (backendHealthy) {
                                // A healthy backend plus an existing socket means the
                                // connection is not proven dead. Do not churn/rebuild the
                                // socket on every quiet period; send a keepalive and let
                                // the normal WebSocket callbacks handle real disconnects.
                                if (!stopped) {
                                    staleChecks = 0
                                    socket?.send(
                                        JSONObject().apply {
                                            put("type", "keepalive")
                                            put("client_ts", System.currentTimeMillis())
                                        }.toString()
                                    )
                                }
                            } else if (!stopped && staleChecks >= 3) {
                                updateServiceNotification("Live feed reconnecting…")
                                connect(force = true)
                            }
                        }
                    }
                }
            })
        }
    }

    private fun updateServiceNotification(text: String) {
        val launchIntent = Intent(this, SafeActivity::class.java)
        val pending = PendingIntent.getActivity(
            this, 3100, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(this, SERVICE_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setContentTitle("Dev Trader")
            .setContentText(text)
            .setContentIntent(pending)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        getSystemService(NotificationManager::class.java)
            .notify(SERVICE_NOTIFICATION_ID, notification)
    }

    private fun notifySignal(signal: JSONObject) {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
            android.content.pm.PackageManager.PERMISSION_GRANTED
        ) return

        val direction = signal.optString("direction", "SIGNAL").uppercase(Locale.US)
        val setup = signal.optString("setup", "setup")
        val tradeStyle = signal.optString("trade_style", "SCALP").uppercase(Locale.US)
        val entry = signal.optDouble("entry", Double.NaN)
        val stop = signal.optDouble("stop", Double.NaN)
        val rr = signal.optDouble("rr", Double.NaN)

        val evidence = signal.optJSONObject("evidence")
        val management = evidence?.optJSONObject("position_management")
        val hasManagement = management != null

        val title: String
        val body: String

        if (hasManagement) {
            val from = management?.optString("from_direction", "POSITION").orEmpty()
            val to = management?.optString("to_direction", direction).orEmpty()
            val status = management?.optString("status", "REVERSAL").orEmpty()
            val pnlR = management?.optDouble("open_pnl_r", Double.NaN) ?: Double.NaN
            val pnlDirection = management?.optString("open_pnl_direction", "FLAT").orEmpty()
            val action = management?.optString("action", "Reassess the existing position.").orEmpty()
            val reason = management?.optString("reason", "Opposite-direction structure has been confirmed.").orEmpty()
            title = "MANAGE $from → $to"
            val pnlText = if (pnlR.isFinite()) {
                "Existing $from: $pnlDirection " + String.format(Locale.US, "%.2f", pnlR) + "R"
            } else {
                "Existing $from: current PnL unavailable"
            }
            body = "$status · $pnlText\n$action\nWhy: $reason"
        } else {
            title = "BTC $direction • $tradeStyle • $setup"
            body = "$tradeStyle · Entry " + format(entry) + " · SL " + format(stop) + " · R:R " + format(rr)
        }

        val launchIntent = Intent(this, SafeActivity::class.java)
        val pending = PendingIntent.getActivity(
            this, SIGNAL_NOTIFICATION_ID, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, SIGNAL_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body.replace("\n", " · "))
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .build()

        getSystemService(NotificationManager::class.java)
            .notify(SIGNAL_NOTIFICATION_ID, notification)
    }

    private fun notifyTradeEvent(event: JSONObject) {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
            android.content.pm.PackageManager.PERMISSION_GRANTED
        ) return

        val type = event.optString("type", "TRADE_EVENT")
        val direction = event.optString("direction", "BTC").uppercase(Locale.US)
        val setup = event.optString("setup", "setup")
        val price = format(event.optDouble("price", Double.NaN))
        val level = format(event.optDouble("level", Double.NaN))
        val note = event.optString("note", "")
        val learning = event.optJSONObject("learning_review")

        val title = when (type) {
            "TP1_HIT" -> "BTC $direction • TP1 HIT"
            "TP2_HIT" -> "BTC $direction • TP2 HIT"
            "SL_HIT" -> "BTC $direction • STOP / INVALIDATION"
            "EXECUTION_OPEN" -> "BTC $direction • DEMO TRADE OPENED"
            "EXECUTION_CLOSED" -> "BTC $direction • DEMO TRADE CLOSED"
            "EXECUTION_FAILED" -> "BTC $direction • DEMO TRADE FAILED"
            else -> "BTC $direction • " + type.replace('_', ' ')
        }
        var body = "$setup\nPrice $price • Level $level"
        if (type == "EXECUTION_OPEN") {
            val entry = event.optDouble("entry_price", Double.NaN)
            val stop = event.optDouble("stop_loss", Double.NaN)
            val tp = event.optDouble("take_profit", Double.NaN)
            body = "$setup\nEntry " + format(entry) + " • SL " + format(stop) + " • TP " + format(tp) + "\nBitget Demo execution"
        } else if (type == "EXECUTION_CLOSED") {
            val entry = event.optDouble("entry_price", Double.NaN)
            val exit = event.optDouble("exit_price", Double.NaN)
            val pnl = event.optDouble("net_profit_usdt", 0.0)
            val r = event.optDouble("result_r", Double.NaN)
            val reason = event.optString("close_reason", "UNKNOWN")
            body = "$setup\nEntry " + format(entry) + " • Exit " + format(exit) + "\nP&L " +
                String.format(Locale.US, "%+.2f", pnl) + " USDT • R " +
                if (r.isFinite()) String.format(Locale.US, "%.2f", r) else "—" +
                "\nClose " + reason + " • Bitget Demo"
        } else if (type == "EXECUTION_FAILED") {
            body = "$setup\nDemo execution failed\n" + event.optString("note", "Unknown execution error.")
        }
        if (note.isNotBlank()) body += "\n$note"
        if (learning != null) {
            val next = learning.optJSONArray("do_next_time")
            val avoid = learning.optJSONArray("avoid_next_time")
            if (next != null && next.length() > 0) body += "\nNext time: " + next.optString(0)
            if (avoid != null && avoid.length() > 0) body += "\nAvoid: " + avoid.optString(0)
        }

        val launchIntent = Intent(this, SafeActivity::class.java)
        val pending = PendingIntent.getActivity(
            this, 3200, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notificationId = 3200 + (event.optString("key").hashCode() and 0x7fffffff) % 50000
        val notification = NotificationCompat.Builder(this, SIGNAL_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body.replace("\n", " · "))
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .build()

        getSystemService(NotificationManager::class.java).notify(notificationId, notification)
    }

    private fun notifyOpportunity(title: String, body: String) {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
            android.content.pm.PackageManager.PERMISSION_GRANTED
        ) return

        val launchIntent = Intent(this, SafeActivity::class.java)
        val pending = PendingIntent.getActivity(
            this, SIGNAL_NOTIFICATION_ID + 1, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(this, SIGNAL_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title.ifBlank { "Dev Trader Opportunity" })
            .setContentText(body.ifBlank { "Opportunity developing." })
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .build()
        getSystemService(NotificationManager::class.java)
            .notify(SIGNAL_NOTIFICATION_ID + 1, notification)
    }

    private fun format(value: Double): String =
        if (value.isFinite()) String.format(Locale.US, "%.2f", value) else "—"

    override fun onTaskRemoved(rootIntent: Intent?) {
        if (!stopped) handler.post { connect() }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        stopped = true
        handler.removeCallbacks(keepaliveRunnable)
        handler.removeCallbacksAndMessages(null)
        reconnectScheduled = false
        runCatching { socket?.close(1000, "service destroyed") }
        socket = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
