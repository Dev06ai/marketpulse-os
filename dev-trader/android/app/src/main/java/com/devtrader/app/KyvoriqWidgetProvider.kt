package com.devtrader.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import org.json.JSONObject
import java.util.Locale

class KyvoriqWidgetProvider : AppWidgetProvider() {
    companion object {
        private const val PREFS = "kyvoriq_widget"
        private const val KEY_PRICE = "price"
        private const val KEY_STATE = "state"
        private const val KEY_BIAS = "bias"
        private const val KEY_PNL = "pnl"
        private const val KEY_HEALTH = "health"
        private const val KEY_UPDATED = "updated"
        private const val MIN_PUSH_INTERVAL_MS = 5_000L

        fun updateFromState(context: Context, root: JSONObject) {
            val now = System.currentTimeMillis()
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val last = prefs.getLong(KEY_UPDATED, 0L)

            val price = root.optDouble("last_price", Double.NaN)
            val signal = root.optJSONObject("signal")
            val execution = root.optJSONObject("execution")
            val summary = execution?.optJSONObject("summary")
            val openTrades = summary?.optInt("open_trades", 0) ?: 0
            val health = root.optString("data_health", "UNKNOWN").uppercase(Locale.US)
            val state = when {
                health != "HEALTHY" -> "DEGRADED"
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
                else -> "WAIT"
            }
            val pnl = summary?.optDouble("unrealized_pnl_usdt", Double.NaN) ?: Double.NaN

            val priceText = if (price.isFinite()) String.format(Locale.US, "%,.2f", price) else "—"
            val pnlText = if (pnl.isFinite()) String.format(Locale.US, "%+.2f USDT", pnl) else "—"

            val changed = priceText != prefs.getString(KEY_PRICE, "") ||
                state != prefs.getString(KEY_STATE, "") ||
                bias != prefs.getString(KEY_BIAS, "") ||
                pnlText != prefs.getString(KEY_PNL, "") ||
                health != prefs.getString(KEY_HEALTH, "")

            prefs.edit()
                .putString(KEY_PRICE, priceText)
                .putString(KEY_STATE, state)
                .putString(KEY_BIAS, bias)
                .putString(KEY_PNL, pnlText)
                .putString(KEY_HEALTH, health)
                .putLong(KEY_UPDATED, now)
                .apply()

            if (changed || now - last >= MIN_PUSH_INTERVAL_MS) updateAll(context)
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
            val minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 180)
            val minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 100)
            val expanded = minWidth >= 250 || minHeight >= 150
            val layout = if (expanded) R.layout.widget_kyvoriq_expanded else R.layout.widget_kyvoriq_compact
            val views = RemoteViews(context.packageName, layout)

            val price = prefs.getString(KEY_PRICE, "—") ?: "—"
            val state = prefs.getString(KEY_STATE, "SCANNING") ?: "SCANNING"
            val bias = prefs.getString(KEY_BIAS, "WAIT") ?: "WAIT"
            val health = prefs.getString(KEY_HEALTH, "UNKNOWN") ?: "UNKNOWN"
            val pnl = if (hideAmounts) "••••" else (prefs.getString(KEY_PNL, "—") ?: "—")

            views.setTextViewText(R.id.widget_price, "BTC  $price")
            views.setTextViewText(R.id.widget_state, state)
            views.setTextViewText(R.id.widget_bias, bias)
            views.setTextViewText(R.id.widget_health, if (health == "HEALTHY") "LIVE" else health)
            if (expanded) views.setTextViewText(R.id.widget_pnl, "P&L  $pnl")

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
