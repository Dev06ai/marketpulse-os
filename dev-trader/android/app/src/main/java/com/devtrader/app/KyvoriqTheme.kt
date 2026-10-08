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

/** Premium midnight / champagne identity. Teal and red remain reserved for market data. */
object KyvoriqTheme {
    // Design reference: cool blue-black glass, champagne accents and subtle silver rims.
    val gold = Color.rgb(234, 194, 137)      // #EAC289 champagne
    val ember = Color.rgb(206, 164, 109)     // #CEA46D satin bronze
    val deepGold = Color.rgb(177, 132, 77)   // #B1844D antique gold
    val charcoal = Color.rgb(10, 16, 23)     // #0A1017
    val slate = Color.rgb(19, 28, 39)        // #131C27
    val graphite = Color.rgb(37, 48, 61)     // #25303D
    val gray = Color.rgb(175, 187, 201)      // #AFBBC9
    val surface = slate
    val raised = graphite
    val border = Color.argb(148, 123, 141, 158) // restrained slate/silver
    val muted = gray
    val white = Color.rgb(238, 242, 247)     // #EEF2F7
    val motion = PathInterpolator(0.20f, 0.80f, 0.20f, 1f)

    fun motionEnabled(context: Context): Boolean = ValueAnimator.areAnimatorsEnabled() &&
        !(context.getSystemService(Context.POWER_SERVICE) as PowerManager).isPowerSaveMode

    fun button(context: Context, selected: Boolean = false, radius: Float = 12f): Drawable {
        val density = context.resources.displayMetrics.density
        val shape = GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            if (selected) intArrayOf(Color.rgb(250, 224, 177), gold, deepGold)
            else intArrayOf(graphite, slate, charcoal)
        ).apply {
            cornerRadius = radius * density
            setStroke(density.toInt().coerceAtLeast(1), ColorStateList(
                arrayOf(intArrayOf(android.R.attr.state_focused), intArrayOf()),
                intArrayOf(if (selected) gold else Color.argb(185, 151, 166, 182),
                    if (selected) deepGold else Color.argb(118, 120, 144, 167))))
        }
        return RippleDrawable(ColorStateList.valueOf(Color.argb(42, 234, 194, 137)), shape, null)
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

/** Static satin-metal lighting; no GPU particle loop or shimmer animation. */
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
            Color.argb(if (prominent) 24 else 10, 234, 194, 137), Color.TRANSPARENT, Shader.TileMode.CLAMP)
        sheen = LinearGradient(rect.left, rect.bottom, rect.right, rect.top,
            intArrayOf(Color.TRANSPARENT, Color.argb(if (prominent) 26 else 11, 175, 199, 218), Color.TRANSPARENT),
            floatArrayOf(0f, .38f, 1f), Shader.TileMode.CLAMP)
        rim = LinearGradient(rect.left, rect.top, rect.right, rect.bottom,
            intArrayOf(
                if (prominent) Color.argb(192, 186, 192, 201) else Color.argb(122, 134, 151, 170),
                Color.argb(175, 123, 141, 158),
                Color.argb(140, 67, 83, 103)
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
            paint.shader = null; paint.color = Color.argb(13 * drawableAlpha / 255, 176, 196, 219)
            val x = rect.right - rect.width() * .24f
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
