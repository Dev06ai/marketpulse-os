package com.devtrader.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
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
import androidx.core.content.FileProvider
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
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

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

data class UpdateUi(
    val available: Boolean = false,
    val downloading: Boolean = false,
    val downloaded: Boolean = false,
    val message: String = "",
    val versionName: String = "",
    val versionCode: Long = 0L,
    val apkUrl: String = "",
    val sha256: String = ""
)

class MainActivity : ComponentActivity() {
    private val client = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val reconnectScheduled = AtomicBoolean(false)
    private var socket: WebSocket? = null
    private var live by mutableStateOf(LiveUi())
    private var systemCheck by mutableStateOf(SystemCheckUi())
    private var updateUi by mutableStateOf(UpdateUi())
    private var lastNotifiedId: String? = null
    private var reconnectAttempt = 0
    private var shuttingDown = false

    companion object {
        private const val REQUEST_NOTIFICATIONS = 4101
    }

    private val backendWs = "wss://dev-trader-engine.onrender.com/ws"
    private val backendHttp = "https://dev-trader-engine.onrender.com"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            DevTraderScreen(
                live,
                systemCheck,
                updateUi,
                ::runFullSystemCheck,
                ::startAppUpdate
            )
        }

        mainHandler.post {
            runCatching {
                ensureNotificationChannel(this)
                requestNotificationPermissionIfNeeded()
            }
            runCatching { checkForAppUpdate() }
            runCatching { connect() }
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                REQUEST_NOTIFICATIONS
            )
        }
    }

    private val updateManifestUrl =
        "https://raw.githubusercontent.com/Dev06ai/marketpulse-os/dev-trader-v1/dev-trader/update.json"

    private fun checkForAppUpdate() {
        getJson(updateManifestUrl) { ok, body ->
            if (!ok) return@getJson
            try {
                val json = JSONObject(body)
                if (!json.optBoolean("enabled", false)) return@getJson

                val remoteCode = json.optLong("versionCode", 0L)
                val currentCode = packageManager.getPackageInfo(packageName, 0).longVersionCode
                if (remoteCode <= currentCode) return@getJson

                updateUi = UpdateUi(
                    available = true,
                    message = "Version " + json.optString("versionName", "new") +
                        " is ready. Download is verified before installation.",
                    versionName = json.optString("versionName", "new"),
                    versionCode = remoteCode,
                    apkUrl = json.optString("apkUrl", ""),
                    sha256 = json.optString("sha256", "")
                )
            } catch (_: Throwable) {
                // Update checks are optional and must never affect the trading client.
            }
        }
    }

    private fun startAppUpdate() {
        val current = updateUi
        if (current.downloaded) {
            val cached = File(cacheDir, "dev-trader-" + current.versionName + ".apk")
            if (cached.exists()) {
                installApk(cached)
                return
            }
        }
        if (!current.available || current.apkUrl.isBlank() || current.sha256.isBlank()) {
            checkForAppUpdate()
            return
        }

        updateUi = current.copy(
            downloading = true,
            message = "Downloading Dev Trader " + current.versionName + "…"
        )

        client.newCall(Request.Builder().url(current.apkUrl).get().build()).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                mainHandler.post {
                    updateUi = updateUi.copy(
                        downloading = false,
                        message = "Update download failed: " + (e.message ?: "network error")
                    )
                }
            }

            override fun onResponse(call: okhttp3.Call, response: Response) {
                response.use {
                    try {
                        if (!it.isSuccessful) throw java.io.IOException("HTTP " + it.code)
                        val body = it.body ?: throw java.io.IOException("Empty update")
                        val temp = File.createTempFile("dev-trader-", ".apk.tmp", cacheDir)
                        val target = File(cacheDir, "dev-trader-" + current.versionName + ".apk")
                        val digest = MessageDigest.getInstance("SHA-256")

                        body.byteStream().use { input ->
                            FileOutputStream(temp).use { output ->
                                val buffer = ByteArray(16 * 1024)
                                while (true) {
                                    val count = input.read(buffer)
                                    if (count <= 0) break
                                    digest.update(buffer, 0, count)
                                    output.write(buffer, 0, count)
                                }
                            }
                        }

                        val actualHash = digest.digest().joinToString("") { b -> "%02x".format(b) }
                        if (!actualHash.equals(current.sha256, ignoreCase = true)) {
                            temp.delete()
                            throw java.io.IOException("Checksum verification failed")
                        }

                        target.delete()
                        if (!temp.renameTo(target)) throw java.io.IOException("Could not prepare update")

                        mainHandler.post {
                            updateUi = updateUi.copy(
                                downloading = false,
                                downloaded = true,
                                message = "Update verified. Tap INSTALL UPDATE to finish."
                            )
                            installApk(target)
                        }
                    } catch (t: Throwable) {
                        mainHandler.post {
                            updateUi = updateUi.copy(
                                downloading = false,
                                downloaded = false,
                                message = "Update rejected safely: " + (t.message ?: "unknown error")
                            )
                        }
                    }
                }
            }
        })
    }

    private fun installApk(file: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !packageManager.canRequestPackageInstalls()
        ) {
            updateUi = updateUi.copy(
                message = "Allow Dev Trader to install updates, then tap INSTALL UPDATE again."
            )
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + packageName)
                )
            )
            return
        }

        val uri = FileProvider.getUriForFile(this, packageName + ".fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runCatching { startActivity(intent) }.onFailure {
            updateUi = updateUi.copy(
                message = "Android could not open the installer: " + (it.message ?: "unknown error")
            )
        }
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

    private fun runFullSystemCheck() {
        val startedAt = System.currentTimeMillis()
        try {
            val localNotifications = Build.VERSION.SDK_INT < 33 ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

            systemCheck = SystemCheckUi(
                running = true,
                summary = "Running full system check…",
                details = listOf(
                    "Local notifications: " + if (localNotifications) "PASS" else "NOT GRANTED",
                    "Push notifications: DISABLED (Firebase not configured)",
                    "Connecting to backend diagnostics…"
                ),
                success = false
            )

            if (localNotifications) {
                runCatching {
                    postSystemCheckNotification(this, "Local notification test passed on this phone.")
                }
            } else if (Build.VERSION.SDK_INT >= 33) {
                runCatching { requestNotificationPermissionIfNeeded() }
            }

            fetchSystemCheck(startedAt, localNotifications)
        } catch (t: Throwable) {
            mainHandler.post {
                systemCheck = SystemCheckUi(
                    running = false,
                    summary = "System check failed safely",
                    details = listOf("The check encountered an error: " + (t.message ?: t.javaClass.simpleName)),
                    success = false
                )
            }
        }
    }

    private fun fetchSystemCheck(startedAt: Long, localNotifications: Boolean) {
        getJson("$backendHttp/system-check") { ok, body ->
            if (!ok) {
                mainHandler.post {
                    systemCheck = SystemCheckUi(
                        summary = "Backend system check failed",
                        details = listOf(
                            "Local notifications: " + if (localNotifications) "PASS" else "NOT GRANTED",
                            "Push notifications: DISABLED (Firebase not configured)",
                            "Backend diagnostics: FAILED"
                        ),
                        success = false
                    )
                }
                return@getJson
            }

            try {
                val json = JSONObject(body)
                val market = json.optJSONObject("market")
                val strategy = json.optJSONObject("strategy")
                val backendOk = json.optBoolean("backend_ok", false)
                val marketHealthy = market?.optString("data_health") == "HEALTHY"
                val engineWs = market?.optBoolean("ws_connected", false) == true
                val strategyOk = strategy?.optString("status") == "SCANNING"
                val connectedClients = json.optJSONObject("client")?.optInt("connected_websocket_clients", 0) ?: 0
                val details = mutableListOf(
                    "Backend API: " + if (backendOk) "PASS" else "FAIL",
                    "Bybit market feed: " + if (marketHealthy) "HEALTHY" else (market?.optString("data_health") ?: "UNKNOWN"),
                    "Backend market WebSocket: " + if (engineWs) "CONNECTED" else "DISCONNECTED",
                    "Strategy engine: " + if (strategyOk) "SCANNING" else (strategy?.optString("status") ?: "UNKNOWN"),
                    "App WebSocket clients: " + connectedClients,
                    "Local notifications: " + if (localNotifications) "PASS" else "NOT GRANTED",
                    "Push notifications: DISABLED (Firebase not configured)"
                )
                val allCore = backendOk && marketHealthy && engineWs && strategyOk && localNotifications
                mainHandler.post {
                    systemCheck = SystemCheckUi(
                        running = false,
                        summary = if (allCore) "Core system healthy" else "Issues detected — see details",
                        details = details,
                        success = allCore
                    )
                }
            } catch (t: Throwable) {
                mainHandler.post {
                    systemCheck = SystemCheckUi(
                        running = false,
                        summary = "System check failed safely",
                        details = listOf("Diagnostics response error: " + (t.message ?: t.javaClass.simpleName)),
                        success = false
                    )
                }
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

    override fun onResume() {
        super.onResume()
        checkForAppUpdate()
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
private fun DevTraderScreen(state: LiveUi, check: SystemCheckUi, update: UpdateUi, onRunCheck: () -> Unit, onUpdate: () -> Unit) {
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
                item { UpdateCard(update, onUpdate) }
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
private fun UpdateCard(update: UpdateUi, onUpdate: () -> Unit) {
    if (!update.available && update.message.isBlank()) return
    Card(
        colors = CardDefaults.cardColors(containerColor = CardColor),
        shape = RoundedCornerShape(18.dp)
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("APP UPDATE", color = Muted)
            Text(
                when {
                    update.downloaded -> "Update ready"
                    update.downloading -> "Downloading update…"
                    else -> "Update available"
                },
                color = TextColor,
                fontWeight = FontWeight.Bold
            )
            if (update.message.isNotBlank()) {
                Text(update.message, color = Muted, style = MaterialTheme.typography.bodySmall)
            }
            if (update.available && !update.downloading) {
                Button(onClick = onUpdate) {
                    Text("INSTALL UPDATE")
                }
            }
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
