package com.devtrader.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider

/**
 * Isolated Firebase consumer identity. Never grants private Bitget owner
 * access, paid tiers, or trading capability; those require independent
 * server-verified JWT claims + database entitlements.
 *
 * Account creation/login/recovery uses Firebase's managed provider. No
 * plaintext passwords, Google credentials or refresh tokens are persisted
 * in KYVORIQ preferences or sent to the private Voroa trading service.
 */
object KyvoriqConsumerIdentity {
    const val GOOGLE_REQUEST_CODE = 64161
    private const val FIREBASE_NAME = "kyvoriq-consumer-identity"

    fun configured(): Boolean = BuildConfig.FIREBASE_API_KEY.isNotBlank() &&
        BuildConfig.FIREBASE_APP_ID.isNotBlank() &&
        BuildConfig.FIREBASE_PROJECT_ID.isNotBlank()

    fun googleConfigured(): Boolean = configured() &&
        BuildConfig.GOOGLE_WEB_CLIENT_ID.endsWith(".apps.googleusercontent.com")

    @Synchronized
    private fun client(context: Context): FirebaseAuth? {
        if (!configured()) return null
        return runCatching {
            val app = FirebaseApp.getApps(context.applicationContext)
                .firstOrNull { it.name == FIREBASE_NAME } ?: FirebaseApp.initializeApp(
                    context.applicationContext,
                    FirebaseOptions.Builder()
                        .setApiKey(BuildConfig.FIREBASE_API_KEY)
                        .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                        .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                        .build(),
                    FIREBASE_NAME
                )
            FirebaseAuth.getInstance(app)
        }.getOrNull()
    }

    fun signedInVerifiedEmail(context: Context): String? =
        client(context)?.currentUser?.takeIf { it.isEmailVerified }?.email

    fun hasVerifiedSession(context: Context): Boolean =
        client(context)?.currentUser?.isEmailVerified == true

    fun signUp(activity: Activity, email: String, password: String, done: (String) -> Unit) {
        val auth = client(activity) ?: return done("Account provider is not configured yet.")
        if (!validEmail(email) || password.length < 12 || password.length > 128) {
            return done("Use a valid email and a password of 12–128 characters.")
        }
        auth.createUserWithEmailAndPassword(email.trim(), password)
            .addOnCompleteListener(activity) { result ->
                if (!result.isSuccessful) {
                    done("Registration unavailable. Check the details and retry.")
                    return@addOnCompleteListener
                }
                val user = auth.currentUser
                if (user == null) {
                    auth.signOut()
                    done("Account setup could not be confirmed.")
                    return@addOnCompleteListener
                }
                user.sendEmailVerification().addOnCompleteListener(activity) { mail ->
                    // Never treat an unverified email account as logged in.
                    auth.signOut()
                    done(if (mail.isSuccessful)
                        "Verification link sent. Check your Gmail/email, confirm it, then sign in."
                    else "Account created, but verification email could not be sent. Contact support before signing in.")
                }
            }
    }

    fun signIn(activity: Activity, email: String, password: String, done: (String) -> Unit) {
        val auth = client(activity) ?: return done("Account provider is not configured yet.")
        if (!validEmail(email) || password.isEmpty()) return done("Enter your email and password.")
        auth.signInWithEmailAndPassword(email.trim(), password)
            .addOnCompleteListener(activity) { result ->
                if (!result.isSuccessful) {
                    done("Could not sign in. Check your credentials or reset your password.")
                    return@addOnCompleteListener
                }
                auth.currentUser?.reload()?.addOnCompleteListener(activity) {
                    if (auth.currentUser?.isEmailVerified == true) {
                        done("Verified email sign-in successful. Premium access requires separate server verification.")
                    } else {
                        auth.signOut()
                        done("Please confirm the verification email before signing in.")
                    }
                } ?: run {
                    auth.signOut()
                    done("Account verification unavailable. Retry later.")
                }
            }
    }

    fun passwordReset(activity: Activity, email: String, done: (String) -> Unit) {
        val auth = client(activity) ?: return done("Account provider is not configured yet.")
        if (!validEmail(email)) return done("Enter a valid email address.")
        auth.sendPasswordResetEmail(email.trim()).addOnCompleteListener(activity) {
            // Enumeration-resistant response: do not confirm account existence.
            done("If the account exists, a password reset email will be sent. Check your inbox.")
        }
    }

    fun startGoogle(activity: Activity, done: (String) -> Unit) {
        if (!googleConfigured()) return done("Google sign-in is awaiting provider configuration.")
        val options = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestEmail().requestIdToken(BuildConfig.GOOGLE_WEB_CLIENT_ID).build()
        runCatching {
            activity.startActivityForResult(
                GoogleSignIn.getClient(activity, options).signInIntent, GOOGLE_REQUEST_CODE
            )
        }.onFailure { done("Google sign-in is unavailable on this device.") }
    }

    fun finishGoogle(activity: Activity, data: Intent?, done: (String) -> Unit) {
        val auth = client(activity) ?: return done("Google sign-in is not configured.")
        try {
            val account = GoogleSignIn.getSignedInAccountFromIntent(data)
                .getResult(ApiException::class.java)
            val token = account.idToken ?: return done("Google identity verification failed.")
            auth.signInWithCredential(GoogleAuthProvider.getCredential(token, null))
                .addOnCompleteListener(activity) { result ->
                    if (result.isSuccessful && auth.currentUser?.isEmailVerified == true) {
                        done("Google account verified. Premium access requires separate server verification.")
                    } else {
                        auth.signOut()
                        done("Google sign-in could not be verified.")
                    }
                }
        } catch (_: ApiException) {
            done("Google sign-in was cancelled or could not be verified.")
        }
    }

    fun signOut(context: Context) {
        client(context)?.signOut()
        if (googleConfigured()) {
            val options = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestEmail().requestIdToken(BuildConfig.GOOGLE_WEB_CLIENT_ID).build()
            runCatching { GoogleSignIn.getClient(context, options).signOut() }
        }
    }

    private fun validEmail(email: String) =
        email.length in 5..254 && email == email.trim() &&
            android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()
}
