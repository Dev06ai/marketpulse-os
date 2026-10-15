package com.devtrader.app

import org.json.JSONArray
import org.json.JSONObject

/**
 * Historical TradingView 1h annotations, chart only. They cannot authorize orders,
 * signals or risk decisions. Fixed screenshot values never masquerade as today's
 * automatically calculated levels. Unreadable OB boundaries and ALL Fibonacci
 * projections are intentionally excluded.
 */
internal object DewaldSnapshotReferences {
    const val SOURCE = "DEWALD_SCREENSHOT_2026_10_15"
    const val START_MS = 1792048560000L // Oct 15 2026, 07:16 UTC = 09:16 UTC+2
    const val EXPIRES_MS = 1792368000000L // Oct 19 2026, 00:00 UTC

    internal data class Reference(val kind: String, val label: String, val price: Double)
    internal val exact = listOf(
        Reference("NPOC", "nPOC", 89409.5),
        Reference("DAILY", "Daily", 89261.7),
        Reference("NPOC", "nPOC", 87996.6),
        Reference("WEEKLY_NPOC", "Weekly nPOC", 87783.9),
        Reference("WEEKLY", "Weekly", 86482.8),
        Reference("NPOC", "nPOC", 85563.9),
        Reference("RANGE_POC", "Range POC", 83903.4),
        Reference("DAILY", "Daily", 83125.7),
        Reference("RANGE_VAL", "VAL Range", 82337.2),
        Reference("RANGE_VAL", "VAL", 80530.0),
        Reference("RANGE_LOW", "Range Low", 80095.9),
        Reference("MONTHLY_POC", "Monthly POC", 77249.9),
        Reference("WEEKLY", "Weekly", 77246.5),
        Reference("WEEKLY_NPOC", "Weekly nPOC", 76805.0),
        Reference("WEEKLY_NPOC", "Weekly nPOC", 76384.9),
        Reference("NPOC", "nPOC", 75790.1),
        Reference("DAILY", "Daily", 75599.9)
    )

    fun isActive(nowMs: Long = System.currentTimeMillis()): Boolean =
        nowMs >= START_MS && nowMs < EXPIRES_MS

    fun rows(nowMs: Long = System.currentTimeMillis()): JSONArray {
        val result = JSONArray()
        if (!isActive(nowMs)) return result
        exact.forEach { reference ->
            result.put(JSONObject()
                .put("id", "dewald-oct15-" + reference.kind.lowercase() + "-" + (reference.price * 10).toInt())
                .put("kind", reference.kind)
                .put("label", reference.label)
                .put("price", reference.price)
                .put("priority", if (reference.kind.contains("POC")) 12 else 10)
                .put("source", SOURCE)
                .put("manual", true)
                .put("status", "REFERENCE")
                .put("estimated", false)
                .put("reference_expires_ms", EXPIRES_MS))
        }
        return result
    }

    /** A backend outage cannot hide chart annotations; identical remote refs
     * are not doubled, and superseded Oct 14 screenshots are not mixed in.
     */
    fun merge(remote: JSONArray?, nowMs: Long = System.currentTimeMillis()): JSONArray {
        val result = rows(nowMs)
        val local = HashSet<String>()
        for (i in 0 until result.length()) {
            val r = result.optJSONObject(i) ?: continue
            local.add(r.optString("kind") + "|" + r.optDouble("price"))
        }
        if (remote == null) return result
        for (i in 0 until remote.length()) {
            val row = remote.optJSONObject(i) ?: continue
            val source = row.optString("source")
            if (isActive(nowMs) && source.startsWith("MINDPILLAR_SCREENSHOT_")) continue
            val expiry = row.optLong("reference_expires_ms", 0L)
            if (expiry <= nowMs || expiry <= 0L) continue
            val price = row.optDouble("price", Double.NaN)
            if (!price.isFinite() || price <= 0.0) continue
            val key = row.optString("kind") + "|" + price
            if (local.add(key)) result.put(row)
        }
        return result
    }
}
