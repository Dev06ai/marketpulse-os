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

class SignalService : Service() {
    companion object {
        private const val SERVICE_CHANNEL = "dev_trader_background"
        private const val SIGNAL_CHANNEL = "dev_trader_signals"
        private const val SERVICE_NOTIFICATION_ID = 3100
        private const val SIGNAL_NOTIFICATION_ID = 3101
        private const val PREFS = "dev_trader_signal_state"
        private const val PREF_LAST_SIGNAL_ID = "last_signal_id"
        private const val WS_URL = "wss://dev-trader-engine.onrender.com/ws"
    }

    private val handler = Handler(Looper.getMainLooper())
    private var socket: WebSocket? = null
    private var reconnectAttempt = 0
    private var stopped = false
    private val client by lazy {
        OkHttpClient.Builder()
            .pingInterval(15, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    override fun onCreate() {
        super.onCreate()
        stopped = false
        ensureChannels()
        startForegroundNotification()
        connect()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        stopped = false
        if (socket == null) connect()
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

    private fun connect() {
        if (stopped || socket != null) return
        socket = client.newWebSocket(
            Request.Builder().url(WS_URL).build(),
            object : WebSocketListener() {
                override fun onOpen(ws: WebSocket, response: Response) {
                    reconnectAttempt = 0
                    socket = ws
                    updateServiceNotification("Live signal monitoring connected")
                }

                override fun onMessage(ws: WebSocket, text: String) {
                    runCatching {
                        val root = JSONObject(text)
                        if (root.optString("type") != "state") return
                        val signal = root.optJSONObject("signal") ?: return
                        val id = signal.optString("id")
                        if (id.isBlank()) return

                        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
                        val previous = prefs.getString(PREF_LAST_SIGNAL_ID, null)
                        if (id != previous) {
                            prefs.edit().putString(PREF_LAST_SIGNAL_ID, id).apply()
                            notifySignal(signal)
                        }
                    }
                }

                override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                    socket = null
                    scheduleReconnect()
                }

                override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                    socket = null
                    updateServiceNotification("Reconnecting to live signal feed…")
                    scheduleReconnect()
                }
            }
        )
    }

    private fun scheduleReconnect() {
        if (stopped || socket != null) return
        reconnectAttempt = min(reconnectAttempt + 1, 6)
        val delay = min(30_000L, 1_000L shl (reconnectAttempt - 1))
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ if (!stopped) connect() }, delay)
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
        val entry = signal.optDouble("entry", Double.NaN)
        val stop = signal.optDouble("stop", Double.NaN)
        val rr = signal.optDouble("rr", Double.NaN)
        val title = "BTC $direction • $setup"
        val body = "Entry " + format(entry) + " · SL " + format(stop) + " · R:R " + format(rr)

        val launchIntent = Intent(this, SafeActivity::class.java)
        val pending = PendingIntent.getActivity(
            this, SIGNAL_NOTIFICATION_ID, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, SIGNAL_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .build()

        getSystemService(NotificationManager::class.java)
            .notify(SIGNAL_NOTIFICATION_ID, notification)
    }

    private fun format(value: Double): String =
        if (value.isFinite()) String.format(Locale.US, "%.2f", value) else "—"

    override fun onTaskRemoved(rootIntent: Intent?) {
        if (!stopped) handler.post { connect() }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        stopped = true
        handler.removeCallbacksAndMessages(null)
        runCatching { socket?.close(1000, "service destroyed") }
        socket = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
