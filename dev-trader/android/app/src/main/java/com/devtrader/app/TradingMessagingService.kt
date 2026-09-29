package com.devtrader.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class TradingMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        getSharedPreferences("dev_trader", Context.MODE_PRIVATE)
            .edit()
            .putString("fcm_token", token)
            .apply()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        getSharedPreferences("dev_trader", Context.MODE_PRIVATE)
            .edit()
            .putLong("last_fcm_received_ts", System.currentTimeMillis())
            .putString("last_fcm_type", message.data["type"] ?: "notification")
            .apply()

        ensureChannel(this)

        val title = message.notification?.title
            ?: if (message.data["type"] == "system_check") "Dev Trader System Check" else "Dev Trader"
        val body = message.notification?.body
            ?: "Notification received successfully."

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Dev Trader Signals",
                    NotificationManager.IMPORTANCE_HIGH
                )
            )
        }
    }

    companion object {
        private const val CHANNEL_ID = "dev_trader_signals"
        private const val NOTIFICATION_ID = 3101
    }
}
