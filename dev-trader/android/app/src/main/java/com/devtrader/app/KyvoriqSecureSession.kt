package com.devtrader.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import okhttp3.Request
import java.net.URI
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Stores only a short-lived, server-issued DEVICE bearer encrypted by the
 * Android hardware-backed Keystore where available. Never store the operator
 * pairing secret, Bitget credentials, or any host master token in the APK.
 */
object KyvoriqSecureSession {
    private const val ALIAS = "kyvoriq_device_session_aes_v1"
    private const val PREFS = "kyvoriq_secure_session_v1"
    private const val TOKEN = "access_token_encrypted"
    private const val EXP = "expires_at"
    private const val MAX_LIFETIME_SECONDS = 7L * 24L * 60L * 60L

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore")
        store.load(null)
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build()
        )
        return generator.generateKey()
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    fun save(context: Context, token: String, expiresAt: Long) {
        val now = System.currentTimeMillis() / 1000L
        require(token.startsWith("kvq.v1.") && token.length < 512)
        require(expiresAt > now && expiresAt <= now + MAX_LIFETIME_SECONDS + 120L)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(token.toByteArray(StandardCharsets.UTF_8))
        val blob = iv + ciphertext
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(TOKEN, Base64.encodeToString(blob, Base64.NO_WRAP))
            .putLong(EXP, expiresAt).apply()
    }

    fun accessToken(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getLong(EXP, 0L) <= System.currentTimeMillis() / 1000L + 10L) {
            clear(context)
            return null
        }
        val blob = prefs.getString(TOKEN, null) ?: return null
        return runCatching {
            val decoded = Base64.decode(blob, Base64.NO_WRAP)
            require(decoded.size in 30..700)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, decoded.copyOfRange(0, 12)))
            val value = String(cipher.doFinal(decoded.copyOfRange(12, decoded.size)), StandardCharsets.UTF_8)
            require(value.startsWith("kvq.v1.") && value.length < 512)
            value
        }.getOrElse {
            clear(context)
            null
        }
    }

    fun isPaired(context: Context): Boolean = accessToken(context) != null

    /** Do not send a bearer to GitHub, arbitrary URLs, or update providers. */
    fun authenticate(context: Context, builder: Request.Builder, url: String): Request.Builder {
        val origin = runCatching { URI(BackendEndpoint.base) }.getOrNull() ?: return builder
        val destination = runCatching { URI(url) }.getOrNull() ?: return builder
        val scheme = destination.scheme?.lowercase()
        if (scheme !in setOf("https", "wss") || origin.host.isNullOrBlank() ||
            !origin.host.equals(destination.host, ignoreCase = true) || origin.port != destination.port
        ) return builder
        accessToken(context)?.let { builder.header("Authorization", "Bearer " + it) }
        return builder
    }
}
