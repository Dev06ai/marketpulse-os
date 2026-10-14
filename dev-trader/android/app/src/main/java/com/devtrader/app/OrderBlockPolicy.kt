package com.devtrader.app

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

/** Display admission only. Unknown/legacy OB quality never implies strength. */
object OrderBlockPolicy {
    private val weights = mapOf("15m" to 1, "1h" to 4, "4h" to 16, "1D" to 96, "2D" to 192)
    fun isOrderBlock(row: JSONObject): Boolean {
        val kind = row.optString("kind").uppercase(Locale.US)
        val label = row.optString("label").uppercase(Locale.US)
        return kind in setOf("OB", "OB_ZONE", "SUPPLY_ZONE", "DEMAND_ZONE") ||
            label.contains(" OB") || label.endsWith("OB")
    }

    fun filter(input: JSONArray?, currentPrice: Double = Double.NaN): JSONArray {
        val output = JSONArray()
        val candidates = mutableListOf<JSONObject>()
        for (i in 0 until (input?.length() ?: 0)) {
            val row = input?.optJSONObject(i) ?: continue
            if (!isOrderBlock(row)) { output.put(row); continue }
            val lo = row.optDouble("zone_low", Double.NaN)
            val hi = row.optDouble("zone_high", Double.NaN)
            val score = row.optInt("strength_score", 0)
            val tf = row.optString("timeframe")
            if (!lo.isFinite() || !hi.isFinite() || lo <= 0 || hi <= lo ||
                row.optString("rule_version") != "strong-ob-v1" ||
                row.optString("id").isBlank() || row.optLong("confirmed_at") <= 0 ||
                row.optString("status") != "ACTIVE" || !row.optBoolean("structure_break") ||
                row.optString("direction") !in setOf("BULLISH", "BEARISH") ||
                tf !in weights || score !in 75..100 || tf == "15m" && score < 85) continue
            candidates.add(row)
        }
        fun distance(row: JSONObject): Double = if (currentPrice.isFinite() && currentPrice > 0)
            max(max(row.optDouble("zone_low")-currentPrice, currentPrice-row.optDouble("zone_high")), 0.0)/currentPrice else 0.0
        val selected = mutableListOf<JSONObject>()
        candidates.sortedWith(compareByDescending<JSONObject> { it.optInt("strength_score") }
            .thenBy { distance(it) }.thenByDescending { weights[it.optString("timeframe")] ?: 0 }
            .thenByDescending { it.optLong("confirmed_at") }.thenBy { it.optString("id") }).forEach { row ->
            if (selected.size >= 4 || distance(row) > .12 ||
                selected.count { it.optString("direction") == row.optString("direction") } >= 2) return@forEach
            val lo = row.optDouble("zone_low"); val hi = row.optDouble("zone_high")
            if (selected.any { old ->
                val ol = old.optDouble("zone_low"); val oh = old.optDouble("zone_high")
                old.optString("id") == row.optString("id") ||
                    max(0.0, min(hi, oh)-max(lo, ol)) >= .5*min(hi-lo, oh-ol)
            }) return@forEach
            selected.add(row)
        }
        selected.forEach { output.put(it) }
        return output
    }
}
