const VERSION = "1.0.0";

const KRAKEN_SPOT_PAIRS = {
  BTCUSDT:"XBTUSD",
  ETHUSDT:"ETHUSD",
  SOLUSDT:"SOLUSD",
  BNBUSDT:"BNBUSD",
  XRPUSDT:"XRPUSD",
  DOGEUSDT:"DOGEUSD",
  ADAUSDT:"ADAUSD"
};

const COINBASE_PRODUCTS = {
  BTCUSDT:"BTC-USD",
  ETHUSDT:"ETH-USD",
  SOLUSDT:"SOL-USD",
  XRPUSDT:"XRP-USD",
  DOGEUSDT:"DOGE-USD",
  ADAUSDT:"ADA-USD"
};

function clamp(x,min,max){return Math.max(min,Math.min(max,x))}
function finite(x,fallback=null){const n=Number(x);return Number.isFinite(n)?n:fallback}

async function fetchJson(url,timeoutMs=3500){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetch(url,{signal:controller.signal,headers:{accept:"application/json","user-agent":"MarketPulse-DataFabric/1.0"}});
    const raw=await r.text();
    let body={};try{body=JSON.parse(raw)}catch{}
    if(!r.ok)throw new Error("HTTP "+r.status);
    return body;
  }finally{clearTimeout(timer)}
}

async function coinbaseSnapshot(symbol){
  const product=COINBASE_PRODUCTS[symbol];
  if(!product)throw new Error("Coinbase product unavailable");
  const started=Date.now();
  const u="https://api.exchange.coinbase.com/products/"+encodeURIComponent(product)+"/trades?limit=50";
  const rows=await fetchJson(u,3500);
  if(!Array.isArray(rows)||!rows.length)throw new Error("Coinbase returned no trades");
  const parsed=rows.map(x=>({price:Number(x.price),size:Number(x.size),time:Date.parse(x.time),side:String(x.side||"").toLowerCase()}))
    .filter(x=>Number.isFinite(x.price)&&Number.isFinite(x.size)&&x.size>0);
  if(!parsed.length)throw new Error("Coinbase returned unusable trades");
  const last=parsed[0];
  const vwap=parsed.reduce((s,x)=>s+x.price*x.size,0)/parsed.reduce((s,x)=>s+x.size,0);
  return {
    name:"Coinbase Spot",
    role:"spot-price-cross-check",
    status:"healthy",
    price:last.price,
    vwap,
    ageMs:Number.isFinite(last.time)?Math.max(0,Date.now()-last.time):null,
    latencyMs:Date.now()-started,
    tradeCount:parsed.length,
    endpoint:"coinbase-exchange-public"
  };
}

async function krakenSnapshot(symbol){
  const pair=KRAKEN_SPOT_PAIRS[symbol];
  if(!pair)throw new Error("Kraken pair unavailable");
  const started=Date.now();
  const u=new URL("https://api.kraken.com/0/public/Ticker");
  u.searchParams.set("pair",pair);
  const body=await fetchJson(u,3500);
  if(body?.error?.length)throw new Error(body.error.join(", "));
  const key=Object.keys(body.result||{})[0];
  const row=body.result?.[key];
  const price=Number(row?.c?.[0]);
  if(!Number.isFinite(price))throw new Error("Kraken returned no last price");
  return {
    name:"Kraken Spot",
    role:"spot-price-cross-check",
    status:"healthy",
    price,
    bid:finite(row?.b?.[0]),
    ask:finite(row?.a?.[0]),
    latencyMs:Date.now()-started,
    ageMs:0,
    endpoint:"kraken-public-rest"
  };
}

async function binanceSnapshot(symbol){
  const started=Date.now();
  const hosts=["https://api.binance.com","https://api-gcp.binance.com","https://api1.binance.com"];
  let lastError=null;
  for(const host of hosts){
    try{
      const u=new URL(host+"/api/v3/ticker/price");u.searchParams.set("symbol",symbol);
      const body=await fetchJson(u,2500);
      const price=Number(body?.price);
      if(!Number.isFinite(price))throw new Error("invalid price");
      return {name:"Binance Spot",role:"spot-price-cross-check",status:"healthy",price,latencyMs:Date.now()-started,ageMs:0,host};
    }catch(e){lastError=e}
  }
  return {name:"Binance Spot",role:"spot-price-cross-check",status:"restricted_or_unavailable",price:null,latencyMs:Date.now()-started,ageMs:null,error:String(lastError?.message||"unavailable")};
}

function summarizeSources(rows){
  const valid=rows.filter(x=>Number.isFinite(x.price));
  if(!valid.length)return {sources:rows,sourceCount:0,consensus:"NO_DATA",consensusQualityPct:0,priceDispersionBps:null,medianPrice:null,lowPrice:null,highPrice:null};
  const prices=valid.map(x=>x.price).sort((a,b)=>a-b);
  const median=prices[Math.floor(prices.length/2)];
  const low=prices[0],high=prices[prices.length-1];
  const dispersion=median>0?((high-low)/median)*10000:null;
  const sourceCount=valid.length;
  const independentSourceCount=valid.filter(x=>x.role==="spot-price-cross-check"||x.role==="derivatives-mark-cross-check").length;
  let consensus="SINGLE_SOURCE";
  let quality=independentSourceCount===0?45:independentSourceCount===1?72:88;
  if(independentSourceCount>=2){
    if(dispersion!==null&&dispersion<=15){consensus="CONFIRMED";quality=98}
    else if(dispersion!==null&&dispersion<=40){consensus="ALIGNED";quality=93}
    else if(dispersion!==null&&dispersion<=80){consensus="WATCH";quality=78}
    else {consensus="CONFLICT";quality=50}
  }
  return {
    sources:rows.map(x=>Object.assign({},x)),
    sourceCount,
    independentSourceCount,
    consensus,
    consensusQualityPct:clamp(quality,0,100),
    priceDispersionBps:dispersion,
    medianPrice:median,
    lowPrice:low,
    highPrice:high,
    disagreement:consensus==="CONFLICT"
  };
}

async function assess(symbol,interval="1h",context={}){
  const started=Date.now();
  const settled=await Promise.all([
    coinbaseSnapshot(symbol).catch(e=>({name:"Coinbase Spot",role:"spot-price-cross-check",status:"error",price:null,error:String(e.message||e)})),
    krakenSnapshot(symbol).catch(e=>({name:"Kraken Spot",role:"spot-price-cross-check",status:"error",price:null,error:String(e.message||e)})),
    binanceSnapshot(symbol)
  ]);
  const primaryPrice=finite(context.primaryPrice);
  const rows=settled.slice();
  if(Number.isFinite(primaryPrice))rows.unshift({name:"Primary Engine",role:"engine-candle",status:"healthy",price:primaryPrice,ageMs:finite(context.primaryAgeMs),source:context.primarySource||"engine"});
  const livePrice=finite(context.liveFlow?.markPrice);
  if(Number.isFinite(livePrice))rows.push({name:"Bybit WS Flow",role:"derivatives-mark-cross-check",status:"healthy",price:livePrice,ageMs:context.liveFlow?.lastTs?Math.max(0,Date.now()-Number(context.liveFlow.lastTs)):null,source:"bybit-public-websocket"});
  const summary=summarizeSources(rows);
  const usable=rows.filter(x=>Number.isFinite(x.price));
  const ages=usable.map(x=>finite(x.ageMs)).filter(Number.isFinite);
  const newestAge=ages.length?Math.min(...ages):null;
  return Object.assign({},summary,{
    symbol,interval,
    generatedAt:Date.now(),
    latencyMs:Date.now()-started,
    freshestAgeMs:newestAge,
    healthySources:rows.filter(x=>x.status==="healthy").length,
    restrictedSources:rows.filter(x=>x.status==="restricted_or_unavailable").length,
    errors:rows.filter(x=>x.error).map(x=>x.name+": "+x.error),
    method:"cross-exchange spot consensus; derivatives mark is supplemental",
    interpretation:summary.consensus==="CONFLICT"?"Price feeds materially disagree.":summary.consensus==="NO_DATA"?"No independent cross-check available.":"Independent price feeds are sufficiently aligned."
  });
}

module.exports={VERSION,KRAKEN_SPOT_PAIRS,COINBASE_PRODUCTS,coinbaseSnapshot,krakenSnapshot,binanceSnapshot,assess};
