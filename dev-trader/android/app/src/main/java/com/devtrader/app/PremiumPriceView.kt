package com.devtrader.app

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Locale

/**
 * Native, VSYNC-driven BTC price motion for the main KYVORIQ terminal.
 *
 * Property animations are scheduled by Android's rendering pipeline, so motion
 * follows the device refresh rate (60/90/120 Hz where the OS/display permits)
 * instead of using a hand-written timer.
 */
class PremiumPriceView(context: Context) : LinearLayout(context) {
    private val gold = KyvoriqTheme.gold
    private val green = Color.rgb(54, 211, 153)
    private val red = Color.rgb(255, 82, 105)
    private val motionInterpolator = PathInterpolator(0.18f, 0.82f, 0.20f, 1f)
    private val settleInterpolator = PathInterpolator(0.20f, 0f, 0f, 1f)

    private val instrument = TextView(context).apply {
        text = "BTC"
        setTextColor(gold)
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        includeFontPadding = false
        gravity = Gravity.CENTER_VERTICAL
    }

    private val valueHost = FrameLayout(context)
    private val valueViews = Array(2) {
        TextView(context).apply {
            text = "—"
            setTextColor(gold)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            includeFontPadding = false
            gravity = Gravity.CENTER_VERTICAL
            alpha = if (it == 0) 1f else 0f
        }
    }

    private var activeSlot = 0
    private var lastPrice = Double.NaN
    private var colorAnimator: ValueAnimator? = null
    private var settleGeneration = 0L

    init {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        clipChildren = false
        clipToPadding = false
        valueHost.clipChildren = false
        valueHost.clipToPadding = false

        addView(instrument, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.MATCH_PARENT))
        addView(
            valueHost,
            LayoutParams(0, LayoutParams.MATCH_PARENT, 1f).apply {
                marginStart = dp(9f).toInt()
            }
        )
        valueViews.forEach {
            valueHost.addView(
                it,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
            )
        }
        contentDescription = "BTC price"
    }

    fun setTextSizeSp(size: Float) {
        instrument.textSize = size * .48f
        valueViews.forEach { it.textSize = size }
    }

    fun setPrice(price: Double, animate: Boolean = true) {
        val shouldAnimate = animate && isShown && KyvoriqTheme.motionEnabled(context)
        if (!price.isFinite()) {
            cancelAnimations()
            valueViews[activeSlot].text = "—"
            valueViews[activeSlot].setTextColor(gold)
            lastPrice = Double.NaN
            contentDescription = "BTC price unavailable"
            return
        }

        val formatted = String.format(Locale.US, "%,.2f", price)
        val previous = lastPrice
        val direction = when {
            previous.isFinite() && price > previous -> 1
            previous.isFinite() && price < previous -> -1
            else -> 0
        }

        if (!previous.isFinite() || !shouldAnimate) {
            cancelAnimations()
            val current = valueViews[activeSlot]
            current.text = formatted
            current.alpha = 1f
            current.translationY = 0f
            current.scaleX = 1f
            current.scaleY = 1f
            current.setTextColor(gold)
            lastPrice = price
            contentDescription = "BTC $formatted"
            return
        }

        if (formatted == valueViews[activeSlot].text.toString()) {
            lastPrice = price
            contentDescription = "BTC $formatted"
            return
        }

        val outgoing = valueViews[activeSlot]
        val incomingSlot = 1 - activeSlot
        val incoming = valueViews[incomingSlot]
        val travel = dp(6f)
        val incomingStart = if (direction >= 0) travel else -travel
        val outgoingEnd = -incomingStart
        val motionColor = when {
            direction > 0 -> green
            direction < 0 -> red
            else -> gold
        }

        settleGeneration += 1
        val generation = settleGeneration
        cancelViewMotion(outgoing)
        cancelViewMotion(incoming)
        colorAnimator?.cancel()

        incoming.text = formatted
        incoming.setTextColor(motionColor)
        incoming.alpha = 0f
        incoming.translationY = incomingStart
        incoming.scaleX = 0.985f
        incoming.scaleY = 0.985f
        incoming.visibility = View.VISIBLE

        outgoing.animate()
            .alpha(0f)
            .translationY(outgoingEnd)
            .scaleX(0.992f)
            .scaleY(0.992f)
            .setDuration(150L)
            .setInterpolator(settleInterpolator)
            .withLayer()
            .start()

        incoming.animate()
            .alpha(1f)
            .translationY(0f)
            .scaleX(1f)
            .scaleY(1f)
            .setDuration(245L)
            .setInterpolator(motionInterpolator)
            .withLayer()
            .withEndAction {
                if (generation != settleGeneration) return@withEndAction
                outgoing.alpha = 0f
                outgoing.translationY = 0f
                outgoing.scaleX = 1f
                outgoing.scaleY = 1f
                activeSlot = incomingSlot
                settleColor(incoming, motionColor, generation)
            }
            .start()

        activeSlot = incomingSlot
        lastPrice = price
        contentDescription = "BTC $formatted"
    }

    private fun settleColor(view: TextView, fromColor: Int, generation: Long) {
        if (fromColor == gold) return
        colorAnimator?.cancel()
        colorAnimator = ValueAnimator.ofArgb(fromColor, gold).apply {
            startDelay = 85L
            duration = 360L
            interpolator = settleInterpolator
            addUpdateListener {
                if (generation == settleGeneration) {
                    view.setTextColor(it.animatedValue as Int)
                }
            }
            start()
        }
    }

    private fun cancelAnimations() {
        settleGeneration += 1
        colorAnimator?.cancel()
        colorAnimator = null
        valueViews.forEachIndexed { i, view ->
            cancelViewMotion(view)
            view.alpha = if (i == activeSlot) 1f else 0f
            view.translationY = 0f; view.scaleX = 1f; view.scaleY = 1f
        }
    }

    private fun cancelViewMotion(view: View) {
        view.animate().cancel()
    }

    override fun onDetachedFromWindow() {
        cancelAnimations()
        super.onDetachedFromWindow()
    }

    private fun dp(value: Float): Float = value * resources.displayMetrics.density
}
