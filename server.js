const http=require('http'),fs=require('fs'),path=require('path'),{analyze,backtest,backtestBySetup,walkForwardBacktest}=require('./market-engine');
const storage=require('./storage');
const learning=require('./learning');
const phase4=require('./phase4');
const execution=require('./execution');
const WebSocket=require('ws');
const PORT=Number(process.env.PORT||3000);
const SYMBOLS=(process.env.SYMBOLS||'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT').split(',').map(s=>s.trim()).filter(Boolean);
const KLINE_LIMIT=Number(process.env.KLINE_LIMIT||420);
const labels={BTCUSDT:'BTC',ETHUSDT:'ETH',SOLUSDT:'SOL',BNBUSDT:'BNB',XRPUSDT:'XRP',DOGEUSDT:'DOGE',ADAUSDT:'ADA'};
const KRAKEN_PAIRS={BTCUSDT:'XBTUSD',ETHUSDT:'ETHUSD',SOLUSDT:'SOLUSD',BNBUSDT:'BNBUSD',XRPUSDT:'XRPUSD',DOGEUSDT:'DOGEUSD',ADAUSDT:'ADAUSD'};
const CACHE=new Map(); const TTL=25000;
const SCAN_CACHE=new Map(); const SCAN_TTL=20000;
const PHASE2_VERSION=2; const PHASE3_VERSION=3; const PHASE4_VERSION=4; const PHASE5_VERSION=5;
const OPENAI_API_KEY=process.env.OPENAI_API_KEY||"";
const OPENAI_MODEL=process.env.OPENAI_MODEL||"gpt-5.6-luna";
const AI_LIMIT_MS=8000; const AI_CALLS=new Map();
const DATA_TIMEOUT_MS=7000;
function timeoutSignal(ms){return typeof AbortSignal!=="undefined"&&AbortSignal.timeout?AbortSignal.timeout(ms):undefined;}
function requestDevice(req){return String(req.headers["x-marketpulse-device"]||"00000000-0000-0000-0000-000000000000").slice(0,128)}

function mins(interval){return ({'15m':15,'1h':60,'4h':240,'1d':1440})[interval]||60}
async function getBinance(symbol,interval){
  const bases=['https://api.binance.com','https://api-gcp.binance.com','https://api1.binance.com'];
  const requests=bases.map(async base=>{const u=new URL(base+'/api/v3/klines');u.searchParams.set('symbol',symbol);u.searchParams.set('interval',interval);u.searchParams.set('limit',String(Math.min(KLINE_LIMIT,1000)));const r=await fetch(u,{signal:timeoutSignal(DATA_TIMEOUT_MS)});if(!r.ok)throw Error('HTTP '+r.status);const rows=await r.json();return rows.map(x=>({t:x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],source:'binance'}))});
  try{return await Promise.any(requests)}catch{return null}
}
async function getKraken(symbol,interval){
  const pair=KRAKEN_PAIRS[symbol]; if(!pair)throw new Error('No Kraken mapping for '+symbol);
  const u=new URL('https://api.kraken.com/0/public/OHLC');u.searchParams.set('pair',pair);u.searchParams.set('interval',String(mins(interval)));
  const r=await fetch(u,{signal:timeoutSignal(DATA_TIMEOUT_MS)});if(!r.ok)throw new Error('Kraken returned '+r.status);const body=await r.json();if(body.error?.length)throw new Error(body.error.join(', '));
  const key=Object.keys(body.result||{}).find(k=>k!=='last');if(!key)throw new Error('Kraken returned no OHLC data');
  return (body.result[key]||[]).slice(-Math.min(KLINE_LIMIT,720)).map(x=>({t:+x[0]*1000,o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[6],source:'kraken'}));
}
async function klines(symbol,interval){
  const key=symbol+'|'+interval,hit=CACHE.get(key);if(hit&&Date.now()-hit.ts<TTL)return hit.rows;
  const rows=await getBinance(symbol,interval)||await getKraken(symbol,interval);CACHE.set(key,{ts:Date.now(),rows});return rows;
}
async function longDailyHistory(symbol,days=4200){
  const key="LONG|"+symbol,hit=CACHE.get(key);if(hit&&Date.now()-hit.ts<TTL*4)return hit.rows;
  const bases=['https://api.binance.com','https://api-gcp.binance.com','https://api1.binance.com','https://api2.binance.com','https://api3.binance.com','https://api4.binance.com'];
  for(const base of bases){
    try{
      let endTime=Date.now(),all=[];
      while(all.length<days){
        const u=new URL(base+'/api/v3/klines');u.searchParams.set('symbol',symbol);u.searchParams.set('interval','1d');u.searchParams.set('limit','1000');u.searchParams.set('endTime',String(endTime));
        const r=await fetch(u,{headers:{Accept:'application/json'},signal:timeoutSignal(5000)});if(!r.ok)throw Error('HTTP '+r.status);
        const rows=await r.json();if(!rows.length)break;
        const mapped=rows.map(x=>({t:x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],source:'binance'}));
        all=mapped.concat(all);endTime=rows[0][0]-1;if(rows.length<1000)break;
      }
      all=all.slice(-days);if(all.length){CACHE.set(key,{ts:Date.now(),rows:all});return all}
    }catch{}
  }
  const fallback=await klines(symbol,'1d').catch(()=>[]);return fallback;
}

const LIVE_FLOW=new Map();
const LIVE_FLOW_LIMIT=900;
const LIVE_SYMBOLS=SYMBOLS.filter(s=>["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","ADAUSDT"].includes(s));
function flowBucket(symbol){
  let v=LIVE_FLOW.get(symbol);if(!v){v={liqLong:0,liqShort:0,cvd:0,cvdNotional:0,lastTs:0,oi:null,fundingRate:null,markPrice:null,points:[]};LIVE_FLOW.set(symbol,v)}
  return v;
}
function recordFlowPoint(symbol){
  const v=flowBucket(symbol);v.points.push({ts:Date.now(),liqLong:v.liqLong,liqShort:v.liqShort,liqTotal:v.liqLong+v.liqShort,cvd:v.cvd,cvdRatio:v.cvdNotional?v.cvd/v.cvdNotional:null,oi:v.oi,fundingRate:v.fundingRate,markPrice:v.markPrice});if(v.points.length>LIVE_FLOW_LIMIT)v.points.shift();
}
function startBybitLiveFlow(){
  if(!LIVE_SYMBOLS.length)return;
  let stopped=false,ws=null,retry=1000,timer=null;
  const connect=()=>{
    if(stopped)return;
    ws=new WebSocket("wss://stream.bybit.com/v5/public/linear");
    ws.on("open",()=>{
      retry=1000;
      ws.send(JSON.stringify({op:"subscribe",args:LIVE_SYMBOLS.flatMap(sym=>["allLiquidation."+sym,"publicTrade."+sym,"tickers."+sym])}));
    });
    ws.on("message",raw=>{
      try{
        const msg=JSON.parse(raw.toString()),topic=String(msg.topic||""),data=Array.isArray(msg.data)?msg.data:[msg.data];
        if(!topic||!data.length)return;
        const symbol=topic.split(".")[1];if(!LIVE_FLOW.has(symbol))return;const v=flowBucket(symbol);
        if(topic.startsWith("allLiquidation.")){
          for(const x of data){
            const q=Number(x.v)*Number(x.p);if(!Number.isFinite(q)||q<=0)continue;
            // Bybit: Buy liquidation means a long was liquidated; Sell means a short was liquidated.
            if(x.S==="Buy")v.liqLong+=q;else if(x.S==="Sell")v.liqShort+=q;
            v.lastTs=Number(x.T)||Date.now();
          }
        }else if(topic.startsWith("publicTrade.")){
          for(const x of data){
            const q=Number(x.v)*Number(x.p);if(!Number.isFinite(q)||q<=0)continue;
            v.cvd+=(x.S==="Buy"?q:-q);v.cvdNotional+=q;v.lastTs=Number(x.T)||Date.now();
          }
        }else if(topic.startsWith("tickers.")){
          const x=data[0]||{};
          if(Number.isFinite(+x.openInterest))v.oi=+x.openInterest;
          if(Number.isFinite(+x.fundingRate))v.fundingRate=+x.fundingRate;
          if(Number.isFinite(+x.markPrice))v.markPrice=+x.markPrice;
          v.lastTs=Number(msg.ts)||Date.now();
        }
        recordFlowPoint(symbol);
      }catch{}
    });
    ws.on("close",()=>{if(!stopped){clearTimeout(timer);timer=setTimeout(connect,retry);retry=Math.min(retry*2,30000)}});
    ws.on("error",()=>{try{ws.close()}catch{}});
  };
  connect();
  process.on("SIGTERM",()=>{stopped=true;try{ws?.close()}catch{}});
}
startBybitLiveFlow();

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
  const urls={cvd:base+"/cvd?since="+since+"&interval="+secs,oi:base+"/open-interest?since="+since+"&interval="+secs,funding:base+"/funding?since="+since+"&interval="+secs,ls:base+"/long-short-info?since="+since+"&interval="+secs,liq:base+"/liquidation-volume?since="+since+"&interval="+secs};
  const settled=await Promise.all(Object.entries(urls).map(async([key,url])=>{try{return{key,status:"fulfilled",value:await fetchJson(url,5000)}}catch(e){return{key,status:"rejected",reason:String(e.message||e)}}}));
  const byName=Object.fromEntries(settled.map(x=>[x.key,x]));
  const payload=key=>byName[key]?.status==="fulfilled"?(byName[key].value?.result||byName[key].value):null;
  const arraysFrom=(obj,names)=>{
    if(!obj)return[];const roots=[obj?.data,obj?.result?.data,obj?.result,obj];
    for(const root of roots){
      if(!root)continue;
      for(const name of names){const v=root?.[name];if(Array.isArray(v)){const out=v.map(x=>typeof x==="object"?Number(x.value??x.v??x[name]):Number(x)).filter(Number.isFinite);if(out.length)return out}}
      if(Array.isArray(root))for(const name of names){const out=root.map(x=>Number(x?.[name]??x?.value??x?.v)).filter(Number.isFinite);if(out.length)return out}
    }
    return[];
  };
  const cvdPayload=payload("cvd"),oiPayload=payload("oi"),fundingPayload=payload("funding"),lsPayload=payload("ls"),liqPayload=payload("liq");
  const cvdVals=arraysFrom(cvdPayload,["cvd","cumulativeVolumeDelta","cumulative_volume_delta"]);
  const buyVals=arraysFrom(cvdPayload,["buyVolume","buy_volume","buyNotional"]);
  const sellVals=arraysFrom(cvdPayload,["sellVolume","sell_volume","sellNotional"]);
  const oiVals=arraysFrom(oiPayload,["openInterest","open_interest","oi"]);
  const fundingVals=arraysFrom(fundingPayload,["rate","fundingRate","funding_rate"]);
  const longPct=arraysFrom(lsPayload,["longPercent","long_percent","long"]);
  const shortPct=arraysFrom(lsPayload,["shortPercent","short_percent","short"]);
  const ratioVals=arraysFrom(lsPayload,["ratio","longShortRatio","long_short_ratio"]);
  const liqTotalVals=arraysFrom(liqPayload,["liquidationVolume","liquidation_volume","volume","usdValue"]);
  const cvdFirst=cvdVals[0],cvdLast=cvdVals[cvdVals.length-1];
  let cvdDelta=Number.isFinite(cvdLast)&&Number.isFinite(cvdFirst)?cvdLast-cvdFirst:null;
  if(cvdDelta===null&&buyVals.length&&sellVals.length){const n=Math.min(buyVals.length,sellVals.length),buy=buyVals.slice(-n).reduce((a,b)=>a+b,0),sell=sellVals.slice(-n).reduce((a,b)=>a+b,0);cvdDelta=buy-sell}
  const oiFirst=oiVals[0],oiLast=oiVals[oiVals.length-1],oiChangePct=Number.isFinite(oiFirst)&&oiFirst?((oiLast-oiFirst)/oiFirst)*100:null;
  const fundingRate=fundingVals.length?fundingVals[fundingVals.length-1]:null;
  const longLast=longPct.length?longPct[longPct.length-1]:null,shortLast=shortPct.length?shortPct[shortPct.length-1]:null,ratioLast=ratioVals.length?ratioVals[ratioVals.length-1]:null;
  const liquidationTotal=liqTotalVals.length?liqTotalVals.reduce((a,b)=>a+b,0):0;
  if(!Number.isFinite(oiLast)&&!Number.isFinite(cvdDelta)&&liqTotalVals.length===0&&!Number.isFinite(fundingRate)&&!Number.isFinite(longLast))throw new Error("Kraken Futures analytics returned no usable data");
  const cvdState=Number.isFinite(cvdDelta)?(cvdDelta>0?"BUYERS PRESSURE":cvdDelta<0?"SELLERS PRESSURE":"BALANCED"):"UNAVAILABLE";
  let positioning="UNAVAILABLE";if(Number.isFinite(longLast)&&Number.isFinite(shortLast))positioning=longLast>shortLast+2?"LONG BIAS":shortLast>longLast+2?"SHORT BIAS":"BALANCED";else if(Number.isFinite(oiChangePct))positioning=oiChangePct>1?"OI RISING":oiChangePct<-1?"OI FALLING":"OI FLAT";
  const errors=settled.filter(x=>x.status==="rejected").map(x=>x.key+": "+x.reason),lengths=[cvdVals.length,oiVals.length,liqTotalVals.length].filter(Boolean);
  return{available:true,provider:"Kraken Futures public API",symbol:pair,oi:Number.isFinite(oiLast)?oiLast:null,oiChangePct,cvdDelta,cvdState,positioning,tradeCount:0,fundingRate:Number.isFinite(fundingRate)?fundingRate:null,markPrice:null,cvdRatio:null,longPercent:longLast,shortPercent:shortLast,longShortRatio:ratioLast,liquidationTotal,liquidationBias:liquidationTotal>0?"LIQUIDATION ACTIVITY":"NO LIQUIDATION ACTIVITY",analyticsBuckets:lengths.length?Math.max(...lengths):0,series:{cvd:cvdVals,oi:oiVals,liq:liqTotalVals},completeness:{oi:Number.isFinite(oiLast),cvd:Number.isFinite(cvdDelta),funding:Number.isFinite(fundingRate),positioning:Number.isFinite(longLast)&&Number.isFinite(shortLast),liquidations:liqTotalVals.length>0},errors,updatedAt:Date.now()};
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
  const live=flowBucket(symbol),liveCvd=live.cvdNotional?live.cvd:cvd,liveCvdRatio=live.cvdNotional?live.cvd/live.cvdNotional:cvdRatio,liqTotal=live.liqLong+live.liqShort,liqBias=liqTotal?(live.liqLong>live.liqShort?"LONG LIQS DOMINANT":"SHORT LIQS DOMINANT"):"UNAVAILABLE";
  const data={available:Boolean(ticker||oiPayload||tradePayload||live.cvdNotional||liqTotal),provider:"Bybit linear futures"+(live.cvdNotional||liqTotal?" · live stream":""),oi:Number.isFinite(currentOi)?currentOi:null,oiChangePct,cvdDelta:liveCvd,cvdRatio:liveCvdRatio,cvdState:"MIXED",positioning:"MIXED",tradeCount:trades.length,fundingRate:ticker&&Number.isFinite(+ticker.fundingRate)?+ticker.fundingRate:null,markPrice:ticker&&Number.isFinite(+ticker.markPrice)?+ticker.markPrice:null,tradePriceChangePct:priceChangePct,longLiquidations:live.liqLong,shortLiquidations:live.liqShort,liquidationTotal:liqTotal,liquidationBias:liqBias,livePointCount:live.points.length,liveHistory:live.points.slice(-120),errors,updatedAt:Date.now()};
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
  const live=flowBucket(symbol);
  if(Number.isFinite(data.oi))live.oi=data.oi;
  if(Number.isFinite(data.fundingRate))live.fundingRate=data.fundingRate;
  if(Number.isFinite(data.markPrice))live.markPrice=data.markPrice;
  if(Number.isFinite(data.cvdDelta)&&!live.cvdNotional){live.cvd=data.cvdDelta;live.cvdNotional=1;}
  if(Number.isFinite(data.cvdDelta)){
    data.cvdState=data.cvdDelta>0?"BUYERS PRESSURE":data.cvdDelta<0?"SELLERS PRESSURE":"BALANCED";
  }
  if(Number.isFinite(data.oiChangePct)){
    data.positioning=data.oiChangePct>1?"OI RISING":data.oiChangePct<-1?"OI FALLING":"OI FLAT";
  }
  if(Number.isFinite(data.longPercent)&&Number.isFinite(data.shortPercent)){
    data.positioning=data.longPercent>data.shortPercent+2?"LONG BIAS":data.shortPercent>data.longPercent+2?"SHORT BIAS":"BALANCED";
  }
  if(live.liqLong||live.liqShort){
    data.liveLiquidations={long:live.liqLong,short:live.liqShort,total:live.liqLong+live.liqShort,bias:live.liqLong>live.liqShort?"LONG LIQS DOMINANT":"SHORT LIQS DOMINANT"};
    if(!Number(data.liquidationTotal) || data.liquidationTotal===0){
      data.liquidationBias=data.liveLiquidations.bias;data.liquidationTotal=data.liveLiquidations.total;
      data.longLiquidations=live.liqLong;data.shortLiquidations=live.liqShort;
    }
  }
  recordFlowPoint(symbol);
  data.liveHistory=live.points.slice(-120);
  data.livePointCount=live.points.length;
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
  const m=market||{},call=String(m.status==="READY"?m.type:m.status==="WATCH"?"WATCH":m.status==="WAITING"?"NO TRADE":m.type||"NO TRADE"),regime=String(m.regime||"UNKNOWN"),score=Number(m.score||0),rsi=Number.isFinite(Number(m.rsi))?Number(m.rsi).toFixed(2):"—",adx=Number.isFinite(Number(m.adx))?Number(m.adx).toFixed(2):"—",structure=String(m.structure||"—"),mtf=m.mtf?("4H "+(m.mtf.higher||"UNKNOWN")+" · 15M "+(m.mtf.lower||"UNKNOWN")):"",deriv=m.derivatives||{};
  if(mode==="trade"){
    const entry=Number(trade?.entry),stop=Number(trade?.stop),target=Number(trade?.target),side=String(trade?.side||""),risk=Number.isFinite(entry)&&Number.isFinite(stop)?Math.abs(entry-stop):NaN,reward=Number.isFinite(entry)&&Number.isFinite(target)?Math.abs(target-entry):NaN,rr=Number.isFinite(risk)&&risk?reward/risk:NaN;
    const lines=["MarketPulse Lite review","", "Market context: "+regime+" · "+call+" · confluence "+score+"/100.","Momentum: RSI "+rsi+" · ADX "+adx+" · structure "+structure+".",mtf?"Timeframe context: "+mtf+".":"",deriv.cvdState?"Derivatives: "+deriv.cvdState+" · "+(deriv.positioning||"positioning unavailable")+".":""].filter(Boolean);
    if(side)lines.push("Your plan: "+side+(Number.isFinite(rr)?" · planned R:R "+rr.toFixed(2)+"R.":""));
    if(call==="NO TRADE")lines.push("The dashboard currently sees insufficient alignment. That matters more than whether the trade eventually wins or loses.");
    else if(Number.isFinite(rr)&&rr<1.5)lines.push("Your planned R:R is below 1.5R. Check whether the invalidation is structural before proceeding.");
    else if(Number.isFinite(rr))lines.push("Your planned R:R is "+rr.toFixed(2)+"R. Check that the invalidation is structural rather than arbitrary.");
    lines.push("Question: "+(question||"Review this trade."),"Note: Lite mode uses deterministic MarketPulse rules. Add API credits to unlock full AI reasoning.");
    return lines.join("\n");
  }
  return ["MarketPulse Lite","", "Market context: "+regime+" · "+call+" · confluence "+score+"/100.","Momentum: RSI "+rsi+" · ADX "+adx+" · structure "+structure+".",mtf?"Multi-timeframe: "+mtf+".":"",deriv.cvdState?"Derivatives: "+deriv.cvdState+" · "+(deriv.positioning||"positioning unavailable")+".":"",call==="NO TRADE"?"Read: wait for alignment instead of forcing a trade.":"Read: treat this as a setup to validate, not a guarantee.","Question: "+(question||"What is the market doing?"),"Full AI reasoning will be available when API credits are added."].filter(Boolean).join("\n");
}

function replayOutcome(candles,index,analysis,horizon=12){
  if(!analysis||!["READY","WATCH","WAITING"].includes(analysis.status))return {status:"NO_SIGNAL"};
  const entryLow=Number(analysis.entryLow),entryHigh=Number(analysis.entryHigh),stop=Number(analysis.stop),target=Number(analysis.tp1);
  const side=String(analysis.side||"");
  if(!Number.isFinite(stop)||!Number.isFinite(target)||!side)return {status:"NO_LEVELS"};
  const entry=Number.isFinite(entryLow)&&Number.isFinite(entryHigh)?(entryLow+entryHigh)/2:Number(analysis.price);
  if(!Number.isFinite(entry)||Math.abs(entry-stop)<1e-12)return {status:"NO_LEVELS"};
  const zoneLow=Number.isFinite(entryLow)?entryLow:entry,zoneHigh=Number.isFinite(entryHigh)?entryHigh:entry;
  let entryBar=-1;
  for(let j=index+1;j<Math.min(candles.length,index+1+horizon);j++){
    const c=candles[j],hitEntry=Number(c.l)<=zoneHigh&&Number(c.h)>=zoneLow;
    if(hitEntry){entryBar=j;break}
  }
  if(entryBar<0)return {status:"NOT_TRIGGERED",entry,stop,target,side,resolutionBars:horizon};
  let outcome="UNRESOLVED",resultR=0,resolvedBar=-1;
  for(let j=entryBar;j<Math.min(candles.length,index+1+horizon);j++){
    const c=candles[j],lo=Number(c.l),hi=Number(c.h);
    const stopHit=side==="LONG"?lo<=stop:hi>=stop;
    const targetHit=side==="LONG"?hi>=target:lo<=target;
    if(stopHit&&targetHit){outcome="AMBIGUOUS";resolvedBar=j;resultR=0;break}
    if(stopHit){outcome="STOP";resolvedBar=j;resultR=-1;break}
    if(targetHit){outcome="TARGET_1";resolvedBar=j;const risk=Math.abs(entry-stop),reward=Math.abs(target-entry);resultR=risk?reward/risk:0;break}
  }
  return {status:outcome,entry,stop,target,side,resultR,resolutionBars:resolvedBar>=0?resolvedBar-entryBar:horizon,entryBar:entryBar-index,resolvedBar:resolvedBar};
}

function replaySnapshot(a){
  return {
    status:a.status,type:a.type,side:a.side,score:a.score,bias:a.bias,regime:a.regime,mood:a.mood,
    momentum:a.momentum,volatilityState:a.volatilityState,structure:a.structure,directionalLean:a.directionalLean,
    price:a.price,rsi:a.rsi,adx:a.adx,atrPct:a.atrPct,volumeZ:a.volumeZ,
    ema20:a.ema20,ema50:a.ema50,ema200:a.ema200,
    entryLow:a.entryLow,entryHigh:a.entryHigh,stop:a.stop,tp1:a.tp1,tp2:a.tp2,rr:a.rr,
    probabilityLabel:a.probabilityLabel,reasons:(a.reasons||[]).slice(0,6),
    historicalDerivativeContext:"UNAVAILABLE_IN_REPLAY"
  };
}

async function historicalCandles(symbol,interval,bars){
  const n=Math.max(240,Math.min(Number(bars)||4200,4200));
  if(interval==="1d")return longDailyHistory(symbol,n);
  return klines(symbol,interval);
}

async function buildReplayDataset(symbol,interval,{points=60,bars=420}={}){
  const candles=await historicalCandles(symbol,interval,bars);
  if(!candles||candles.length<240)throw new Error("Not enough historical candles for replay");
  const usable=Math.max(1,candles.length-220-13),count=Math.max(10,Math.min(Number(points)||60,usable));
  const step=Math.max(1,Math.floor(usable/count)),frames=[];
  for(let idx=220;idx<candles.length-12;idx+=step){
    const window=candles.slice(0,idx+1);
    const a=analyze(window,{interval});
    const outcome=replayOutcome(candles,idx,a,12);
    frames.push({
      index:idx,ts:candles[idx].t,price:candles[idx].c,
      snapshot:replaySnapshot(a),outcome
    });
    if(frames.length>=count)break;
  }
  return {symbol,interval,candles,frames,coverage:{bars:candles.length,startTs:candles[0]?.t,endTs:candles[candles.length-1]?.t,points:frames.length,horizonBars:12}};
}

function dnaRecordsFromReplay(dataset){
  return (dataset.frames||[]).map(f=>{
    const s=f.snapshot,o=f.outcome||{};
    const signalKey=["MPDNA",dataset.symbol,dataset.interval,f.ts,s.status,s.score,s.side].join("|");
    return {
      signalKey,symbol:dataset.symbol,interval:dataset.interval,candleTs:f.ts,status:s.status,side:s.side||"NEUTRAL",
      type:s.type||"NO TRADE",regime:s.regime||"UNKNOWN",score:Number(s.score)||0,
      snapshot:s,outcome:o
    };
  });
}

function summarizeDNA(records){
  const rows=Array.isArray(records)?records:[];
  const resolved=rows.filter(x=>["TARGET_1","STOP","AMBIGUOUS"].includes(x.outcome?.status));
  const triggered=rows.filter(x=>!["NOT_TRIGGERED","NO_SIGNAL","NO_LEVELS"].includes(x.outcome?.status));
  const by=(keyFn)=>{
    const map=new Map();
    for(const r of rows){const k=keyFn(r)||"UNKNOWN";const x=map.get(k)||{key:k,total:0,triggered:0,target:0,stop:0,ambiguous:0,notTriggered:0,netR:0,resolved:0};x.total++;if(r.outcome?.status==="TARGET_1"){x.target++;x.triggered++;x.resolved++;x.netR+=Number(r.outcome.resultR)||0}else if(r.outcome?.status==="STOP"){x.stop++;x.triggered++;x.resolved++;x.netR-=1}else if(r.outcome?.status==="AMBIGUOUS"){x.ambiguous++;x.triggered++;x.resolved++}else if(r.outcome?.status==="NOT_TRIGGERED")x.notTriggered++;map.set(k,x)}
    return Array.from(map.values()).map(x=>({...x,triggerRate:x.total?x.triggered/x.total:0,targetRate:x.resolved?x.target/x.resolved:0,avgR:x.resolved?x.netR/x.resolved:0})).sort((a,b)=>b.total-a.total);
  };
  const scoreBuckets=by(r=>{const s=Number(r.score)||0;return s<40?"0-39":s<55?"40-54":s<70?"55-69":s<80?"70-79":"80-100"});
  return {total:rows.length,resolved:resolved.length,triggered:triggered.length,targetHits:resolved.filter(x=>x.outcome?.status==="TARGET_1").length,stops:resolved.filter(x=>x.outcome?.status==="STOP").length,ambiguous:resolved.filter(x=>x.outcome?.status==="AMBIGUOUS").length,notTriggered:rows.filter(x=>x.outcome?.status==="NOT_TRIGGERED").length,netR:resolved.reduce((a,x)=>a+(Number(x.outcome?.resultR)||0),0),byRegime:by(r=>r.regime),bySide:by(r=>r.side),byType:by(r=>r.type),byStatus:by(r=>r.status),byScore:scoreBuckets};
}

function staticFile(req,res){const reqPath=req.url==='/'?'/index.html':req.url.split('?')[0],file=path.join(__dirname,'public',reqPath),root=path.join(__dirname,'public');if(!file.startsWith(root))return send(res,403,{error:'Forbidden'});fs.readFile(file,(e,d)=>{if(e)return send(res,404,{error:'Not found'});const ext=path.extname(file);res.writeHead(200,{'Content-Type':ext==='.html'?'text/html; charset=utf-8':ext==='.json'?'application/json; charset=utf-8':'text/plain; charset=utf-8'});res.end(d)})}

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&u.pathname==='/health')return send(res,200,{ok:true,service:'marketpulse-os',time:Date.now()});
    if(req.method==='GET'&&u.pathname==='/api/memory'){
      const device=String(u.searchParams.get('device')||req.headers['x-marketpulse-device']||'');
      const mem=await storage.get(device);
      return send(res,200,{storage:mem.storage,durable:mem.storage==="postgres",payload:mem.payload,updatedAt:mem.updatedAt});
    }
    if(req.method==='POST'&&u.pathname==='/api/memory'){
      const device=String(u.searchParams.get('device')||req.headers['x-marketpulse-device']||'');
      let raw="";for await(const chunk of req)raw+=chunk;
      let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      const saved=await storage.save(device,body.memory||body);
      return send(res,200,{ok:true,storage:saved.storage,durable:saved.storage==="postgres",updatedAt:saved.updatedAt});
    }
    if(req.method==='GET'&&u.pathname==='/api/memory/status')return send(res,200,storage.status());
    if(req.method==='GET'&&u.pathname==='/api/learning/status')return send(res,200,await learning.status());
    if(req.method==='GET'&&u.pathname==='/api/config')return send(res,200,{symbols:SYMBOLS,labels,intervals:['15m','1h','4h','1d'],memory:storage.status(),learning:{state:'LOADING'},phase4:PHASE4_VERSION,phase5:PHASE5_VERSION});if(req.method==='POST'&&u.pathname==='/api/ai'){
      if(!aiAllowed(req)) return send(res,429,{error:"Slow down for a few seconds."});
      let raw=""; for await(const chunk of req) raw+=chunk; let body={}; try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      const mode=body.mode==="trade"?"trade":"market";
      const q=String(body.question||"").slice(0,1800);
      const market=body.market||{}; const trade=body.trade||{}; const traderProfile=body.traderProfile||{};
      let edgeContext={};try{edgeContext=await phase4.snapshot(requestDevice(req),market.symbol||"BTCUSDT",market.interval||"1h",market)||{}}catch{}
      const profileText="PERSONAL TRADER PROFILE (descriptive, small-sample aware):\n"+JSON.stringify(traderProfile);
      const edgeText="PHASE 4 LIVE EDGE CONTEXT:\n"+JSON.stringify({
        signal:edgeContext.signal||null,
        evidence:edgeContext.evidence||null,
        risk:edgeContext.risk||null,
        paper:edgeContext.paper?{trades:edgeContext.paper.trades,winRate:edgeContext.paper.winRate,netR:edgeContext.paper.netR,realizedPnl:edgeContext.paper.realizedPnl,openRiskPct:edgeContext.paper.openRiskPct}:null,
        health:edgeContext.health||null
      });
      const userPrompt=mode==="trade"
        ? ("Review this trade plan/trade.\nMARKET CONTEXT:\n"+JSON.stringify(market)+"\nTRADE:\n"+JSON.stringify(trade)+"\n"+profileText+"\n"+edgeText+"\nUSER QUESTION:\n"+q)
        : ("Explain the current market context.\nMARKET:\n"+JSON.stringify(market)+"\n"+profileText+"\n"+edgeText+"\nUSER QUESTION:\n"+q);
      try{return send(res,200,await callOpenAI(aiSystem(),userPrompt))}
      catch(e){
        const msg=String(e.message||"AI request failed");
        if(e.message==="AI_COPILOT_NOT_CONFIGURED"||/credit|billing|quota|insufficient|model.*not.*found|unsupported.*model/i.test(msg)){
          return send(res,200,{text:liteCopilot(mode,market,trade,q),model:"MarketPulse Lite",lite:true,ts:Date.now()});
        }
        return send(res,502,{error:msg});
      }
    }
    
    if(req.method==='GET'&&u.pathname==='/api/core'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{error:'Unsupported symbol'});
      try{
        const candles=await getKraken(symbol,interval);
        if(!candles||candles.length<220)throw Error('Kraken returned insufficient candles');
        const lowerPromise=interval==='15m'?Promise.resolve(null):Promise.race([getKraken(symbol,'15m'),new Promise(resolve=>setTimeout(()=>resolve(null),1400))]).catch(()=>null);
        const higherPromise=interval==='4h'?Promise.resolve(null):Promise.race([getKraken(symbol,'4h'),new Promise(resolve=>setTimeout(()=>resolve(null),1400))]).catch(()=>null);
        const derivPromise=Promise.race([derivatives(symbol,interval),new Promise(resolve=>setTimeout(()=>resolve(null),900))]).catch(()=>null);
        const [lower,higher,deriv]=await Promise.all([lowerPromise,higherPromise,derivPromise]);
        let analysis=analyze(candles,{interval,lower:lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null,higher:higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null,deriv});
        let learned=null;
        try{learned=await Promise.race([learning.process(symbol,interval,candles,analysis),new Promise(resolve=>setTimeout(()=>resolve(null),650))])}catch{}
        if(learned?.analysis)analysis=learned.analysis;
        try{await Promise.race([phase4.updateLive(requestDevice(req),symbol,interval,analysis,candles),new Promise(resolve=>setTimeout(resolve,700))])}catch{}
        const learningStatus=await Promise.race([learning.status(),new Promise(resolve=>setTimeout(()=>resolve({phase:2,state:'COLLECTING',durable:storage.status().durable,resolved:0}),500))]).catch(()=>({phase:2,state:'COLLECTING',durable:storage.status().durable,resolved:0}));
        const sample=candles.slice(-600);
        const setupStats=require("./market-engine").backtestBySetup(sample);
        return send(res,200,{
          ok:true,symbol,interval,candles,analysis,derivatives:deriv,learning:learningStatus,
          backtest:backtest(sample),validation:walkForwardBacktest(sample),setupStats,
          source:'Kraken spot',
          phase2:PHASE2_VERSION,
          phase3:PHASE3_VERSION,
          phase4:PHASE4_VERSION,
          dataQuality:{candleCount:candles.length,candleAgeMs:candles.length?Math.max(0,Date.now()-Number(candles[candles.length-1].t)):null,derivativesAvailable:Boolean(deriv?.available),derivativesCompleteness:deriv?.completeness||null},
          updatedAt:Date.now()
        });
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e),source:'Kraken spot'})}
    }
    if(req.method==='GET'&&u.pathname==='/api/core-flow'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{error:'Unsupported symbol'});
      try{
        const data=await Promise.race([derivatives(symbol,interval),new Promise(resolve=>setTimeout(()=>resolve(null),2500))]).catch(()=>null);
        return send(res,200,{ok:true,data:data||null});
      }catch(e){return send(res,200,{ok:false,data:null,error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/core-scan'){
      const interval=u.searchParams.get('interval')||'1h',hit=SCAN_CACHE.get(interval);
      if(hit&&Date.now()-hit.ts<SCAN_TTL)return send(res,200,hit.payload);
      const rows=await Promise.all(SYMBOLS.map(async symbol=>{
        try{
          const candles=await getKraken(symbol,interval);if(!candles||candles.length<220)throw Error('Insufficient candles');
          const higher=interval==='4h'?null:await Promise.race([getKraken(symbol,'4h'),new Promise(resolve=>setTimeout(()=>resolve(null),1200))]).catch(()=>null);
          const lower=interval==='15m'?null:await Promise.race([getKraken(symbol,'15m'),new Promise(resolve=>setTimeout(()=>resolve(null),1200))]).catch(()=>null);
          const deriv=await Promise.race([derivatives(symbol,interval),new Promise(resolve=>setTimeout(()=>resolve(null),700))]).catch(()=>null);
          let analysis=analyze(candles,{interval,lower:lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null,higher:higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null,deriv});
          try{const learned=await Promise.race([learning.process(symbol,interval,candles,analysis),new Promise(resolve=>setTimeout(()=>resolve(null),250))]);if(learned?.analysis)analysis=learned.analysis}catch{}
          return{symbol,label:labels[symbol]||symbol,price:analysis.price,change24h:analysis.change24h,regime:analysis.regime,side:analysis.side,type:analysis.type,status:analysis.status,score:analysis.score,bias:analysis.bias,probabilityLabel:analysis.probabilityLabel,structure:analysis.structure,derivatives:analysis.derivatives};
        }catch(e){return{symbol,label:labels[symbol]||symbol,status:'WAITING',side:'WAIT',score:0,error:e.message}}
      }));
      const payload={ok:true,interval,rows,updatedAt:Date.now(),cacheTtlMs:SCAN_TTL};SCAN_CACHE.set(interval,{ts:Date.now(),payload});return send(res,200,payload);
    }


    if(req.method==='GET'&&u.pathname==='/api/edge'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      try{return send(res,200,await phase4.snapshot(requestDevice(req),symbol,interval,null))}catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/edge/health'){
      try{const x=await phase4.snapshot(requestDevice(req),null,null,null);return send(res,200,{ok:true,health:x.health,paper:x.paper,personalEdge:x.personalEdge,updatedAt:x.updatedAt})}catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/edge/config'){
      let raw="";for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      try{return send(res,200,await phase4.setConfig(requestDevice(req),{account:body.account,riskPct:body.riskPct,minRR:body.minRR,maxOpenRiskPct:body.maxOpenRiskPct}))}catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/edge/journal'){
      let raw="";for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      try{const row=await phase4.addJournal(requestDevice(req),body.entry||body);return send(res,200,{ok:true,row})}catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/edge/events'){
      try{const x=await phase4.snapshot(requestDevice(req),null,null,null);return send(res,200,{ok:true,events:x.events||[],updatedAt:x.updatedAt})}catch(e){return send(res,503,{ok:false,error:e.message})}
    }

    if(req.method==='GET'&&u.pathname==='/api/execution'){
      try{return send(res,200,await execution.snapshot())}catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/execution/config'){
      let raw="";for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      try{return send(res,200,await execution.setConfig({mode:body.mode,account:body.account,riskPct:body.riskPct,maxOpenRiskPct:body.maxOpenRiskPct,maxDailyLossPct:body.maxDailyLossPct,maxPositions:body.maxPositions,maxSymbolExposurePct:body.maxSymbolExposurePct,maxOrdersPerMinute:body.maxOrdersPerMinute,maxSlippageBps:body.maxSlippageBps,maxIntentAgeMs:body.maxIntentAgeMs,allowMarketOrders:false,requireReconciliation:true}))}catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/execution/arm'){
      try{return send(res,200,await execution.armTestnet())}catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/execution/kill'){
      try{return send(res,200,await execution.killSwitch(true))}catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/execution/reconcile'){
      try{return send(res,200,await execution.reconcile())}catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/execution/prepare'){
      let raw="";for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      const symbol=(body.symbol||'BTCUSDT').toUpperCase(),interval=body.interval||'1h';
      try{
        const edge=await phase4.snapshot(requestDevice(req),symbol,interval,null);
        return send(res,200,{ok:true,order:await execution.prepareFromSignal(edge.signal),edge});
      }catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/execution/intent'){
      let raw="";for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      try{return send(res,200,{ok:true,order:await execution.createIntent(body)})}catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/execution/submit'){
      let raw="";for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      try{return send(res,200,{ok:true,order:await execution.submitIntent(body.id)})}catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/execution/cancel'){
      let raw="";for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      try{return send(res,200,{ok:true,order:await execution.cancelOrder(body.id)})}catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/execution/close-sim'){
      let raw="";for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      try{return send(res,200,await execution.closeSimulationPosition(body.positionId,body.exitPrice))}catch(e){return send(res,400,{error:e.message})}
    }

    if(req.method==='GET'&&u.pathname==='/api/replay'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h',points=Math.min(120,Math.max(12,Number(u.searchParams.get('points')||60))),bars=Math.min(4200,Math.max(240,Number(u.searchParams.get('bars')||(interval==="1d"?1800:420))));
      if(!SYMBOLS.includes(symbol))return send(res,400,{error:'Unsupported symbol'});
      try{return send(res,200,await buildReplayDataset(symbol,interval,{points,bars}))}catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/dna/refresh'){
      let raw="";for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      const requestedSymbol=(body.symbol||"ALL").toUpperCase(),interval=body.interval||"1h",points=Math.min(160,Math.max(20,Number(body.points||80))),bars=Math.min(4200,Math.max(240,Number(body.bars||(interval==="1d"?1800:420))));
      const symbols=requestedSymbol==="ALL"?SYMBOLS:[requestedSymbol];
      if(symbols.some(s=>!SYMBOLS.includes(s)))return send(res,400,{error:"Unsupported symbol"});
      try{
        const datasets=await Promise.all(symbols.map(async symbol=>buildReplayDataset(symbol,interval,{points,bars}))),records=datasets.flatMap(d=>dnaRecordsFromReplay(d));
        const stored=await storage.saveSignalDNA(records);
        return send(res,200,{ok:true,symbol:requestedSymbol,interval,stored:stored.stored,storage:stored.storage,coverage:datasets.map(d=>d.coverage),summary:summarizeDNA(records),records:records.slice(-250).reverse()});
      }catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/dna'){
      const symbol=u.searchParams.get('symbol')||"",interval=u.searchParams.get('interval')||"",limit=Math.min(500,Math.max(20,Number(u.searchParams.get('limit')||200)));
      try{const records=await storage.getSignalDNA({symbol: symbol||undefined,interval:interval||undefined,limit});return send(res,200,{ok:true,records,summary:summarizeDNA(records),storage:storage.status()})}catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/dna/clear'){
      let raw="";for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      await storage.clearSignalDNA({symbol:body.symbol||undefined,interval:body.interval||undefined});return send(res,200,{ok:true})
    }
    if(req.method==='GET'&&u.pathname==='/api/research'){
      const symbol=u.searchParams.get('symbol')||"",interval=u.searchParams.get('interval')||"",limit=Math.min(2000,Math.max(50,Number(u.searchParams.get('limit')||800)));
      try{
        let records=await storage.getSignalDNA({symbol:symbol||undefined,interval:interval||undefined,limit});
        if(records.length<50){
          const symbols=symbol?[symbol]:SYMBOLS,sets=await Promise.all(symbols.map(async sym=>{
            try{
              const ds=await buildReplayDataset(sym,interval||"1h",{points:50,bars:(interval||"1h")==="1d"?1800:420});return dnaRecordsFromReplay(ds);
            }catch{return[]}
          }));
          records=sets.flat();
        }
        return send(res,200,{ok:true,filters:{symbol:symbol||"ALL",interval:interval||"ALL"},summary:summarizeDNA(records),records:records.slice(0,limit),updatedAt:Date.now()});
      }catch(e){return send(res,503,{ok:false,error:e.message})}
    }

    if(req.method==='GET'&&u.pathname==='/api/system-check'){
      const checks={server:true,marketEngine:true,learning:false,memory:false,marketData:false,derivatives:false,oi:false,cvd:false,liquidations:false,execution:true};
      let marketError=null,derivativesError=null;
      try{checks.learning=Boolean(await learning.status())}catch(e){}
      try{checks.memory=Boolean(storage.status())}catch(e){}
      try{const rows=await getKraken('BTCUSDT','1h');checks.marketData=Boolean(rows&&rows.length>=50)}catch(e){marketError=e.message}
      try{
        const d=await Promise.race([derivatives('BTCUSDT','15m'),new Promise(resolve=>setTimeout(()=>resolve(null),3500))]);
        checks.derivatives=Boolean(d&&d.available);checks.oi=Boolean(Number.isFinite(Number(d?.oi)));
        checks.cvd=Boolean(Number.isFinite(Number(d?.cvdDelta))||["BUYERS PRESSURE","SELLERS PRESSURE","BALANCED"].includes(d?.cvdState));
        checks.liquidations=Boolean(Array.isArray(d?.series?.liq)?d.series.liq.length>0:Boolean(d&&d.liquidationTotal!=null));
        if(!checks.derivatives)derivativesError="No derivatives provider returned usable data";
      }catch(e){derivativesError=String(e.message||e)}
      return send(res,200,{ok:checks.server&&checks.marketEngine&&checks.learning&&checks.memory&&checks.marketData&&checks.execution,checks,marketError,derivativesError,phase2:PHASE2_VERSION,phase3:PHASE3_VERSION,phase4:PHASE4_VERSION,phase5:PHASE5_VERSION,routes:{core:true,coreScan:true,coreFlow:true,cycle:true,ai:true,memory:true,learning:true,replay:true,dna:true,research:true,edge:true,edgeHealth:true,edgeConfig:true,edgeJournal:true,execution:true,executionConfig:true,executionArm:true,executionKill:true,executionReconcile:true},timestamp:Date.now()});
    }
    if(req.method==='GET'&&u.pathname==='/api/live'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{error:'Unsupported symbol'});
      try{
        const candles=await klines(symbol,interval);
        if(!candles||candles.length<220)throw Error('Not enough market candles yet.');
        const lowerPromise=interval==='15m'?Promise.resolve(null):Promise.race([klines(symbol,'15m'),new Promise(resolve=>setTimeout(()=>resolve(null),1500))]).catch(()=>null);
        const higherPromise=interval==='4h'?Promise.resolve(null):Promise.race([klines(symbol,'4h'),new Promise(resolve=>setTimeout(()=>resolve(null),1500))]).catch(()=>null);
        const [lower,higher]=await Promise.all([lowerPromise,higherPromise]);
        const deriv=await Promise.race([derivatives(symbol,interval),new Promise(resolve=>setTimeout(()=>resolve(null),1000))]).catch(()=>null);
        let analysis=analyze(candles,{interval,lower:lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null,higher:higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null,deriv});
        try{const learned=await Promise.race([learning.process(symbol,interval,candles,analysis),new Promise(resolve=>setTimeout(()=>resolve(null),700))]);if(learned?.analysis)analysis=learned.analysis}catch{}
        return send(res,200,{ok:true,symbol,interval,candles,analysis,derivatives:deriv,learning:{phase:2,state:'COLLECTING',durable:storage.status().durable}});
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e)})}
    }
    if(req.method==='GET'&&u.pathname==='/api/scanner-live'){
      const interval=u.searchParams.get('interval')||'1h';
      const rows=await Promise.all(SYMBOLS.map(async symbol=>{
        try{
          const candles=await klines(symbol,interval);
          if(!candles||candles.length<220)throw Error('insufficient candles');
          const a=analyze(candles,{interval});
          return {symbol,label:labels[symbol]||symbol,price:a.price,change24h:a.change24h,regime:a.regime,side:a.side,type:a.type,status:a.status,score:a.score,bias:a.bias,probabilityLabel:a.probabilityLabel,structure:a.structure};
        }catch(e){return {symbol,label:labels[symbol]||symbol,error:e.message,status:'WAITING',side:'WAIT',score:0}}
      }));
      return send(res,200,{ok:true,interval,rows});
    }
    if(req.method==='GET'&&u.pathname==='/api/market'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{error:'Unsupported symbol'});
      const [candles,lower,higher]=await Promise.all([
        klines(symbol,interval),
        interval==='15m'?Promise.resolve(null):klines(symbol,'15m').catch(()=>null),
        interval==='4h'?Promise.resolve(null):klines(symbol,'4h').catch(()=>null)
      ]);
      const lowerA=lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null;
      const higherA=higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null;
      const deriv=await Promise.race([
        derivatives(symbol,interval),
        new Promise(resolve=>setTimeout(()=>resolve(null),1800))
      ]).catch(()=>null);
      let analysis=analyze(candles,{interval,higher:higherA,lower:lowerA,deriv});
      let learningResult=null;
      try{learningResult=await Promise.race([learning.process(symbol,interval,candles,analysis),new Promise(resolve=>setTimeout(()=>resolve(null),1500))])}catch{}
      if(learningResult?.analysis)analysis=learningResult.analysis;
      const learningStatus=await Promise.race([learning.status(),new Promise(resolve=>setTimeout(()=>resolve({phase:2,state:'COLLECTING',durable:storage.status().durable,resolved:0}),700))]).catch(()=>({phase:2,state:'COLLECTING',durable:storage.status().durable,resolved:0}));
      return send(res,200,{symbol,interval,candles,analysis,derivatives:deriv,learning:learningStatus,backtest:backtest(candles),validation:walkForwardBacktest(candles),setupStats:require("./market-engine").backtestBySetup(candles)});
    }
    if(req.method==='GET'&&u.pathname==='/api/cycle'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase();
      if(!SYMBOLS.includes(symbol))return send(res,400,{error:'Unsupported symbol'});
      const candles=await longDailyHistory(symbol,4200);
      return send(res,200,{symbol,interval:'1d',candles,updatedAt:Date.now(),source:candles?.[0]?.source||'binance'});
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
          let a=analyze(candles,{interval,higher:higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null,lower:lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null,deriv});
          a=(await learning.process(symbol,interval,candles,a)).analysis;
          return {symbol,label:labels[symbol]||symbol,derivatives:deriv,...a};
        }catch(e){return {symbol,label:labels[symbol]||symbol,error:e.message,type:"DATA ERROR",side:"WAIT",score:0,regime:"UNKNOWN"}}
      }));
      return send(res,200,{interval,rows,updatedAt:Date.now()});
    }
    return staticFile(req,res);
  }catch(e){return send(res,500,{error:e.message||'Server error'})}
});
storage.init().catch(()=>{});learning.init().catch(()=>{});
server.listen(PORT,()=>console.log('MarketPulse OS listening on :'+PORT));