package com.devtrader.app

import android.content.Context
import android.content.BroadcastReceiver
import android.content.Intent
import android.content.IntentFilter
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.core.content.ContextCompat
import com.airbnb.lottie.LottieAnimationView
import com.airbnb.lottie.LottieDrawable
import com.airbnb.lottie.RenderMode

/** Aspect-preserving vectors with a matching native fallback and no offscreen animation. */
open class KyvoriqIdentityMotionView(
    context: Context, filename: String, fallbackResource: Int, description: String
) : FrameLayout(context) {
    private var loaded = false
    private var observing = false
    private val still = ImageView(context).apply {
        setImageResource(fallbackResource)
        scaleType = ImageView.ScaleType.FIT_CENTER
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    private val motion = LottieAnimationView(context).apply {
        scaleType = ImageView.ScaleType.FIT_CENTER
        repeatCount = LottieDrawable.INFINITE
        repeatMode = LottieDrawable.RESTART
        setRenderMode(RenderMode.AUTOMATIC)
        setCacheComposition(true)
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        visibility = View.INVISIBLE
    }
    private val motionSetting = object : ContentObserver(Handler(Looper.getMainLooper())) {
        override fun onChange(selfChange: Boolean) = refresh()
    }
    private val powerSetting = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) = refresh()
    }
    init {
        contentDescription = description
        addView(still, LayoutParams(-1, -1))
        addView(motion, LayoutParams(-1, -1))
        motion.addLottieOnCompositionLoadedListener { loaded = true; refresh() }
        motion.setFailureListener { loaded = false; refresh() }
        motion.setAnimation(filename)
    }
    private fun refresh() {
        val animate = loaded && KyvoriqTheme.motionEnabled(context)
        still.visibility = if (animate) View.INVISIBLE else View.VISIBLE
        motion.visibility = if (animate) View.VISIBLE else View.INVISIBLE
        if (animate && isAttachedToWindow && isShown && hasWindowFocus()) {
            if (!motion.isAnimating) motion.resumeAnimation()
        } else motion.pauseAnimation()
    }
    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (!observing) {
            context.contentResolver.registerContentObserver(
                Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, motionSetting
            )
            ContextCompat.registerReceiver(context, powerSetting,
                IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
            observing = true
        }
        refresh()
    }
    override fun onDetachedFromWindow() {
        motion.pauseAnimation()
        if (observing) {
            context.contentResolver.unregisterContentObserver(motionSetting)
            context.unregisterReceiver(powerSetting)
            observing = false
        }
        super.onDetachedFromWindow()
    }
    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        super.onWindowFocusChanged(hasWindowFocus); refresh()
    }
    override fun onVisibilityAggregated(isVisible: Boolean) {
        super.onVisibilityAggregated(isVisible); refresh()
    }
}

class KyvoriqEmblemMotionView(context: Context) : KyvoriqIdentityMotionView(
    context, "kyvoriq_gold_flames.json", R.drawable.kyvoriq_emblem_static, "KYVORIQ gold emblem"
)

class KyvoriqRazorWordmarkView(context: Context) : KyvoriqIdentityMotionView(
    context, "kyvoriq_razor_wordmark.json", R.drawable.kyvoriq_wordmark_static, "KYVORIQ"
)
