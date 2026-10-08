package com.devtrader.app

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.view.Gravity
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream

/**
 * Optional, network-dependent TradingView Lightweight Charts 5.2.1 preview.
 * Native KYVORIQ chart remains default. No private API access, file access,
 * JS bridge or trading actions. Apache-2.0 / TradingView attribution.
 * TradingView Lightweight Charts (c) 2025 TradingView Inc.
 * https://www.tradingview.com/
 */
class TradingViewPreview(context: Context, candles: JSONArray, overlays: JSONArray) : LinearLayout(context) {
    private val web: WebView
    init {
        orientation = VERTICAL
        setBackgroundColor(Color.rgb(12, 15, 21))
        val heading=TextView(context).apply {
            text="TRADINGVIEW LIGHTWEIGHT CHARTS · PREVIEW"
            setTextColor(Color.rgb(222, 181, 94))
            textSize=12f
            setPadding(16, 16, 8, 8)
        }
        addView(heading,LayoutParams(-1,-2))
        web=WebView(context).apply {
            setBackgroundColor(Color.rgb(12,15,21))
            settings.javaScriptEnabled=true
            settings.domStorageEnabled=false
            settings.allowFileAccess=false
            settings.allowContentAccess=false
            settings.javaScriptCanOpenWindowsAutomatically=false
            settings.mixedContentMode=android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            webViewClient=object:WebViewClient(){
                override fun shouldOverrideUrlLoading(view:WebView?,request:WebResourceRequest?):Boolean=true
                override fun shouldInterceptRequest(view:WebView?,request:WebResourceRequest?):WebResourceResponse? {
                    val u=request?.url ?: return blocked()
                    val allowed="/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js"
                    return if(u.scheme=="https"&&u.host=="unpkg.com"&&u.path==allowed&&u.query==null) null else blocked()
                }
            }
        }
        addView(web,LayoutParams(-1,0,1f))
        val attribution=TextView(context).apply {
            text="TradingView Lightweight Charts™ · © 2025 TradingView, Inc. · tradingview.com ↗"
            setTextColor(Color.rgb(169,176,187))
            textSize=10f
            gravity=Gravity.CENTER
            setPadding(4,12,4,12)
            setOnClickListener{
                context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse("https://www.tradingview.com/")))
            }
        }
        addView(attribution,LayoutParams(-1,-2))
        val data=JSONArray()
        val seen=HashSet<Long>()
        for(i in 0 until candles.length()){
            val c=candles.optJSONObject(i)?:continue
            val ts=c.optLong("start",0L)
            val o=c.optDouble("open",Double.NaN)
            val h=c.optDouble("high",Double.NaN)
            val l=c.optDouble("low",Double.NaN)
            val cl=c.optDouble("close",Double.NaN)
            if(ts<=0||!o.isFinite()||!h.isFinite()||!l.isFinite()||!cl.isFinite()||
                o<=0||l<=0||h<kotlin.math.max(o,cl)||l>kotlin.math.min(o,cl)||!seen.add(ts))continue
            data.put(JSONObject().put("time",ts/1000).put("open",o).put("high",h).put("low",l).put("close",cl))
        }
        val levels=JSONArray()
        for(i in 0 until kotlin.math.min(overlays.length(),24)){
            val row=overlays.optJSONObject(i)?:continue
            val value=row.optDouble("price",Double.NaN)
            if(!value.isFinite()||value<=0)continue
            levels.put(JSONObject().put("price",value)
                .put("kind",row.optString("kind","LEVEL").take(25))
                .put("label",row.optString("label","LEVEL").take(25)))
        }
        // Script injection defense: escape angle brackets in exchange-supplied
        // strings embedded into the HTML script context.
        val barsJson=data.toString().replace("<","\\u003c").replace(">","\\u003e")
        val levelsJson=levels.toString().replace("<","\\u003c").replace(">","\\u003e")
        val html="""
<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline' https://unpkg.com;style-src 'unsafe-inline';connect-src 'none';font-src 'none';img-src data:;object-src 'none';"/>
<style>html,body,#plot{background:#0c0f15;width:100%;height:100%;margin:0;overflow:hidden}
#status{position:absolute;top:45%;left:8%;width:84%;color:#dbb65e;font:12px sans-serif;text-align:center}</style></head>
<body><div id="plot"></div><div id="status">Loading optional renderer…</div>
<script src="https://unpkg.com/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js"></script>
<script>
(function(){
  const status=document.getElementById('status'), root=document.getElementById('plot');
  const bars=$barsJson, levels=$levelsJson;
  if(!window.LightweightCharts || !LightweightCharts.CandlestickSeries || !bars.length){
    status.textContent='TradingView preview unavailable. Native KYVORIQ chart remains available.';return;
  }
  try{
    bars.sort((a,b)=>a.time-b.time);
    const chart=LightweightCharts.createChart(root,{
      width:root.clientWidth,height:root.clientHeight,
      layout:{background:{type:'solid',color:'#0c0f15'},textColor:'#b1b8c4',attributionLogo:true},
      grid:{vertLines:{color:'#1b222c'},horzLines:{color:'#252d38'}},
      rightPriceScale:{borderColor:'#38434d'},
      timeScale:{timeVisible:true,rightOffset:4,barSpacing:9,borderColor:'#38434d'},
      handleScale:{pinch:true,mouseWheel:true,axisPressedMouseMove:true}
    });
    const candles=chart.addSeries(LightweightCharts.CandlestickSeries,{
      upColor:'#2bb89a',downColor:'#d36570',borderVisible:false,
      wickUpColor:'#2bb89a',wickDownColor:'#d36570'
    });
    candles.setData(bars);
    for(const l of levels){
      const k=String(l.kind).toUpperCase();
      const color=k.includes('NPOC')?'#d36570':k.includes('DAILY')?'#47b590':
        k.includes('WEEK')||k.includes('SFP')?'#deb75c':k.includes('OB')?'#d1d6da':'#8c96a4';
      candles.createPriceLine({price:l.price,color:color,lineWidth:1,
        lineStyle:LightweightCharts.LineStyle.Dotted,axisLabelVisible:true,title:String(l.label).slice(0,20)});
    }
    chart.timeScale().setVisibleLogicalRange({from:Math.max(0,bars.length-75),to:bars.length+3});
    status.style.display='none';
    window.addEventListener('resize',()=>chart.applyOptions({width:root.clientWidth,height:root.clientHeight}));
  }catch(err){status.textContent='Chart preview failed. Native KYVORIQ chart is unaffected.';}
})();
</script></body></html>""".trimIndent()
        web.loadDataWithBaseURL("https://appassets.androidplatform.net/",html,"text/html","UTF-8",null)
    }

    override fun onDetachedFromWindow(){
        web.stopLoading()
        web.destroy()
        super.onDetachedFromWindow()
    }

    private fun blocked()=WebResourceResponse("text/plain","UTF-8",ByteArrayInputStream(ByteArray(0)))
}
