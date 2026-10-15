package com.devtrader.app

import org.json.JSONObject

/**
 * Stable Build 191 Insights adapter. Only the backend's auditable read-only
 * market_insights payload may drive user-visible market theses and order flow.
 *
 * Intentionally ignores strategy state, demo execution, historical screenshot
 * levels, implied CVD-neutral defaults and OI numbers without time coverage.
 */
internal object MarketInsightThesis {
    data class Report(val context: String, val flow: String, val fresh: Boolean)

    fun render(root: JSONObject, now: Long = System.currentTimeMillis()): Report {
        val verified = root.optJSONObject("market_insights")
        return Report(
            context = VerifiedInsightsPresentation.marketContext(verified, now),
            flow = VerifiedInsightsPresentation.levelsFlow(verified, now),
            fresh = VerifiedInsightsPresentation.usable(verified, now),
        )
    }
}
