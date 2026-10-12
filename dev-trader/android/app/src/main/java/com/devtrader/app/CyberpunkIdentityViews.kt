package com.devtrader.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.os.SystemClock
import android.view.View
import kotlin.math.sin

/**
 * VSYNC-driven, resolution-independent KYVORIQ identity.
 * No decoded GIF frames, main-thread handlers, network calls or bitmap allocations per frame.
 * Only visible, focused views animate. Reduced-motion and power-saver settings are respected.
 */
class CyberpunkMarkView(context: Context) : View(context) {
    private val mark: Drawable = requireNotNull(
        androidx.core.content.ContextCompat.getDrawable(context, R.drawable.kyvoriq_mark)
    ).mutate()
    private val cyan = Color.rgb(37, 226, 249)
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = resources.displayMetrics.density * 0.8f
    }
    private val streak = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        strokeWidth = resources.displayMetrics.density
    }
    private val glitchTint = PorterDuffColorFilter(cyan, PorterDuff.Mode.SRC_IN)
    private val rect = RectF()
    private val start = SystemClock.uptimeMillis()

    init {
        contentDescription = "KYVORIQ gold cyberpunk emblem"
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
        setLayerType(LAYER_TYPE_HARDWARE, null)
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        val side = minOf(w, h).toFloat()
        rect.set((w - side) / 2f, (h - side) / 2f, (w + side) / 2f, (h + side) / 2f)
        mark.setBounds(rect.left.toInt(), rect.top.toInt(), rect.right.toInt(), rect.bottom.toInt())
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (width <= 0 || height <= 0) return
        val running = KyvoriqTheme.motionEnabled(context) && isShown && hasWindowFocus()
        val t = if (running) (SystemClock.uptimeMillis() - start) / 1000f else 0f
        val pulse = if (running) (sin(t * 2.4f) + 1f) * .5f else .28f
        val s = canvas.save()
        canvas.scale(1f + pulse * .012f, 1f + pulse * .012f, width / 2f, height / 2f)
        mark.draw(canvas)
        canvas.restoreToCount(s)

        // Subtle pulsing targeting reticle; zero perceptual strobe/flicker.
        ring.color = Color.argb((15 + pulse * 25).toInt(), 37, 226, 249)
        canvas.drawRoundRect(rect.left + rect.width() * .1f,
            rect.top + rect.height() * .08f,
            rect.right - rect.width() * .1f,
            rect.bottom - rect.height() * .08f,
            rect.width() * .18f, rect.height() * .18f, ring)

        // The occasional offset scan-slice approximates the supplied glitch GIF,
        // without expensive full-screen decompression or uncontrolled blinking.
        val cycle = (t % 4.8f)
        if (running && cycle in 4.20f..4.43f) {
            val save = canvas.save()
            val y = rect.top + rect.height() * (.39f + (cycle - 4.20f) * .6f)
            canvas.clipRect(rect.left, y, rect.right, y + rect.height() * .095f)
            canvas.translate(rect.width() * .035f, 0f)
            mark.colorFilter = glitchTint
            mark.alpha = 150
            mark.draw(canvas)
            mark.alpha = 255
            mark.clearColorFilter()
            canvas.restoreToCount(save)
        }
        if (running) {
            val y = rect.top + (t % 3.2f) / 3.2f * rect.height()
            streak.color = Color.argb(24, 37, 226, 249)
            canvas.drawLine(rect.left + rect.width() * .14f, y,
                rect.right - rect.width() * .14f, y, streak)
            postInvalidateOnAnimation()
        }
    }

    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        super.onWindowFocusChanged(hasWindowFocus)
        if (hasWindowFocus) postInvalidateOnAnimation()
    }

    override fun onVisibilityAggregated(isVisible: Boolean) {
        super.onVisibilityAggregated(isVisible)
        if (isVisible) postInvalidateOnAnimation()
    }
}

class CyberpunkWordmarkView(context: Context) : View(context) {
    private val lettering = "KYVORIQ"
    private val path = Path()
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.create("sans-serif-condensed-black", Typeface.BOLD_ITALIC)
        textAlign = Paint.Align.LEFT
    }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val edge = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = resources.displayMetrics.density * .55f
    }
    private val accent = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = resources.displayMetrics.density
    }
    private val sweep = Matrix()
    private var shader: LinearGradient? = null
    private val started = SystemClock.uptimeMillis()

    init {
        contentDescription = "KYVORIQ"
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
        setLayerType(LAYER_TYPE_HARDWARE, null)
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        if (w <= 0 || h <= 0) return
        text.textSize = minOf(h * .74f, w / 5.15f)
        val measured = text.measureText(lettering)
        val baseline = (h - text.fontMetrics.ascent - text.fontMetrics.descent) * .5f
        path.reset()
        text.getTextPath(lettering, 0, lettering.length, (w - measured) / 2f, baseline, path)
        shader = LinearGradient(
            -w.toFloat(), 0f, w.toFloat(), 0f,
            intArrayOf(Color.rgb(255, 177, 48), Color.rgb(255, 222, 126),
                Color.rgb(37, 226, 249), Color.rgb(255, 202, 65)),
            floatArrayOf(0f, .36f, .53f, 1f), Shader.TileMode.CLAMP
        )
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val running = KyvoriqTheme.motionEnabled(context) && isShown && hasWindowFocus()
        val t = if (running) (SystemClock.uptimeMillis() - started) / 1000f else 0f
        edge.color = Color.argb(120, 37, 226, 249)
        canvas.drawPath(path, edge)
        sweep.setTranslate(if (running) (t % 3.6f) / 3.6f * width * 1.5f else width * .28f, 0f)
        shader?.setLocalMatrix(sweep)
        fill.shader = shader
        canvas.drawPath(path, fill)
        fill.shader = null
        if (running && t % 5.4f in 4.83f..4.98f) {
            val save = canvas.save()
            val y = height * .57f
            canvas.clipRect(0f, y, width.toFloat(), y + height * .13f)
            canvas.translate(resources.displayMetrics.density * 2.5f, 0f)
            fill.color = Color.argb(175, 37, 226, 249)
            canvas.drawPath(path, fill)
            canvas.restoreToCount(save)
        }
        accent.color = Color.argb(if (running) 95 else 54, 37, 226, 249)
        canvas.drawLine(width * .09f, height * .92f,
            width * (.12f + if (running) .76f * ((t % 2.6f) / 2.6f) else .30f),
            height * .92f, accent)
        if (running) postInvalidateOnAnimation()
    }

    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        super.onWindowFocusChanged(hasWindowFocus)
        if (hasWindowFocus) postInvalidateOnAnimation()
    }

    override fun onVisibilityAggregated(isVisible: Boolean) {
        super.onVisibilityAggregated(isVisible)
        if (isVisible) postInvalidateOnAnimation()
    }
}
