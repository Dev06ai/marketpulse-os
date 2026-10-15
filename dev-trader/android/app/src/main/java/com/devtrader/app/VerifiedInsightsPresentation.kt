package com.devtrader.app

import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Read-only consumer market intelligence from timestamped server evidence.
 * No strategy signal, prediction or execution state is used to manufacture
 * thesis/flow certainty. Private exchange demo account fields are never read.
 */
internal object VerifiedInsightsPresentation {
    private fun state(data: JSONObject?): String = data?.optString("quality", "UNVERIFIED")
        ?.uppercase(Locale.US) ?: "UNVERIFIED"

    private fun money(value: Double): String = if (value.isFinite() && value > 0)
        String.format(Locale.US, "%,.2f", value) else "—"

    private fun trend(value: String): String = when (value.uppercase(Locale.US)) {
        "UP" -> "UP"
        "DOWN" -> "DOWN"
        "RANGE" -> "RANGE"
        else -> "UNCONFIRMED"
    }

    private fun age(data: JSONObject?, now: Long): String {
        val whenMs = data?.optLong("market_as_of_ms", 0L) ?: 0L
        if (whenMs <= 0L || whenMs > now + 15_000L) return "Time unverified"
        val ageSeconds = ((now - whenMs) / 1000).coerceAtLeast(0L)
        val at = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date(whenMs))
        return "Feed $at · ${ageSeconds}s old (device local)"
    }

    fun usable(data: JSONObject?, now: Long): Boolean {
        if (data == null || state(data) !in setOf("LIVE", "PARTIAL")) return false
        val stamp = data.optLong("generated_at_ms", 0L)
        val market = data.optLong("market_as_of_ms", 0L)
        if (stamp <= 0L || market <= 0L || stamp > now + 15_000L ||
            now - stamp > 90_000L || now - market > 90_000L) return false
        return true
    }

    fun marketContext(data: JSONObject?, now: Long = System.currentTimeMillis()): String {
        val quality = state(data)
        if (!usable(data, now)) {
            return "MARKET DATA · UNVERIFIED / STALE\n" +
                "A current BTC thesis cannot be confirmed.\n" +
                age(data, now) + "\n" +
                "Waiting for fresh exchange data and confirmed candles.\n" +
                "No directional claim will be inferred from cached signals."
        }
        val info = data!!.optJSONObject("context") ?: JSONObject()
        val frames = info.optJSONObject("trends") ?: JSONObject()
        val bias = info.optString("bias", "UNCONFIRMED")
        val thesis = info.optString("thesis", "Insufficient verified evidence.")
            .take(260).ifBlank { "Insufficient verified evidence." }
        val structure = info.optString("structure_15m", "UNKNOWN")
        return "DATA · $quality · BTCUSDT perpetual\n" +
            age(data, now) + "\n" +
            "THESIS · $bias\n" +
            "4H ${trend(frames.optString("4h"))}  |  1H ${trend(frames.optString("1h"))}  |  " +
            "15M ${trend(frames.optString("15m"))}\n" +
            "15M STRUCTURE · ${trendStructure(structure)}\n" +
            thesis + "\n" +
            "Observed trends; not a guaranteed forecast or entry signal."
    }

    private fun trendStructure(value: String): String = when (value.uppercase(Locale.US)) {
        "BULLISH", "BEARISH", "RANGE" -> value.uppercase(Locale.US)
        else -> "UNCONFIRMED"
    }

    private fun level(label: String, level: JSONObject?): String {
        if (level == null) return "$label · Not confirmed"
        val price = level.optDouble("price", Double.NaN)
        val kind = level.optString("kind", "LEVEL").take(22)
        val distance = level.optDouble("distance_pct", Double.NaN)
        return "$label · $kind ${money(price)}" +
            (if (distance.isFinite()) String.format(Locale.US, " (%+.2f%%)", distance) else "")
    }

    fun levelsFlow(data: JSONObject?, now: Long = System.currentTimeMillis()): String {
        if (!usable(data, now)) {
            return "LEVELS & FLOW · UNVERIFIED\n" +
                "Confirmed levels and order flow are withheld while data is stale.\n" +
                "OI/CVD values are unavailable until their own history is verified."
        }
        val levels = data!!.optJSONObject("levels") ?: JSONObject()
        val flow = data.optJSONObject("flow") ?: JSONObject()
        val oi = flow.optDouble("oi_5m_pct", Double.NaN)
        val oiOk = flow.optString("oi_source") == "EXCHANGE_OPEN_INTEREST" && oi.isFinite()
        val cvd = flow.optString("cvd_divergence", "UNAVAILABLE").uppercase(Locale.US)
        val cvdOk = flow.optString("cvd_source") == "RECENT_TRADE_TAPE" &&
            cvd in setOf("BULLISH", "BEARISH", "NONE")
        val cvdText = if (!cvdOk) "Not verified" else if (cvd == "NONE")
            "No divergence observed" else "$cvd divergence (heuristic)"
        return "CONFIRMED MARKET REFERENCES\n" +
            level("Above", levels.optJSONObject("above")) + "\n" +
            level("Below", levels.optJSONObject("below")) + "\n" +
            "OI · " + (if (oiOk) String.format(Locale.US, "5m %+.3f%%", oi) else "5m unavailable") + "\n" +
            "CVD · $cvdText\n" +
            "Live observations, not automatic support/resistance or trades."
    }
}
