package com.devtrader.app

import android.animation.ValueAnimator
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.PowerManager
import android.provider.Settings
import android.view.animation.PathInterpolator
import android.widget.Button

/** Monochrome KYVORIQ trading surfaces with a restrained deep-gold identity. */
object KyvoriqTheme {
    val gold = Color.rgb(182, 140, 75)
    val ember = Color.rgb(199, 165, 103)
    val deepGold = Color.rgb(137, 98, 44)
    val charcoal = Color.rgb(8, 9, 11)
    val slate = Color.rgb(16, 17, 20)
    val graphite = Color.rgb(28, 29, 33)
    val gray = Color.rgb(161, 164, 171)
    val surface = slate
    val raised = graphite
    val border = Color.rgb(53, 55, 61)
    val muted = gray
    val white = Color.rgb(244, 245, 247)
    val motion = PathInterpolator(0.20f, 0.80f, 0.20f, 1f)

    fun motionEnabled(context: Context): Boolean =
        Settings.Global.getFloat(
            context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f
        ) > 0f && ValueAnimator.areAnimatorsEnabled() &&
        !(context.getSystemService(Context.POWER_SERVICE) as PowerManager).isPowerSaveMode

    fun button(context: Context, selected: Boolean = false, radius: Float = 12f): Drawable {
        val density = context.resources.displayMetrics.density
        val shape = GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            if (selected) intArrayOf(Color.rgb(246, 246, 247), Color.rgb(212, 213, 216))
            else intArrayOf(Color.rgb(27, 28, 31), Color.rgb(15, 16, 19))
        ).apply {
            cornerRadius = radius * density
            setStroke((density * .8f).toInt().coerceAtLeast(1),
                if (selected) Color.rgb(236, 237, 240) else border)
        }
        return RippleDrawable(ColorStateList.valueOf(Color.argb(43, 221, 224, 228)), shape, null)
    }

    fun surface(context: Context, prominent: Boolean = false, radius: Float = 18f): Drawable {
        val density = context.resources.displayMetrics.density
        return GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            if (prominent) intArrayOf(Color.rgb(25, 26, 30), Color.rgb(15, 16, 19))
            else intArrayOf(Color.rgb(20, 21, 24), Color.rgb(13, 14, 16))
        ).apply {
            cornerRadius = radius * density
            setStroke((density * .8f).toInt().coerceAtLeast(1),
                if (prominent) Color.rgb(68, 69, 75) else border)
        }
    }
}

/** Native press feedback remains accessible and pauses when detached. */
class KyvoriqButton(context: Context) : Button(context) {
    override fun setPressed(pressed: Boolean) {
        super.setPressed(pressed)
        animate().cancel()
        val target = if (pressed && isEnabled) .975f else 1f
        if (isAttachedToWindow && KyvoriqTheme.motionEnabled(context)) {
            animate().scaleX(target).scaleY(target)
                .setDuration(if (pressed) 90L else 180L)
                .setStartDelay(0).setInterpolator(KyvoriqTheme.motion).start()
        } else { scaleX = target; scaleY = target }
    }

    override fun onDetachedFromWindow() {
        animate().cancel()
        scaleX = 1f
        scaleY = 1f
        super.onDetachedFromWindow()
    }
}
