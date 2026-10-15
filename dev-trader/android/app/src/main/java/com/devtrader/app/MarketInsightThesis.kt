package com.devtrader.app

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import kotlin.math.abs

/**
 * Read-only, evidence-limited BTC market interpretation. No execution,
 * demo account, position, or strategy admission fields are consumed.
 * Never turn missing / old / contradictory inputs into a directional call.
 */
internal object MarketInsightThesis {
    data class Report(val context: String, val flow: String, val fresh: Boolean)

    private fun price(n: Double): String =
        if (n.isFinite() && n > 0) String.format(Locale.US, "%,.2f", n) else "Unavailable"

    private fun validTrend(value: String): String = when (value.trim().uppercase(Locale.US)) {
        "UP", "BULLISH" -> "UP"
        "DOWN", "BEARISH" -> "DOWN"
        "SIDEWAYS", "RANGE", "RANGING", "NEUTRAL", "FLAT" -> "RANGE"
        else -> "UNKNOWN"
    }

    private fun observedString(json: JSONObject, name: String): String {
        val raw = json.optString(name, "").trim().uppercase(Locale.US)
        return raw.takeIf { it.isNotBlank() && it !in setOf("UNKNOWN", "NONE", "NULL", "N/A", "—") }
            ?: "UNAVAILABLE"
    }

    private fun describeTrend(fourHour: String, oneHour: String, fifteen: String): String {
        if (fourHour == "UNKNOWN" || oneHour == "UNKNOWN" || fifteen == "UNKNOWN")
            return "Timeframe evidence is incomplete; no directional thesis."
        return when {
            fourHour == "DOWN" && oneHour == "DOWN" && fifteen == "UP" ->
                "Bearish 4H/1H trend; 15m rebound is countertrend until higher-timeframe structure changes."
            fourHour == "UP" && oneHour == "UP" && fifteen == "DOWN" ->
                "Bullish 4H/1H trend; 15m pullback is countertrend until higher-timeframe structure changes."
            fourHour == "DOWN" && oneHour == "DOWN" && fifteen == "DOWN" ->
                "Bearish alignment across 4H, 1H and 15m; a reversal is not established."
            fourHour == "UP" && oneHour == "UP" && fifteen == "UP" ->
                "Bullish alignment across 4H, 1H and 15m; continuation is not guaranteed."
            fourHour == "RANGE" && oneHour == "RANGE" ->
                "Range-like higher timeframes; directional follow-through is uncertain."
            else -> "Mixed timeframe trends; direction lacks confirmation."
        }
    }

    private data class Level(val price: Double, val name: String, val source: String)
    private fun levels(overlays: JSONArray?, now: Long): List<Level> {
        if (overlays == null) return emptyList()
        val accepted = setOf("DAILY", "WEEKLY", "WEEKLY_OPEN", "NPOC", "WEEKLY_NPOC",
            "RANGE_POC", "RANGE_VAH", "RANGE_VAL", "MONTHLY_POC", "SFP")
        return (0 until overlays.length()).mapNotNull { index ->
            val row = overlays.optJSONObject(index) ?: return@mapNotNull null
            val kind = row.optString("kind", "").trim().uppercase(Locale.US)
            val value = row.optDouble("price", Double.NaN)
            val expires = row.optLong("reference_expires_ms", Long.MAX_VALUE)
            val hideAfter = row.optLong("hide_after_ms", Long.MAX_VALUE)
            if (kind !in accepted || !value.isFinite() || value <= 0.0 ||
                expires <= now || hideAfter <= now || row.optBoolean("estimated", false))
                return@mapNotNull null
            val name = when (kind) {
                "WEEKLY_NPOC" -> "Weekly nPOC"
                "WEEKLY_OPEN" -> "Weekly open"
                "MONTHLY_POC" -> "Monthly POC"
                "RANGE_POC" -> "Range POC"
                "RANGE_VAH" -> "Range VAH"
                "RANGE_VAL" -> "Range VAL"
                "NPOC" -> "nPOC"
                else -> kind.lowercase(Locale.US).replaceFirstChar { it.titlecase(Locale.US) }
            }
            val provenance = if (row.optBoolean("manual", false) ||
                row.optString("source", "").contains("SCREENSHOT")) "historical reference"
                else "mapped"
            Level(value, name, provenance)
        }.distinctBy { it.name + "|" + String.format(Locale.US, "%.2f", it.price) }
    }

    fun render(root: JSONObject, now: Long = System.currentTimeMillis()): Report {
        val source = root.optJSONObject("upstream")?.optString("source", "").orEmpty()
        val health = root.optString("data_health", "").uppercase(Locale.US)
        val last = maxOf(root.optLong("received_ts", 0), root.optLong("last_market_update_ts", 0))
        val age = now - last
        val spot = root.optDouble("last_price", Double.NaN)
        val sourceAccepted = source == "BITGET_WS" && root.optBoolean("ws_connected", false) ||
            source.contains("REST", ignoreCase = true)
        val fresh = sourceAccepted && health in setOf("HEALTHY", "DEGRADED") &&
            last > 0 && age in -1000L..8000L && spot.isFinite() && spot > 0.0
        val ageText = if (age >= 0 && last > 0) "${age / 1000}s" else "unknown"
        if (!fresh) {
            val reason = when {
                last <= 0 -> "No timestamped market snapshot"
                !sourceAccepted -> "Unverified market source"
                age !in -1000L..8000L -> "Market snapshot stale (age $ageText)"
                !spot.isFinite() || spot <= 0 -> "BTC price unavailable"
                else -> "Market feed degraded / unverified"
            }
            return Report(
                "DATA NOT VERIFIED\n$reason.\nDirectional thesis withheld until fresh BTC market evidence returns.",
                "DATA NOT VERIFIED\nLevel proximity, CVD and OI interpretations are withheld.\nLast snapshot age: $ageText.\nNo market levels or flow values inferred.",
                false
            )
        }

        val features = root.optJSONObject("features") ?: JSONObject()
        // Backend features represent computed trends, not confirmed future bars.
        val t4 = validTrend(features.optString("trend_240", ""))
        val t1 = validTrend(features.optString("trend_60", ""))
        val t15 = validTrend(features.optString("trend_15", ""))
        val structure = observedString(features, "market_structure")
        val regime = observedString(features, "regime")
        val thesis = describeTrend(t4, t1, t15)
        val regimeLabel = when {
            regime == "UNAVAILABLE" -> "Unclassified"
            else -> regime.replace("_", " ")
        }
        val incompatible = regime.contains("DOWN") && structure.contains("BULL") ||
            regime.contains("UP") && structure.contains("BEAR")
        val disagreement = if (incompatible) " • CONFLICTING SIGNALS" else ""
        val marketText = buildString {
            append("BTC / USDT PERPETUAL • ").append(price(spot)).append("\n")
            append("DATA  ").append(if (source == "BITGET_WS") "Exchange WS" else "REST fallback")
                .append(" • ").append(ageText).append(" old\n")
            append("TREND  4H ").append(t4).append(" • 1H ").append(t1)
                .append(" • 15m ").append(t15).append("\n")
            append("THESIS  ").append(thesis).append("\n")
            append("REGIME  ").append(regimeLabel).append("  •  Structure ")
                .append(structure).append(disagreement).append("\n")
            append("CONFIRMATION  Need fresh price action and structure; no guaranteed direction.")
        }
        val overlays = root.optJSONArray("chart_overlays")
        val confirmedLevels = levels(overlays, now)
        val above = confirmedLevels.filter { it.price > spot }
            .minByOrNull { it.price - spot }
        val below = confirmedLevels.filter { it.price < spot }
            .minByOrNull { spot - it.price }
        fun mapped(level: Level?): String = if (level == null) "Not available" else
            "${level.name} ${price(level.price)} (${level.source})"
        // NONE is an explicit "no divergence" classifier from the backend.
        // Missing/unknown/null is not evidence of an absent divergence.
        val cvd = features.optString("cvd_price_divergence", "").trim().uppercase(Locale.US)
        val cvdText = when (cvd) {
            "BULLISH", "BEARISH" -> "${cvd.lowercase(Locale.US)} divergence flagged; requires price confirmation"
            "NONE", "NEUTRAL" -> "No confirmed divergence flagged (not proof of neutral order flow)"
            else -> "Divergence data unavailable"
        }
        val oi = features.optDouble("oi_change_5m_pct", Double.NaN)
        val oiText = if (oi.isFinite() && abs(oi) <= 100.0)
            String.format(Locale.US, "%+.2f%%", oi) + " • participation change; not long/short direction"
        else "Unavailable (no reliable 5m change)"
        val reaction = root.optJSONObject("engine")?.optJSONObject("level_reactions")
        val state = reaction?.optString("status", "").orEmpty().uppercase(Locale.US)
        val status = if (state in setOf("CONFIRMING", "ARMED", "READY")) state
            else "NO CONFIRMED REACTION"
        val flowText = buildString {
            append("NEAREST MAPPED LEVELS • chart references\n")
            append("ABOVE  ").append(mapped(above)).append("\n")
            append("BELOW  ").append(mapped(below)).append("\n")
            append("STRUCTURE  ").append(structure).append("\n")
            append("CVD  ").append(cvdText).append("\n")
            append("OI 5m  ").append(oiText).append("\n")
            append("LEVEL REACTION  ").append(status).append("\n")
            append("Levels are references, not independently verified support/resistance.")
        }
        return Report(marketText, flowText, true)
    }
}
