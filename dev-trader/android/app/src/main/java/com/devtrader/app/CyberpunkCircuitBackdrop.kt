package com.devtrader.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.os.SystemClock
import android.view.View
import kotlin.math.sin

/**
 * Circuit-board splash ambience drawn in one small native layer.
 * It is removed with the launch overlay and never competes with candle chart redraws.
 */
class CyberpunkCircuitBackdrop(context: Context) : View(context) {
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG)
    private val trace = Paint(Paint.ANTI_ALIAS_FLAG).apply { style=Paint.Style.STROKE; strokeWidth=resources.displayMetrics.density*.8f }
    private val pulse = Paint(Paint.ANTI_ALIAS_FLAG).apply { style=Paint.Style.STROKE; strokeWidth=resources.displayMetrics.density*1.4f }
    private val route = Array(18) { Path() }
    private val t0 = SystemClock.uptimeMillis()
    init { importantForAccessibility=IMPORTANT_FOR_ACCESSIBILITY_NO;setLayerType(LAYER_TYPE_HARDWARE,null) }

    override fun onSizeChanged(w:Int,h:Int,oldw:Int,oldh:Int){
        super.onSizeChanged(w,h,oldw,oldh)
        for (i in route.indices) {
            val upper=i<9
            val index=i%9
            val x0=w*((index+.32f)/9.5f)
            val y0=h*(if(upper) .08f else .93f)
            val y1=h*(if(upper) .24f else .76f)
            val turn=if(index%2==0) 1 else -1
            route[i].reset()
            route[i].moveTo(x0,y0)
            route[i].lineTo(x0,y0+if(upper)h*.055f else -h*.055f)
            route[i].lineTo(x0+turn*w*.05f,y0+if(upper)h*.10f else -h*.10f)
            route[i].lineTo(x0+turn*w*.05f,y1)
        }
    }
    override fun onDraw(canvas:Canvas) {
        super.onDraw(canvas)
        val active=KyvoriqTheme.motionEnabled(context)&&isShown&&hasWindowFocus()
        val seconds=if(active)(SystemClock.uptimeMillis()-t0)/1000f else 0f
        val w=width.toFloat();val h=height.toFloat()
        canvas.drawColor(0xFF090713.toInt())
        for(i in route.indices){
            trace.color=if(i%4==0)0x553BCAE8 else 0x354E5A86
            canvas.drawPath(route[i],trace)
            val u=(seconds*.25f+i*.067f)%1f
            val upper=i<9
            val index=i%9
            val x=w*((index+.32f)/9.5f)
            val y=h*(if(upper) .08f+u*.15f else .93f-u*.15f)
            pulse.color=if(i%3==0)0xBB19E6FF.toInt() else 0x998F45FA.toInt()
            if(active)canvas.drawLine(x,y,x+w*.017f,y,pulse)
        }
        // Sparse cyan digit column fragments, rather than a full-screen particle/video texture.
        bg.textSize=resources.displayMetrics.density*6f
        bg.typeface=android.graphics.Typeface.MONOSPACE
        for(i in 0..23) {
            val col=i%8
            val row=i/8
            val x=w*(.08f+col*.115f)
            val y=h*(.38f+row*.12f)
            val flicker=sin((seconds*2.3f+i*2.8f).toDouble()).toFloat()
            bg.color=Color.argb((13f+12f*(flicker+1f)).toInt(),45,220,244)
            canvas.drawText(if(i%3==0)"01" else if(i%3==1)"7F" else "10",x,y,bg)
        }
        // A single HUD scan sweeps across the dark backing.
        if(active){
            val y=(seconds%.95f)/.95f*h
            pulse.color=0x2735E4FF
            canvas.drawLine(0f,y,w,y,pulse)
            postInvalidateOnAnimation()
        }
    }
    override fun onWindowFocusChanged(hasWindowFocus:Boolean) {
        super.onWindowFocusChanged(hasWindowFocus)
        if(hasWindowFocus)postInvalidateOnAnimation()
    }
    override fun onVisibilityAggregated(isVisible:Boolean){
        super.onVisibilityAggregated(isVisible)
        if(isVisible)postInvalidateOnAnimation()
    }
}

/** Small non-interactive signal-rail motion: never drawn over chart candles or touch controls. */
class CyberpunkHeaderRail(context: Context): View(context) {
    private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
    private val started=SystemClock.uptimeMillis()
    init { importantForAccessibility=IMPORTANT_FOR_ACCESSIBILITY_NO;setLayerType(LAYER_TYPE_HARDWARE,null) }
    override fun onDraw(canvas:Canvas){
        super.onDraw(canvas)
        val t=(SystemClock.uptimeMillis()-started)/1000f
        paint.strokeWidth=(height.toFloat()*.6f).coerceAtLeast(1f)
        paint.color=0x5532A7C6
        canvas.drawLine(0f,height/2f,width.toFloat(),height/2f,paint)
        val active=KyvoriqTheme.motionEnabled(context)&&isShown&&hasWindowFocus()
        val x=if(active)width*((t%3.2f)/3.2f) else width*.5f
        paint.color=0xFF1BE9FF.toInt()
        canvas.drawLine((x-width*.09f).coerceAtLeast(0f),height/2f,x,height/2f,paint)
        if(active)postInvalidateOnAnimation()
    }
    override fun onWindowFocusChanged(hasWindowFocus:Boolean){
        super.onWindowFocusChanged(hasWindowFocus)
        if(hasWindowFocus)postInvalidateOnAnimation()
    }
    override fun onVisibilityAggregated(isVisible:Boolean){
        super.onVisibilityAggregated(isVisible)
        if(isVisible)postInvalidateOnAnimation()
    }
}
