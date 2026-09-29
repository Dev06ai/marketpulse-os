package com.devtrader.app

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class TradingMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        // Pairing endpoint will be wired when the private backend is deployed.
    }
    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
    }
}
