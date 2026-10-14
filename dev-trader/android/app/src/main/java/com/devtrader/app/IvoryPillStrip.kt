package com.devtrader.app

import android.animation.ValueAnimator
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout

/** A single physical ivory pill glides between controls without intercepting touches. */
class IvoryPillStrip(context: Context) : FrameLayout(context) {
    val buttons = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = android.view.Gravity.CENTER_VERTICAL
    }
    private val selector = View(context).apply {
        background = GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(Color.rgb(252, 250, 245), KyvoriqTheme.gold)
        ).apply { cornerRadius = dp(100f); setStroke(dp(1f).toInt().coerceAtLeast(1), KyvoriqTheme.deepGold) }
        isClickable = false
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    private var selectedIndex = 0
    private var widthAnimation: ValueAnimator? = null
    private var positioned = false

    init {
        clipChildren = false
        clipToPadding = false
        addView(selector, LayoutParams(0, 0))
        addView(buttons, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
    }

    fun select(index: Int, animated: Boolean = true) {
        if (index !in 0 until buttons.childCount) return
        selectedIndex = index
        for (i in 0 until buttons.childCount) {
            val button = buttons.getChildAt(i) as? Button ?: continue
            val active = i == index
            button.isSelected = active
            button.setTextColor(if (active) KyvoriqTheme.charcoal else KyvoriqTheme.white)
            // Transparent button surface leaves the sliding ivory selector visible.
            button.background = RippleDrawable(
                ColorStateList.valueOf(Color.argb(65, 245, 241, 230)),
                ColorDrawable(Color.TRANSPARENT),
                null
            )
        }
        val target = buttons.getChildAt(index)
        if (target.width == 0 || target.height == 0) {
            post { if (isAttachedToWindow) positionSelected(false) }
        } else positionSelected(animated)
    }

    private fun positionSelected(animated: Boolean) {
        val target = buttons.getChildAt(selectedIndex) ?: return
        if (target.width <= 0 || target.height <= 0) return
        val params = selector.layoutParams as LayoutParams
        val newWidth = target.width
        val newHeight = target.height
        val targetX = buttons.left.toFloat() + target.left
        val targetY = buttons.top.toFloat() + target.top
        selector.animate().cancel()
        widthAnimation?.cancel()
        params.height = newHeight
        if (!positioned || !animated || !KyvoriqTheme.motionEnabled(context)) {
            params.width = newWidth
            selector.layoutParams = params
            selector.x = targetX
            selector.y = targetY
        } else {
            val oldWidth = selector.width
            if (oldWidth != newWidth) {
                widthAnimation = ValueAnimator.ofInt(oldWidth, newWidth).apply {
                    duration = 290L
                    interpolator = KyvoriqTheme.motion
                    addUpdateListener {
                        val updated = selector.layoutParams as LayoutParams
                        updated.width = it.animatedValue as Int
                        selector.layoutParams = updated
                    }
                    start()
                }
            }
            selector.animate().x(targetX).y(targetY).setDuration(290L)
                .setInterpolator(KyvoriqTheme.motion).start()
        }
        positioned = true
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w != oldw || h != oldh) post { if (isAttachedToWindow) positionSelected(false) }
    }

    override fun onDetachedFromWindow() {
        selector.animate().cancel()
        widthAnimation?.cancel()
        widthAnimation = null
        super.onDetachedFromWindow()
    }

    private fun dp(value: Float) = value * resources.displayMetrics.density
}
