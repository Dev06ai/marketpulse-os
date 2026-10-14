package com.devtrader.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import kotlin.math.abs

/**
 * Device-private, one-shot BTC price alerts. This store never contains exchange
 * credentials and never contacts an order/execution endpoint. Delivery uses
 * KYVORIQ's existing foreground websocket service, not FCM.
 */
object BtcPriceAlerts {
    private const val PREFS = "kyvoriq_btc_price_alerts_v1"
    private const val KEY = "alerts"
    private const val MAX_ARMED = 20
    private const val MAX_ROWS = 50
    private const val MAX_PRICE = 10_000_000.0
    private const val MAX_AGE_MS = 8_000L

    data class Triggered(val id: String, val level: Double, val observed: Double, val direction: String)

    private fun load(context: Context): JSONArray = runCatching {
        JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]") ?: "[]")
    }.getOrDefault(JSONArray())

    private fun save(context: Context, array: JSONArray): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY, array.toString()).commit()

    @Synchronized
    fun all(context: Context): JSONArray = JSONArray(load(context).toString())

    @Synchronized
    fun armedLevels(context: Context): List<Double> {
        val rows = load(context)
        return (0 until rows.length()).mapNotNull { i ->
            rows.optJSONObject(i)?.takeIf { it.optString("status") == "ARMED" }
                ?.optDouble("level", Double.NaN)?.takeIf { it.isFinite() && it > 0.0 }
        }
    }

    @Synchronized
    fun add(context: Context, rawLevel: Double, currentPrice: Double): String {
        require(rawLevel.isFinite() && rawLevel in 1.0..MAX_PRICE) { "Enter a valid BTC price in USDT." }
        require(currentPrice.isFinite() && currentPrice > 0.0) { "Fresh BTC price is required." }
        val level = kotlin.math.round(rawLevel * 100.0) / 100.0
        val rows = load(context)
        val active = (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }
            .filter { it.optString("status") == "ARMED" }
        require(active.size < MAX_ARMED) { "Maximum 20 active BTC alerts. Remove one first." }
        require(active.none { abs(it.optDouble("level") - level) < 0.005 }) {
            "An alert for this BTC price already exists."
        }
        val id = UUID.randomUUID().toString()
        val direction = if (currentPrice <= level) "ABOVE" else "BELOW"
        val updated = JSONArray()
        // Keep recently triggered alerts for a compact history without unbounded storage.
        val retained = (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }
            .takeLast(MAX_ROWS - 1)
        retained.forEach(updated::put)
        updated.put(JSONObject()
            .put("id", id)
            .put("level", level)
            .put("direction", direction)
            .put("status", "ARMED")
            .put("created_at_ms", System.currentTimeMillis()))
        check(save(context, updated)) { "Unable to save alert on this device." }
        return id
    }

    @Synchronized
    fun remove(context: Context, id: String): Boolean {
        val rows = load(context)
        val updated = JSONArray()
        var found = false
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            if (row.optString("id") == id) found = true else updated.put(row)
        }
        return found && save(context, updated)
    }

    /**
     * Only exchange-authored, recent Bitget websocket prices may trigger.
     * Reconnect, stale prices, REST-only fallback and cached dashboard data
     * cannot generate a notification. Mark fired durably before display so
     * duplicated websocket frames and service restarts do not notify twice.
     */
    @Synchronized
    fun onMarketTick(context: Context, tick: JSONObject, canNotify: Boolean): List<Triggered> {
        if (!canNotify ||
            tick.optString("symbol") != "BTCUSDT" ||
            tick.optString("data_health") != "HEALTHY" ||
            !tick.optBoolean("ws_connected") ||
            tick.optJSONObject("upstream")?.optString("source") != "BITGET_WS") return emptyList()
        val now = System.currentTimeMillis()
        val price = tick.optDouble("last_price", Double.NaN)
        val feedTs = tick.optLong("last_market_update_ts", 0L)
        val serverTs = tick.optLong("server_ts", 0L)
        if (!price.isFinite() || price <= 0.0 ||
            feedTs <= 0L || serverTs <= 0L ||
            now - feedTs !in -2_000L..MAX_AGE_MS ||
            now - serverTs !in -2_000L..MAX_AGE_MS) return emptyList()

        val rows = load(context)
        val triggered = mutableListOf<Triggered>()
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            if (row.optString("status") != "ARMED") continue
            val level = row.optDouble("level", Double.NaN)
            val direction = row.optString("direction")
            if (!level.isFinite() || level <= 0.0) continue
            val reached = when (direction) {
                "ABOVE" -> price >= level
                "BELOW" -> price <= level
                else -> false
            }
            if (reached) {
                row.put("status", "TRIGGERED")
                row.put("triggered_at_ms", now)
                row.put("trigger_price", price)
                triggered.add(Triggered(row.optString("id"), level, price, direction))
            }
        }
        return if (triggered.isNotEmpty() && save(context, rows)) triggered else emptyList()
    }
}
