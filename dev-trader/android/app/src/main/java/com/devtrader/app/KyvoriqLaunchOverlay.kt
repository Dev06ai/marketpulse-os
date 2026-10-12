package com.devtrader.app

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.airbnb.lottie.LottieAnimationView
import com.airbnb.lottie.RenderMode

/**
 * Build 140 cinematic intro: three independent authored Lottie compositions.
 *
 * Nested precomps in the original all-in-one intro were not rendering on the
 * Android 35 emulator. Keep its verified circuit artwork as the background,
 * while overlaying the known-good emblem and wordmark Lottie views. This
 * preserves the original motion assets without blanking the branding.
 */
class KyvoriqLaunchOverlay(context: Context) : FrameLayout(context) {
    private val easing = PathInterpolator(.18f, .78f, .20f, 1f)
    private var completed = false
    private var onComplete: (() -> Unit)? = null
    private val timeout = Runnable { finish() }

    private val circuit = LottieAnimationView(context).apply {
        setAnimation("kyvoriq_ignition_intro.json")
        repeatCount = 0
        scaleType = ImageView.ScaleType.FIT_CENTER
        setRenderMode(RenderMode.AUTOMATIC)
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    private val emblem = KyvoriqEmblemMotionView(context).apply {
        alpha = 0f
        scaleX = .76f
        scaleY = .76f
    }
    private val wordmark = KyvoriqRazorWordmarkView(context).apply {
        alpha = 0f
        translationX = -dp(16f)
    }
    private val subtitle = TextView(context).apply {
        text = "KYVORIQ  //  MARKET INTELLIGENCE"
        textSize = 9f
        letterSpacing = .12f
        gravity = Gravity.CENTER
        setTextColor(Color.rgb(169, 190, 203))
        typeface = Typeface.create("monospace", Typeface.BOLD)
        includeFontPadding = false
        alpha = 0f
    }

    init {
        setBackgroundColor(0xFF070C12.toInt())
        isClickable = true
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        addView(circuit, LayoutParams(-1, -1))
        val lockup = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }
        lockup.addView(emblem,
            LinearLayout.LayoutParams(dp(168f).toInt(), dp(168f).toInt()).apply {
                gravity = Gravity.CENTER_HORIZONTAL
            })
        lockup.addView(wordmark,
            LinearLayout.LayoutParams(dp(294f).toInt(), dp(70f).toInt()).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                topMargin = dp(5f).toInt()
            })
        lockup.addView(subtitle,
            LinearLayout.LayoutParams(-1, dp(30f).toInt()).apply {
                topMargin = dp(8f).toInt()
            })
        addView(lockup, LayoutParams(-1, -1))
    }

    fun play(onEnd: () -> Unit) {
        if (completed) { onEnd(); return }
        onComplete = onEnd
        if (!KyvoriqTheme.motionEnabled(context)) { finish(); return }
        post {
            if (completed || onComplete == null) return@post
            postDelayed(timeout, 1900L)
            circuit.playAnimation()
            emblem.animate().alpha(1f).scaleX(1f).scaleY(1f)
                .setStartDelay(130L).setDuration(460L).setInterpolator(easing).start()
            wordmark.animate().alpha(1f).translationX(0f)
                .setStartDelay(460L).setDuration(410L).setInterpolator(easing).start()
            subtitle.animate().alpha(1f)
                .setStartDelay(960L).setDuration(260L).setInterpolator(easing).start()
            animate().alpha(0f).setStartDelay(1480L).setDuration(240L)
                .setInterpolator(easing).withEndAction { finish() }.start()
        }
    }

    /** Freeze all three authored assets for screenshot QA; never called in production UI. */
    internal fun showVerificationFrame() {
        circuit.pauseAnimation()
        circuit.progress = .45f
        emblem.alpha = 1f
        emblem.scaleX = 1f
        emblem.scaleY = 1f
        wordmark.alpha = 1f
        wordmark.translationX = 0f
        subtitle.alpha = 1f
        alpha = 1f
    }

    private fun finish() {
        if (completed) return
        completed = true
        removeCallbacks(timeout)
        circuit.cancelAnimation()
        val callback = onComplete
        onComplete = null
        callback?.invoke()
    }

    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        super.onWindowFocusChanged(hasWindowFocus)
        if (!hasWindowFocus && onComplete != null) finish()
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(timeout)
        animate().cancel()
        emblem.animate().cancel()
        wordmark.animate().cancel()
        subtitle.animate().cancel()
        circuit.cancelAnimation()
        onComplete = null
        completed = true
        super.onDetachedFromWindow()
    }

    private fun dp(value: Float): Float = value * resources.displayMetrics.density
}
