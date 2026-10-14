package com.devtrader.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Public OHLCV only. Cached data never restores authentication or trading state. */
object MarketRecovery {
    const val PERPETUAL = "BITGET_PERPETUAL"
    const val SPOT = "BINANCE_SPOT"
    const val KRAKEN_SPOT = "KRAKEN_SPOT"
    private const val PREFS = "kyvoriq_public_candles_v1"
    private const val MAX_CACHE_AGE = 48 * 60 * 60_000L
    fun intervalMs(tf: String): Long = when (tf) {
        "5m" -> 5 * 60_000L
        "15m" -> 15 * 60_000L
        "1h" -> 60 * 60_000L
        "4h" -> 4 * 60 * 60_000L
        else -> throw IllegalArgumentException("Unsupported timeframe")
    }
    fun transientFailure(error: String): Boolean = error in setOf(
        "HTTP 404", "HTTP 408", "HTTP 429", "HTTP 500", "HTTP 502", "HTTP 503", "HTTP 504",
        "NETWORK TIMEOUT", "NETWORK UNAVAILABLE", "INVALID SNAPSHOT"
    )
    fun retryDelay(hasCandles: Boolean): Long = if (hasCandles) 15_000L else 3_000L

    fun sanitize(rows: JSONArray, tf: String, now: Long = System.currentTimeMillis()): JSONArray {
        intervalMs(tf)
        require(rows.length() in 1..2000)
        val clean = JSONArray()
        var previous = 0L
        for (i in maxOf(0, rows.length() - 120) until rows.length()) {
            val row = rows.getJSONObject(i)
            val start = row.getLong("start")
            val open = row.getDouble("open")
            val high = row.getDouble("high")
            val low = row.getDouble("low")
            val close = row.getDouble("close")
            val volume = row.getDouble("volume")
            require(start > previous && start <= now + 120_000L)
            require(listOf(open, high, low, close, volume).all { it.isFinite() })
            require(low > 0 && high >= low && high >= maxOf(open, close) &&
                low <= minOf(open, close) && volume >= 0)
            clean.put(JSONObject().put("start", start).put("end", start + intervalMs(tf))
                .put("open", open).put("high", high).put("low", low)
                .put("close", close).put("volume", volume))
            previous = start
        }
        return clean
    }

    fun save(context: Context, tf: String, rows: JSONArray, source: String) {
        runCatching {
            require(source in setOf(PERPETUAL, SPOT, KRAKEN_SPOT))
            val now = System.currentTimeMillis()
            val clean = sanitize(rows, tf, now)
            require(now - clean.getJSONObject(clean.length() - 1).getLong("start") < MAX_CACHE_AGE)
            val payload = JSONObject().put("candles", clean).put("source", source).put("saved_at", now)
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(tf, payload.toString()).apply()
        }
    }

    fun load(context: Context, tf: String, now: Long = System.currentTimeMillis()): JSONObject? = runCatching {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(tf, null) ?: return null
        val payload = JSONObject(raw)
        require(now - payload.getLong("saved_at") in 0..MAX_CACHE_AGE)
        require(payload.getString("source") in setOf(PERPETUAL, SPOT, KRAKEN_SPOT))
        val clean = sanitize(payload.getJSONArray("candles"), tf, now)
        require(now - clean.getJSONObject(clean.length() - 1).getLong("start") < MAX_CACHE_AGE)
        JSONObject().put("candles", clean).put("source", payload.getString("source"))
            .put("saved_at", payload.getLong("saved_at"))
    }.getOrNull()
}
