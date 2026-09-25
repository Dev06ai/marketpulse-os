const http=require('http'),fs=require('fs'),path=require('path'),{analyze,backtest}=require('./market-engine');
const PORT=Number(process.env.PORT||3000);
const SYMBOLS=(process.env.SYMBOLS||'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT').split(',').map(s=>s.trim()).filter(Boolean);
const KLINE_LIMIT=Number(process.env.KLINE_LIMIT||420);
const labels={BTCUSDT:'BTC',ETHUSDT:'ETH',SOLUSDT:'SOL',BNBUSDT:'BNB',XRPUSDT:'XRP',DOGEUSDT:'DOGE',ADAUSDT:'ADA'};
const KRAKEN_PAIRS={BTCUSDT:'XBTUSD',ETHUSDT:'ETHUSD',SOLUSDT:'SOLUSD',BNBUSDT:'BNBUSD',XRPUSDT:'XRPUSD',DOGEUSDT:'DOGEUSD',ADAUSDT:'ADAUSD'};
const CACHE=new Map(); const TTL=25000;
const OPENAI_API_KEY=process.env.OPENAI_API_KEY||"";
const OPENAI_MODEL=process.env.OPENAI_MODEL||"gpt-5.6-luna";
const AI_LIMIT_MS=8000; const AI_CALLS=new Map();

function mins(interval){return ({'15m':15,'1h':60,'4h':240,'1d':1440})[interval]||60}
async function getBinance(symbol,interval){
  const bases=['https://api.binance.com','https://api-gcp.binance.com','https://api1.binance.com','https://api2.binance.com','https://api3.binance.com','https://api4.binance.com'];
  for(const base of bases){try{const u=new URL(base+'/api/v3/klines');u.searchParams.set('symbol',symbol);u.searchParams.set('interval',interval);u.searchParams.set('limit',String(Math.min(KLINE_LIMIT,1000)));const r=await fetch(u);if(r.ok){const rows=await r.json();return rows.map(x=>({t:x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],source:'binance'}))}}catch{}}
  return null;
}
async function getKraken(symbol,interval){
  const pair=KRAKEN_PAIRS[symbol]; if(!pair)throw new Error('No Kraken mapping for '+symbol);
  const u=new URL('https://api.kraken.com/0/public/OHLC');u.searchParams.set('pair',pair);u.searchParams.set('interval',String(mins(interval)));
  const r=await fetch(u);if(!r.ok)throw new Error('Kraken returned '+r.status);const body=await r.json();if(body.error?.length)throw new Error(body.error.join(', '));
  const key=Object.keys(body.result||{}).find(k=>k!=='last');if(!key)throw new Error('Kraken returned no OHLC data');
  return (body.result[key]||[]).slice(-Math.min(KLINE_LIMIT,720)).map(x=>({t:+x[0]*1000,o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[6],source:'kraken'}));
}
async function klines(symbol,interval){
  const key=symbol+'|'+interval,hit=CACHE.get(key);if(hit&&Date.now()-hit.ts<TTL)return hit.rows;
  const rows=await getBinance(symbol,interval)||await getKraken(symbol,interval);CACHE.set(key,{ts:Date.now(),rows});return rows;
}
const DERIV_CACHE=new Map(); const DERIV_TTL=15000;
const KRAKEN_FUTURES_PAIRS={BTCUSDT:"PF_XBTUSD",ETHUSDT:"PF_ETHUSD",SOLUSDT:"PF_SOLUSD",BNBUSDT:"PF_BNBUSD",XRPUSDT:"PF_XRPUSD",DOGEUSDT:"PF_DOGEUSD",ADAUSDT:"PF_ADAUSD"};
const BYBIT_HOSTS=["https://api.bybit.com","https://api.bytick.com"];
function bybitInterval(interval){return ({'15m':'15min','1h':'1h','4h':'4h','1d':'1d'})[interval]||'1h'}

async function fetchJson(url,timeoutMs=4500){
  const controller=new AbortController();const t=setTimeout(()=>controller.abort(),timeoutMs);
  try{const r=await fetch(url,{signal:controller.signal,headers:{"User-Agent":"MarketPulse/2.0","Accept":"application/json"}});const raw=await r.text();let j={};try{j=JSON.parse(raw)}catch{}if(!r.ok)throw new Error("HTTP "+r.status);return j}
  finally{clearTimeout(t)}
}

async function bybitGet(path,params,timeoutMs=4500){
  let lastErr=new Error("Bybit request failed");
  for(const host of BYBIT_HOSTS){
    const u=new URL(host+path);for(const [k,v] of Object.entries(params||{}))u.searchParams.set(k,String(v));
    try{const j=await fetchJson(u,timeoutMs);if(j.retCode!==0)throw new Error(j.retMsg||("Bybit error "+j.retCode));return {result:j.result,host}}catch(e){lastErr=e}
  }
  throw lastErr;
}

async function krakenRecentCvd(symbol){
  const pair=KRAKEN_FUTURES_PAIRS[symbol];if(!pair)throw new Error("No Kraken futures trade mapping");
  const j=await fetchJson("https://futures.kraken.com/derivatives/api/v3/history?symbol="+encodeURIComponent(pair));
  const rows=(j.history||[]).slice().reverse();
  if(!rows.length)throw new Error("Kraken Futures history returned no trades");
  let cvd=0,total=0;
  for(const t of rows){
    const q=Number(t.notional_amount||Number(t.price||0)*Number(t.size||0));
    if(!Number.isFinite(q)||!q)continue;
    cvd+=(String(t.side).toLowerCase()==="buy"?q:-q);total+=q;
  }
  const first=Number(rows[0]?.price),last=Number(rows[rows.length-1]?.price);
  return {cvdDelta:cvd,cvdRatio:total?cvd/total:null,tradeCount:rows.length,tradePriceChangePct:Number.isFinite(first)&&first?((last-first)/first)*100:null};
}

async function krakenAnalytics(symbol,interval){
  const pair=KRAKEN_FUTURES_PAIRS[symbol];if(!pair)throw new Error("No Kraken futures mapping for "+symbol);
  const secs=mins(interval)*60;
  const windows={"15m":6*3600,"1h":24*3600,"4h":3*86400,"1d":7*86400};
  const since=Math.floor((Date.now()-(windows[interval]||24*3600))/1000);
  const base="https://futures.kraken.com/api/charts/v1/analytics/"+pair;
  const [cvd,oi,funding,ls,liq]=await Promise.all([
    fetchJson(base+"/cvd?since="+since+"&interval="+secs),
    fetchJson(base+"/open-interest?since="+since+"&interval="+secs),
    fetchJson(base+"/funding?since="+since+"&interval="+secs).catch(()=>null),
    fetchJson(base+"/long-short-info?since="+since+"&interval="+secs).catch(()=>null),
    fetchJson(base+"/liquidation-volume?since="+since+"&interval="+secs).catch(()=>null)
  ]);
  const cvdPayload=cvd?.result||cvd,oiPayload=oi?.result||oi,fundingPayload=funding?.result||funding,lsPayload=ls?.result||ls,liqPayload=liq?.result||liq;
  const numericArray=(obj,names)=>{for(const n of names){if(Array.isArray(obj?.data?.[n]))return obj.data[n].map(Number).filter(Number.isFinite)}return[]};
  const cvdVals=numericArray(cvdPayload,["cvd"]),buyVals=numericArray(cvdPayload,["buyVolume","buy_volume"]),sellVals=numericArray(cvdPayload,["sellVolume","sell_volume"]);
  const oiVals=numericArray(oiPayload,["openInterest","open_interest"]);
  const fundingVals=numericArray(fundingPayload,["rate","fundingRate","funding_rate"]);
  const longPct=numericArray(lsPayload,["longPercent","long_percent"]),shortPct=numericArray(lsPayload,["shortPercent","short_percent"]),ratioVals=numericArray(lsPayload,["ratio"]);
  const liqLong=numericArray(liqPayload,["longLiquidationVolume","long_liquidation_volume","buyVolume","buy_volume"]);
  const liqShort=numericArray(liqPayload,["shortLiquidationVolume","short_liquidation_volume","sellVolume","sell_volume"]);
  if(!cvdVals.length&&!oiVals.length&&!buyVals.length&&!sellVals.length&&!liqLong.length&&!liqShort.length)throw new Error("Kraken futures analytics returned no data");
  const cvdFirst=Number(cvdVals[0]),cvdLast=Number(cvdVals[cvdVals.length-1]),cvdDelta=Number.isFinite(cvdLast)&&Number.isFinite(cvdFirst)?cvdLast-cvdFirst:null;
  const oiFirst=Number(oiVals[0]),oiLast=Number(oiVals[oiVals.length-1]),oiChangePct=Number.isFinite(oiFirst)&&oiFirst?((oiLast-oiFirst)/oiFirst)*100:null;
  const fundingRate=fundingVals.length?Number(fundingVals[fundingVals.length-1]):null;
  const longLast=longPct.length?Number(longPct[longPct.length-1]):null,shortLast=shortPct.length?Number(shortPct[shortPct.length-1]):null,ratioLast=ratioVals.length?Number(ratioVals[ratioVals.length-1]):null;
  const longLiq=liqLong.reduce((a,b)=>a+b,0),shortLiq=liqShort.reduce((a,b)=>a+b,0),liqTotal=longLiq+shortLiq;
  return {available:true,provider:"Kraken Futures analytics",symbol:pair,oi:Number.isFinite(oiLast)?oiLast:null,oiChangePct,cvdDelta,cvdState:"MIXED",positioning:"MIXED",tradeCount:0,fundingRate:Number.isFinite(fundingRate)?fundingRate:null,markPrice:null,cvdRatio:null,longPercent:longLast,shortPercent:shortLast,longShortRatio:ratioLast,longLiquidations:longLiq,shortLiquidations:shortLiq,liquidationTotal:liqTotal,liquidationBias:liqTotal?(longLiq>shortLiq?"LONG LIQS DOMINANT":"SHORT LIQS DOMINANT"):"UNKNOWN",analyticsBuckets:Math.max(cvdVals.length,oiVals.length,liqLong.length,liqShort.length),updatedAt:Date.now(),errors:[]};
}

async function bybitDerivatives(symbol,interval){
  const [oiRes,tradeRes,tickerRes]=await Promise.allSettled([
    bybitGet('/v5/market/open-interest',{category:'linear',symbol,intervalTime:bybitInterval(interval),limit:50}),
    bybitGet('/v5/market/recent-trade',{category:'linear',symbol,limit:1000}),
    bybitGet('/v5/market/tickers',{category:'linear',symbol})
  ]);
  const errors=[];
  const oiPayload=oiRes.status==='fulfilled'?oiRes.value:null,tradePayload=tradeRes.status==='fulfilled'?tradeRes.value:null,tickerPayload=tickerRes.status==='fulfilled'?tickerRes.value:null;
  if(oiRes.status==='rejected')errors.push("OI: "+oiRes.reason.message);if(tradeRes.status==='rejected')errors.push("Trades: "+tradeRes.reason.message);if(tickerRes.status==='rejected')errors.push("Ticker: "+tickerRes.reason.message);
  const oiList=(oiPayload?.result?.list||[]).slice().reverse().map(x=>+x.openInterest),ticker=tickerPayload?.result?.list?.[0]||null;
  const currentOi=oiList.length?oiList[oiList.length-1]:(ticker&&Number.isFinite(+ticker.openInterest)?+ticker.openInterest:NaN),oiFirst=oiList[0],oiChangePct=Number.isFinite(oiFirst)&&oiFirst?((currentOi-oiFirst)/oiFirst)*100:null;
  const trades=(tradePayload?.result?.list||[]).slice().sort((a,b)=>+a.time-+b.time).map(x=>({ts:+x.time,price:+x.price,size:+x.size,side:x.side}));
  let cvd=0,total=0;for(const t of trades){const q=t.price*t.size;cvd+=(t.side==="Buy"?q:-q);total+=q}
  const first=trades[0]?.price,lastT=trades[trades.length-1]?.price,priceChangePct=Number.isFinite(first)&&first?((lastT-first)/first)*100:null,cvdRatio=total?cvd/total:null;
  const data={available:Boolean(ticker||oiPayload||tradePayload),provider:tickerPayload?.host||oiPayload?.host||tradePayload?.host||"Bybit linear futures",oi:Number.isFinite(currentOi)?currentOi:null,oiChangePct,cvdDelta:cvd,cvdRatio,cvdState:"MIXED",positioning:"MIXED",tradeCount:trades.length,fundingRate:ticker&&Number.isFinite(+ticker.fundingRate)?+ticker.fundingRate:null,markPrice:ticker&&Number.isFinite(+ticker.markPrice)?+ticker.markPrice:null,tradePriceChangePct:priceChangePct,errors,updatedAt:Date.now()};
  if(priceChangePct!=null&&cvdRatio!=null){if(priceChangePct>0.15&&cvdRatio<-0.01)data.cvdState="BEARISH DIVERGENCE";else if(priceChangePct<-0.15&&cvdRatio>0.01)data.cvdState="BULLISH DIVERGENCE";else if(priceChangePct>0.15&&cvdRatio>0.01)data.cvdState="BUYERS CONFIRM";else if(priceChangePct<-0.15&&cvdRatio<-0.01)data.cvdState="SELLERS CONFIRM"}else if(trades.length===0)data.cvdState="UNAVAILABLE";
  if(priceChangePct!=null&&oiChangePct!=null){if(priceChangePct>0.15&&oiChangePct>1)data.positioning="PRICE + OI: LONG PARTICIPATION";else if(priceChangePct>0.15&&oiChangePct<-1)data.positioning="PRICE UP + OI DOWN: SHORT COVERING";else if(priceChangePct<-0.15&&oiChangePct>1)data.positioning="PRICE DOWN + OI UP: SHORT PARTICIPATION";else if(priceChangePct<-0.15&&oiChangePct<-1)data.positioning="PRICE DOWN + OI DOWN: LONG LIQUIDATION"}else if(!Number.isFinite(oiChangePct))data.positioning=Number.isFinite(currentOi)?"OI CHANGE NOT AVAILABLE":"OI UNAVAILABLE";
  return data;
}

async function derivatives(symbol,interval){
  const key=symbol+"|"+interval,hit=DERIV_CACHE.get(key);
  if(hit&&Date.now()-hit.ts<DERIV_TTL)return hit.data;
  let data=null;
  try{data=await krakenAnalytics(symbol,interval)}
  catch(e){
    try{
      const ticker=await fetchJson("https://futures.kraken.com/derivatives/api/v3/tickers");
      const t=(ticker.tickers||[]).find(x=>String(x.symbol||"").toUpperCase()===KRAKEN_FUTURES_PAIRS[symbol]);
      const cvd=await krakenRecentCvd(symbol).catch(()=>null);
      if(!t&&!cvd)throw new Error("Kraken Futures public analytics unavailable");
      data={available:true,provider:"Kraken Futures public API",symbol:KRAKEN_FUTURES_PAIRS[symbol],oi:t&&Number.isFinite(+t.openInterest)?+t.openInterest:null,oiChangePct:null,cvdDelta:cvd?.cvdDelta??null,cvdRatio:cvd?.cvdRatio??null,cvdState:"MIXED",positioning:"OI CHANGE NOT AVAILABLE",tradeCount:cvd?.tradeCount??0,fundingRate:t&&Number.isFinite(+t.fundingRate)?+t.fundingRate:null,markPrice:t&&Number.isFinite(+t.markPrice)?+t.markPrice:null,tradePriceChangePct:cvd?.tradePriceChangePct??null,errors:[e.message],updatedAt:Date.now()};
    }catch(e2){
      try{data=await bybitDerivatives(symbol,interval)}
      catch(e3){data={available:false,provider:"No derivatives provider",oi:null,oiChangePct:null,cvdDelta:null,cvdRatio:null,cvdState:"UNAVAILABLE",positioning:"UNAVAILABLE",tradeCount:0,fundingRate:null,markPrice:null,errors:[e.message,e2.message,e3.message],updatedAt:Date.now()}}
    }
  }
  DERIV_CACHE.set(key,{ts:Date.now(),data});return data;
}

function send(res,code,p){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(p))}
async function callOpenAI(systemPrompt,userPrompt){
  if(!OPENAI_API_KEY) throw new Error("AI_COPILOT_NOT_CONFIGURED");
  const now=Date.now();
  const body={
    model:OPENAI_MODEL,
    instructions:systemPrompt,
    input:userPrompt,
    max_output_tokens:900
  };
  const controller=new AbortController(); const t=setTimeout(()=>controller.abort(),AI_LIMIT_MS);
  try{
    const r=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+OPENAI_API_KEY},
      body:JSON.stringify(body),
      signal:controller.signal
    });
    const raw=await r.text();
    let j={}; try{j=JSON.parse(raw)}catch{}
    if(!r.ok) throw new Error(j?.error?.message||("OpenAI returned "+r.status));
    const text=j.output_text || (j.output||[]).flatMap(x=>x.content||[]).find(x=>x.type==="output_text")?.text || "";
    if(!text) throw new Error("AI returned no text");
    return {text,model:OPENAI_MODEL,ts:Date.now()};
  } finally {clearTimeout(t)}
}

function aiAllowed(req){
  const ip=req.headers["x-forwarded-for"]?.split(",")[0]?.trim()||req.socket.remoteAddress||"unknown";
  const last=AI_CALLS.get(ip)||0;
  if(Date.now()-last<4000)return false;
  AI_CALLS.set(ip,Date.now()); return true;
}

function aiSystem(){
  return [
    "You are MarketPulse Copilot, a calm crypto market analyst inside a decision-support product.",
    "Use the supplied market data and trade details. Do not invent live prices, catalysts, news, or indicators.",
    "Explain reasoning in plain, modern language. Be concise but useful.",
    "Never promise profit, certainty, or a winning probability. Never tell the user to risk more money.",
    "For a market read: describe regime, multi-timeframe alignment, momentum, volatility, structure, and what would invalidate the setup.",
    "For a personal trade review: separate execution quality from outcome. Review entry, stop, target, R:R, sizing/risk, and whether the plan matched the market regime.",
    "When evidence conflicts, say so. A valid answer may be WAIT / NO TRADE.",
    "This is educational decision support, not individualized financial advice."
  ].join(" ");
}

function liteCopilot(mode,market,trade,question){
  const m=market||{}, call=String(m.call||"NO TRADE"), regime=String(m.regime||"UNKNOWN"), mtf=String(m.multitimeframe||"");
  const score=Number(m.confluence||0), rsi=String(m.rsiAdx||"—"), structure=String(m.structure||"—");
  if(mode==="trade"){
    const entry=Number(trade?.entry),stop=Number(trade?.stop),target=Number(trade?.target),side=String(trade?.side||"");
    const risk=Number.isFinite(entry)&&Number.isFinite(stop)?Math.abs(entry-stop):NaN;
    const reward=Number.isFinite(entry)&&Number.isFinite(target)?Math.abs(target-entry):NaN;
    const rr=Number.isFinite(risk)&&risk?reward/risk:NaN;
    const lines=[
      "MarketPulse Lite review",
      "",
      "Market context: "+regime+" · "+call+" · confluence "+score+"/100.",
      "Momentum: RSI/ADX "+rsi+" · structure "+structure+".",
      mtf?"Timeframe context: "+mtf+".":""
    ].filter(Boolean);
    if(side)lines.push("Your plan: "+side+(Number.isFinite(rr)?" · planned R:R "+rr.toFixed(2)+"R.":""));
    if(call==="NO TRADE")lines.push("The dashboard currently sees insufficient alignment. That matters more than whether the trade eventually wins or loses.");
    else if(Number.isFinite(rr)&&rr<1.5)lines.push("Your planned R:R is below 1.5R. That makes the setup less forgiving before fees/slippage.");
    else if(Number.isFinite(rr))lines.push("Your planned R:R is "+rr.toFixed(2)+"R. Check that the invalidation is structural rather than arbitrary.");
    lines.push("Question: "+(question||"Review this trade."));
    lines.push("Note: Lite mode uses deterministic MarketPulse rules. Add API credits to unlock the full AI Copilot.");
    return lines.join("\n");
  }
  const lines=[
    "MarketPulse Lite",
    "",
    "BTC/asset context: "+regime+" · "+call+" · confluence "+score+"/100.",
    "RSI/ADX: "+rsi+" · structure: "+structure+".",
    mtf?"Multi-timeframe: "+mtf+".":"",
    call==="NO TRADE"?"Read: wait for alignment instead of forcing a trade.":"Read: treat this as a setup to validate, not a guarantee.",
    "Question: "+(question||"What is the market doing?"),
    "Full AI Copilot will be available when API credits are added."
  ].filter(Boolean);
  return lines.join("\n");
}

function staticFile(req,res){const reqPath=req.url==='/'?'/index.html':req.url.split('?')[0],file=path.join(__dirname,'public',reqPath),root=path.join(__dirname,'public');if(!file.startsWith(root))return send(res,403,{error:'Forbidden'});fs.readFile(file,(e,d)=>{if(e)return send(res,404,{error:'Not found'});const ext=path.extname(file);res.writeHead(200,{'Content-Type':ext==='.html'?'text/html; charset=utf-8':ext==='.json'?'application/json; charset=utf-8':'text/plain; charset=utf-8'});res.end(d)})}

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&u.pathname==='/health')return send(res,200,{ok:true,service:'marketpulse-os',time:Date.now()});
    if(req.method==='GET'&&u.pathname==='/api/config')return send(res,200,{symbols:SYMBOLS,labels,intervals:['15m','1h','4h','1d']});if(req.method==='POST'&&u.pathname==='/api/ai'){
      if(!aiAllowed(req)) return send(res,429,{error:"Slow down for a few seconds."});
      let raw=""; for await(const chunk of req) raw+=chunk; let body={}; try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      const mode=body.mode==="trade"?"trade":"market";
      const q=String(body.question||"").slice(0,1800);
      const market=body.market||{}; const trade=body.trade||{};
      const userPrompt=mode==="trade"
        ? ("Review this trade plan/trade.\nMARKET CONTEXT:\n"+JSON.stringify(market)+"\nTRADE:\n"+JSON.stringify(trade)+"\nUSER QUESTION:\n"+q)
        : ("Explain the current market context.\nMARKET:\n"+JSON.stringify(market)+"\nUSER QUESTION:\n"+q);
      try{return send(res,200,await callOpenAI(aiSystem(),userPrompt))}
      catch(e){
        const msg=String(e.message||"AI request failed");
        if(e.message==="AI_COPILOT_NOT_CONFIGURED"||/credit|billing|quota|insufficient/i.test(msg)){
          return send(res,200,{text:liteCopilot(mode,market,trade,q),model:"MarketPulse Lite",lite:true,ts:Date.now()});
        }
        return send(res,502,{error:msg});
      }
    }
    
    if(req.method==='GET'&&u.pathname==='/api/market'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{error:'Unsupported symbol'});
      const lower=interval==='15m'?null:await klines(symbol,'15m').catch(()=>null);
      const higher=interval==='4h'?null:await klines(symbol,'4h').catch(()=>null);
      const candles=await klines(symbol,interval);
      const lowerA=lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null;
      const higherA=higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null;
      const deriv=await Promise.race([
        derivatives(symbol,interval),
        new Promise(resolve=>setTimeout(()=>resolve(null),2500))
      ]).catch(()=>null);
      const analysis=analyze(candles,{interval,higher:higherA,lower:lowerA,deriv});
      return send(res,200,{symbol,interval,candles,analysis,derivatives:deriv,backtest:backtest(candles),setupStats:require("./market-engine").backtestBySetup(candles)});
    }
    if(req.method==='GET'&&u.pathname==='/api/scanner'){
      const interval=u.searchParams.get('interval')||'1h';
      const rows=await Promise.all(SYMBOLS.map(async symbol=>{
        try{
          const candles=await klines(symbol,interval);
          const higher=interval==='4h'?null:await klines(symbol,'4h').catch(()=>null);
          const lower=interval==='15m'?null:await klines(symbol,'15m').catch(()=>null);
          const deriv=await Promise.race([
            derivatives(symbol,interval),
            new Promise(resolve=>setTimeout(()=>resolve(null),2200))
          ]).catch(()=>null);
          const a=analyze(candles,{interval,higher:higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null,lower:lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null,deriv});
          return {symbol,label:labels[symbol]||symbol,derivatives:deriv,...a};
        }catch(e){return {symbol,label:labels[symbol]||symbol,error:e.message,type:"DATA ERROR",side:"WAIT",score:0,regime:"UNKNOWN"}}
      }));
      return send(res,200,{interval,rows,updatedAt:Date.now()});
    }
    return staticFile(req,res);
  }catch(e){return send(res,500,{error:e.message||'Server error'})}
});
server.listen(PORT,()=>console.log('MarketPulse OS listening on :'+PORT));