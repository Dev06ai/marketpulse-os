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
  const candles = await fetchBinanceKlines(symbol, interval, {maxBars: bars});
  const records = [];
  const start = 220;
  const total = Math.max(0, candles.length - horizonBars - start - 1);
  for (let i=start; i<candles.length-horizonBars-1; i++) {
    const window = candles.slice(0, i+1);
    const a = analyze(window, {interval});
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
    if (typeof onProgress === "function" && ((i-start) % 50 === 0 || i === candles.length-horizonBars-2)) {
      await onProgress({processed:i-start+1,total,records:records.length,pct:total?Math.round((i-start+1)/total*100):100});
    }
    if ((i-start) % 50 === 0) await new Promise(resolve => setImmediate(resolve));
  }
  return {symbol, interval, bars: candles.length, records, generatedAt: Date.now(), source:"Binance public historical klines"};
}

module.exports = {VERSION, CATALOG, fetchBinanceKlines, buildReplayRecords};
