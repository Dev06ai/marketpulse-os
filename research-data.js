const VERSION = "1.0.0";

const CATALOG = [
  {
    id: "binance-public-data",
    name: "Binance Public Data",
    kind: "public-market-data",
    url: "https://github.com/binance/binance-public-data",
    coverage: "Spot and futures historical files including klines, trades and aggregate trades.",
    role: "Historical replay / model warm-up.",
    caveat: "Public availability does not by itself grant unrestricted commercial redistribution rights; verify the current Binance data terms before using it in a commercial product."
  },
  {
    id: "ccxt",
    name: "CCXT",
    kind: "open-source-library",
    url: "https://github.com/ccxt/ccxt",
    coverage: "Normalized REST market-data and trading interfaces across many exchanges.",
    role: "Connector/failover layer for public market-data polling.",
    caveat: "Exchange-specific feature coverage and rate limits still apply."
  },
  {
    id: "hummingbot",
    name: "Hummingbot",
    kind: "open-source-library",
    url: "https://github.com/hummingbot/hummingbot",
    coverage: "Exchange connectors and market-data/execution architecture.",
    role: "Connector/reference architecture for future multi-exchange adapters.",
    caveat: "Its strategy/execution framework should not be copied into MarketPulse blindly; MarketPulse keeps execution gated."
  }
];

function asNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function validInterval(interval) {
  return new Set(["1m","3m","5m","15m","30m","1h","2h","4h","6h","8h","12h","1d","3d","1w","1M"]).has(interval);
}

function makeAbort(timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timer };
}

async function fetchJson(url, timeoutMs = 6000) {
  const {controller, timer} = makeAbort(timeoutMs);
  try {
    const r = await fetch(url, {signal: controller.signal, headers: {accept:"application/json","user-agent":"MarketPulse-Research/1.0"}});
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchKrakenKlines(symbol, interval = "1h", options = {}) {
  if (!new Set(["15m","1h","4h","1d"]).has(interval)) throw new Error("Unsupported Kraken interval");
  const map={BTCUSDT:"XBTUSD",ETHUSDT:"ETHUSD",SOLUSDT:"SOLUSD",BNBUSDT:"BNBUSD",XRPUSDT:"XRPUSD",DOGEUSDT:"DOGEUSD",ADAUSDT:"ADAUSD"};
  const pair=map[String(symbol).toUpperCase()];
  if(!pair)throw new Error("Unsupported Kraken symbol");
  const limit=Math.max(1,Math.min(720,Number(options.maxBars||720)));
  const minsByInterval={"15m":15,"1h":60,"4h":240,"1d":1440};
  const mins=minsByInterval[interval];
  const u=new URL("https://api.kraken.com/0/public/OHLC");
  u.searchParams.set("pair",pair);u.searchParams.set("interval",String(mins));
  const body=await fetchJson(u,6000);
  if(body?.error?.length)throw new Error(body.error.join(", "));
  const key=Object.keys(body.result||{}).find(k=>k!=="last");
  if(!key)throw new Error("Kraken returned no OHLC data");
  return (body.result[key]||[]).slice(-limit).map(x=>({
    t:Number(x[0])*1000,o:Number(x[1]),h:Number(x[2]),l:Number(x[3]),c:Number(x[4]),v:Number(x[6]),source:"kraken-public-rest"
  }));
}

async function fetchBinanceKlines(symbol, interval = "1h", options = {}) {
  if (!validInterval(interval)) throw new Error("Unsupported interval");
  const limit = Math.max(1, Math.min(1000, Number(options.limit || 1000)));
  const maxBars = Math.max(1, Math.min(20000, Number(options.maxBars || 5000)));
  const bases = ["https://api.binance.com","https://api-gcp.binance.com","https://api1.binance.com"];
  let endTime = Number.isFinite(Number(options.endTime)) ? Number(options.endTime) : Date.now();
  const all = [];
  let lastError = null;

  while (all.length < maxBars) {
    let rows = null;
    for (const base of bases) {
      try {
        const u = new URL(base + "/api/v3/klines");
        u.searchParams.set("symbol", String(symbol).toUpperCase());
        u.searchParams.set("interval", interval);
        u.searchParams.set("limit", String(Math.min(limit, maxBars - all.length)));
        u.searchParams.set("endTime", String(endTime));
        rows = await fetchJson(u, 6000);
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (!Array.isArray(rows) || !rows.length) break;
    for (const x of rows) {
      all.unshift({t:Number(x[0]),o:Number(x[1]),h:Number(x[2]),l:Number(x[3]),c:Number(x[4]),v:Number(x[5]),source:"binance-public-rest"});
    }
    const oldest = Number(rows[0]?.[0]);
    if (!Number.isFinite(oldest) || rows.length < limit) break;
    endTime = oldest - 1;
  }

  const unique = [];
  const seen = new Set();
  for (const row of all.sort((a,b)=>a.t-b.t)) {
    if (seen.has(row.t)) continue;
    seen.add(row.t); unique.push(row);
  }
  if (!unique.length && lastError) throw lastError;
  return unique.slice(-maxBars);
}

async function fetchBinanceFuturesKlines(symbol, interval = "1h", options = {}) {
  if (!validInterval(interval)) throw new Error("Unsupported interval");
  const limit = Math.max(1, Math.min(1000, Number(options.limit || 1000)));
  const maxBars = Math.max(1, Math.min(20000, Number(options.maxBars || 5000)));
  const bases = ["https://fapi.binance.com","https://fapi1.binance.com","https://fapi2.binance.com"];
  let endTime = Number.isFinite(Number(options.endTime)) ? Number(options.endTime) : Date.now();
  const all = [];
  let lastError = null;
  while (all.length < maxBars) {
    let rows = null;
    for (const base of bases) {
      try {
        const u = new URL(base + "/fapi/v1/klines");
        u.searchParams.set("symbol", String(symbol).toUpperCase());
        u.searchParams.set("interval", interval);
        u.searchParams.set("limit", String(Math.min(limit, maxBars - all.length)));
        u.searchParams.set("endTime", String(endTime));
        rows = await fetchJson(u, 6000);
        break;
      } catch (e) { lastError = e; }
    }
    if (!Array.isArray(rows) || !rows.length) break;
    for (const x of rows) {
      const quoteVolume = Number(x[7]);
      const takerBuyQuote = Number(x[10]);
      const cvdDelta = Number.isFinite(quoteVolume) && Number.isFinite(takerBuyQuote) ? (2*takerBuyQuote - quoteVolume) : null;
      all.unshift({
        t:Number(x[0]),o:Number(x[1]),h:Number(x[2]),l:Number(x[3]),c:Number(x[4]),
        v:Number(x[5]),quoteVolume,takerBuyQuote,cvdDelta,
        cvdRatio:Number.isFinite(quoteVolume)&&quoteVolume>0?cvdDelta/quoteVolume:null,
        source:"binance-futures-public-rest"
      });
    }
    const oldest = Number(rows[0]?.[0]);
    if (!Number.isFinite(oldest) || rows.length < limit) break;
    endTime = oldest - 1;
  }
  const unique=[];const seen=new Set();
  for(const row of all.sort((a,b)=>a.t-b.t)){if(seen.has(row.t))continue;seen.add(row.t);unique.push(row)}
  if(!unique.length && lastError) throw lastError;
  return unique.slice(-maxBars);
}

async function fetchBinanceOpenInterestHist(symbol, period = "1h", options = {}) {
  const limit = Math.max(1, Math.min(500, Number(options.limit || 500)));
  const maxBars = Math.max(1, Math.min(5000, Number(options.maxBars || 5000)));
  const bases = ["https://fapi.binance.com"];
  let endTime = Number.isFinite(Number(options.endTime)) ? Number(options.endTime) : Date.now();
  const all=[]; let lastError=null;
  while(all.length<maxBars){
    let rows=null;
    for(const base of bases){
      try{
        const u=new URL(base+"/futures/data/openInterestHist");
        u.searchParams.set("symbol",String(symbol).toUpperCase());
        u.searchParams.set("period",period);
        u.searchParams.set("limit",String(Math.min(limit,maxBars-all.length)));
        u.searchParams.set("endTime",String(endTime));
        rows=await fetchJson(u,6000);break;
      }catch(e){lastError=e}
    }
    if(!Array.isArray(rows)||!rows.length)break;
    for(const x of rows){
      all.unshift({
        t:Number(x.timestamp),
        oi:Number(x.sumOpenInterest),
        oiValue:Number(x.sumOpenInterestValue),
        source:"binance-futures-open-interest"
      });
    }
    const oldest=Number(rows[0]?.timestamp);
    if(!Number.isFinite(oldest)||rows.length<limit)break;
    endTime=oldest-1;
  }
  const unique=[];const seen=new Set();
  for(const row of all.sort((a,b)=>a.t-b.t)){if(seen.has(row.t))continue;seen.add(row.t);unique.push(row)}
  if(!unique.length&&lastError)throw lastError;
  return unique.slice(-maxBars);
}

function alignDerivativeSnapshot(candle, oiMap, previousOi) {
  const cvd=Number(candle?.cvdDelta), ratio=Number(candle?.cvdRatio);
  const oi=Number(oiMap?.oi);
  const oiChange=Number.isFinite(oi)&&Number.isFinite(previousOi)&&previousOi>0 ? ((oi-previousOi)/previousOi)*100 : null;
  const cvdState=Number.isFinite(ratio) ? (ratio>0.01?"BUYERS PRESSURE":ratio<-0.01?"SELLERS PRESSURE":"BALANCED") : "UNAVAILABLE";
  const positioning=Number.isFinite(oiChange) ? (oiChange>1?"OI RISING":oiChange<-1?"OI FALLING":"OI FLAT") : "OI CHANGE NOT AVAILABLE";
  return {
    available:Number.isFinite(cvd)||Number.isFinite(oi),
    provider:"Binance futures historical proxy",
    oi:Number.isFinite(oi)?oi:null,
    oiChangePct:Number.isFinite(oiChange)?oiChange:null,
    cvdDelta:Number.isFinite(cvd)?cvd:null,
    cvdRatio:Number.isFinite(ratio)?ratio:null,
    cvdState,
    positioning,
    takerImbalance:Number.isFinite(ratio)?ratio:null,
    liquidationTotal:null,
    liquidationBias:"UNAVAILABLE",
    updatedAt:Number(candle?.t)||Date.now(),
    historicalProxy:true
  };
}

function replayOutcome(candles, index, side, horizonBars = 12, stop, target, rr) {
  const entry = Number(candles[index]?.c);
  if (!Number.isFinite(entry) || index >= candles.length - 1) return null;
  const look = candles.slice(index + 1, Math.min(candles.length, index + 1 + horizonBars));
  if (!look.length || !Number.isFinite(stop) || !Number.isFinite(target)) return null;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return null;
  const reward = Math.abs(target - entry);
  const realizedRR = Number.isFinite(rr) ? rr : reward / risk;
  const long = side === "LONG";
  for (const x of look) {
    const hitStop = long ? x.l <= stop : x.h >= stop;
    const hitTarget = long ? x.h >= target : x.l <= target;
    if (hitStop && hitTarget) return {status:"AMBIGUOUS", r:0};
    if (hitTarget) return {status:"TARGET_1", r:realizedRR};
    if (hitStop) return {status:"STOP", r:-1};
  }
  return {status:"TIMEOUT", r:0};
}

async function buildReplayRecords({symbol, interval="1h", bars=5000, analyze, minScore=55, horizonBars=12, onProgress=null} = {}) {
  if (typeof analyze !== "function") throw new Error("analyze function is required");
  let candles = [];
  let spotSource = "binance-public-rest";
  try {
    candles = await fetchBinanceKlines(symbol, interval, {maxBars: bars});
  } catch {
    candles = await fetchKrakenKlines(symbol, interval, {maxBars: bars});
    spotSource = "kraken-public-rest";
  }
  let futures = [];
  try { futures = await fetchBinanceFuturesKlines(symbol, interval, {maxBars: candles.length}); } catch {}
  let oiRows = [];
  try { oiRows = await fetchBinanceOpenInterestHist(symbol, interval, {maxBars: Math.min(candles.length, 5000)}); } catch {}
  const futMap = new Map(futures.map(x=>[x.t,x]));
  const oiMap = new Map(oiRows.map(x=>[x.t,x]));
  const records = [];
  const start = 220;
  const total = Math.max(0, candles.length - horizonBars - start - 1);
  for (let i=start; i<candles.length-horizonBars-1; i++) {
    const window = candles.slice(0, i+1);
    const currentFut=futMap.get(candles[i].t);
    let previousOi=null;
    for(let j=i-1;j>=0&&j>i-10;j--){
      const prev=oiMap.get(candles[j].t);
      if(prev&&Number.isFinite(Number(prev.oi))){previousOi=Number(prev.oi);break;}
    }
    const deriv=alignDerivativeSnapshot(currentFut,oiMap.get(candles[i].t),previousOi);
    const a = analyze(window, {interval, deriv});
    if (a && ["LONG","SHORT"].includes(a.side) && Number(a.score) >= minScore) {
      const outcome = replayOutcome(candles, i, a.side, horizonBars, Number(a.stop), Number(a.tp1), Number(a.rr));
      if (outcome && outcome.status !== "TIMEOUT" && outcome.status !== "AMBIGUOUS") {
        records.push({
      signalKey: [symbol, interval, candles[i].t, a.side, a.score].join("|"),
      symbol,
      interval,
      candleTs: candles[i].t,
      side: a.side,
      type: a.type,
      regime: a.regime,
      score: a.score,
      outcome,
        snapshot: a
        });
      }
    }
    if (typeof onProgress === "function" && ((i-start) % 50 === 0 || i === candles.length-horizonBars-2)) {
      await onProgress({processed:i-start+1,total,records:records.length,pct:total?Math.round((i-start+1)/total*100):100});
    }
    if ((i-start) % 50 === 0) await new Promise(resolve => setImmediate(resolve));
  }
  return {symbol, interval, bars: candles.length, records, generatedAt: Date.now(), source:spotSource+" + historical futures flow where available"};
}

module.exports = {VERSION, CATALOG, fetchBinanceKlines, fetchKrakenKlines, fetchBinanceFuturesKlines, fetchBinanceOpenInterestHist, buildReplayRecords};
