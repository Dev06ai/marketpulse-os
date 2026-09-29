package com.devtrader.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
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
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

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

class MainActivity : ComponentActivity() {
    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
    private val client = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).build()
    private var socket: WebSocket? = null
    private var live by mutableStateOf(LiveUi())
    private var lastNotifiedId: String? = null

    // Set this once the private backend is deployed.
    private val backendWs = "wss://REPLACE_WITH_YOUR_ENGINE_HOST/ws"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) permission.launch(Manifest.permission.POST_NOTIFICATIONS)
        ensureNotificationChannel(this)
        connect()
        setContent { DevTraderScreen(live) }
    }

    private fun connect() {
        if (backendWs.contains("REPLACE_WITH_YOUR_ENGINE_HOST")) return
        socket = client.newWebSocket(
            Request.Builder().url(backendWs).build(),
            object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, text: String) {
                    runCatching { handleMessage(JSONObject(text)) }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    live = live.copy(health = "RECONNECTING", ws = false)
                }
            }
        )
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
        socket?.close(1000, "activity destroyed")
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
private fun DevTraderScreen(state: LiveUi) {
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
                item { SignalCard(state.signal) }
                item { IntegrityCard(state) }
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
private fun SignalCard(signal: SignalUi?) {
    if (signal == null) {
        Box(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(Brush.horizontalGradient(listOf(Blue, Purple)))
                .padding(18.dp)
        ) {
            Column {
                Text("CURRENT STATE", color = Color.White.copy(alpha = 0.82f))
                Text(
                    "No new validated trade call",
                    color = Color.White,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
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
private fun IntegrityCard(state: LiveUi) {
    Card(
        colors = CardDefaults.cardColors(containerColor = CardColor),
        shape = RoundedCornerShape(18.dp)
    ) {
        Column(Modifier.padding(16.dp)) {
            Text("DATA INTEGRITY", color = Muted)
            Text("WebSocket: " + if (state.ws) "CONNECTED" else "DISCONNECTED", color = TextColor)
            Text("Feed age: " + state.ageMs + " ms", color = TextColor)
            Text("Signals are blocked while the engine reports stale data.", color = Muted)
        }
    }
}
