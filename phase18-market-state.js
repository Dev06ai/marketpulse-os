/*
 * MarketPulse Phase 18 — Cross-Exchange Market State Engine
 * Public-data only. No credentials. Fail-soft and cache-heavy by design.
 *
 * Current venue primitives:
 * - Bybit linear ticker + orderbook
 * - Binance USD-M futures ticker/book + OI + funding
 * - Hyperliquid info: allMids/metaAndAssetCtxs/l2Book
 * - OKX swap ticker/book/open-interest/funding
 * - Coinbase spot ticker as an independent spot cross-check
 *
 * The engine never places orders and never changes live-trading flags.
 */

const VERSION="18.0.0";
const CACHE_TTL_MS=15000;
const HISTORY_LIMIT=180;
const HISTORY=new Map();
const SNAPSHOT_CACHE=new Map();
const INFLIGHT=new Map();
const LAST_GOOD=new Map();

function n(x,d=null){const v=Number(x);return Number.isFinite(v)?v:d}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function now(){return Date.now()}
function symbolOk(symbol){return ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","ADAUSDT"].includes(String(symbol||"").toUpperCase())}
function timeoutSignal(ms=3500){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);
  return {signal:c.signal,clear:()=>clearTimeout(t)};
}
async function fetchJson(url,{method="GET",body=null,timeout=3500,headers={}}={}){
  const x=timeoutSignal(timeout);
  try{
    const r=await fetch(url,{method,body,signal:x.signal,headers:{accept:"application/json","content-type":"application/json",...headers},cache:"no-store"});
    const raw=await r.text();let j={};try{j=JSON.parse(raw)}catch{}
    if(!r.ok)throw new Error("HTTP "+r.status);
    return j;
  }finally{x.clear()}
}
async function safe(name,fn){
  const started=now();
  try{
    const v=await fn();
    return {name,status:"healthy",latencyMs:now()-started,...v};
  }catch(e){
    return {name,status:"unavailable",latencyMs:now()-started,error:String(e?.message||e)};
  }
}
function bookMetrics(bids,asks,levels=20){
  const bb=Array.isArray(bids)?bids.slice(0,levels).map(x=>[n(x?.[0]),n(x?.[1])]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1])):[];
  const aa=Array.isArray(asks)?asks.slice(0,levels).map(x=>[n(x?.[0]),n(x?.[1])]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1])):[];
  const bidQty=bb.reduce((a,x)=>a+x[1],0),askQty=aa.reduce((a,x)=>a+x[1],0);
  const bestBid=bb[0]?.[0]??null,bestAsk=aa[0]?.[0]??null;
  const mid=Number.isFinite(bestBid)&&Number.isFinite(bestAsk)?(bestBid+bestAsk)/2:(bestBid??bestAsk??null);
  const spreadBps=Number.isFinite(mid)&&mid>0&&Number.isFinite(bestBid)&&Number.isFinite(bestAsk)?((bestAsk-bestBid)/mid)*10000:null;
  const imbalance=(bidQty+askQty)>0?(bidQty-askQty)/(bidQty+askQty):null;
  return {bestBid,bestAsk,mid,spreadBps,bidQty,askQty,imbalance,levels:Math.max(bb.length,aa.length)};
}
async function bybit(symbol){
  const t=await fetchJson("https://api.bybit.com/v5/market/tickers?category=linear&symbol="+encodeURIComponent(symbol),{timeout:2500});
  const q=t?.result?.list?.[0];if(!q)throw Error("Bybit ticker empty");
  const ob=await fetchJson("https://api.bybit.com/v5/market/orderbook?category=linear&symbol="+encodeURIComponent(symbol)+"&limit=50",{timeout:2500});
  const m=bookMetrics(ob?.result?.b,ob?.result?.a,20);
  return {
    exchange:"BYBIT",venueType:"perp",price:n(q.lastPrice),markPrice:n(q.markPrice),indexPrice:n(q.indexPrice),
    fundingRate:n(q.fundingRate),openInterest:n(q.openInterestValue??q.openInterest),
    change24hPct:n(q.price24hPcnt)?n(q.price24hPcnt)*100:null,
    ...m,sourceTs:n(ob?.time||q.ts)||now()
  };
}
async function binance(symbol){
  const [t,ob,oi,fr]=await Promise.all([
    fetchJson("https://fapi.binance.com/fapi/v1/ticker/24hr?symbol="+encodeURIComponent(symbol),{timeout:2500}),
    fetchJson("https://fapi.binance.com/fapi/v1/depth?symbol="+encodeURIComponent(symbol)+"&limit=50",{timeout:2500}),
    fetchJson("https://fapi.binance.com/fapi/v1/openInterest?symbol="+encodeURIComponent(symbol),{timeout:2500}),
    fetchJson("https://fapi.binance.com/fapi/v1/premiumIndex?symbol="+encodeURIComponent(symbol),{timeout:2500})
  ]);
  const m=bookMetrics(ob?.bids,ob?.asks,20);
  return {
    exchange:"BINANCE",venueType:"perp",price:n(t?.lastPrice),markPrice:n(fr?.markPrice),indexPrice:n(fr?.indexPrice),
    fundingRate:n(fr?.lastFundingRate),openInterest:n(oi?.openInterest),change24hPct:n(t?.priceChangePercent),
    ...m,sourceTs:n(ob?.lastUpdateId)?now():now()
  };
}
async function hyperliquid(symbol){
  const coin=symbol.replace("USDT","");
  const [mids,ctxs,book]=await Promise.all([
    fetchJson("https://api.hyperliquid.xyz/info",{method:"POST",body:JSON.stringify({type:"allMids"}),timeout:3000}),
    fetchJson("https://api.hyperliquid.xyz/info",{method:"POST",body:JSON.stringify({type:"metaAndAssetCtxs"}),timeout:3000}),
    fetchJson("https://api.hyperliquid.xyz/info",{method:"POST",body:JSON.stringify({type:"l2Book",coin}),timeout:3000})
  ]);
  const px=n(mids?.[coin]);
  const metas=ctxs?.[1]||[],universe=ctxs?.[0]?.universe||[];
  const idx=universe.findIndex(x=>x?.name===coin);
  const c=idx>=0?metas[idx]:null;
  const levels=book?.levels||[];
  const bids=levels[0]||[],asks=levels[1]||[];
  const m=bookMetrics(bids,asks,20);
  return {
    exchange:"HYPERLIQUID",venueType:"perp",price:px,markPrice:n(c?.markPx),indexPrice:n(c?.oraclePx),
    fundingRate:n(c?.funding),openInterest:n(c?.openInterest),
    change24hPct:null,...m,sourceTs:now()
  };
}
async function okx(symbol){
  const coin=symbol.replace("USDT","");
  const inst=coin+"-USDT-SWAP";
  const [t,ob,oi,fr]=await Promise.all([
    fetchJson("https://www.okx.com/api/v5/market/ticker?instId="+encodeURIComponent(inst),{timeout:2500}),
    fetchJson("https://www.okx.com/api/v5/market/books?instId="+encodeURIComponent(inst)+"&sz=50",{timeout:2500}),
    fetchJson("https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId="+encodeURIComponent(inst),{timeout:2500}),
    fetchJson("https://www.okx.com/api/v5/public/funding-rate?instId="+encodeURIComponent(inst),{timeout:2500})
  ]);
  const q=t?.data?.[0],m=bookMetrics(ob?.data?.[0]?.bids,ob?.data?.[0]?.asks,20);
  return {
    exchange:"OKX",venueType:"perp",price:n(q?.last),markPrice:n(q?.last),indexPrice:n(q?.idxPx),
    fundingRate:n(fr?.data?.[0]?.fundingRate),openInterest:n(oi?.data?.[0]?.oiCcy??oi?.data?.[0]?.oi),
    change24hPct:n(q?.sodUtc8)?null:null,...m,sourceTs:n(ob?.ts)||now()
  };
}
async function bitget(symbol){
  const q=await fetchJson("https://api.bitget.com/api/v3/market/orderbook?category=USDT-FUTURES&symbol="+encodeURIComponent(symbol)+"&limit=50",{timeout:2500});
  const m=bookMetrics(q?.data?.b,q?.data?.a,20);
  return {exchange:"BITGET",venueType:"perp",price:m.mid,markPrice:m.mid,indexPrice:null,fundingRate:null,openInterest:null,change24hPct:null,...m,sourceTs:n(q?.data?.ts)||now()};
}
async function gate(symbol){
  const contract=symbol.replace("USDT","_USDT");
  const q=await fetchJson("https://api.gateio.ws/api/v4/futures/usdt/order_book?contract="+encodeURIComponent(contract)+"&limit=50",{timeout:2500});
  const bids=(q?.bids||[]).map(x=>[x?.p,x?.s]),asks=(q?.asks||[]).map(x=>[x?.p,x?.s]);
  const m=bookMetrics(bids,asks,20);
  return {exchange:"GATE",venueType:"perp",price:m.mid,markPrice:m.mid,indexPrice:null,fundingRate:null,openInterest:null,change24hPct:null,...m,sourceTs:n(q?.current)||now()};
}
async function paradex(symbol){
  const market=symbol.replace("USDT","")+"-USD-PERP";
  const q=await fetchJson("https://api.prod.paradex.trade/v1/orderbook/"+encodeURIComponent(market)+"?depth=20",{timeout:3000});
  const m=bookMetrics(q?.bids,q?.asks,20);
  return {exchange:"PARADEX",venueType:"perp",price:m.mid,markPrice:m.mid,indexPrice:null,fundingRate:null,openInterest:null,change24hPct:null,...m,sourceTs:n(q?.last_updated_at)||now()};
}
async function coinbase(symbol){
  const coin=symbol.replace("USDT","");
  const product=coin+"-USD";
  const q=await fetchJson("https://api.exchange.coinbase.com/products/"+encodeURIComponent(product)+"/ticker",{timeout:2500});
  return {exchange:"COINBASE",venueType:"spot",price:n(q?.price),change24hPct:null,bestBid:n(q?.bid),bestAsk:n(q?.ask),mid:n(q?.price),spreadBps:null,imbalance:null,sourceTs:now()};
}
function recentHistory(symbol){
  const a=HISTORY.get(symbol)||[];
  return a.slice(-HISTORY_LIMIT);
}
function pushHistory(symbol,venues){
  const a=HISTORY.get(symbol)||[];
  a.push({ts:now(),venues});
  if(a.length>HISTORY_LIMIT)a.splice(0,a.length-HISTORY_LIMIT);
  HISTORY.set(symbol,a);
  return a;
}
function median(a){const x=a.filter(Number.isFinite).sort((p,q)=>p-q);return x.length?x[Math.floor(x.length/2)]:null}
function summarize(venues,history){
  const valid=venues.filter(v=>Number.isFinite(v.price));
  const perp=valid.filter(v=>v.venueType==="perp");
  const px=median(perp.map(v=>v.price));
  const dispersion=px?(((Math.max(...perp.map(v=>v.price))-Math.min(...perp.map(v=>v.price)))/px)*10000):null;
  const imbalances=perp.map(v=>v.imbalance).filter(Number.isFinite);
  const avgImb=imbalances.length?imbalances.reduce((a,b)=>a+b,0)/imbalances.length:null;
  const funds=perp.map(v=>v.fundingRate).filter(Number.isFinite);
  const avgFunding=funds.length?funds.reduce((a,b)=>a+b,0)/funds.length:null;
  const pricesByEx={};valid.forEach(v=>pricesByEx[v.exchange]=v.price);
  let leadCandidate=null;
  const prior=history.length>=2?history[history.length-2]:null;
  if(prior){
    const moves=[];
    for(const v of perp){
      const p0=prior.venues?.find(x=>x.exchange===v.exchange)?.price,p1=v.price;
      if(Number.isFinite(p0)&&Number.isFinite(p1)&&p0>0)moves.push({exchange:v.exchange,movePct:(p1-p0)/p0*100});
    }
    if(moves.length)leadCandidate=moves.sort((a,b)=>Math.abs(b.movePct)-Math.abs(a.movePct))[0];
  }
  const consensusQ=clamp(Math.round(50+(valid.length>=3?30:valid.length>=2?15:0)-(dispersion&&dispersion>20?20:0)),0,100);
  return {
    venueCount:valid.length,perpVenueCount:perp.length,spotVenueCount:valid.filter(v=>v.venueType==="spot").length,
    medianPerpPrice:px,dispersionBps:dispersion,avgOrderbookImbalance:avgImb,avgFundingRate:avgFunding,
    consensusQuality:consensusQ,leadCandidate,pricesByExchange:pricesByEx
  };
}
function classify(summary,venues){
  const imb=Number(summary.avgOrderbookImbalance),fund=Number(summary.avgFundingRate);
  const dispersion=Number(summary.dispersionBps);
  let state="BALANCED",bias="NEUTRAL";
  if(Number.isFinite(imb)&&imb>.12)bias="BUYERS";else if(Number.isFinite(imb)&&imb<-.12)bias="SELLERS";
  if(Number.isFinite(fund)&&fund>.0008)state="LONG_CROWDED";else if(Number.isFinite(fund)&&fund<-.0008)state="SHORT_CROWDED";
  if(Number.isFinite(dispersion)&&dispersion>25)state="VENUE_CONFLICT";
  if(bias==="SELLERS"&&state!=="LONG_CROWDED")state="SELLER_PRESSURE";
  if(bias==="BUYERS"&&state!=="SHORT_CROWDED")state="BUYER_PRESSURE";
  return {state,bias};
}
async function snapshot(symbol="BTCUSDT",opts={}){
  symbol=String(symbol).toUpperCase();
  if(!symbolOk(symbol))throw new Error("Unsupported symbol");
  const fast=Boolean(opts?.fast),key=symbol+"|"+(fast?"FAST":"FULL"),hit=SNAPSHOT_CACHE.get(key),ts=now();
  if(hit&&ts-hit.ts<CACHE_TTL_MS)return {...hit.payload,cache:"memory",cacheAgeMs:ts-hit.ts};
  if(INFLIGHT.has(key)){
    if(hit)return {...hit.payload,cache:"stale-inflight",stale:true,cacheAgeMs:ts-hit.ts};
    return await INFLIGHT.get(key);
  }
  const venuesFns=fast
    ?[
      ["Bybit",()=>bybit(symbol)],
      ["Binance",()=>binance(symbol)],
      ["Hyperliquid",()=>hyperliquid(symbol)],
      ["Coinbase",()=>coinbase(symbol)]
    ]
    :[
      ["Bybit",()=>bybit(symbol)],
      ["Binance",()=>binance(symbol)],
      ["Hyperliquid",()=>hyperliquid(symbol)],
      ["OKX",()=>okx(symbol)],
      ["Bitget",()=>bitget(symbol)],
      ["Gate",()=>gate(symbol)],
      ["Paradex",()=>paradex(symbol)],
      ["Coinbase",()=>coinbase(symbol)]
    ];
  const job=(async()=>{
    const results=await Promise.all(venuesFns.map(([name,fn])=>safe(name,fn)));
    const venues=results;

    // When exchange REST is restricted or unavailable, the existing public
    // Bybit websocket flow can still provide a fresh derivatives mark/book
    // observation. Treat it as a supplemental venue rather than declaring the
    // whole cross-venue layer empty.
    const lf=opts?.liveFlow||null;
    const livePrice=n(lf?.markPrice);
    const liveTs=n(lf?.lastTs);
    const liveFresh=Number.isFinite(livePrice)&&Number.isFinite(liveTs)&&now()-liveTs<45000;
    const hasHealthyBybit=venues.some(v=>v?.name==="Bybit"&&v.status==="healthy"&&Number.isFinite(v.price));
    if(liveFresh&&!hasHealthyBybit){
      const ob=lf?.orderBook||{};
      venues.push({
        name:"Bybit Live Flow",
        exchange:"BYBIT LIVE",
        status:"healthy",
        latencyMs:0,
        price:livePrice,
        markPrice:livePrice,
        venueType:"perp",
        role:"live-public-websocket",
        fundingRate:n(lf?.fundingRate),
        openInterest:n(lf?.oi),
        spreadBps:n(ob?.spreadBps),
        imbalance:n(ob?.imbalance),
        sourceTs:liveTs,
        source:"bybit-public-websocket"
      });
    }

    const history=recentHistory(symbol);
    const summary=summarize(venues,history);
    const regime=classify(summary,venues);
    const payload={
      ok:summary.venueCount>0,version:VERSION,symbol,generatedAt:now(),
      venues,summary,regime,history:history.slice(-20),
      method:fast
        ?"REST fast cross-exchange snapshot with live-public-websocket fallback."
        :"REST full cross-exchange snapshot with live-public-websocket fallback; streaming lead/lag is progressively learned from repeated samples"
    };
    pushHistory(symbol,venues);
    SNAPSHOT_CACHE.set(key,{ts:now(),payload});
    LAST_GOOD.set(key,{ts:now(),payload});
    return payload;
  })().finally(()=>INFLIGHT.delete(key));
  INFLIGHT.set(key,job);
  try{
    return await job;
  }catch(e){
    const last=LAST_GOOD.get(key);
    if(last)return {...last.payload,cache:"last-good",stale:true,cacheAgeMs:ts-last.ts};
    throw e;
  }
}
function health(snapshot){
  const s=snapshot?.summary||{};
  return {ok:Boolean(snapshot?.ok&&Number(s.venueCount)>=2),venueCount:Number(s.venueCount)||0,consensusQuality:Number(s.consensusQuality)||0,dispersionBps:s.dispersionBps,unavailable:(snapshot?.venues||[]).filter(v=>v.status!=="healthy").map(v=>v.name)};
}
function selfTest(){const b=bookMetrics([["100","2"]],[["101","1"]],20),h=health({ok:true,summary:{venueCount:2,consensusQuality:95,dispersionBps:5},venues:[{name:"Bybit",status:"healthy"}]});return {ok:b.bestBid===100&&b.bestAsk===101&&b.imbalance===1/3&&h.ok&&h.venueCount===2,version:VERSION};}
module.exports={VERSION,snapshot,health,bookMetrics};
