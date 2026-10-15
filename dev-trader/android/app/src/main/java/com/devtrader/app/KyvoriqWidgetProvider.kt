package com.devtrader.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.widget.RemoteViews
import org.json.JSONObject
import java.util.Locale

class KyvoriqWidgetProvider : AppWidgetProvider() {
    companion object {
        private const val PREFS = "kyvoriq_widget"
        private const val KEY_PRICE = "price"
        private const val KEY_PRICE_RAW = "price_raw"
        private const val KEY_PREVIOUS_PRICE = "previous_price"
        private const val KEY_PRICE_SLOT = "price_slot"
        private const val KEY_PRICE_DIRECTION = "price_direction"
        private const val KEY_STATE = "state"
        private const val KEY_BIAS = "bias"
        private const val KEY_PNL = "pnl"
        private const val KEY_HEALTH = "health"
        private const val KEY_UPDATED = "updated"
        private const val KEY_OPEN_DIRECTION = "open_direction"
        private const val KEY_OPEN_ENTRY = "open_entry"
        private const val KEY_OPEN_QTY = "open_qty"

        fun updateFromState(context: Context, root: JSONObject) {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val price = root.optDouble("last_price", Double.NaN)
            val signal = root.optJSONObject("signal")
            val execution = root.optJSONObject("execution")
            val summary = execution?.optJSONObject("summary")
            val openTrades = summary?.optInt("open_trades", 0) ?: 0
            val health = root.optString("data_health", prefs.getString(KEY_HEALTH, "UNKNOWN") ?: "UNKNOWN")
                .uppercase(Locale.US)

            val state = when {
                health !in setOf("HEALTHY", "LIVE") -> "DEGRADED"
                openTrades > 0 -> "POSITION OPEN"
                signal != null -> "TRADE READY"
                else -> "SCANNING"
            }
            val direction = signal?.optString("direction", "").orEmpty().uppercase(Locale.US)
            val engineBias = root.optJSONObject("engine")
                ?.optJSONObject("market_story")
                ?.optString("bias", "")
                .orEmpty()
                .uppercase(Locale.US)
            val bias = when {
                direction == "LONG" || direction == "SHORT" -> direction
                engineBias.isNotBlank() -> engineBias
                else -> "SCANNING"
            }

            var openDirection = ""
            var openEntry = Double.NaN
            var openQty = Double.NaN
            val recent = execution?.optJSONArray("recent_trades")
            if (recent != null) {
                for (i in 0 until recent.length()) {
                    val trade = recent.optJSONObject(i) ?: continue
                    if (trade.optString("status").uppercase(Locale.US) != "OPEN") continue
                    openDirection = trade.optString("direction", direction).uppercase(Locale.US)
                    openEntry = trade.optDouble("entry_price", Double.NaN)
                    openQty = trade.optDouble("filled_qty", trade.optDouble("requested_qty", Double.NaN))
                    break
                }
            }

            val serverPnl = summary?.optDouble("unrealized_pnl_usdt", Double.NaN) ?: Double.NaN
            val pnlText = if (serverPnl.isFinite()) String.format(Locale.US, "%+.2f USDT", serverPnl) else "—"

            val editor = prefs.edit()
                .putString(KEY_STATE, state)
                .putString(KEY_BIAS, bias)
                .putString(KEY_PNL, pnlText)
                .putString(KEY_HEALTH, health)
                .putString(KEY_OPEN_DIRECTION, openDirection)
                .putLong(KEY_UPDATED, System.currentTimeMillis())

            if (openEntry.isFinite() && openQty.isFinite() && openQty > 0.0) {
                editor.putString(KEY_OPEN_ENTRY, openEntry.toString())
                    .putString(KEY_OPEN_QTY, openQty.toString())
            } else if (openTrades <= 0) {
                editor.remove(KEY_OPEN_ENTRY).remove(KEY_OPEN_QTY).remove(KEY_OPEN_DIRECTION)
            }
            editor.apply()

            if (price.isFinite()) {
                updatePriceAndLiveFields(context, price, health, push = false)
            }
            // The detailed dashboard's reconciled value takes precedence over
            // the local price-only gross estimate on this authoritative update.
            // Subsequent price ticks display their own estimate explicitly.
            if (serverPnl.isFinite()) {
                prefs.edit().putString(KEY_PNL, pnlText).apply()
            }
            updateAll(context)
        }

        fun updateFromMarketTick(context: Context, root: JSONObject) {
            val price = root.optDouble("last_price", Double.NaN)
            val health = root.optString("data_health", "UNKNOWN").uppercase(Locale.US)
            if (price.isFinite()) {
                updatePriceAndLiveFields(context, price, health, push = true)
            } else {
                val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                prefs.edit()
                    .putString(KEY_HEALTH, health)
                    .putLong(KEY_UPDATED, System.currentTimeMillis())
                    .apply()
                updateAll(context)
            }
        }

        private fun updatePriceAndLiveFields(context: Context, price: Double, health: String, push: Boolean) {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val oldRaw = prefs.getString(KEY_PRICE_RAW, null)?.toDoubleOrNull()
            val formatted = String.format(Locale.US, "%,.2f", price)
            val previousFormatted = prefs.getString(KEY_PRICE, "—") ?: "—"
            var slot = prefs.getInt(KEY_PRICE_SLOT, 0)
            var motion = prefs.getInt(KEY_PRICE_DIRECTION, 0)

            if (oldRaw != null && price != oldRaw) {
                motion = when {
                    price > oldRaw -> 1
                    price < oldRaw -> -1
                    else -> 0
                }
                if (formatted != previousFormatted) slot = 1 - slot
            }

            val openDirection = prefs.getString(KEY_OPEN_DIRECTION, "").orEmpty().uppercase(Locale.US)
            val openEntry = prefs.getString(KEY_OPEN_ENTRY, null)?.toDoubleOrNull()
            val openQty = prefs.getString(KEY_OPEN_QTY, null)?.toDoubleOrNull()
            val estimatedPnl = if (
                openDirection in setOf("LONG", "SHORT") &&
                openEntry != null && openEntry.isFinite() &&
                openQty != null && openQty.isFinite() && openQty > 0.0
            ) {
                val move = if (openDirection == "SHORT") openEntry - price else price - openEntry
                move * openQty
            } else Double.NaN

            prefs.edit()
                .putString(KEY_PREVIOUS_PRICE, previousFormatted)
                .putString(KEY_PRICE, formatted)
                .putString(KEY_PRICE_RAW, price.toString())
                .putInt(KEY_PRICE_SLOT, slot)
                .putInt(KEY_PRICE_DIRECTION, motion)
                .putString(KEY_HEALTH, health)
                .putString(
                    KEY_PNL,
                    if (estimatedPnl.isFinite()) String.format(Locale.US, "≈%+.2f USDT", estimatedPnl)
                    else prefs.getString(KEY_PNL, "—") ?: "—"
                )
                .putLong(KEY_UPDATED, System.currentTimeMillis())
                .apply()

            if (push) updateAll(context)
        }

        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val component = ComponentName(context, KyvoriqWidgetProvider::class.java)
            val ids = manager.getAppWidgetIds(component)
            ids.forEach { updateOne(context, manager, it) }
        }

        private fun updateOne(context: Context, manager: AppWidgetManager, appWidgetId: Int) {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val privacy = context.getSharedPreferences("kyvoriq_privacy", Context.MODE_PRIVATE)
            val hideAmounts = privacy.getBoolean("hide_amounts", false)
            val options = manager.getAppWidgetOptions(appWidgetId)
            val minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 260)
            val minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 100)
            // Only vertical resizing expands details; width alone should not
            // turn a slim 4x1 price card back into a bulky two-row widget.
            val expanded = minHeight >= 170
            val layout = if (expanded) R.layout.widget_kyvoriq_expanded else R.layout.widget_kyvoriq_compact
            val views = RemoteViews(context.packageName, layout)

            // On compact 4x1 widgets protect price legibility before ornamental text.
            // Larger launchers receive the full logo / LIVE label, smaller ones
            // retain the emblem, full value and the Alerts shortcut.
            views.setViewVisibility(R.id.widget_alerts,
                if (expanded || minWidth >= 230) android.view.View.VISIBLE else android.view.View.GONE)
            if (!expanded) {
                val logoVisible = if (minWidth >= 315) android.view.View.VISIBLE else android.view.View.GONE
                views.setViewVisibility(R.id.widget_wordmark, logoVisible)
                views.setViewVisibility(R.id.widget_brand_divider, logoVisible)
                views.setViewVisibility(R.id.widget_market_divider,
                    if (minWidth >= 355) android.view.View.VISIBLE else android.view.View.GONE)
                views.setViewVisibility(R.id.widget_health,
                    if (minWidth >= 385) android.view.View.VISIBLE else android.view.View.GONE)
            }

            val price = prefs.getString(KEY_PRICE, "—") ?: "—"
            val previous = prefs.getString(KEY_PREVIOUS_PRICE, "—") ?: "—"
            val slot = prefs.getInt(KEY_PRICE_SLOT, 0)
            val motion = prefs.getInt(KEY_PRICE_DIRECTION, 0)
            val state = prefs.getString(KEY_STATE, "SCANNING") ?: "SCANNING"
            val bias = prefs.getString(KEY_BIAS, "SCANNING") ?: "SCANNING"
            val health = prefs.getString(KEY_HEALTH, "UNKNOWN") ?: "UNKNOWN"
            val pnl = if (hideAmounts) "••••" else (prefs.getString(KEY_PNL, "—") ?: "—")

            // Brand system: the price is consistently ivory, regardless of the
            // previous tick. Direction remains legible in the adjacent arrow.
            val currentColor = KyvoriqTheme.gold
            val delta = when {
                motion > 0 -> "▲"
                motion < 0 -> "▼"
                else -> "•"
            }
            val deltaColor = when {
                motion > 0 -> KyvoriqTheme.gold
                motion < 0 -> KyvoriqTheme.white
                else -> KyvoriqTheme.muted
            }
            val biasColor = when (bias) {
                "LONG", "BULLISH" -> KyvoriqTheme.gold
                "SHORT", "BEARISH" -> KyvoriqTheme.white
                else -> KyvoriqTheme.gold
            }
            // Cached prices are not live after a service stop or expired pairing.
            val updated = prefs.getLong(KEY_UPDATED, 0L)
            val quoteFresh = updated > 0L && System.currentTimeMillis() - updated in 0L..20_000L
            val paired = KyvoriqSecureSession.isPaired(context)
            // No consumer widget entitlement provider is live yet. Never
            // expose cached owner market/execution state after local expiry,
            // logout or device unpairing. Server-verified Pro/Elite projection
            // must replace this guard before consumer widget launch.
            if (!paired) {
                views.setTextViewText(R.id.widget_price_0, "—")
                views.setTextViewText(R.id.widget_price_1, "—")
                views.setDisplayedChild(R.id.widget_price_flipper, 0)
                views.setTextViewText(R.id.widget_delta, "•")
                views.setTextViewText(R.id.widget_bias, "LOCKED")
                views.setTextViewText(R.id.widget_health, "SIGN IN")
                if (!expanded) {
                    views.setViewVisibility(R.id.widget_market_dot, android.view.View.GONE)
                    views.setViewVisibility(R.id.widget_health, android.view.View.VISIBLE)
                }
                if (expanded) {
                    views.setTextViewText(R.id.widget_state, "MARKET WIDGET LOCKED")
                    views.setTextViewText(R.id.widget_pnl, "P&L  PRIVATE")
                }
                manager.updateAppWidget(appWidgetId, views)
                return
            }
            val healthLabel = when {
                !paired -> "PAIR"
                !quoteFresh -> "STALE"
                health in setOf("HEALTHY", "LIVE") -> "LIVE"
                else -> "SYNCING"
            }
            val healthColor = if (paired && quoteFresh && health == "HEALTHY")
                KyvoriqTheme.gold else KyvoriqTheme.muted

            if (slot == 0) {
                views.setTextViewText(R.id.widget_price_0, price)
                views.setTextViewText(R.id.widget_price_1, previous)
            } else {
                views.setTextViewText(R.id.widget_price_0, previous)
                views.setTextViewText(R.id.widget_price_1, price)
            }
            views.setTextColor(R.id.widget_price_0, currentColor)
            views.setTextColor(R.id.widget_price_1, currentColor)
            views.setDisplayedChild(R.id.widget_price_flipper, slot)
            views.setTextViewText(R.id.widget_delta, if (paired && quoteFresh) delta else "•")
            views.setTextColor(R.id.widget_delta, deltaColor)

            if (expanded) views.setTextViewText(R.id.widget_state, if (paired) state else "PAIR DEVICE")
            views.setTextViewText(R.id.widget_bias, if (!paired) "Private" else if (bias == "WAIT") "Scanning" else bias.lowercase().replaceFirstChar { it.uppercase() })
            views.setTextColor(R.id.widget_bias, biasColor)
            if (!expanded) views.setViewVisibility(R.id.widget_bias, android.view.View.GONE)
            if (!expanded) {
                val feedLive = quoteFresh && health in setOf("HEALTHY", "LIVE")
                views.setViewVisibility(R.id.widget_market_dot,
                    if (feedLive) android.view.View.VISIBLE else android.view.View.GONE)
                views.setTextViewText(R.id.widget_health, when {
                    feedLive && minWidth >= 445 -> "MARKET LIVE"
                    feedLive -> "LIVE"
                    !quoteFresh -> "STALE"
                    else -> "SYNCING"
                })
                if (!feedLive) views.setViewVisibility(R.id.widget_health, android.view.View.VISIBLE)
            } else {
                views.setTextViewText(R.id.widget_health, healthLabel)
            }
            views.setTextColor(R.id.widget_health, healthColor)
            if (expanded) {
                views.setTextViewText(R.id.widget_pnl, if (paired) "P&L  $pnl" else "P&L  PRIVATE")
                val pnlColor = when {
                    pnl.startsWith("+") || pnl.startsWith("≈+") -> KyvoriqTheme.gold
                    pnl.startsWith("-") || pnl.startsWith("≈-") -> KyvoriqTheme.white
                    else -> KyvoriqTheme.white
                }
                views.setTextColor(R.id.widget_pnl, pnlColor)
            }

            fun destination(name: String, index: Int): PendingIntent {
                val route = Intent(context, SafeActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                    data = android.net.Uri.parse("kyvoriq://widget/$appWidgetId/$name")
                    putExtra("widget_destination", name)
                }
                return PendingIntent.getActivity(context, appWidgetId * 10 + index, route,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            }
            views.setOnClickPendingIntent(R.id.widget_price_flipper, destination("chart", 1))
            views.setOnClickPendingIntent(R.id.widget_health, destination("insights", 2))
            if (!expanded) views.setOnClickPendingIntent(R.id.widget_market_status, destination("insights", 2))
            views.setOnClickPendingIntent(R.id.widget_alerts, destination("alerts", 3))
            if (expanded) {
                views.setOnClickPendingIntent(R.id.widget_chart, destination("chart", 4))
                views.setOnClickPendingIntent(R.id.widget_positions, destination("positions", 5))
            }
            val open = Intent(context, SafeActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pending = PendingIntent.getActivity(
                context,
                appWidgetId,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_root, pending)
            manager.updateAppWidget(appWidgetId, views)
        }
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { updateOne(context, manager, it) }
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: android.os.Bundle
    ) {
        updateOne(context, manager, appWidgetId)
    }
}
