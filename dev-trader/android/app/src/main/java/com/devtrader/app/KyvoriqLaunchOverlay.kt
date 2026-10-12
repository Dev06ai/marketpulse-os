package com.devtrader.app

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Cyberpunk boot sequence (~1.8s). Circuit-board boot, violet ignition, emblem
 * materialization, RGB tear, cyan/gold razor wordmark, dashboard reveal.
 * Visual only: application/network bootstrap runs separately and is never blocked.
 */
class KyvoriqLaunchOverlay(context: Context) : FrameLayout(context) {
    private val ease=PathInterpolator(.15f,.80f,.20f,1f)
    private val circuit=CyberpunkCircuitBackdrop(context)
    private val emblem=CyberpunkMarkView(context).apply {
        alpha=0f;scaleX=.42f;scaleY=.42f;translationY=dp(28f)
    }
    private val wordmark=CyberpunkWordmarkView(context).apply {
        alpha=0f;scaleX=1.18f;translationX=-dp(22f)
    }
    private val tag=TextView(context).apply {
        text="SYSTEM BOOT  //  QUANTUM MARKET INTERFACE"
        setTextColor(0xFFABB8D2.toInt())
        textSize=9f;letterSpacing=.12f
        typeface=Typeface.create("monospace",Typeface.BOLD)
        gravity=Gravity.CENTER
        includeFontPadding=false
        alpha=0f
    }
    private val charge=View(context).apply {
        background=GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,intArrayOf(
            Color.TRANSPARENT,0xFF8F43FF.toInt(),0xFF18E8FF.toInt(),0xFFFFCE47.toInt(),Color.TRANSPARENT))
        alpha=0f;scaleX=0f
    }
    private val lens=View(context).apply {
        background=GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,intArrayOf(
            Color.TRANSPARENT,0x6630E9FF,0x889B39FF.toInt(),Color.TRANSPARENT))
        alpha=0f;rotation=-16f
    }

    init {
        isClickable=true
        isFocusable=true
        setBackgroundColor(0xFF090713.toInt())
        addView(circuit, LayoutParams(-1,-1))
        val center=LinearLayout(context).apply { orientation=LinearLayout.VERTICAL;gravity=Gravity.CENTER }
        center.addView(emblem,LinearLayout.LayoutParams(dp(180f).toInt(),dp(180f).toInt()).apply {
            gravity=Gravity.CENTER_HORIZONTAL
        })
        center.addView(wordmark,LinearLayout.LayoutParams(dp(284f).toInt(),dp(69f).toInt()).apply {
            gravity=Gravity.CENTER_HORIZONTAL;topMargin=dp(6f).toInt()
        })
        center.addView(tag,LinearLayout.LayoutParams(-1,-2).apply { topMargin=dp(2f).toInt() })
        center.addView(charge,LinearLayout.LayoutParams(dp(256f).toInt(),dp(2f).toInt()).apply {
            gravity=Gravity.CENTER_HORIZONTAL;topMargin=dp(21f).toInt()
        })
        addView(center,LayoutParams(-1,-1))
        addView(lens,LayoutParams(dp(72f).toInt(),dp(280f).toInt()).apply {
            gravity=Gravity.START or Gravity.CENTER_VERTICAL
        })
    }

    fun play(onEnd:()->Unit) {
        if(!KyvoriqTheme.motionEnabled(context)){onEnd();return}
        post {
            // Real Android display VSYNC drives all motion; no per-frame bitmap decode.
            emblem.animate().alpha(1f).scaleX(1f).scaleY(1f).translationY(0f)
                .setStartDelay(240L).setDuration(620L).setInterpolator(ease).withLayer().start()
            wordmark.animate().alpha(1f).scaleX(1f).translationX(0f)
                .setStartDelay(650L).setDuration(490L).setInterpolator(ease).withLayer().start()
            tag.animate().alpha(.93f)
                .setStartDelay(1050L).setDuration(230L).setInterpolator(ease).start()
            charge.animate().alpha(1f).scaleX(1f)
                .setStartDelay(880L).setDuration(470L).setInterpolator(ease).start()
            lens.translationX=-dp(160f)
            lens.animate().alpha(.45f).translationX(width+dp(120f))
                .setStartDelay(650L).setDuration(550L).setInterpolator(ease).withLayer().start()
            animate().alpha(0f).scaleX(1.013f).scaleY(1.013f)
                .setStartDelay(1550L).setDuration(230L).setInterpolator(ease)
                .withEndAction { onEnd() }.start()
        }
    }
    override fun onDetachedFromWindow(){
        animate().cancel()
        listOf(emblem,wordmark,tag,charge,lens).forEach{it.animate().cancel()}
        super.onDetachedFromWindow()
    }
    private fun dp(value:Float):Float = value*resources.displayMetrics.density
}
