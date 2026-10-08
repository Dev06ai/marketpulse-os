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
    // KYVORIQ brand board — exact palette values.
    val gold = Color.rgb(219, 170, 59)       // #DBAA3B
    val ember = Color.rgb(224, 131, 45)      // #E0832D
    val deepGold = Color.rgb(184, 134, 11)   // #B8860B
    val charcoal = Color.rgb(12, 12, 12)     // #0C0C0C
    val slate = Color.rgb(23, 21, 18)        // #171512
    val graphite = Color.rgb(44, 35, 23)     // #2C2317
    val gray = Color.rgb(179, 168, 147)      // #B3A893
    val surface = slate
    val raised = graphite
    val border = Color.argb(148, 184, 134, 11)
    val muted = gray
    val white = Color.rgb(247, 240, 227)
    val motion = PathInterpolator(0.20f, 0.80f, 0.20f, 1f)

    fun motionEnabled(context: Context): Boolean = ValueAnimator.areAnimatorsEnabled() &&
        !(context.getSystemService(Context.POWER_SERVICE) as PowerManager).isPowerSaveMode

    fun button(context: Context, selected: Boolean = false, radius: Float = 12f): Drawable {
        val density = context.resources.displayMetrics.density
        val shape = GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            if (selected) intArrayOf(gold, ember, deepGold)
            else intArrayOf(graphite, slate, charcoal)
        ).apply {
            cornerRadius = radius * density
            setStroke(density.toInt().coerceAtLeast(1), ColorStateList(
                arrayOf(intArrayOf(android.R.attr.state_focused), intArrayOf()),
                intArrayOf(gold, if (selected) deepGold else Color.argb(150, 184, 134, 11))))
        }
        return RippleDrawable(ColorStateList.valueOf(Color.argb(42, 219, 170, 59)), shape, null)
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
    private var sheen: Shader? = null
    private var rim: Shader? = null
    override fun onBoundsChange(bounds: Rect) {
        rect.set(bounds); rect.inset(density * 0.5f, density * 0.5f)
        clip.reset(); clip.addRoundRect(rect, radiusPx, radiusPx, Path.Direction.CW)
        fill = LinearGradient(
            rect.left, rect.top, rect.right, rect.bottom,
            if (prominent) intArrayOf(KyvoriqTheme.graphite, KyvoriqTheme.slate, KyvoriqTheme.charcoal)
            else intArrayOf(KyvoriqTheme.slate, KyvoriqTheme.charcoal, KyvoriqTheme.graphite),
            null, Shader.TileMode.CLAMP
        )
        glow = RadialGradient(rect.left + rect.width() * .12f, rect.top,
            rect.width().coerceAtLeast(1f) * .85f,
            Color.argb(if (prominent) 34 else 12, 224, 167, 46), Color.TRANSPARENT, Shader.TileMode.CLAMP)
        sheen = LinearGradient(rect.left, rect.bottom, rect.right, rect.top,
            intArrayOf(Color.TRANSPARENT, Color.argb(if (prominent) 23 else 9, 224, 131, 45), Color.TRANSPARENT),
            floatArrayOf(0f, .38f, 1f), Shader.TileMode.CLAMP)
        rim = LinearGradient(rect.left, rect.top, rect.right, rect.bottom,
            intArrayOf(
                if (prominent) KyvoriqTheme.deepGold else Color.argb(120, 184, 134, 11),
                Color.argb(120, 184, 134, 11),
                KyvoriqTheme.graphite
            ), null, Shader.TileMode.CLAMP)
    }
    override fun draw(canvas: Canvas) {
        paint.alpha = drawableAlpha
        paint.shader = fill
        canvas.drawRoundRect(rect, radiusPx, radiusPx, paint)
        paint.shader = glow
        canvas.drawRoundRect(rect, radiusPx, radiusPx, paint)
        paint.shader = sheen
        canvas.drawRoundRect(rect, radiusPx, radiusPx, paint)
        edge.shader = rim
        canvas.drawRoundRect(rect, radiusPx, radiusPx, edge)
        if (prominent) {
            val save = canvas.save(); canvas.clipPath(clip)
            paint.shader = null; paint.color = Color.argb(16 * drawableAlpha / 255, 219, 170, 59)
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
