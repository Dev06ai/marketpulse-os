package com.devtrader.app

import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

/**
 * Read-only, verified BTCUSDT market observations. Never infer a trade bias
 * from the private signal/execution engine or trust an unverified fallback.
 * Missing data is displayed as unavailable, NEVER silently as neutral or 0%.
 */
internal object VerifiedMarketInsightsPresentation {
    data class Cards(val context: String, val levelsAndFlow: String, val valid: Boolean)

    private const val SOURCE = "BITGET_PUBLIC_BTCUSDT_PERPETUAL"
    private const val MAX_SNAPSHOT_AGE_MS = 120_000L
    private val approvedBias = setOf("BEARISH", "BULLISH", "MIXED", "UNCONFIRMED")
    private val trends = setOf("UP", "DOWN", "RANGE", "UNKNOWN")

    private fun timeLabel(ms: Long): String =
        if (ms <= 0L) "—" else SimpleDateFormat("HH:mm:ss", Locale.US).format(Date(ms))

    private fun unavailable(why: String, asOf: Long = 0L): Cards {
        val label = if (asOf > 0) "\nLast market observation: ${timeLabel(asOf)}" else ""
        return Cards(
            "BTCUSDT PERPETUAL • DATA UNVERIFIED\n$why$label\nNo verified directional thesis.",
            "VERIFIED LEVELS & FLOW • UNAVAILABLE\n$why$label\nNo live level or OI/CVD inference.",
            false
        )
    }

    private fun number(value: Double, digits: Int = 2): String {
        if (!value.isFinite()) return "Unavailable"
        return String.format(Locale.US, "%,.${digits}f", value)
    }

    private fun trend(value: String): String {
        val upper = value.uppercase(Locale.US)
        return if (upper in trends) upper else "UNKNOWN"
    }

    fun present(payload: JSONObject?, nowMs: Long = System.currentTimeMillis()): Cards {
        if (payload == null || payload.optInt("schema", 0) != 1 ||
            payload.optString("source") != SOURCE) return unavailable("Verified BTC market snapshot missing.")
        val generated = payload.optLong("generated_at_ms", 0L)
        val observed = payload.optLong("market_as_of_ms", 0L)
        if (generated <= 0 || observed <= 0 ||
            generated > nowMs + 30_000L || observed > nowMs + 30_000L ||
            nowMs - generated > MAX_SNAPSHOT_AGE_MS ||
            nowMs - observed > MAX_SNAPSHOT_AGE_MS) {
            return unavailable("Snapshot expired or exchange trade timestamp is unverified.", observed)
        }
        val quality = payload.optString("quality", "UNVERIFIED").uppercase(Locale.US)
        if (quality !in setOf("LIVE", "PARTIAL")) {
            return unavailable("Market feed quality: $quality.", observed)
        }
        val price = payload.optDouble("price", Double.NaN)
        val context = payload.optJSONObject("context")
        if (context == null || !price.isFinite() || price <= 0.0) {
            return unavailable("Live price or confirmed analysis unavailable.", observed)
        }
        val rawBias = context.optString("bias").uppercase(Locale.US)
        val bias = if (rawBias in approvedBias) rawBias else "UNCONFIRMED"
        val ts = context.optJSONObject("trends")
        val t4h = trend(ts?.optString("4h", "UNKNOWN") ?: "UNKNOWN")
        val t1h = trend(ts?.optString("1h", "UNKNOWN") ?: "UNKNOWN")
        val t15 = trend(ts?.optString("15m", "UNKNOWN") ?: "UNKNOWN")
        val structure = context.optString("structure_15m", "UNKNOWN")
            .uppercase(Locale.US).takeIf { it in setOf("BULLISH", "BEARISH", "RANGE") } ?: "UNKNOWN"
        val thesis = context.optString("thesis", "")
            .trim().take(260).ifBlank { "Confirmed market thesis unavailable." }
        val qualification = if (quality == "PARTIAL") "PARTIAL CONFIRMATION" else "FRESH OBSERVATIONS"
        val summary = "BTCUSDT PERPETUAL • $quality\n" +
            "Price $ ${number(price)} • as of ${timeLabel(observed)}\n" +
            "Thesis $bias • $qualification\n" +
            thesis + "\n" +
            "4H $t4h  •  1H $t1h  •  15m $t15\n" +
            "15m structure $structure\n" +
            "Observed, not a prediction or trade instruction."

        val levels = payload.optJSONObject("levels")
        val flow = payload.optJSONObject("flow")
        fun levelText(row: JSONObject?, direction: String): String {
            if (row == null) return "$direction: no confirmed reference"
            val value = row.optDouble("price", Double.NaN)
            val distance = row.optDouble("distance_pct", Double.NaN)
            if (!value.isFinite() || value <= 0.0 ||
                (direction == "Above" && value <= price) ||
                (direction == "Below" && value >= price)) {
                return "$direction: no confirmed reference"
            }
            val kind = row.optString("label", row.optString("kind", "LEVEL"))
                .replace("\n", " ").trim().take(24).ifBlank { "LEVEL" }
            val source = row.optString("source").replace("\n", " ").trim().take(36)
            val gap = if (distance.isFinite() && abs(distance) <= 100.0)
                " (${String.format(Locale.US, "%+.2f", distance)}%)" else ""
            return "$direction $kind  ${number(value)}$gap" +
                if (source.isBlank()) "" else " • $source"
        }
        val oi = flow?.optDouble("oi_5m_pct", Double.NaN) ?: Double.NaN
        val oiAvailable = flow?.optString("oi_source") == "EXCHANGE_OPEN_INTEREST" &&
            oi.isFinite() && abs(oi) < 1000.0
        val cvd = flow?.optString("cvd_divergence", "UNAVAILABLE")
            ?.uppercase(Locale.US) ?: "UNAVAILABLE"
        val cvdAvailable = flow?.optString("cvd_source") == "RECENT_TRADE_TAPE" &&
            cvd in setOf("BULLISH", "BEARISH", "NONE")
        val flowLine = "Open interest 5m: " +
            if (oiAvailable) String.format(Locale.US, "%+.3f%%", oi)
            else "unavailable (insufficient verified history)"
        val cvdLine = "Trade-tape CVD divergence: " + if (cvdAvailable) cvd else "unavailable"
        val levelsSummary = "BTC STRUCTURE & FLOW • $quality\n" +
            "As of ${timeLabel(observed)} • $ ${number(price)}\n" +
            levelText(levels?.optJSONObject("above"), "Above") + "\n" +
            levelText(levels?.optJSONObject("below"), "Below") + "\n" +
            flowLine + "\n" + cvdLine + "\n" +
            "Nearest confirmed references only; missing data is not zero."
        return Cards(summary, levelsSummary, true)
    }
}
