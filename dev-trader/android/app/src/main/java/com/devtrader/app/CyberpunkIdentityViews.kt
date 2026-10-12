package com.devtrader.app

import android.content.Context
import android.graphics.*
import android.graphics.drawable.Drawable
import android.os.SystemClock
import android.view.View
import androidx.core.content.ContextCompat
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/** Cyberpunk identity motion is UI-only: no timers, GIF decoding, network calls or trade state. */
private object Ion {
    const val CYAN = 0xFF18E8FF.toInt()
    const val GOLD = 0xFFFFCE47.toInt()
    const val VIOLET = 0xFF9342FF.toInt()
    const val MAGENTA = 0xFFFF38CB.toInt()
    const val BLACK = 0xFF070B12.toInt()
    fun alpha(a: Int, c: Int): Int = (a.coerceIn(0,255) shl 24) or (c and 0xFFFFFF)
    fun wave(t: Float): Float = (sin(t.toDouble()).toFloat() + 1f) * .5f
}

class CyberpunkMarkView(context: Context) : View(context) {
    private val emblem: Drawable = requireNotNull(ContextCompat.getDrawable(context, R.drawable.kyvoriq_mark)).mutate()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeJoin = Paint.Join.ROUND; strokeCap = Paint.Cap.ROUND }
    private val flame = Path()
    private val sparks = Path()
    private val started = SystemClock.uptimeMillis()
    private val density = resources.displayMetrics.density
    private var boundsReady = false
    private var glowShader: Shader? = null

    init {
        contentDescription = "KYVORIQ animated gold emblem with amber energy flames"
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
        setLayerType(LAYER_TYPE_HARDWARE, null)
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w,h,oldw,oldh)
        if (w < 1 || h < 1) { boundsReady = false; return }
        emblem.setBounds((w*.12f).toInt(), (h*.26f).toInt(), (w*.88f).toInt(), (h*.94f).toInt())
        glowShader = RadialGradient(w*.5f,h*.54f,(minOf(w,h)*.48f).coerceAtLeast(1f),
            intArrayOf(0x77D89013,0x334F2B08,Color.TRANSPARENT), null,Shader.TileMode.CLAMP)
        boundsReady = true
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (!boundsReady) return
        val active = KyvoriqTheme.motionEnabled(context) && isShown && hasWindowFocus()
        val t = if (active) (SystemClock.uptimeMillis() - started)/1000f else .6f
        val pulse = Ion.wave(t * 3.8f)
        val w = width.toFloat()
        val h = height.toFloat()
        val compact = minOf(w,h) < density*55f
        val sideCount = if (compact) 8 else 14

        paint.style = Paint.Style.FILL
        paint.shader = glowShader
        paint.alpha = if (compact) 175 else 215
        canvas.drawCircle(w*.5f,h*.55f,minOf(w,h)*.48f,paint)
        paint.shader = null
        paint.alpha = 255

        // Flame tongues have an organic double-bezier contour, with stable per-tongue phase.
        // Three translucent layers give the reference's violet fire without bitmap blur passes.
        for (layer in 0..2) {
            for (i in 0 until sideCount) {
                val u = i.toFloat() / (sideCount - 1)
                val wobble = sin((t*3f + i*1.91f + layer*.65f).toDouble()).toFloat()
                val x = w*(.13f + u*.74f)
                val baseY = h*(.74f - .15f*abs(u-.5f))
                val reach = h*(.25f + .17f*Ion.wave(i*2.37f + t*1.28f) + (1f-abs(u-.5f))* .10f)
                val tipX = x + h*(.05f*wobble + .045f*(u-.5f))
                val tipY = baseY - reach - layer*h*.025f
                val radius = w*(.08f - layer*.012f)
                flame.reset()
                flame.moveTo(x-radius,baseY)
                flame.cubicTo(x-radius*1.25f,baseY-reach*.35f,tipX-radius*.48f,tipY+reach*.20f,tipX,tipY)
                flame.cubicTo(tipX+radius*.44f,tipY+reach*.19f,x+radius*1.20f,baseY-reach*.25f,x+radius,baseY)
                flame.close()
                paint.color = when(layer) {
                    0 -> Ion.alpha(if(compact) 75 else 90,Ion.GOLD)
                    1 -> Ion.alpha(if(compact) 112 else 132,Ion.GOLD)
                    else -> Ion.alpha(if(compact) 78 else 105,Ion.GOLD)
                }
                canvas.drawPath(flame,paint)
            }
        }

        // Glowing embers float upward in deterministic loops; no particle objects are allocated.
        val motes = if(compact) 3 else 13
        for (i in 0 until motes) {
            val x = w*(.18f + (.618034f*i % 1f)*.64f) + sin((t*2f+i).toDouble()).toFloat()*w*.035f
            val travel = ((t*.15f+i*.197f)%1f)
            val y = h*(.67f-travel*.65f)
            paint.color = Ion.alpha(((1f-travel)*135f).toInt(),if(i%4==0) Ion.CYAN else Ion.GOLD)
            canvas.drawCircle(x,y,if(compact) density*.38f else density*.8f,paint)
        }

        val scale = 1f + .018f*pulse
        val save = canvas.save()
        canvas.scale(scale,scale,w/2f,h*.62f)
        // Warm halo traces behind vector, while the core mark remains crisp.
        for (pass in 0..1) {
            canvas.save()
            canvas.translate(if(pass==0) -density*.7f else density*.7f,0f)
            emblem.colorFilter = PorterDuffColorFilter(
                if(pass==0) Ion.alpha(65,Ion.GOLD) else Ion.alpha(65,Ion.GOLD), PorterDuff.Mode.SRC_IN)
            emblem.alpha = 80
            emblem.draw(canvas)
            canvas.restore()
        }
        emblem.clearColorFilter()
        emblem.alpha = 255
        emblem.draw(canvas)

        // RGB split and displaced horizontal slices, concentrated in rare short bursts like the GIF.
        val glitch = t%4.35f
        if (active && glitch>.14f && glitch<.40f) {
            for(i in 0..2){
                val bandY = h*(.35f+i*.155f+Ion.wave(t*41f+i)*.025f)
                val saveBand=canvas.save()
                canvas.clipRect(0f,bandY,w,bandY+h*.085f)
                canvas.translate((if(i%2==0) 1 else -1)*w*.055f,0f)
                emblem.colorFilter=PorterDuffColorFilter(
                    if(i%2==0) Ion.CYAN else Ion.GOLD, PorterDuff.Mode.SRC_IN)
                emblem.alpha=if(i==1) 215 else 155
                emblem.draw(canvas)
                canvas.restoreToCount(saveBand)
            }
            emblem.alpha=255
            emblem.clearColorFilter()
        }
        canvas.restoreToCount(save)

        if (!compact) {
            // Forked lightning: brief, bounded pulses around the emblem, not photosensitive strobes.
            for (i in 0..2) {
                val u = t*1.9f+i*2.1f
                val xx = w*(if(i==0) .19f else if(i==1) .81f else .60f)
                val yy = h*(.36f+.10f*i)
                sparks.reset()
                sparks.moveTo(xx,yy)
                sparks.lineTo(xx+w*.036f,yy-h*.06f)
                sparks.lineTo(xx-w*.002f,yy-h*.095f)
                sparks.lineTo(xx+w*.055f,yy-h*.15f)
                paint.style=Paint.Style.STROKE
                paint.strokeWidth=density*.85f
                paint.color=Ion.alpha((55f+Ion.wave(u)*110f).toInt(),if(i==1) Ion.CYAN else Ion.GOLD)
                canvas.drawPath(sparks,paint)
            }
        }
        paint.style=Paint.Style.FILL
        if(active) postInvalidateOnAnimation()
    }

    override fun onWindowFocusChanged(hasWindowFocus:Boolean) {
        super.onWindowFocusChanged(hasWindowFocus)
        if(hasWindowFocus) postInvalidateOnAnimation()
    }
    override fun onVisibilityAggregated(isVisible:Boolean) {
        super.onVisibilityAggregated(isVisible)
        if(isVisible) postInvalidateOnAnimation()
    }
}

/**
 * Text has a hand-sharpened slash silhouette, full-cyan to full-gold phase transitions,
 * electric tracing, analog glitch bands and RGB channel separation.
 * Unlike the reference this says KYVORIQ (not another brand's wordmark).
 */
class CyberpunkWordmarkView(context: Context) : View(context) {
    private val main = Path()
    private val blade = Path()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeJoin=Paint.Join.MITER; strokeCap=Paint.Cap.SQUARE }
    private val font = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface=Typeface.create("sans-serif-condensed-black",Typeface.BOLD_ITALIC)
        textSkewX=-.17f
        textAlign=Paint.Align.LEFT
    }
    private val started=SystemClock.uptimeMillis()
    private val density=resources.displayMetrics.density
    private var cyan: Shader?=null
    private var gold: Shader?=null
    private val shift=Matrix()

    init {
        contentDescription="KYVORIQ electric cyberpunk wordmark"
        importantForAccessibility=IMPORTANT_FOR_ACCESSIBILITY_YES
        setLayerType(LAYER_TYPE_HARDWARE,null)
    }
    override fun onSizeChanged(w:Int,h:Int,oldw:Int,oldh:Int){
        super.onSizeChanged(w,h,oldw,oldh)
        if(w<1||h<1) return
        font.textSize=minOf(h*.72f,w/4.65f)
        val measured=font.measureText("KYVORIQ")
        val x=(w-measured)*.5f
        val y=(h-font.fontMetrics.ascent-font.fontMetrics.descent)*.48f
        main.reset()
        font.getTextPath("KYVORIQ",0,7,x,y,main)
        blade.reset()
        // Sharp overhangs and torn slash tips emulate the reference's custom speed-lettering.
        for (k in 0..5) {
            val px=x+measured*(.12f+.145f*k)
            val yy=y-(k%2)*h*.08f
            blade.moveTo(px-h*.06f,yy-h*.04f)
            blade.lineTo(px+h*.05f,yy-h*.57f)
            blade.lineTo(px+h*.028f,yy-h*.18f)
            blade.lineTo(px+h*.11f,yy-h*.27f)
            blade.close()
        }
        val stops=floatArrayOf(0f,.45f,.75f,1f)
        cyan=LinearGradient(0f,0f,w.toFloat(),0f,
            intArrayOf(0xFF086E9D.toInt(),0xFF20ECFF.toInt(),0xFF92FFFF.toInt(),0xFF08B5E2.toInt()),stops,Shader.TileMode.CLAMP)
        gold=LinearGradient(0f,0f,w.toFloat(),0f,
            intArrayOf(0xFFB7650C.toInt(),0xFFFFDC4F.toInt(),0xFFFFFF9B.toInt(),0xFFF0AB16.toInt()),stops,Shader.TileMode.CLAMP)
    }
    override fun onDraw(canvas:Canvas){
        super.onDraw(canvas)
        val running=KyvoriqTheme.motionEnabled(context)&&isShown&&hasWindowFocus()
        val t=if(running)(SystemClock.uptimeMillis()-started)/1000f else .4f
        val phase=t%6.8f
        // Held states are deliberately long: reference transitions cyan -> gold in glitch bursts.
        val goldState=phase>3.45f
        val ink=if(goldState)Ion.GOLD else Ion.CYAN
        val other=if(goldState)Ion.CYAN else Ion.GOLD
        // Black undercut / deep outline to reproduce the cut-out industrial silhouette.
        paint.shader=null;paint.style=Paint.Style.STROKE;paint.strokeWidth=density*2.8f
        paint.color=Ion.BLACK;canvas.drawPath(main,paint);canvas.drawPath(blade,paint)
        paint.strokeWidth=density*1.2f
        paint.color=Ion.alpha(175,other)
        canvas.drawPath(main,paint)
        paint.strokeWidth=density*3.0f
        paint.color=Ion.alpha(40,ink)
        canvas.drawPath(main,paint)

        // Metallic neon lighting passes across both the glyph and extra razor blades.
        val shader=if(goldState)gold else cyan
        shift.setTranslate(((t%3.1f)/3.1f-.5f)*width*.44f,0f)
        shader?.setLocalMatrix(shift)
        paint.style=Paint.Style.FILL
        paint.shader=shader;paint.alpha=255
        canvas.drawPath(main,paint);canvas.drawPath(blade,paint)
        paint.shader=null;paint.alpha=255

        val noise=phase%3.45f
        if(running && noise in 2.85f..3.22f) {
            // Hard horizontal image tear, RGB split and intermittent fine scanlines.
            for(i in 0..4){
                val y=height*(.17f+i*.16f)
                val save=canvas.save()
                canvas.clipRect(0f,y,width.toFloat(),y+height*(if(i%2==0).07f else .045f))
                canvas.translate((if(i%2==0)1 else -1)*width*(.023f+.009f*i),0f)
                paint.color=Ion.alpha(if(i==2)220 else 140,if(i%2==0)Ion.CYAN else Ion.GOLD)
                canvas.drawPath(main,paint)
                canvas.restoreToCount(save)
            }
        }
        paint.style=Paint.Style.STROKE;paint.strokeWidth=density*.6f
        // A bright slash crossing the logotype and uneven high-tech scan traces.
        val cursor=(t%2.65f)/2.65f
        paint.color=Ion.alpha(130,ink)
        canvas.drawLine(width*.065f,height*.90f,width*(.08f+.83f*cursor),height*.90f,paint)
        paint.color=Ion.alpha(85,other)
        canvas.drawLine(width*.24f,height*.15f,width*.29f,height*.05f,paint)
        canvas.drawLine(width*.70f,height*.84f,width*.74f,height*.67f,paint)
        paint.style=Paint.Style.FILL
        if(running)postInvalidateOnAnimation()
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
