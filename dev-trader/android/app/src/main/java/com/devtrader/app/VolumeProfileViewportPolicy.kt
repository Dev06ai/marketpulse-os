package com.devtrader.app

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs

/**
 * Chart-only viewport semantics for historical 15m-OHLCV volume estimates.
 * Do not substitute estimated volume profiles into the strategy or execution.
 */
internal object VolumeProfileViewportPolicy {
    data class Selection(val profile: JSONObject, val pinned: Boolean)

    fun select(profiles: JSONArray, viewStartMs: Long, viewEndMs: Long): Selection? {
        if (viewStartMs <= 0 || viewEndMs <= viewStartMs) return null
        val valid = (0 until profiles.length()).mapNotNull { profiles.optJSONObject(it) }
            .filter { p ->
                val start = p.optLong("start_ms", 0L)
                val end = p.optLong("end_ms", 0L)
                val valueLow = p.optDouble("val", Double.NaN)
                val valueMid = p.optDouble("poc", Double.NaN)
                val valueHigh = p.optDouble("vah", Double.NaN)
                p.optString("source") == "OHLCV_15M_ESTIMATE" &&
                    start > 0 && end > start &&
                    valueLow.isFinite() && valueLow > 0.0 &&
                    valueMid.isFinite() && valueHigh.isFinite() &&
                    valueLow <= valueMid && valueMid <= valueHigh &&
                    (p.optJSONArray("bins")?.length() ?: 0) >= 2
            }
        if (valid.isEmpty()) return null
        val inView = valid.filter {
            it.optLong("start_ms") <= viewEndMs && it.optLong("end_ms") > viewStartMs
        }
        if (inView.isNotEmpty()) {
            return Selection(inView.maxWithOrNull(compareBy<JSONObject> { it.optLong("start_ms") }
                .thenBy { it.optLong("end_ms") })!!, false)
        }
        // When no backfilled VP exists in the scrolled viewport, show the
        // nearest REAL available snapshot, explicitly flagged PINNED.
        // Never invent OHLCV bins for the missing historical session.
        val nearest = valid.minWithOrNull(
            compareBy<JSONObject> {
                val start = it.optLong("start_ms")
                val end = it.optLong("end_ms")
                when {
                    end < viewStartMs -> viewStartMs.toDouble() - end
                    start > viewEndMs -> start.toDouble() - viewEndMs
                    else -> 0.0
                }
            }.thenByDescending { it.optLong("start_ms") }
        ) ?: return null
        return Selection(nearest, true)
    }

    fun offscreenPriceLevels(
        rows: List<JSONObject>, low: Double, high: Double
    ): Pair<JSONObject?, JSONObject?> {
        if (!low.isFinite() || !high.isFinite() || low >= high) return null to null
        // Upper/lower nearest real level: arrows express OUTSIDE the viewport,
        // never imply the source level is at the edge tick.
        val above = rows.filter { it.optDouble("price", Double.NaN).let { p ->
            p.isFinite() && p > high && p > 0.0
        } }.minByOrNull { it.optDouble("price") }
        val below = rows.filter { it.optDouble("price", Double.NaN).let { p ->
            p.isFinite() && p < low && p > 0.0
        } }.maxByOrNull { it.optDouble("price") }
        return above to below
    }
}
