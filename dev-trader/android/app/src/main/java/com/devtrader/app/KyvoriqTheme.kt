package com.devtrader.app

import android.animation.ValueAnimator
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.*
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.PowerManager
import android.view.View
import android.view.animation.PathInterpolator
import android.widget.Button

/** Shared visual tokens: gold is identity; green/red remain trading information. */
object KyvoriqTheme {
    val gold = Color.rgb(231, 196, 106)
    val deepGold = Color.rgb(184, 134, 11)
    val ember = Color.rgb(221, 151, 65)
    val charcoal = Color.rgb(13, 14, 16)
    val surface = Color.rgb(26, 25, 23)
    val raised = Color.rgb(39, 35, 28)
    val border = Color.rgb(80, 65, 38)
    val muted = Color.rgb(177, 171, 159)
    val white = Color.rgb(245, 240, 228)
    val motion = PathInterpolator(0.20f, 0.80f, 0.20f, 1f)

    fun motionEnabled(context: Context): Boolean = ValueAnimator.areAnimatorsEnabled() &&
        !(context.getSystemService(Context.POWER_SERVICE) as PowerManager).isPowerSaveMode

    fun button(context: Context, selected: Boolean = false, radius: Float = 12f): Drawable {
        val density = context.resources.displayMetrics.density
        val shape = GradientDrawable(GradientDrawable.Orientation.TL_BR,
            if (selected) intArrayOf(gold, deepGold) else intArrayOf(raised, surface)).apply {
            cornerRadius = radius * density
            setStroke(density.toInt().coerceAtLeast(1), ColorStateList(
                arrayOf(intArrayOf(android.R.attr.state_focused), intArrayOf()),
                intArrayOf(gold, if (selected) gold else border)))
        }
        return RippleDrawable(ColorStateList.valueOf(Color.argb(46, 247, 201, 72)), shape, null)
    }

    fun surface(context: Context, prominent: Boolean = false, radius: Float = 18f): Drawable =
        GoldSurfaceDrawable(context.resources.displayMetrics.density, prominent, radius)
}

/** Bounded native press feedback also works with keyboard/accessibility activation. */
class KyvoriqButton(context: Context) : Button(context) {
    override fun setPressed(pressed: Boolean) {
        super.setPressed(pressed)
        animate().cancel()
        val target = if (pressed && isEnabled) 0.975f else 1f
        if (isAttachedToWindow && KyvoriqTheme.motionEnabled(context)) {
            animate().scaleX(target).scaleY(target).setDuration(if (pressed) 90L else 180L)
                .setStartDelay(0).setInterpolator(KyvoriqTheme.motion).start()
        } else { scaleX = target; scaleY = target }
    }

    override fun onDetachedFromWindow() {
        animate().cancel()
        scaleX = 1f; scaleY = 1f
        super.onDetachedFromWindow()
    }
}

/** Static, low-cost brushed-gold lighting. No background particle loop. */
private class GoldSurfaceDrawable(
    private val density: Float, private val prominent: Boolean, radius: Float
) : Drawable() {
    private val radiusPx = radius * density
    private val rect = RectF()
    private val clip = Path()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val edge = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = density * 0.75f
    }
    private var drawableAlpha = 255
    private var fill: Shader? = null
    private var glow: Shader? = null
    private var rim: Shader? = null
    override fun onBoundsChange(bounds: Rect) {
        rect.set(bounds); rect.inset(density * 0.5f, density * 0.5f)
        clip.reset(); clip.addRoundRect(rect, radiusPx, radiusPx, Path.Direction.CW)
        fill = LinearGradient(rect.left, rect.top, rect.right, rect.bottom,
            if (prominent) intArrayOf(Color.rgb(53, 42, 23), Color.rgb(28, 25, 20), KyvoriqTheme.surface)
            else intArrayOf(Color.rgb(33, 30, 25), KyvoriqTheme.surface, Color.rgb(20, 20, 19)),
            null, Shader.TileMode.CLAMP)
        glow = RadialGradient(rect.left + rect.width() * .12f, rect.top,
            rect.width().coerceAtLeast(1f) * .85f,
            Color.argb(if (prominent) 30 else 10, 221, 151, 65), Color.TRANSPARENT, Shader.TileMode.CLAMP)
        rim = LinearGradient(rect.left, rect.top, rect.right, rect.bottom,
            intArrayOf(if (prominent) KyvoriqTheme.deepGold else KyvoriqTheme.border,
                KyvoriqTheme.border, Color.rgb(48, 43, 33)), null, Shader.TileMode.CLAMP)
    }
    override fun draw(canvas: Canvas) {
        paint.alpha = drawableAlpha
        paint.shader = fill
        canvas.drawRoundRect(rect, radiusPx, radiusPx, paint)
        paint.shader = glow
        canvas.drawRoundRect(rect, radiusPx, radiusPx, paint)
        edge.shader = rim
        canvas.drawRoundRect(rect, radiusPx, radiusPx, edge)
        if (prominent) {
            val save = canvas.save(); canvas.clipPath(clip)
            paint.shader = null; paint.color = Color.argb(13 * drawableAlpha / 255, 231, 196, 106)
            val x = rect.right - rect.width() * .22f
            val facet = Path().apply {
                moveTo(x, rect.top); lineTo(rect.right, rect.top)
                lineTo(rect.right, rect.bottom); close()
            }
            canvas.drawPath(facet, paint); canvas.restoreToCount(save)
        }
        paint.shader = null
    }
    override fun setAlpha(alpha: Int) { drawableAlpha = alpha; edge.alpha = alpha; invalidateSelf() }
    override fun setColorFilter(filter: ColorFilter?) { paint.colorFilter = filter; invalidateSelf() }
    @Deprecated("Deprecated in Java")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}
