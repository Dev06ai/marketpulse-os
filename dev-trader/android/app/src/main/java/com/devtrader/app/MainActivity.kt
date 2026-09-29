package com.devtrader.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.Button
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import android.os.Handler
import android.os.Looper

private val Charcoal = Color(0xFF0B0B10)
private val CardColor = Color(0xFF14141D)
private val Blue = Color(0xFF4A86FF)
private val Purple = Color(0xFF8B5CF6)
private val TextColor = Color(0xFFF4F4F7)
private val Muted = Color(0xFF9494A7)
private const val CHANNEL_ID = "dev_trader_signals"

data class SignalUi(
    val id: String,
    val direction: String,
    val setup: String,
    val entry: Double,
    val stop: Double,
    val target1: Double,
    val target2: Double,
    val rr: Double,
    val confidence: Double,
    val grade: String,
    val regime: String,
    val invalidation: String,
    val thesis: List<String>
)

data class LiveUi(
    val price: Double? = null,
    val oi: Double? = null,
    val cvd: Double = 0.0,
    val delta: Double = 0.0,
    val funding: Double? = null,
    val bid: Double? = null,
    val ask: Double? = null,
    val health: String = "STARTING",
    val ws: Boolean = false,
    val signal: SignalUi? = null,
    val ageMs: Long = 0L
)

data class SystemCheckUi(
    val running: Boolean = false,
    val summary: String = "Not run yet.",
    val details: List<String> = emptyList(),
    val success: Boolean = false
)

class MainActivity : ComponentActivity() {
    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
    private val client = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val reconnectScheduled = AtomicBoolean(false)
    private var socket: WebSocket? = null
    private var live by mutableStateOf(LiveUi())
    private var systemCheck by mutableStateOf(SystemCheckUi())
    private var lastNotifiedId: String? = null
    private var reconnectAttempt = 0
    private var shuttingDown = false

    private val backendWs = "wss://dev-trader-engine.onrender.com/ws"
    private val backendHttp = "https://dev-trader-engine.onrender.com"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) permission.launch(Manifest.permission.POST_NOTIFICATIONS)
        ensureNotificationChannel(this)
        connect()
        registerFcmToken()
        setContent { DevTraderScreen(live, systemCheck, ::runFullSystemCheck) }
    }

    private fun connect() {
        if (shuttingDown || socket != null) return

        live = live.copy(health = "RECONNECTING", ws = false)

        socket = client.newWebSocket(
            Request.Builder().url(backendWs).build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    if (shuttingDown) {
                        webSocket.close(1000, "activity destroyed")
                        return
                    }
                    socket = webSocket
                    reconnectAttempt = 0
                    reconnectScheduled.set(false)
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    runCatching { handleMessage(JSONObject(text)) }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    if (socket === webSocket) socket = null
                    live = live.copy(health = "RECONNECTING", ws = false)
                    scheduleReconnect()
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (socket === webSocket) socket = null
                    if (!shuttingDown) {
                        live = live.copy(health = "RECONNECTING", ws = false)
                        scheduleReconnect()
                    }
                }
            }
        )
    }

    private fun scheduleReconnect() {
        if (shuttingDown) return
        if (!reconnectScheduled.compareAndSet(false, true)) return

        val attempt = reconnectAttempt.coerceAtMost(5)
        val delayMs = minOf(30_000L, 1_000L * (1L shl attempt))
        reconnectAttempt = minOf(reconnectAttempt + 1, 5)

        mainHandler.postDelayed({
            reconnectScheduled.set(false)
            if (!shuttingDown) {
                socket = null
                connect()
            }
        }, delayMs)
    }

    private fun registerFcmToken() {
        runCatching {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    val token = task.result
                    getSharedPreferences("dev_trader", Context.MODE_PRIVATE)
                        .edit()
                        .putString("fcm_token", token)
                        .apply()
                    postJson("$backendHttp/device/register", JSONObject().put("token", token)) { _, _ -> }
                }
            }
        }
    }

    private fun runFullSystemCheck() {
        val startedAt = System.currentTimeMillis()
        val localNotifications = Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

        systemCheck = SystemCheckUi(
            running = true,
            summary = "Running full system check…",
            details = listOf("Checking notification permission", "Connecting to backend diagnostics"),
            success = false
        )

        if (localNotifications) {
            postSystemCheckNotification(this, "Local notification test passed on this phone.")
        } else if (Build.VERSION.SDK_INT >= 33) {
            permission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        getFcmToken { token ->
            if (token == null) {
                fetchSystemCheck(startedAt, localNotifications, false, null)
                return@getFcmToken
            }

            postJson("$backendHttp/device/register", JSONObject().put("token", token)) { registerOk, _ ->
                if (!registerOk) {
                    fetchSystemCheck(startedAt, localNotifications, true, null)
                    return@postJson
                }
                postJson("$backendHttp/system-check/push", JSONObject().put("token", token)) { pushOk, pushBody ->
                    val sent = runCatching { JSONObject(pushBody).optInt("sent", 0) }.getOrDefault(0)
                    fetchSystemCheck(startedAt, localNotifications, true, if (pushOk) sent else null)
                }
            }
        }
    }

    private fun getFcmToken(callback: (String?) -> Unit) {
        runCatching {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                callback(if (task.isSuccessful) task.result else null)
            }
        }.onFailure { callback(null) }
    }

    private fun fetchSystemCheck(startedAt: Long, localNotifications: Boolean, fcmAvailable: Boolean, fcmSent: Int?) {
        getJson("$backendHttp/system-check") { ok, body ->
            val now = System.currentTimeMillis()
            if (!ok) {
                mainHandler.post {
                    systemCheck = SystemCheckUi(
                        summary = "Backend system check failed",
                        details = listOf(
                            "Local notifications: " + if (localNotifications) "PASS" else "NOT GRANTED",
                            "FCM token: " + if (fcmAvailable) "AVAILABLE" else "UNAVAILABLE",
                            "Backend diagnostics: FAILED"
                        ),
                        success = false
                    )
                }
                return@getJson
            }

            val json = JSONObject(body)
            val market = json.optJSONObject("market")
            val strategy = json.optJSONObject("strategy")
            val push = json.optJSONObject("push")
            val backendOk = json.optBoolean("backend_ok", false)
            val marketHealthy = market?.optString("data_health") == "HEALTHY"
            val engineWs = market?.optBoolean("ws_connected", false) == true
            val strategyOk = strategy?.optString("status") == "SCANNING"
            val firebaseReady = push?.optBoolean("firebase_ready", false) == true
            val connectedClients = json.optJSONObject("client")?.optInt("connected_websocket_clients", 0) ?: 0
            val recentFcm = getSharedPreferences("dev_trader", Context.MODE_PRIVATE)
                .getLong("last_fcm_received_ts", 0L)
            val fcmReceived = recentFcm >= startedAt
            val details = mutableListOf(
                "Backend API: " + if (backendOk) "PASS" else "FAIL",
                "Bybit market feed: " + if (marketHealthy) "HEALTHY" else (market?.optString("data_health") ?: "UNKNOWN"),
                "Backend market WebSocket: " + if (engineWs) "CONNECTED" else "DISCONNECTED",
                "Strategy engine: " + if (strategyOk) "SCANNING" else (strategy?.optString("status") ?: "UNKNOWN"),
                "App WebSocket clients: $connectedClients",
                "Local notifications: " + if (localNotifications) "PASS" else "NOT GRANTED",
                "FCM token: " + if (fcmAvailable) "AVAILABLE" else "UNAVAILABLE",
                "Firebase backend: " + if (firebaseReady) "READY" else "NOT CONFIGURED"
            )
            if (fcmSent != null) {
                details.add("FCM test: " + if (fcmSent > 0) "SERVER ACCEPTED ($fcmSent)" else "NOT SENT")
                details.add("FCM callback on phone: " + if (fcmReceived) "RECEIVED" else "NOT YET RECEIVED")
            } else {
                details.add("FCM test: NOT RUN")
            }

            val allCore = backendOk && marketHealthy && engineWs && strategyOk && localNotifications
            mainHandler.post {
                systemCheck = SystemCheckUi(
                    summary = if (allCore) "Core system healthy" else "Issues detected — see details",
                    details = details,
                    success = allCore
                )
            }

            if (fcmSent != null && !fcmReceived) {
                mainHandler.postDelayed({
                    val receivedLater = getSharedPreferences("dev_trader", Context.MODE_PRIVATE)
                        .getLong("last_fcm_received_ts", 0L) >= startedAt
                    systemCheck = systemCheck.copy(
                        details = systemCheck.details.map {
                            if (it.startsWith("FCM callback on phone:")) {
                                "FCM callback on phone: " + if (receivedLater) "RECEIVED" else "NOT RECEIVED"
                            } else it
                        }
                    )
                }, maxOf(2500L, now - startedAt))
            }
        }
    }

    private fun postJson(url: String, body: JSONObject, callback: (Boolean, String) -> Unit) {
        val request = Request.Builder()
            .url(url)
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        client.newCall(request).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                mainHandler.post { callback(false, e.message ?: "") }
            }
            override fun onResponse(call: okhttp3.Call, response: Response) {
                response.use {
                    mainHandler.post { callback(it.isSuccessful, it.body?.string().orEmpty()) }
                }
            }
        })
    }

    private fun getJson(url: String, callback: (Boolean, String) -> Unit) {
        client.newCall(Request.Builder().url(url).get().build()).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                mainHandler.post { callback(false, e.message ?: "") }
            }
            override fun onResponse(call: okhttp3.Call, response: Response) {
                response.use {
                    mainHandler.post { callback(it.isSuccessful, it.body?.string().orEmpty()) }
                }
            }
        })
    }

    private fun handleMessage(root: JSONObject) {
        if (root.optString("type") != "state") return

        val signalJson = root.optJSONObject("signal")
        val signal = signalJson?.let { json ->
            val thesis = buildList {
                val arr = json.optJSONArray("thesis")
                if (arr != null) {
                    for (i in 0 until arr.length()) add(arr.optString(i))
                }
            }
            SignalUi(
                id = json.optString("id"),
                direction = json.optString("direction"),
                setup = json.optString("setup"),
                entry = json.optDouble("entry"),
                stop = json.optDouble("stop"),
                target1 = json.optDouble("target1"),
                target2 = json.optDouble("target2"),
                rr = json.optDouble("rr"),
                confidence = json.optDouble("confidence", 0.0),
                grade = json.optString("grade", "B"),
                regime = json.optString("regime", "UNKNOWN"),
                invalidation = json.optString("invalidation"),
                thesis = thesis
            )
        }

        val age = root.optLong("server_ts", 0L) - root.optLong("exchange_ts", 0L)
        live = LiveUi(
            price = root.optDoubleOrNull("last_price"),
            oi = root.optDoubleOrNull("open_interest"),
            cvd = root.optDouble("cvd", 0.0),
            delta = root.optDouble("delta_1m", 0.0),
            funding = root.optDoubleOrNull("funding_rate"),
            bid = root.optDoubleOrNull("bid"),
            ask = root.optDoubleOrNull("ask"),
            health = root.optString("data_health", "UNKNOWN"),
            ws = root.optBoolean("ws_connected", false),
            signal = signal,
            ageMs = age.coerceAtLeast(0L)
        )

        if (signal != null && signal.id.isNotBlank() && signal.id != lastNotifiedId) {
            lastNotifiedId = signal.id
            postSignalNotification(this, signal)
        }
    }

    override fun onDestroy() {
        shuttingDown = true
        mainHandler.removeCallbacksAndMessages(null)
        reconnectScheduled.set(false)
        socket?.close(1000, "activity destroyed")
        socket = null
        client.dispatcher.executorService.shutdown()
        super.onDestroy()
    }
}

private fun JSONObject.optDoubleOrNull(key: String): Double? {
    return if (has(key) && !isNull(key)) optDouble(key) else null
}

private fun ensureNotificationChannel(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
        NotificationChannel(
            CHANNEL_ID,
            "Dev Trader Signals",
            NotificationManager.IMPORTANCE_HIGH
        )
    )
}

private fun postSystemCheckNotification(context: Context, body: String) {
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle("Dev Trader System Check")
        .setContentText(body)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setAutoCancel(true)
        .build()
    context.getSystemService(NotificationManager::class.java).notify(3100, notification)
}

private fun postSignalNotification(context: Context, signal: SignalUi) {
    val body = String.format(
        "Entry %.2f • SL %.2f • R:R %.2f",
        signal.entry,
        signal.stop,
        signal.rr
    )
    val detail = signal.thesis.joinToString(separator = "\n") +
        "\nInvalidation: " + signal.invalidation

    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle("BTC " + signal.direction + " • " + signal.setup)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(detail))
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setAutoCancel(true)
        .build()

    context.getSystemService(NotificationManager::class.java).notify(2001, notification)
}

@Composable
private fun DevTraderScreen(state: LiveUi, check: SystemCheckUi, onRunCheck: () -> Unit) {
    MaterialTheme(colorScheme = darkColorScheme(background = Charcoal, surface = CardColor)) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Charcoal)
        ) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                item {
                    Column {
                        Text(
                            "DEV TRADER",
                            color = TextColor,
                            style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text("Klein • Manual Execution", color = Muted)
                    }
                }
                item { StatusCard(state) }
                item { PriceCard(state) }
                item { FlowCard(state) }
                item { SignalCard(state) }
                item { IntegrityCard(state) }
                item { SystemCheckCard(check, onRunCheck) }
            }
        }
    }
}

@Composable
private fun StatusCard(state: LiveUi) {
    Card(
        colors = CardDefaults.cardColors(containerColor = CardColor),
        shape = RoundedCornerShape(18.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text("MARKET ENGINE", color = Muted)
                Text(
                    if (state.health == "HEALTHY") "LIVE" else state.health,
                    color = if (state.health == "HEALTHY") Color(0xFF7CFFB2) else Color(0xFFFFB86B),
                    fontWeight = FontWeight.Bold
                )
            }
            Text("BTCUSDT", color = TextColor, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun PriceCard(state: LiveUi) {
    Card(
        colors = CardDefaults.cardColors(containerColor = CardColor),
        shape = RoundedCornerShape(18.dp)
    ) {
        Column(Modifier.padding(16.dp)) {
            Text("BTC PRICE", color = Muted)
            Text(
                state.price?.let { String.format("%,.2f", it) } ?: "—",
                color = TextColor,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.padding(top = 4.dp))
            Row(Modifier.fillMaxWidth()) {
                Stat("OI", state.oi?.let { String.format("%,.2f", it) } ?: "—")
                Stat("CVD", String.format("%.2f", state.cvd))
                Stat("1m Δ", String.format("%.2f", state.delta))
                Stat("Age", state.ageMs.toString() + "ms")
            }
        }
    }
}

@Composable
private fun RowScope.Stat(label: String, value: String) {
    Column(Modifier.weight(1f)) {
        Text(label, color = Muted, style = MaterialTheme.typography.labelSmall)
        Text(value, color = TextColor, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun FlowCard(state: LiveUi) {
    Card(
        colors = CardDefaults.cardColors(containerColor = CardColor),
        shape = RoundedCornerShape(18.dp)
    ) {
        Column(Modifier.padding(16.dp)) {
            Text("ORDER FLOW", color = Muted)
            Text(
                "Bid " + (state.bid?.let { String.format("%.2f", it) } ?: "—") +
                    "   Ask " + (state.ask?.let { String.format("%.2f", it) } ?: "—"),
                color = TextColor
            )
            Text(
                "Funding " + (state.funding?.let { String.format("%.5f", it) } ?: "—"),
                color = Muted
            )
        }
    }
}

@Composable
private fun SignalCard(state: LiveUi) {
    val signal = state.signal
    if (signal == null) {
        Box(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(Brush.horizontalGradient(listOf(Blue, Purple)))
                .padding(18.dp)
        ) {
            Column {
                Text(
                    if (state.health == "HEALTHY") "MARKET SCANNING" else "CURRENT STATE",
                    color = Color.White.copy(alpha = 0.82f)
                )
                Text(
                    when (state.health) {
                        "HEALTHY" -> "No validated setup right now"
                        "STALE" -> "Waiting for fresh market data"
                        "RECONNECTING" -> "Reconnecting to market engine"
                        else -> "Waiting for market feed"
                    },
                    color = Color.White,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                if (state.health == "HEALTHY") {
                    Text(
                        "Evaluating SFP • D-Line • MSS with live BTC order-flow context",
                        color = Color.White.copy(alpha = 0.82f),
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
        }
        return
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = CardColor),
        shape = RoundedCornerShape(18.dp)
    ) {
        Column(Modifier.padding(16.dp)) {
            Text("TRADE CALL", color = Muted)
            Text(
                signal.direction + " • " + signal.setup,
                color = TextColor,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold
            )
            Text("Entry " + String.format("%.2f", signal.entry), color = TextColor)
            Text("SL " + String.format("%.2f", signal.stop), color = Color(0xFFFF7A90))
            Text("TP1 " + String.format("%.2f", signal.target1), color = Color(0xFF86F7B0))
            Text("TP2 " + String.format("%.2f", signal.target2), color = Color(0xFF86F7B0))
            Text("R:R " + String.format("%.2f", signal.rr), color = TextColor)
            Text(
                "Grade " + signal.grade +
                    " • Confidence " + String.format("%.0f%%", signal.confidence * 100.0) +
                    " • Regime " + signal.regime,
                color = Muted,
                style = MaterialTheme.typography.bodySmall
            )
            Spacer(Modifier.padding(top = 6.dp))
            Text("THESIS", color = Muted)
            signal.thesis.forEach { item ->
                Text("• " + item, color = TextColor, style = MaterialTheme.typography.bodySmall)
            }
            Text(
                "Invalidation: " + signal.invalidation,
                color = Muted,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
private fun SystemCheckCard(check: SystemCheckUi, onRunCheck: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = CardColor),
        shape = RoundedCornerShape(18.dp)
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("SYSTEM CHECK", color = Muted)
            Text(
                check.summary,
                color = if (check.success) Color(0xFF86F7B0) else TextColor,
                fontWeight = FontWeight.Bold
            )
            Button(onClick = onRunCheck, enabled = !check.running) {
                Text(if (check.running) "CHECKING…" else "RUN FULL SYSTEM CHECK")
            }
            check.details.forEach { Text("• " + it, color = TextColor, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

@Composable
private fun IntegrityCard(state: LiveUi) {
    val status = when {
        !state.ws -> "WebSocket: DISCONNECTED"
        state.health == "HEALTHY" -> "WebSocket: CONNECTED"
        else -> "WebSocket: CONNECTED • " + state.health
    }

    val detail = when {
        !state.ws -> "Connection to the market engine is down."
        state.health == "HEALTHY" -> "Feed healthy • engine is actively evaluating validated setups."
        state.health == "STALE" -> "Feed is stale • new signals remain blocked until fresh data returns."
        state.health == "RECONNECTING" -> "Engine is reconnecting • signal generation is paused."
        else -> "Engine status: " + state.health
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = CardColor),
        shape = RoundedCornerShape(18.dp)
    ) {
        Column(Modifier.padding(16.dp)) {
            Text("DATA INTEGRITY", color = Muted)
            Text(status, color = TextColor)
            Text("Feed age: " + state.ageMs + " ms", color = TextColor)
            Text(
                detail,
                color = if (state.health == "HEALTHY" && state.ws) Color(0xFF86F7B0) else Muted
            )
        }
    }
}
