const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),{analyze,backtest,backtestBySetup,walkForwardBacktest}=require('./market-engine');
const storage=require('./storage');
const learning=require('./learning');
const phase4=require('./phase4');
const execution=require('./execution');
const phase6=require('./phase6');
const phase7=require('./phase7');
const phase910=require('./phase9-10');
const phase1113=require('./phase11-13');
const propFirm=require('./prop-firm');
const research=require('./research-data');
const dataFabric=require('./data-fabric');
const auth=require('./auth');
const WebSocket=require('ws');
const PORT=Number(process.env.PORT||3000);
const SYMBOLS=(process.env.SYMBOLS||'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT').split(',').map(s=>s.trim()).filter(Boolean);
const KLINE_LIMIT=Number(process.env.KLINE_LIMIT||420);
const labels={BTCUSDT:'BTC',ETHUSDT:'ETH',SOLUSDT:'SOL',BNBUSDT:'BNB',XRPUSDT:'XRP',DOGEUSDT:'DOGE',ADAUSDT:'ADA'};
const KRAKEN_PAIRS={BTCUSDT:'XBTUSD',ETHUSDT:'ETHUSD',SOLUSDT:'SOLUSD',BNBUSDT:'BNBUSD',XRPUSDT:'XRPUSD',DOGEUSDT:'DOGEUSD',ADAUSDT:'ADAUSD'};
const CACHE=new Map(); const TTL=45000;
const SCAN_CACHE=new Map(); const SCAN_TTL=20000;
const CORE_ANALYTICS_CACHE=new Map();
const CORE_ANALYTICS_JOBS=new Set();
const CORE_ANALYTICS_TTL=120000;
const PHASE2_VERSION=2; const PHASE3_VERSION=3; const PHASE4_VERSION=4; const PHASE5_VERSION=5; const PHASE6_VERSION=6; const PHASE7_VERSION=7; const PHASE7_DATA_VERSION=2;
const PHASE9_VERSION=9; const PHASE10_VERSION=10; const PHASE11_VERSION=11; const PHASE12_VERSION=12; const PHASE13_VERSION=13;
const DECISION_CACHE=new Map(); const DECISION_TTL=4000; const DECISION_LAST_GOOD=new Map();
const SIGNAL_STABILITY=new Map();
const SIGNAL_CONFIRMATIONS_REQUIRED=2;
const SIGNAL_RELEASE_MISSES=2;

function signalStabilityKey(symbol,interval){return String(symbol)+"|"+String(interval)}
function hardSignalBlock(decision){
  const state=String(decision?.state||"").toUpperCase();
  const gate=String(decision?.deploymentGate?.state||"").toUpperCase();
  const reason=String(decision?.reason||"").toLowerCase();
  return Boolean(
    decision?.stale ||
    state==="DATA_BLOCKED" ||
    state==="RISK_BLOCKED" ||
    gate==="BLOCKED" ||
    reason.includes("data quality") ||
    reason.includes("risk gate") ||
    reason.includes("stale")
  );
}
function applySignalStability(decision,symbol,interval){
  const d=decision||{}, key=signalStabilityKey(symbol,interval), now=Date.now();
  const candidate=["LONG","SHORT"].includes(String(d?.action||"").toUpperCase()) ? String(d.action).toUpperCase() : null;
  const eligible=Boolean(d?.liveSignalEligible&&candidate);
  const row=SIGNAL_STABILITY.get(key)||{side:null,confirmations:0,misses:0,confirmed:false,lastTs:0};

  if(eligible){
    if(row.side===candidate){
      row.confirmations=Math.min(SIGNAL_CONFIRMATIONS_REQUIRED,row.confirmations+1);
    }else{
      row.side=candidate; row.confirmations=1; row.misses=0; row.confirmed=false;
    }
    row.lastTs=now;
    if(row.confirmations>=SIGNAL_CONFIRMATIONS_REQUIRED)row.confirmed=true;
    SIGNAL_STABILITY.set(key,row);

    if(row.confirmed){
      return {...d,signalStability:{state:"CONFIRMED",side:candidate,confirmations:row.confirmations,required:SIGNAL_CONFIRMATIONS_REQUIRED,misses:0},
        rawAction:d.rawAction||candidate};
    }

    const confirmingReason="Directional setup detected, but it must persist across "+SIGNAL_CONFIRMATIONS_REQUIRED+" live refreshes before becoming a confirmed signal.";
    return {
      ...d,
      rawAction:d.rawAction||candidate,
      action:"WAIT",
      state:"NO_TRADE",
      liveSignalEligible:false,
      market:{...(d.market||{}),side:"WAIT",status:"WAITING",type:"CONFIRMING SETUP",bias:"Neutral",directionalLean:"NEUTRAL"},
      levels:{...(d.levels||{}),entryLow:null,entryHigh:null,entry:null,stop:null,tp1:null,tp2:null,rr:null},
      deploymentGate:{...(d.deploymentGate||{}),state:"CONFIRMING",reason:confirmingReason},
      operational:{...(d.operational||{}),liveUse:"PAPER_ONLY"},
      signalStability:{state:"CONFIRMING",side:candidate,confirmations:row.confirmations,required:SIGNAL_CONFIRMATIONS_REQUIRED,misses:0}
    };
  }

  if(!row.confirmed){
    SIGNAL_STABILITY.delete(key);
    return {...d,signalStability:{state:"NONE",side:null,confirmations:0,required:SIGNAL_CONFIRMATIONS_REQUIRED,misses:0}};
  }

  if(hardSignalBlock(d)){
    SIGNAL_STABILITY.delete(key);
    return {...d,action:"WAIT",state:"NO_TRADE",liveSignalEligible:false,
      market:{...(d.market||{}),side:"WAIT",status:"WAITING",type:"NO TRADE",bias:"Neutral",directionalLean:"NEUTRAL"},
      levels:{...(d.levels||{}),entryLow:null,entryHigh:null,entry:null,stop:null,tp1:null,tp2:null,rr:null},
      deploymentGate:{...(d.deploymentGate||{}),state:"BLOCKED"},
      signalStability:{state:"RELEASED",side:row.side,confirmations:row.confirmations,required:SIGNAL_CONFIRMATIONS_REQUIRED,misses:SIGNAL_RELEASE_MISSES}};
  }

  if(row.side===String(d?.rawAction||"").toUpperCase() || row.side===String(d?.market?.side||"").toUpperCase()){
    row.misses+=1; row.lastTs=now;
    if(row.misses<SIGNAL_RELEASE_MISSES){
      SIGNAL_STABILITY.set(key,row);
      return {...d,action:row.side,state:"READY",liveSignalEligible:true,
        market:{...(d.market||{}),side:row.side},
        signalStability:{state:"HOLDING",side:row.side,confirmations:row.confirmations,required:SIGNAL_CONFIRMATIONS_REQUIRED,misses:row.misses,releaseAfter:SIGNAL_RELEASE_MISSES}};
    }
  }

  SIGNAL_STABILITY.delete(key);
  return {...d,action:"WAIT",state:"NO_TRADE",liveSignalEligible:false,
    market:{...(d.market||{}),side:"WAIT",status:"WAITING",type:"NO TRADE",bias:"Neutral",directionalLean:"NEUTRAL"},
    levels:{...(d.levels||{}),entryLow:null,entryHigh:null,entry:null,stop:null,tp1:null,tp2:null,rr:null},
    deploymentGate:{...(d.deploymentGate||{}),state:"PAPER_ONLY"},
    signalStability:{state:"RELEASED",side:row.side,confirmations:row.confirmations,required:SIGNAL_CONFIRMATIONS_REQUIRED,misses:SIGNAL_RELEASE_MISSES}};
}
const PHASE1113_CACHE=new Map(); const PHASE1113_JOBS=new Set(); const PHASE1113_TTL=10*60*1000;
const OPENAI_API_KEY=process.env.OPENAI_API_KEY||"";
const OPENAI_MODEL=process.env.OPENAI_MODEL||"gpt-5.6-luna";
const AI_LIMIT_MS=8000; const AI_CALLS=new Map();
const DATA_TIMEOUT_MS=7000;
const GLOBAL_RATE_WINDOW_MS=5*60*1000;
const GLOBAL_RATE_LIMIT=300;
const GLOBAL_RATE=new Map();
const FAST_PUBLIC_PATHS=new Set(["/api/core","/api/chart","/api/fast-ticker","/api/core-enrichment","/api/core-analytics","/api/decision","/api/validation","/api/data-fabric","/api/config","/health","/"]);
const FAST_TICKER_CACHE=new Map();
const CSRF_COOKIE="mp_csrf";
const SERVER_METRICS={startedAt:Date.now(),requests:0,errors:0,totalLatencyMs:0,routeCounts:new Map(),lastErrors:[]};
let RESEARCH_JOB={running:false,startedAt:null,finishedAt:null,error:null,symbol:null,interval:null,bars:0,records:0,trained:0,skipped:0,progress:{processed:0,total:0,pct:0}};
async function runResearchWarmup(){
  if(RESEARCH_JOB.running)return {skipped:true,reason:"job_running"};
  const enabled=String(process.env.RESEARCH_WARMUP_ENABLED??"true").toLowerCase()!=="false";
  if(!enabled)return {skipped:true,reason:"disabled"};
  try{
    const st=await Promise.race([learning.status(),new Promise(resolve=>setTimeout(()=>resolve(null),5000))]);
    const updates=Number(st?.model?.updates)||0;
    if(updates>=150)return {skipped:true,reason:"already_warmed",updates};
  }catch{}
  const symbols=String(process.env.RESEARCH_WARMUP_SYMBOLS||"BTCUSDT,ETHUSDT").split(",").map(s=>s.trim().toUpperCase()).filter(s=>SYMBOLS.includes(s));
  const bars=Math.max(600,Math.min(3000,Number(process.env.RESEARCH_WARMUP_BARS||1500)));
  for(const symbol of symbols){
    if(RESEARCH_JOB.running)return {skipped:true,reason:"job_running"};
    RESEARCH_JOB={running:true,startedAt:Date.now(),finishedAt:null,error:null,symbol,interval:"1h",bars,records:0,trained:0,skipped:0,mode:"automatic",progress:{processed:0,total:0,pct:0}};
    try{
      const built=await research.buildReplayRecords({symbol,interval:"1h",bars,analyze,onProgress:async function(progress){RESEARCH_JOB.progress=progress}});
      RESEARCH_JOB.records=built.records.length;
      RESEARCH_JOB.progress={processed:built.bars,total:built.bars,pct:100};
      const trained=await learning.trainFromReplay(built.records);
      RESEARCH_JOB.trained=trained.trained;RESEARCH_JOB.skipped=trained.skipped;
      RESEARCH_JOB.running=false;RESEARCH_JOB.finishedAt=Date.now();
    }catch(e){
      RESEARCH_JOB.running=false;RESEARCH_JOB.finishedAt=Date.now();RESEARCH_JOB.error=String(e.message||e);
    }
  }
  return {ok:true};
}
let ADMIN_RUNTIME={loadedAt:0,config:null};
async function getAdminRuntime(force=false){
  if(!force&&ADMIN_RUNTIME.config&&Date.now()-ADMIN_RUNTIME.loadedAt<2000)return ADMIN_RUNTIME.config;
  try{ADMIN_RUNTIME.config=await storage.getAdminConfig();ADMIN_RUNTIME.loadedAt=Date.now();return ADMIN_RUNTIME.config}catch{return ADMIN_RUNTIME.config||{mode:"normal",maintenanceMode:false,readOnlyMode:false,registrationsEnabled:true,aiEnabled:true,executionEnabled:true,marketDataEnabled:true,writesEnabled:true,maintenanceMessage:"MarketPulse is temporarily unavailable."}}
}
async function setAdminRuntime(payload){ADMIN_RUNTIME.config=payload;ADMIN_RUNTIME.loadedAt=Date.now();return payload}
function featureEnabled(flags,key){return Boolean(flags?.[key]?.enabled!==false&&Number(flags?.[key]?.rolloutPct??100)>0)}
async function auditAdmin(req,action,category,targetUserId,metadata){
  try{const u=await auth.userFromRequest(req);if(u?.isAdmin)await storage.recordAdminAudit(u.email,action,category,targetUserId,metadata||{})}catch{}
}
async function securityEvent(severity,eventType,email,metadata){try{await storage.recordSecurityEvent(severity,eventType,email,metadata||{})}catch{}}

function clientIp(req){return String(req.headers["x-forwarded-for"]||"").split(",")[0].trim()||String(req.socket?.remoteAddress||"unknown")}
function rateRequest(req){
  const key=clientIp(req),now=Date.now(),x=GLOBAL_RATE.get(key);
  if(!x||now-x.started>GLOBAL_RATE_WINDOW_MS){GLOBAL_RATE.set(key,{started:now,count:1});return true}
  x.count++;return x.count<=GLOBAL_RATE_LIMIT;
}
function originAllowed(req){
  const origin=req.headers.origin;
  if(!origin)return true;
  const proto=String(req.headers["x-forwarded-proto"]||"http").split(",")[0].trim();
  const host=String(req.headers.host||"");
  return origin===proto+"://"+host;
}
function csrfCookie(){
  const secure=String(process.env.NODE_ENV||"").toLowerCase()==="production"?" Secure;":"";
  return CSRF_COOKIE+"="+crypto.randomBytes(32).toString("hex")+"; Path=/; SameSite=Strict; Max-Age=86400;"+secure;
}
const ADMIN_ONLY_PREFIXES=['/api/admin'];
const LIVE_VISITORS=new Map();
function markLiveVisitor(device,registered){
  const id=String(device||"").slice(0,128);
  if(!id)return;
  LIVE_VISITORS.set(id,{lastSeen:Date.now(),registered:Boolean(registered)});
}
function liveVisitorStats(){
  const cutoff=Date.now()-120000;
  let visitors=0,registered=0;
  for(const [id,row] of LIVE_VISITORS){if(row.lastSeen<cutoff){LIVE_VISITORS.delete(id);continue}visitors++;if(row.registered)registered++}
  return {liveVisitors:visitors,liveRegistered:registered};
}

const ADMIN_ONLY_PATHS=new Set([
  '/api/memory/status',
  '/api/phase7/health',
  '/api/learning/status',
  '/api/edge/health',
  '/api/edge/events',
  '/api/edge/config',
  '/api/edge/journal',
  '/api/execution',
  '/api/execution/config',
  '/api/execution/arm',
  '/api/execution/kill',
  '/api/execution/reconcile',
  '/api/execution/prepare',
  '/api/execution/intent',
  '/api/execution/submit',
  '/api/execution/cancel',
  '/api/execution/close-sim',
  '/api/portfolio/config',
  '/api/portfolio/health',
  '/api/system-check',
  '/api/dna/clear',
  '/api/research/status',
  '/api/research/train'
]);
function normalizeFundingRate(value){
  const n=Number(value);
  if(!Number.isFinite(n))return null;
  if(Math.abs(n)>0.1)return n/100;
  return n;
}
function timeoutSignal(ms){return typeof AbortSignal!=="undefined"&&AbortSignal.timeout?AbortSignal.timeout(ms):undefined;}
function queueCoreAnalytics(symbol,interval,candles){
  const key=String(symbol)+"|"+String(interval),hit=CORE_ANALYTICS_CACHE.get(key);
  if(hit&&Date.now()-hit.ts<CORE_ANALYTICS_TTL)return hit.payload;
  if(CORE_ANALYTICS_JOBS.has(key))return hit?.payload||null;
  CORE_ANALYTICS_JOBS.add(key);
  const sample=(candles||[]).slice(-600);
  setTimeout(()=>{
    (async()=>{
      try{
        if(sample.length<240)return;
        const payload={
          backtest:backtest(sample),
          validation:walkForwardBacktest(sample),
          setupStats:backtestBySetup(sample)
        };
        CORE_ANALYTICS_CACHE.set(key,{ts:Date.now(),payload});
      }catch{}finally{CORE_ANALYTICS_JOBS.delete(key)}
    })();
  },1500);
  return hit?.payload||null;
}

function queuePhase1113Validation(symbol,interval,candles){
  const key="P11-13|"+String(symbol)+"|"+String(interval),now=Date.now(),hit=PHASE1113_CACHE.get(key);
  if(hit&&now-hit.ts<PHASE1113_TTL)return hit.payload;
  if(PHASE1113_JOBS.has(key))return hit?.payload||null;
  const fallback=(candles||[]).slice(-900);
  if(fallback.length<260)return hit?.payload||null;
  PHASE1113_JOBS.add(key);
  setTimeout(async()=>{
    try{
      let source=fallback;
      try{
        const historical=await research.fetchBinanceKlines(symbol,interval,{maxBars:1800});
        const closed=closedCandles(historical,interval,Date.now());
        if(closed.length>=600)source=closed;
      }catch{}
      const sample=source.slice(-1500);
      let higher8h=null;
      if(String(interval).toLowerCase()==="15m"){
        try{
          const h=await research.fetchBinanceKlines(symbol,"8h",{maxBars:1800});
          higher8h=closedCandles(h,"8h",Date.now());
        }catch{}
      }
      const validation=phase1113.runWalkForward(sample,{symbol,interval,higher8h,basePolicy:{minScore:78,minRR:1.5},step:2,maxSamples:350,minTrades:80,minTestBars:300});
      PHASE1113_CACHE.set(key,{ts:Date.now(),payload:validation});
      try{
        const state=await storage.getLearningState();
        const payload=state?.payload&&typeof state.payload==="object"?state.payload:{};
        await storage.saveLearningState({...payload,phase11_13:{...validation,storedAt:Date.now()}});
      }catch{}
    }catch{}finally{PHASE1113_JOBS.delete(key)}
  },100);
  return hit?.payload||null;
}

async function buildDecisionSnapshot(symbol,interval,query){
  const key=symbol+"|"+interval,now=Date.now(),cached=DECISION_CACHE.get(key);
  if(cached&&now-cached.ts<DECISION_TTL)return Object.assign({cache:"fresh",cacheAgeMs:now-cached.ts},cached.payload);
  try{
    const rawCandles=await getFastKlines(symbol,interval);
    const candles=closedCandles(rawCandles,interval,now);
    if(!candles||candles.length<220)throw Error("Insufficient closed candles");
    const lowerInterval=interval==="15m"?null:"15m";
    const higherInterval=interval==="4h"?"1d":interval==="1d"?null:"4h";
    const dlineHigherInterval=interval==="15m"?"8h":null;
    const lowerRaw=lowerInterval?await Promise.race([klines(symbol,lowerInterval),new Promise(resolve=>setTimeout(()=>resolve(null),1500))]).catch(()=>null):null;
    const higherRaw=higherInterval?await Promise.race([klines(symbol,higherInterval),new Promise(resolve=>setTimeout(()=>resolve(null),1500))]).catch(()=>null):null;
    const dlineHigherRaw=dlineHigherInterval?await Promise.race([klines(symbol,dlineHigherInterval),new Promise(resolve=>setTimeout(()=>resolve(null),1700))]).catch(()=>null):null;
    const lower=lowerRaw?closedCandles(lowerRaw,lowerInterval,now):null;
    const higher=higherRaw?closedCandles(higherRaw,higherInterval,now):null;
    const dlineHigher=dlineHigherRaw?closedCandles(dlineHigherRaw,dlineHigherInterval,now):null;
    const deriv=await Promise.race([derivatives(symbol,interval),new Promise(resolve=>setTimeout(()=>resolve(null),2600))]).catch(()=>null);
    const consensus=await Promise.race([dataFabric.assess(symbol,interval,{
      primaryPrice:candles[candles.length-1]?.c,
      primaryAgeMs:candles[candles.length-1]?.t?now-Number(candles[candles.length-1].t):null,
      primarySource:candles?.[0]?.source,
      liveFlow:flowBucket(symbol)
    }),new Promise(resolve=>setTimeout(()=>resolve(null),1500))]).catch(()=>null);
    const lowerAnalysis=lower&&lower.length>=220&&lowerInterval?analyze(lower,{interval:lowerInterval}):null;
    const higherAnalysis=higher&&higher.length>=220&&higherInterval?analyze(higher,{interval:higherInterval}):null;
    const dlineHigherAnalysis=dlineHigher&&dlineHigher.length>=100?analyze(dlineHigher,{interval:dlineHigherInterval}):null;
    let analysis=analyze(candles,{interval,lower:lowerAnalysis,higher:higherAnalysis,dlineHigher:dlineHigherAnalysis,deriv});
    let learned=null;
    try{
      learned=await Promise.race([learning.process(symbol,interval,candles,analysis),new Promise(resolve=>setTimeout(()=>resolve(null),500))]);
      if(learned?.analysis)analysis=learned.analysis;
    }catch{}
    const flow=mergeFlowSnapshot(symbol,deriv||{});
    const analytics=queueCoreAnalytics(symbol,interval,candles);
    const validation1113=queuePhase1113Validation(symbol,interval,candles);
    const getQ=(k,d)=>query&&typeof query.get==='function'?(query.get(k)??d):(query?.[k]??d);
    const config=propFirm.normalizeConfig({
      accountSize:Number(getQ('accountSize',process.env.PROP_ACCOUNT_SIZE||5000)),
      startingEquity:Number(getQ('equity',process.env.PROP_STARTING_EQUITY||5000)),
      dailyLossLimitPct:Number(getQ('dailyLossLimitPct',process.env.PROP_DAILY_LOSS_PCT||3)),
      maxDrawdownPct:Number(getQ('maxDrawdownPct',process.env.PROP_MAX_DRAWDOWN_PCT||6)),
      riskPerTradePct:Number(getQ('riskPerTradePct',process.env.PROP_RISK_PER_TRADE_PCT||0.5)),
      maxOpenRiskPct:Number(getQ('maxOpenRiskPct',process.env.PROP_MAX_OPEN_RISK_PCT||1)),
      minSignalScore:Number(getQ('minSignalScore',process.env.PROP_MIN_SIGNAL_SCORE||78)),
      minRR:Number(getQ('minRR',process.env.PROP_MIN_RR||1.5)),
      minConsensusQualityPct:Number(getQ('minConsensusQualityPct',process.env.PROP_MIN_CONSENSUS_QUALITY_PCT||85)),
      maxPriceDispersionBps:Number(getQ('maxPriceDispersionBps',process.env.PROP_MAX_PRICE_DISPERSION_BPS||80)),
      blockMixedFlow:String(getQ('blockMixedFlow',process.env.PROP_BLOCK_MIXED_FLOW||"true"))!=="false"
    });
    const gate=propFirm.evaluateStandard({
      analysis,derivatives:flow,
      dataQuality:{
        candleAgeMs:candles.length?Math.max(0,now-Number(candles[candles.length-1].t)):null,
        qualityPct:flow?.available?100:80,
        consensusQualityPct:consensus?.consensusQualityPct,
        priceDispersionBps:consensus?.priceDispersionBps,
        providerCount:consensus?.sourceCount,
        independentSourceCount:consensus?.independentSourceCount
      },
      equity:config.startingEquity,dayStartEquity:config.startingEquity,peakEquity:config.startingEquity,config
    });
    const decision=phase910.evaluate({
      symbol,interval,analysis,lower:lowerAnalysis,higher:higherAnalysis,derivatives:flow,consensus,
      dataQuality:{candleAgeMs:candles.length?Math.max(0,now-Number(candles[candles.length-1].t)):null},
      liveFlow:flow,validation:analytics?.validation||null,propGate:gate
    });
    const gatedDecision=phase1113.applyDeploymentGate(decision,validation1113,{basePolicy:{minScore:config.minSignalScore,minRR:config.minRR}});
    const stableDecision=applySignalStability(gatedDecision,symbol,interval);
    const payload={
      ok:true,...stableDecision,analysis,derivatives:flow,consensus,
      learning:learned?await learning.status().catch(()=>null):null,
      backtest:analytics?.backtest||null,validation:analytics?.validation||null,setupStats:analytics?.setupStats||null,
      phase11_13:validation1113,phase11:PHASE11_VERSION,phase12:PHASE12_VERSION,phase13:PHASE13_VERSION,
      updatedAt:now
    };
    DECISION_CACHE.set(key,{ts:now,payload});
    DECISION_LAST_GOOD.set(key,{ts:now,payload});
    return Object.assign({cache:"fresh",cacheAgeMs:0},payload);
  }catch(e){
    const last=DECISION_LAST_GOOD.get(key);
    if(last){
      const safeStale={
        ...last.payload,
        stale:true,
        action:"WAIT",
        state:"NO_TRADE",
        liveSignalEligible:false,
        market:{...(last.payload.market||{}),side:"WAIT",status:"WAITING",type:"STALE DATA / NO TRADE",bias:"Neutral",directionalLean:"NEUTRAL"},
        levels:{...(last.payload.levels||{}),entryLow:null,entryHigh:null,entry:null,stop:null,tp1:null,tp2:null,rr:null},
        deploymentGate:{...(last.payload.deploymentGate||{}),state:"BLOCKED",reason:"Decision refresh failed; stale directional data is not eligible for a live signal."},
        operational:{...(last.payload.operational||{}),liveUse:"PAPER_ONLY"},
        signalStability:{state:"RELEASED",reason:"stale_decision"}
      };
      return Object.assign({cache:"stale",stale:true,cacheAgeMs:Math.max(0,now-last.ts),degraded:String(e.message||e)},safeStale);
    }
    throw e;
  }
}

function authKey(ip,email,type){return type+":"+String(ip||"unknown")+":"+String(email||"").toLowerCase()}
function requestDevice(req){return String(req.headers["x-marketpulse-device"]||"00000000-0000-0000-0000-000000000000").slice(0,128)}

function mins(interval){return ({'15m':15,'30m':30,'1h':60,'4h':240,'1d':1440})[interval]||60}
function closedCandles(rows,interval,now=Date.now()){
  const ms=mins(interval)*60*1000;
  return (Array.isArray(rows)?rows:[]).filter(x=>Number.isFinite(Number(x?.t))&&Number(x.t)+ms<=now-1000);
}
async function getBinance(symbol,interval,timeoutMs=DATA_TIMEOUT_MS){
  const bases=['https://api.binance.com','https://api-gcp.binance.com','https://api1.binance.com'];
  const requests=bases.map(async base=>{const u=new URL(base+'/api/v3/klines');u.searchParams.set('symbol',symbol);u.searchParams.set('interval',interval);u.searchParams.set('limit',String(Math.min(KLINE_LIMIT,1000)));const r=await fetch(u,{signal:timeoutSignal(timeoutMs)});if(!r.ok)throw Error('HTTP '+r.status);const rows=await r.json();return rows.map(x=>({t:x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],source:'binance'}))});
  try{return await Promise.any(requests)}catch{return null}
}
async function getKraken(symbol,interval,timeoutMs=DATA_TIMEOUT_MS){
  const pair=KRAKEN_PAIRS[symbol]; if(!pair)throw new Error('No Kraken mapping for '+symbol);
  const u=new URL('https://api.kraken.com/0/public/OHLC');u.searchParams.set('pair',pair);u.searchParams.set('interval',String(mins(interval)));
  const r=await fetch(u,{signal:timeoutSignal(timeoutMs)});if(!r.ok)throw new Error('Kraken returned '+r.status);const body=await r.json();if(body.error?.length)throw new Error(body.error.join(', '));
  const key=Object.keys(body.result||{}).find(k=>k!=='last');if(!key)throw new Error('Kraken returned no OHLC data');
  return (body.result[key]||[]).slice(-Math.min(KLINE_LIMIT,720)).map(x=>({t:+x[0]*1000,o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[6],source:'kraken'}));
}
async function getBybitKlines(symbol,interval,timeoutMs=2200){
  const bybitIntervalMap={"15m":"15","30m":"30","1h":"60","4h":"240","8h":"480","1d":"D"};
  const iv=bybitIntervalMap[interval]||"60";
  const hosts=["https://api.bybit.com","https://api.bytick.com"];
  let lastErr=null;
  for(const host of hosts){
    try{
      const u=new URL(host+"/v5/market/kline");
      u.searchParams.set("category","linear");
      u.searchParams.set("symbol",symbol);
      u.searchParams.set("interval",iv);
      u.searchParams.set("limit",String(Math.min(KLINE_LIMIT,1000)));
      const j=await fetchJson(u.toString(),timeoutMs);
      if(Number(j?.retCode)!==0)throw Error(j?.retMsg||("Bybit error "+j?.retCode));
      const rows=Array.isArray(j?.result?.list)?j.result.list.slice().reverse():[];
      const mapped=rows.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],source:"bybit"})).filter(x=>[x.t,x.o,x.h,x.l,x.c,x.v].every(Number.isFinite));
      if(mapped.length<220)throw Error("Bybit returned insufficient candles");
      return mapped;
    }catch(e){lastErr=e}
  }
  throw lastErr||new Error("Bybit kline request failed");
}
async function getFastKlines(symbol,interval){
  const key="FAST|"+symbol+"|"+interval,hit=CACHE.get(key);
  if(hit&&Date.now()-hit.ts<8000)return hit.rows;
  const providers=[
    ["bybit",()=>getBybitKlines(symbol,interval,2200)],
    ["kraken",()=>getKraken(symbol,interval,2600)],
    ["binance",()=>getBinance(symbol,interval,1900)]
  ];
  try{
    const rows=await Promise.any(providers.map(([,fn])=>Promise.resolve().then(fn).then(rows=>{
      if(!Array.isArray(rows)||rows.length<220)throw Error("Provider returned insufficient candles");
      return rows;
    })));
    CACHE.set(key,{ts:Date.now(),rows});
    return rows;
  }catch{
    if(hit?.rows)return hit.rows;
    throw Error("No fast market data source available");
  }
}
async function klines(symbol,interval){
  const key=symbol+'|'+interval,hit=CACHE.get(key);if(hit&&Date.now()-hit.ts<TTL)return hit.rows;
  const rows=await getFastKlines(symbol,interval)||await getBinance(symbol,interval)||await getKraken(symbol,interval);CACHE.set(key,{ts:Date.now(),rows});return rows;
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
  let v=LIVE_FLOW.get(symbol);if(!v){v={liqLong:0,liqShort:0,cvd:0,cvdNotional:0,lastTs:0,oi:null,fundingRate:null,markPrice:null,orderBook:null,points:[]};LIVE_FLOW.set(symbol,v)}
  return v;
}
function recordFlowPoint(symbol){
  const v=flowBucket(symbol),now=Date.now();
  if(v.lastPointAt&&now-v.lastPointAt<1500)return;
  v.lastPointAt=now;
  v.points.push({ts:now,liqLong:v.liqLong,liqShort:v.liqShort,liqTotal:v.liqLong+v.liqShort,cvd:v.cvd,cvdRatio:v.cvdNotional?v.cvd/v.cvdNotional:null,oi:v.oi,fundingRate:v.fundingRate,markPrice:v.markPrice,orderBook:v.orderBook});
  if(v.points.length>LIVE_FLOW_LIMIT)v.points.shift();
}
function startBybitLiveFlow(){
  if(!LIVE_SYMBOLS.length)return;
  let stopped=false,ws=null,retry=1000,timer=null,heartbeat=null,hostIndex=0;
  const hosts=String(process.env.BYBIT_WS_HOSTS||[
    "wss://stream.bybit.com/v5/public/linear",
    "wss://stream.bybit.tr/v5/public/linear",
    "wss://stream.bybit.id/v5/public/linear",
    "wss://stream.bybit.kz/v5/public/linear",
    "wss://stream.bybitgeorgia.ge/v5/public/linear",
    "wss://stream.manepa.jp/v5/public/linear"
  ].join(",")).split(",").map(s=>s.trim()).filter(Boolean);
  const connect=()=>{
    if(stopped)return;
    const url=hosts[hostIndex%hosts.length]||hosts[0]; hostIndex++;
    try{ws=new WebSocket(url)}catch{retry=Math.min(retry*2,30000);timer=setTimeout(connect,retry);return}
    ws.on("open",()=>{
      retry=1000;
      const now=Date.now();
      for(const sym of LIVE_SYMBOLS){
        const v=flowBucket(sym);
        v.wsConnected=true;v.wsHost=url;v.wsConnectedAt=now;v.wsReconnects=Number(v.wsReconnects||0)+1;
      }
      ws.send(JSON.stringify({op:"subscribe",args:LIVE_SYMBOLS.flatMap(sym=>["allLiquidation."+sym,"publicTrade."+sym,"tickers."+sym,"orderbook.50."+sym])}));
      clearInterval(heartbeat);
      heartbeat=setInterval(()=>{try{ws&&ws.readyState===1&&ws.send(JSON.stringify({op:"ping",req_id:String(Date.now())}))}catch{}},20000);
    });
    ws.on("message",raw=>{
      try{
        const msg=JSON.parse(raw.toString()),topic=String(msg.topic||""),data=Array.isArray(msg.data)?msg.data:[msg.data];
        if(!topic||!data.length)return;
        const symbol=topic.split(".")[1];if(!LIVE_FLOW.has(symbol))return;const v=flowBucket(symbol);
        if(topic.startsWith("allLiquidation.")){
          for(const x of data){
            const q=Number(x.v)*Number(x.p);if(!Number.isFinite(q)||q<=0)continue;
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
          if(Number.isFinite(+x.fundingRate))v.fundingRate=normalizeFundingRate(x.fundingRate);
          if(Number.isFinite(+x.markPrice))v.markPrice=+x.markPrice;
          v.lastTs=Number(msg.ts)||Date.now();
        }else if(topic.startsWith("orderbook.50.")){
          const x=data[0]||{},bids=Array.isArray(x.b)?x.b:[],asks=Array.isArray(x.a)?x.a:[];
          const bidQty=bids.slice(0,10).reduce((n,r)=>n+(Number(r?.[1])||0),0);
          const askQty=asks.slice(0,10).reduce((n,r)=>n+(Number(r?.[1])||0),0);
          const bidDepth=bids.slice(0,10).reduce((n,r)=>n+(Number(r?.[0])||0)*(Number(r?.[1])||0),0);
          const askDepth=asks.slice(0,10).reduce((n,r)=>n+(Number(r?.[0])||0)*(Number(r?.[1])||0),0);
          const bid=Number(bids[0]?.[0]),ask=Number(asks[0]?.[0]);
          const mid=Number.isFinite(bid)&&Number.isFinite(ask)?(bid+ask)/2:null;
          const micro=mid&&bidQty+askQty>0?((ask*bidQty)+(bid*askQty))/(bidQty+askQty):null;
          v.orderBook={
            imbalance:(bidQty+askQty)>0?(bidQty-askQty)/(bidQty+askQty):null,
            micropriceBias:mid&&Number.isFinite(micro)?(micro-mid)/mid:null,
            spreadBps:mid&&Number.isFinite(ask)&&Number.isFinite(bid)?((ask-bid)/mid)*10000:null,
            depthNotional:bidDepth+askDepth,bidDepth,askDepth,ts:Date.now()
          };
          v.lastTs=Number(msg.ts)||Date.now();
        }
        recordFlowPoint(symbol);
      }catch{}
    });
    ws.on("close",()=>{
      clearInterval(heartbeat);
      LIVE_SYMBOLS.forEach(sym=>{const v=flowBucket(sym);v.wsConnected=false;v.wsLastDisconnectAt=Date.now()});
      if(!stopped){clearTimeout(timer);timer=setTimeout(connect,retry);retry=Math.min(retry*2,30000)}
    });
    ws.on("error",()=>{try{ws.close()}catch{}});
  };
  connect();
  process.on("SIGTERM",()=>{stopped=true;clearTimeout(timer);clearInterval(heartbeat);try{ws?.close()}catch{}});
}
startBybitLiveFlow();

const DERIV_CACHE=new Map(); const DERIV_TTL=15000;
const KRAKEN_FUTURES_PAIRS={BTCUSDT:"PF_XBTUSD",ETHUSDT:"PF_ETHUSD",SOLUSDT:"PF_SOLUSD",BNBUSDT:"PF_BNBUSD",XRPUSDT:"PF_XRPUSD",DOGEUSDT:"PF_DOGEUSD",ADAUSDT:"PF_ADAUSD"};
const BYBIT_HOSTS=["https://api.bybit.com","https://api.bytick.com"];
function bybitInterval(interval){return ({'15m':'15min','30m':'30min','1h':'1h','4h':'4h','1d':'1d'})[interval]||'1h'}

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
  const [oiRes,tradeRes,tickerRes,bookRes]=await Promise.allSettled([
    bybitGet('/v5/market/open-interest',{category:'linear',symbol,intervalTime:bybitInterval(interval),limit:50}),
    bybitGet('/v5/market/recent-trade',{category:'linear',symbol,limit:1000}),
    bybitGet('/v5/market/tickers',{category:'linear',symbol}),
    bybitGet('/v5/market/orderbook',{category:'linear',symbol,limit:50})
  ]);
  const errors=[];
  const oiPayload=oiRes.status==='fulfilled'?oiRes.value:null,tradePayload=tradeRes.status==='fulfilled'?tradeRes.value:null,tickerPayload=tickerRes.status==='fulfilled'?tickerRes.value:null,bookPayload=bookRes.status==='fulfilled'?bookRes.value:null;
  if(oiRes.status==='rejected')errors.push("OI: "+oiRes.reason.message);if(tradeRes.status==='rejected')errors.push("Trades: "+tradeRes.reason.message);if(tickerRes.status==='rejected')errors.push("Ticker: "+tickerRes.reason.message);if(bookRes.status==='rejected')errors.push("Order book: "+bookRes.reason.message);
  const oiList=(oiPayload?.result?.list||[]).slice().reverse().map(x=>+x.openInterest),ticker=tickerPayload?.result?.list?.[0]||null;
  const book=bookPayload?.result||{},bids=Array.isArray(book.b)?book.b:[],asks=Array.isArray(book.a)?book.a:[];
  const bidQty=bids.slice(0,10).reduce((n,r)=>n+(Number(r?.[1])||0),0),askQty=asks.slice(0,10).reduce((n,r)=>n+(Number(r?.[1])||0),0);
  const bidDepth=bids.slice(0,10).reduce((n,r)=>n+(Number(r?.[0])||0)*(Number(r?.[1])||0),0),askDepth=asks.slice(0,10).reduce((n,r)=>n+(Number(r?.[0])||0)*(Number(r?.[1])||0),0);
  const bid=Number(bids[0]?.[0]),ask=Number(asks[0]?.[0]),mid=Number.isFinite(bid)&&Number.isFinite(ask)?(bid+ask)/2:null;
  const micro=mid&&bidQty+askQty>0?((ask*bidQty)+(bid*askQty))/(bidQty+askQty):null;
  const orderBook={imbalance:bidQty+askQty>0?(bidQty-askQty)/(bidQty+askQty):null,micropriceBias:mid&&Number.isFinite(micro)?(micro-mid)/mid:null,spreadBps:mid&&Number.isFinite(ask)&&Number.isFinite(bid)?((ask-bid)/mid)*10000:null,depthNotional:bidDepth+askDepth,bidDepth,askDepth,ts:Date.now()};
  const currentOi=oiList.length?oiList[oiList.length-1]:(ticker&&Number.isFinite(+ticker.openInterest)?+ticker.openInterest:NaN),oiFirst=oiList[0],oiChangePct=Number.isFinite(oiFirst)&&oiFirst?((currentOi-oiFirst)/oiFirst)*100:null;
  const trades=(tradePayload?.result?.list||[]).slice().sort((a,b)=>+a.time-+b.time).map(x=>({ts:+x.time,price:+x.price,size:+x.size,side:x.side}));
  let cvd=0,total=0;for(const t of trades){const q=t.price*t.size;cvd+=(t.side==="Buy"?q:-q);total+=q}
  const first=trades[0]?.price,lastT=trades[trades.length-1]?.price,priceChangePct=Number.isFinite(first)&&first?((lastT-first)/first)*100:null,cvdRatio=total?cvd/total:null;
  const live=flowBucket(symbol),liveCvd=live.cvdNotional?live.cvd:cvd,liveCvdRatio=live.cvdNotional?live.cvd/live.cvdNotional:cvdRatio,liqTotal=live.liqLong+live.liqShort,liqBias=liqTotal?(live.liqLong>live.liqShort?"LONG LIQS DOMINANT":"SHORT LIQS DOMINANT"):"UNAVAILABLE";
  const liveOrderBook=live.orderBook||orderBook;
  const data={available:Boolean(ticker||oiPayload||tradePayload||bookPayload||live.cvdNotional||liqTotal),provider:"Bybit linear futures"+(live.cvdNotional||liqTotal?" · live stream":""),oi:Number.isFinite(currentOi)?currentOi:null,oiChangePct,cvdDelta:liveCvd,cvdRatio:liveCvdRatio,cvdState:"MIXED",positioning:"MIXED",tradeCount:trades.length,fundingRate:ticker&&Number.isFinite(+ticker.fundingRate)?normalizeFundingRate(ticker.fundingRate):null,markPrice:ticker&&Number.isFinite(+ticker.markPrice)?+ticker.markPrice:null,tradePriceChangePct:priceChangePct,takerImbalance:liveCvdRatio,longLiquidations:live.liqLong,shortLiquidations:live.liqShort,liquidationTotal:liqTotal,liquidationBias:liqBias,orderBook:liveOrderBook,livePointCount:live.points.length,liveHistory:live.points.slice(-120),errors,updatedAt:Date.now()};
  if(priceChangePct!=null&&cvdRatio!=null){if(priceChangePct>0.15&&cvdRatio<-0.01)data.cvdState="BEARISH DIVERGENCE";else if(priceChangePct<-0.15&&cvdRatio>0.01)data.cvdState="BULLISH DIVERGENCE";else if(priceChangePct>0.15&&cvdRatio>0.01)data.cvdState="BUYERS CONFIRM";else if(priceChangePct<-0.15&&cvdRatio<-0.01)data.cvdState="SELLERS CONFIRM"}else if(trades.length===0)data.cvdState="UNAVAILABLE";
  if(priceChangePct!=null&&oiChangePct!=null){if(priceChangePct>0.15&&oiChangePct>1)data.positioning="PRICE + OI: LONG PARTICIPATION";else if(priceChangePct>0.15&&oiChangePct<-1)data.positioning="PRICE UP + OI DOWN: SHORT COVERING";else if(priceChangePct<-0.15&&oiChangePct>1)data.positioning="PRICE DOWN + OI UP: SHORT PARTICIPATION";else if(priceChangePct<-0.15&&oiChangePct<-1)data.positioning="PRICE DOWN + OI DOWN: LONG LIQUIDATION"}else if(!Number.isFinite(oiChangePct))data.positioning=Number.isFinite(currentOi)?"OI CHANGE NOT AVAILABLE":"OI UNAVAILABLE";
  return mergeFlowSnapshot(symbol,data);
}

function mergeFlowSnapshot(symbol,base){
  const live=flowBucket(symbol);
  const points=Array.isArray(live.points)?live.points:[],last=points.length?points[points.length-1]:{},prev=points.length>1?points[points.length-2]:{};
  const out=Object.assign({},base||{});
  out.available=Boolean(out.available||live.wsConnected||Number.isFinite(live.oi)||Number.isFinite(live.fundingRate)||live.cvdNotional>0||live.orderBook||live.liqLong||live.liqShort||points.length);
  out.provider=out.provider||"Bybit linear futures";
  out.oi=Number.isFinite(live.oi)?live.oi:(Number.isFinite(out.oi)?out.oi:(Number.isFinite(last.oi)?last.oi:null));
  const dt=Number(last.ts||0)-Number(prev.ts||0);
  out.oiChangePct=Number.isFinite(out.oiChangePct)?out.oiChangePct:(Number.isFinite(live.oi)&&Number.isFinite(Number(prev.oi))&&Number(prev.oi)!==0&&dt>0&&dt<=120000?((live.oi-Number(prev.oi))/Math.abs(Number(prev.oi)))*100:null);
  out.cvdDelta=live.cvdNotional>0?live.cvd:(Number.isFinite(out.cvdDelta)?out.cvdDelta:(Number.isFinite(last.cvd)?last.cvd:null));
  out.cvdRatio=live.cvdNotional>0?live.cvd/live.cvdNotional:(Number.isFinite(out.cvdRatio)?out.cvdRatio:(Number.isFinite(last.cvdRatio)?last.cvdRatio:null));
  out.cvdState=Number.isFinite(out.cvdDelta)?(out.cvdDelta>0?"BUYERS PRESSURE":out.cvdDelta<0?"SELLERS PRESSURE":"BALANCED"):(out.cvdState||"WAITING");
  out.fundingRate=Number.isFinite(live.fundingRate)?live.fundingRate:(Number.isFinite(out.fundingRate)?out.fundingRate:null);
  out.markPrice=Number.isFinite(live.markPrice)?live.markPrice:(Number.isFinite(out.markPrice)?out.markPrice:null);
  if(Number.isFinite(out.oiChangePct))out.positioning=out.oiChangePct>1?"OI RISING":out.oiChangePct<-1?"OI FALLING":"OI FLAT";
  if(!out.positioning||out.positioning==="MIXED"||out.positioning==="OI CHANGE NOT AVAILABLE"||out.positioning==="OI UNAVAILABLE"){
    out.positioning=Number.isFinite(out.oi)?"OI LIVE":"WAITING";
  }
  out.longLiquidations=Number.isFinite(live.liqLong)?live.liqLong:(Number.isFinite(out.longLiquidations)?out.longLiquidations:0);
  out.shortLiquidations=Number.isFinite(live.liqShort)?live.liqShort:(Number.isFinite(out.shortLiquidations)?out.shortLiquidations:0);
  out.liquidationTotal=out.longLiquidations+out.shortLiquidations;
  out.liquidationBias=out.liquidationTotal>0?(out.longLiquidations>out.shortLiquidations?"LONG LIQS DOMINANT":out.shortLiquidations>out.longLiquidations?"SHORT LIQS DOMINANT":"LIQUIDATION ACTIVITY"):"NO LIQUIDATION ACTIVITY";
  out.orderBook=live.orderBook||out.orderBook||null;
  out.liveHistory=points.slice(-180);
  out.livePointCount=points.length;
  out.liveConnected=Boolean(live.wsConnected);
  out.liveHost=live.wsHost||null;
  out.series=out.series||{};
  if(!Array.isArray(out.series.cvd)||out.series.cvd.length<2)out.series.cvd=points.map(x=>x.cvdRatio??x.cvd).filter(Number.isFinite);
  if(!Array.isArray(out.series.oi)||out.series.oi.length<2)out.series.oi=points.map(x=>x.oi).filter(Number.isFinite);
  if(!Array.isArray(out.series.liq)||out.series.liq.length<2)out.series.liq=points.map(x=>x.liqTotal).filter(Number.isFinite);
  return out;
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
  if(live.cvdNotional>0){
    data.cvdDelta=live.cvd;
    data.cvdRatio=live.cvdNotional?live.cvd/live.cvdNotional:null;
    data.cvdState=live.cvd>0?"BUYERS PRESSURE":live.cvd<0?"SELLERS PRESSURE":"BALANCED";
  }
  if(Number.isFinite(live.oi))data.oi=live.oi;
  if(Number.isFinite(live.fundingRate))data.fundingRate=live.fundingRate;
  if(Number.isFinite(live.markPrice))data.markPrice=live.markPrice;
  if(live.orderBook)data.orderBook=live.orderBook;
  if(live.liqLong||live.liqShort){
    data.longLiquidations=live.liqLong;data.shortLiquidations=live.liqShort;
    data.liquidationTotal=live.liqLong+live.liqShort;
    data.liquidationBias=live.liqLong>live.liqShort?"LONG LIQS DOMINANT":"SHORT LIQS DOMINANT";
  }
  data.series=data.series||{};
  if(!Array.isArray(data.series.cvd)||data.series.cvd.length<2)data.series.cvd=live.points.map(x=>x.cvdRatio??x.cvd).filter(Number.isFinite);
  if(!Array.isArray(data.series.oi)||data.series.oi.length<2)data.series.oi=live.points.map(x=>x.oi).filter(Number.isFinite);
  if(!Array.isArray(data.series.liq)||data.series.liq.length<2)data.series.liq=live.points.map(x=>x.liqTotal).filter(Number.isFinite);
  data.provider=(data.provider||"Derivatives")+" · live flow";
  data.liveHistory=live.points.slice(-180);
  data.livePointCount=live.points.length;
  data=mergeFlowSnapshot(symbol,data);
  DERIV_CACHE.set(key,{ts:Date.now(),data});return data;
}

function send(res,code,p){
  res.writeHead(code,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'Pragma':'no-cache',
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
    'Referrer-Policy':'strict-origin-when-cross-origin',
    'Strict-Transport-Security':'max-age=31536000; includeSubDomains',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()',
    'Cross-Origin-Opener-Policy':'same-origin',
    'Cross-Origin-Resource-Policy':'same-origin',
    'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  });
  res.end(JSON.stringify(p))
}
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
    derivatives:a.derivatives||null,
    historicalDerivativeContext:a.derivatives?.available?"BINANCE_PUBLIC_FUTURES":"UNAVAILABLE_IN_REPLAY"
  };
}

async function historicalCandles(symbol,interval,bars){
  const n=Math.max(240,Math.min(Number(bars)||4200,4200));
  if(interval==="1d")return longDailyHistory(symbol,n);
  return klines(symbol,interval);
}

const HIST_DERIV_CACHE=new Map();
const HIST_DERIV_TTL=15*60*1000;
function binanceDerivPeriod(interval){return ({'15m':'15m','1h':'1h','4h':'4h','1d':'1d'})[interval]||'1h'}
async function historicalBinanceDerivatives(symbol,interval){
  const key=symbol+"|"+interval,hit=HIST_DERIV_CACHE.get(key);
  if(hit&&Date.now()-hit.ts<HIST_DERIV_TTL)return hit.rows;
  const period=binanceDerivPeriod(interval),base="https://fapi.binance.com";
  const qs="symbol="+encodeURIComponent(symbol)+"&period="+period+"&limit=500";
  const endpoints={
    oi:"/futures/data/openInterestHist?"+qs+"&contractType=PERPETUAL",
    taker:"/futures/data/takerBuySellVol?"+qs+"&contractType=PERPETUAL",
    accounts:"/futures/data/topLongShortAccountRatio?"+qs+"&contractType=PERPETUAL",
    funding:"/fapi/v1/fundingRate?symbol="+encodeURIComponent(symbol)+"&limit=500"
  };
  const safe=async path=>{try{return await fetchJson(base+path,6000)}catch{return[]}};
  const [oi,taker,accounts,funding]=await Promise.all([safe(endpoints.oi),safe(endpoints.taker),safe(endpoints.accounts),safe(endpoints.funding)]);
  const rows=new Map();
  const put=(ts,patch)=>{const k=Number(ts);if(!Number.isFinite(k))return;const x=rows.get(k)||{t:k};Object.assign(x,patch);rows.set(k,x)};
  (Array.isArray(oi)?oi:[]).forEach((x,i,a)=>{
    const v=Number(x.sumOpenInterestValue??x.sumOpenInterest);put(x.timestamp,{oi:v});
    if(i>0){const prev=Number(a[i-1].sumOpenInterestValue??a[i-1].sumOpenInterest);if(Number.isFinite(v)&&Number.isFinite(prev)&&prev)rows.get(Number(x.timestamp)).oiChangePct=(v-prev)/prev*100}
  });
  (Array.isArray(taker)?taker:[]).forEach(x=>{
    const buy=Number(x.takerBuyVolValue??x.takerBuyVol),sell=Number(x.takerSellVolValue??x.takerSellVol);
    const total=buy+sell;
    put(x.timestamp,{
      takerBuyVol:buy,takerSellVol:sell,
      takerImbalance:Number.isFinite(buy)&&Number.isFinite(sell)&&total>0?(buy-sell)/total:null,
      cvdDelta:Number.isFinite(buy)&&Number.isFinite(sell)?buy-sell:null,
      cvdRatio:Number.isFinite(buy)&&Number.isFinite(sell)&&total>0?(buy-sell)/total:null
    });
  });
  (Array.isArray(accounts)?accounts:[]).forEach(x=>{
    const longPct=Number(x.longAccount)*100,shortPct=Number(x.shortAccount)*100;
    put(x.timestamp,{longPercent:Number.isFinite(longPct)?longPct:null,shortPercent:Number.isFinite(shortPct)?shortPct:null,longShortRatio:Number(x.longShortRatio)});
  });
  (Array.isArray(funding)?funding:[]).forEach(x=>{
    put(x.fundingTime,{fundingRate:Number(x.fundingRate)});
  });
  const out=Array.from(rows.values()).sort((a,b)=>a.t-b.t);
  HIST_DERIV_CACHE.set(key,{ts:Date.now(),rows:out});
  return out;
}
function nearestHistoricalDerivative(rows,ts){
  if(!Array.isArray(rows)||!rows.length)return null;
  let lo=0,hi=rows.length-1,best=null;
  while(lo<=hi){const m=(lo+hi)>>1,x=rows[m];if(x.t<=ts){best=x;lo=m+1}else hi=m-1}
  return best?{...best}:null;
}

async function buildReplayDataset(symbol,interval,{points=60,bars=420}={}){
  const candles=await historicalCandles(symbol,interval,bars);
  if(!candles||candles.length<240)throw new Error("Not enough historical candles for replay");
  const usable=Math.max(1,candles.length-220-13),count=Math.max(10,Math.min(Number(points)||60,usable));
  const step=Math.max(1,Math.floor(usable/count)),frames=[];
  const historicalDeriv=await historicalBinanceDerivatives(symbol,interval).catch(()=>[]);
  for(let idx=220;idx<candles.length-12;idx+=step){
    const window=candles.slice(0,idx+1);
    const rawD=nearestHistoricalDerivative(historicalDeriv,candles[idx].t);
    const deriv=rawD?{
      available:true,provider:"Binance public futures history",
      oi:rawD.oi??null,oiChangePct:rawD.oiChangePct??null,
      takerImbalance:rawD.takerImbalance??null,
      longPercent:rawD.longPercent??null,shortPercent:rawD.shortPercent??null,longShortRatio:rawD.longShortRatio??null,
      cvdDelta:rawD.cvdDelta??null,cvdRatio:rawD.cvdRatio??null,cvdState:Number.isFinite(rawD.cvdDelta)?(rawD.cvdDelta>0?"BUYERS PRESSURE":rawD.cvdDelta<0?"SELLERS PRESSURE":"BALANCED"):"UNAVAILABLE",positioning:"HISTORICAL OI",
      fundingRate:rawD.fundingRate??null,
      liquidationBias:"UNKNOWN",liquidationTotal:null,orderBook:null,errors:[]
    }:null;
    const a=analyze(window,{interval,deriv});
    const outcome=replayOutcome(candles,idx,a,12);
    frames.push({
      index:idx,ts:candles[idx].t,price:candles[idx].c,
      snapshot:replaySnapshot(a),outcome
    });
    if(frames.length>=count)break;
  }
  return {symbol,interval,candles,frames,coverage:{bars:candles.length,startTs:candles[0]?.t,endTs:candles[candles.length-1]?.t,points:frames.length,horizonBars:12,historicalDerivatives:Boolean(historicalDeriv.length),derivativeRows:historicalDeriv.length}};
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

function staticFile(req,res){
  const reqPath=req.url==='/'?'/index.html':req.url.split('?')[0],root=path.resolve(__dirname,'public'),file=path.resolve(root,'.'+reqPath),relative=path.relative(root,file);
  if(relative.startsWith('..')||path.isAbsolute(relative))return send(res,403,{error:'Forbidden'});
  fs.readFile(file,(e,d)=>{
    if(e)return send(res,404,{error:'Not found'});
    const ext=path.extname(file),type=ext==='.html'?'text/html; charset=utf-8':ext==='.json'?'application/json; charset=utf-8':'text/plain; charset=utf-8';
    const nonce=crypto.randomBytes(18).toString('base64');
    let body=d;
    if(ext==='.html')body=Buffer.from(d.toString().replaceAll('__CSP_NONCE__',nonce));
    const csp=[
      "default-src 'self'",
      "script-src 'self' 'nonce-"+nonce+"'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' wss: https:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests"
    ].join("; ");
    res.writeHead(200,{
      'Content-Type':type,'Cache-Control':'no-store','Pragma':'no-cache',
      'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin',
      'Strict-Transport-Security':'max-age=31536000; includeSubDomains',
      'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()',
      'Cross-Origin-Opener-Policy':'same-origin',
      'Cross-Origin-Resource-Policy':'same-origin',
      'Content-Security-Policy':csp
    });
    res.end(body);
  });
}

const server=http.createServer(async(req,res)=>{
  const started=Date.now();SERVER_METRICS.requests++;
  const rawPath=String(req.url||"").split("?")[0];
  SERVER_METRICS.routeCounts.set(rawPath,(SERVER_METRICS.routeCounts.get(rawPath)||0)+1);
  res.on("finish",()=>{const latency=Date.now()-started;SERVER_METRICS.totalLatencyMs+=latency;if(res.statusCode>=500)SERVER_METRICS.errors++;if(res.statusCode>=500)SERVER_METRICS.lastErrors.unshift({path:rawPath,status:res.statusCode,latencyMs:latency,at:new Date().toISOString()});if(SERVER_METRICS.lastErrors.length>50)SERVER_METRICS.lastErrors.length=50});
  try{
    if(!rateRequest(req))return send(res,429,{ok:false,error:"Too many requests. Please slow down."});
    const u=new URL(req.url,'http://localhost');
    const unsafe=req.method==='POST'||req.method==='PUT'||req.method==='PATCH'||req.method==='DELETE';
    if(unsafe&&!originAllowed(req))return send(res,403,{ok:false,error:"Cross-origin request blocked"});
    if(Number(req.headers["content-length"]||0)>262144)return send(res,413,{ok:false,error:"Request too large"});
    if(ADMIN_ONLY_PATHS.has(u.pathname)||ADMIN_ONLY_PREFIXES.some(prefix=>u.pathname.startsWith(prefix))){
      const guard=await auth.requireAdmin(req);
      if(!guard.ok)return send(res,guard.status,{ok:false,error:guard.error});
    }
    const fastPublic=FAST_PUBLIC_PATHS.has(u.pathname)&&req.method==="GET";
    const adminCfg=fastPublic?(ADMIN_RUNTIME.config||{
      mode:"normal",maintenanceMode:false,readOnlyMode:false,registrationsEnabled:true,
      aiEnabled:true,executionEnabled:true,marketDataEnabled:true,writesEnabled:true,
      maintenanceMessage:"MarketPulse is temporarily unavailable."
    }):await getAdminRuntime();
    const userForMode=fastPublic?null:await auth.userFromRequest(req);
    const isAdminUser=Boolean(userForMode?.isAdmin);
    const publicAllowed=new Set(['/api/config','/api/auth/me','/api/auth/login','/api/auth/register','/api/auth/logout','/api/auth/presence','/api/broadcasts/active','/api/telemetry/event','/health','/']);
    if(adminCfg.maintenanceMode&&!isAdminUser&&u.pathname.startsWith('/api/')&&!publicAllowed.has(u.pathname))return send(res,503,{ok:false,error:"MAINTENANCE_MODE",maintenance:true,message:adminCfg.maintenanceMessage});
    if(adminCfg.readOnlyMode&&!isAdminUser&&unsafe&&!['/api/auth/presence','/api/telemetry/event'].includes(u.pathname))return send(res,423,{ok:false,error:"READ_ONLY_MODE",readOnly:true,message:"MarketPulse is temporarily in read-only mode."});
    if(adminCfg.registrationsEnabled===false&&u.pathname==='/api/auth/register'&& !isAdminUser)return send(res,403,{ok:false,error:"REGISTRATIONS_DISABLED"});
    if(adminCfg.aiEnabled===false&&u.pathname==='/api/ai'&&!isAdminUser)return send(res,503,{ok:false,error:"AI_DISABLED"});
    if(adminCfg.executionEnabled===false&&u.pathname.startsWith('/api/execution')&&!isAdminUser)return send(res,503,{ok:false,error:"EXECUTION_DISABLED"});
    if(adminCfg.marketDataEnabled===false&&['/api/core','/api/chart','/api/live','/api/market','/api/scanner','/api/scanner-live','/api/core-scan','/api/core-flow','/api/cycle','/api/core-analytics','/api/decision'].includes(u.pathname)&&!isAdminUser)return send(res,503,{ok:false,error:"MARKET_DATA_DISABLED"});
    if(adminCfg.writesEnabled===false&&unsafe&&!isAdminUser&&!u.pathname.startsWith('/api/auth/')&&!['/api/telemetry/event'].includes(u.pathname))return send(res,423,{ok:false,error:"WRITES_DISABLED"});
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
    if(req.method==='GET'&&u.pathname==='/api/admin/storage-health'){
      const guard=await auth.requireAdmin(req);if(!guard.ok)return send(res,guard.status,{ok:false,error:guard.error});
      try{return send(res,200,await storage.health())}catch(e){return send(res,503,{ok:false,mode:'unknown',connected:false,source:'Unavailable',error:String(e.message||e)})}
    }
    if(req.method==='GET'&&u.pathname==='/api/analytics'){
      const device=String(u.searchParams.get('device')||requestDevice(req));
      try{
        const mem=await storage.get(device);
        const analytics=phase7.analyzeJournal(mem.payload?.journal||[]);
        return send(res,200,{ok:true,device,storage:mem.storage,durable:mem.storage==="postgres",analytics,updatedAt:Date.now()});
      }catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/phase7/health'){
      try{
        const device=String(u.searchParams.get('device')||requestDevice(req));
        const mem=await storage.get(device);
        const analytics=phase7.analyzeJournal(mem.payload?.journal||[]);
        let marketData=false,deriv=null;
        try{const rows=await Promise.race([getKraken('BTCUSDT','1h'),new Promise(resolve=>setTimeout(()=>resolve(null),2500))]);marketData=Boolean(rows&&rows.length>=50)}catch{}
        try{deriv=await Promise.race([derivatives('BTCUSDT','1h'),new Promise(resolve=>setTimeout(()=>resolve(null),1800))])}catch{}
        const health=phase7.qualityCheck({
          analytics,
          storage:storage.status(),
          marketData,
          derivatives:Boolean(deriv?.available)
        });
        return send(res,200,{ok:health.ok,health,analyticsQuality:analytics.quality,marketData,derivatives:deriv?.available?{provider:deriv.provider,oi:Boolean(Number.isFinite(Number(deriv.oi))),cvd:Boolean(Number.isFinite(Number(deriv.cvdDelta))),liquidations:Boolean(deriv.liquidationTotal!=null)}:null,storage:mem.storage,updatedAt:Date.now()});
      }catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    
    if(req.method==='GET'&&u.pathname==='/api/learning/status')return send(res,200,await learning.status());

    if(req.method==='GET'&&u.pathname==='/api/auth/me'){
      try{
        const user=await auth.userFromRequest(req);
        return send(res,200,{ok:true,authenticated:Boolean(user),user:user?{id:user.id,email:user.email,expiresAt:user.expiresAt,isAdmin:Boolean(user.isAdmin),adminMfaAt:user.adminMfaAt||null}:null,adminConfigured:auth.adminConfigured,mfaEnabled:auth.mfaEnabled,passwordPepperEnabled:auth.passwordPepperEnabled});
      }catch(e){return send(res,500,{ok:false,error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/auth/presence'){
      const user=await auth.userFromRequest(req);
      const device=String(req.headers["x-marketpulse-device"]||"").slice(0,128);
      markLiveVisitor(device,Boolean(user));
      return send(res,200,{ok:true,online:Boolean(user),live:liveVisitorStats()});
    }
    if(req.method==='POST'&&(u.pathname==='/api/auth/register'||u.pathname==='/api/auth/login')){
      let raw="";for await(const chunk of req)raw+=chunk;
      let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      try{
        if(u.pathname==='/api/auth/register'){
          const key=authKey(clientIp(req),body.email,"register");
          const user=await auth.register(body.email,body.password,key);
          if(auth.isAdminEmail(user.email)&&auth.mfaEnabled){
            return send(res,201,{ok:true,user:{...user,isAdmin:true,mfaEnabled:true},requiresMfa:true});
          }
          const logged=await auth.login(body.email,body.password,authKey(clientIp(req),body.email,"login"),body.mfaCode);
          res.setHeader("Set-Cookie",logged.setCookie);
          return send(res,201,{ok:true,user:logged.user});
        }
        const key=authKey(clientIp(req),body.email,"login");
        const logged=await auth.login(body.email,body.password,key,body.mfaCode);
        res.setHeader("Set-Cookie",logged.setCookie);
        return send(res,200,{ok:true,user:logged.user});
      }catch(e){
        const map={
          EMAIL_EXISTS:["Unable to create an account with those details.",400],
          INVALID_CREDENTIALS:["Email or password is incorrect.",400],
          ACCOUNT_LOCKED:[e.message,423],
          AUTH_RATE_LIMIT:["Too many attempts. Please wait and try again.",429],
          ADMIN_MFA_REQUIRED:["Owner MFA code required.",401],
          ADMIN_MFA_INVALID:["Owner MFA code is incorrect or expired.",401],
        };
        const pair=map[e.message]||[e.message,422];
        return send(res,pair[1],{ok:false,error:pair[0],mfaRequired:e.message==="ADMIN_MFA_REQUIRED",adminMfa:e.message.startsWith("ADMIN_MFA_")});
      }
    }
    if(req.method==='POST'&&u.pathname==='/api/auth/logout'){
      try{const x=await auth.logout(req);res.setHeader("Set-Cookie",x.setCookie);res.setHeader("Clear-Site-Data",'"cache"');return send(res,200,{ok:true})}catch(e){return send(res,500,{ok:false,error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/users'){
      try{
        const stats=await storage.userStats();
        const users=await storage.listUsers(Math.min(500,Math.max(1,Number(u.searchParams.get('limit')||200))));
        return send(res,200,{ok:true,stats:{...stats,...liveVisitorStats()},users});
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e)})}
    }
    if(req.method==='POST'&&u.pathname.startsWith('/api/admin/users/')&&u.pathname.endsWith('/action')){
      const userId=u.pathname.slice('/api/admin/users/'.length,-'/action'.length);
      let raw="";for await(const chunk of req)raw+=chunk;
      let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      try{
        const guard=await auth.requireAdmin(req);
        if(!guard.ok)return send(res,guard.status,{ok:false,error:guard.error});
        if(userId===guard.user.id)return send(res,400,{ok:false,error:"The owner account cannot be moderated."});
        await storage.moderateUser(userId,body.action,body.durationMinutes,body.reason);
        await auditAdmin(req,(String(body.action)==="ban"?"Banned user":String(body.action)==="restrict"?"Restricted user":"Restored user"),"users",userId,{durationMinutes:body.durationMinutes||null,reason:String(body.reason||"").slice(0,200)});
        await securityEvent("warning","admin_user_moderation",(await auth.userFromRequest(req))?.email,{action:body.action,targetUserId:userId});
        return send(res,200,{ok:true});
      }catch(e){return send(res,400,{ok:false,error:String(e.message||e)})}
    }
    if(req.method==='GET'&&u.pathname==='/api/broadcasts/active'){
      try{const viewer=await auth.userFromRequest(req),rows=await storage.getActiveBroadcasts();return send(res,200,{ok:true,broadcasts:rows.filter(x=>x.audience==="all"||(x.audience==="registered"&&viewer))})}catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/telemetry/event'){
      let raw="";for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      const user=await auth.userFromRequest(req);try{await storage.recordUsageEvent(user?.id||null,body.feature||"unknown",body.action||"view",body.symbol||null,body.interval||null,body.metadata||{});return send(res,200,{ok:true})}catch(e){return send(res,200,{ok:false})}
    }
    if(req.method==='POST'&&u.pathname==='/api/support/tickets'){
      const user=await auth.userFromRequest(req);if(!user)return send(res,401,{ok:false,error:"Authentication required"});
      let raw="";for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      try{const ticket=await storage.createSupportTicket(user.id,body);await storage.recordUsageEvent(user.id,"support","ticket_created");return send(res,201,{ok:true,ticket})}catch(e){return send(res,400,{ok:false,error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/support/tickets'){
      const user=await auth.userFromRequest(req);if(!user)return send(res,401,{ok:false,error:"Authentication required"});
      try{return send(res,200,{ok:true,tickets:(await storage.listSupportTickets(100)).filter(x=>x.userId===user.id)})}catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/overview'){
      const safe=async(name,fn,fallback)=>{try{return {ok:true,value:await fn()}}catch(e){return {ok:false,error:String(e.message||e),value:fallback}}};
      const [healthR,statsR,analyticsR,flagsR,configR,auditR,securityR,ticketsR,broadcastsR,snapshotsR,recentUsageR]=await Promise.all([
        safe("health",()=>storage.health(),{ok:false,source:"unavailable"}),
        safe("stats",()=>storage.userStats(),{allTime:0,today:0,week:0,month:0,liveNow:0}),
        safe("analytics",()=>storage.adminAnalytics(),{totals:{},features:[],symbols:[],intervals:[]}),
        safe("flags",()=>storage.getFeatureFlags(),{}),
        safe("config",()=>getAdminRuntime(true),{mode:"normal"}),
        safe("audit",()=>storage.listAdminAudit(20),[]),
        safe("security",()=>storage.listSecurityEvents(20),[]),
        safe("tickets",()=>storage.listSupportTickets(20),[]),
        safe("broadcasts",()=>storage.listBroadcasts(20),[]),
        safe("snapshots",()=>storage.listAdminSnapshots(20),[]),
        safe("recentUsage",()=>storage.recentUsageEvents(40),[])
      ]);
      const perf={uptimeSec:Math.floor((Date.now()-SERVER_METRICS.startedAt)/1000),requests:SERVER_METRICS.requests,errors:SERVER_METRICS.errors,avgLatencyMs:SERVER_METRICS.requests?Math.round(SERVER_METRICS.totalLatencyMs/SERVER_METRICS.requests):0,memoryMb:Math.round(process.memoryUsage().rss/1048576),heapUsedMb:Math.round(process.memoryUsage().heapUsed/1048576),cpu:process.cpuUsage(),lastErrors:SERVER_METRICS.lastErrors.slice(0,12),topRoutes:Array.from(SERVER_METRICS.routeCounts.entries()).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([route,count])=>({route,count}))};
      const learningState=await Promise.race([learning.status(),new Promise(resolve=>setTimeout(()=>resolve({state:"unknown"}),1200))]).catch(()=>({state:"unknown"}));
      const phase7Check=(()=>{try{return phase7.selfTest()}catch{return{ok:false}}})();
      const sections={health:healthR,stats:statsR,analytics:analyticsR,flags:flagsR,config:configR,audit:auditR,security:securityR,tickets:ticketsR,broadcasts:broadcastsR,snapshots:snapshotsR,recentUsage:recentUsageR};
      const values=Object.fromEntries(Object.entries(sections).map(([k,v])=>[k,v.value]));
      const errors=Object.fromEntries(Object.entries(sections).filter(([,v])=>!v.ok).map(([k,v])=>[k,v.error]));
      return send(res,200,{ok:Object.keys(errors).length===0,partial:Object.keys(errors).length>0,errors,...values,stats:{...(values.stats||{}),...liveVisitorStats()},learning:learningState,phase7:phase7Check,performance:perf});
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/providers'){
      const probe=async(name,urls,validate)=>{
        const started=Date.now(),errors=[];
        const tasks=urls.map(async(item)=>{
          try{
            const j=await fetchJson(item.url,2500);
            if(validate&&!validate(j))throw new Error("unexpected response");
            return {host:item.host};
          }catch(e){
            errors.push(item.host+": "+String(e.message||e).slice(0,120));
            throw e;
          }
        });
        try{
          const hit=await Promise.any(tasks);
          return {name,status:"healthy",latencyMs:Date.now()-started,detail:"reachable via "+hit.host,host:hit.host};
        }catch{
          const detail=errors.slice(0,3).join(" | ")||"all endpoints failed";
          const restricted=/HTTP (401|403|451)/i.test(detail);
          return {name,status:restricted?"restricted":"error",latencyMs:Date.now()-started,detail:restricted?detail+"; network/geographic access restriction likely":detail};
        }
      };
      const items=[];
      const db=await storage.health();
      items.push({name:"PostgreSQL",status:db.connected?"healthy":"degraded",latencyMs:null,detail:db.source});
      const binanceHosts=['https://api.binance.com','https://api-gcp.binance.com','https://api1.binance.com','https://api2.binance.com','https://api3.binance.com'];
      items.push(await probe("Binance",binanceHosts.map(host=>({host,url:host+"/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1"})),j=>Array.isArray(j)&&j.length===1));
      items.push(await probe("Kraken",[{host:"api.kraken.com",url:"https://api.kraken.com/0/public/SystemStatus"}],j=>j?.result?.status));
      const bybitHosts=(BYBIT_HOSTS||[]).map(host=>({host,url:host+"/v5/market/time"}));
      items.push(await probe("Bybit",bybitHosts,j=>j?.retCode===0));
      items.push(await (async()=>{const t=Date.now();try{const s=await dataFabric.coinbaseSnapshot("BTCUSDT");return{name:"Coinbase Spot",status:"healthy",latencyMs:Date.now()-t,detail:"public trades reachable"}}catch(e){return{name:"Coinbase Spot",status:"error",latencyMs:Date.now()-t,detail:String(e.message||e)}}})());
      items.push({name:"OpenAI",status:OPENAI_API_KEY?"configured":"not_configured",latencyMs:null,detail:OPENAI_MODEL});
      const flow=LIVE_FLOW.get("BTCUSDT"),fresh=Boolean(flow?.lastTs&&Date.now()-flow.lastTs<120000);
      items.push({name:"Bybit Live Flow",status:fresh?"healthy":"stale",latencyMs:fresh?Date.now()-flow.lastTs:null,detail:fresh?"Live derivatives stream active":"No recent live flow event",lastEventAt:flow?.lastTs||null});
      const krakenOk=items.some(x=>x.name==="Kraken"&&x.status==="healthy");
      if(krakenOk){
        items.forEach(function(item){
          if((item.name==="Binance"||item.name==="Bybit")&&item.status==="error"){
            item.status="degraded";
            item.detail=(item.detail||"primary host unavailable")+"; fallback available";
          }
        });
      }
      const usable=items.filter(x=>["PostgreSQL","Binance","Kraken","Bybit"].includes(x.name)&&["healthy","degraded"].includes(x.status)).length;
      return send(res,200,{ok:usable>=2,providers:items,router:{usableProviders:usable,failoverEnabled:true}});
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/audit')return send(res,200,{ok:true,rows:await storage.listAdminAudit(300)});
    if(req.method==='GET'&&u.pathname==='/api/admin/security')return send(res,200,{ok:true,rows:await storage.listSecurityEvents(300)});
    if(req.method==='GET'&&u.pathname==='/api/admin/analytics')return send(res,200,{ok:true,data:await storage.adminAnalytics()});
    if(req.method==='GET'&&u.pathname==='/api/admin/flags')return send(res,200,{ok:true,flags:await storage.getFeatureFlags()});
    if(req.method==='POST'&&u.pathname==='/api/admin/flags'){
      let raw="";for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      const user=await auth.userFromRequest(req);try{const row=await storage.saveFeatureFlag(body.key,body, user.email);await auditAdmin(req,"Updated feature flag "+row.key,"feature_flags",null,{enabled:row.enabled,rolloutPct:row.rolloutPct});return send(res,200,{ok:true,flag:row})}catch(e){return send(res,400,{ok:false,error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/config')return send(res,200,{ok:true,config:await getAdminRuntime(true)});
    if(req.method==='POST'&&u.pathname==='/api/admin/config'){
      let raw="";for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      const current=await getAdminRuntime(true),next=Object.assign({},current,body);const saved=await storage.saveAdminConfig(next);setAdminRuntime(saved);await auditAdmin(req,"Updated Admin runtime controls","configuration",null,{changed:Object.keys(body)});return send(res,200,{ok:true,config:saved});
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/broadcasts')return send(res,200,{ok:true,rows:await storage.listBroadcasts(100)});
    if(req.method==='POST'&&u.pathname==='/api/admin/broadcasts'){
      let raw="";for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      const user=await auth.userFromRequest(req);try{const row=await storage.createBroadcast(body,user.email);await auditAdmin(req,"Created broadcast","communications",null,{broadcastId:row.id,title:row.title});return send(res,201,{ok:true,row})}catch(e){return send(res,400,{ok:false,error:e.message})}
    }
    if(req.method==='POST'&&u.pathname.startsWith('/api/admin/broadcasts/')&&u.pathname.endsWith('/toggle')){
      const id=u.pathname.slice('/api/admin/broadcasts/'.length,-'/toggle'.length),active=String(u.searchParams.get("active"))!=="false";await storage.setBroadcastActive(id,active);await auditAdmin(req,(active?"Activated":"Deactivated")+" broadcast","communications",null,{broadcastId:id,active});return send(res,200,{ok:true});
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/support')return send(res,200,{ok:true,rows:await storage.listSupportTickets(300)});
    if(req.method==='POST'&&u.pathname.startsWith('/api/admin/support/')&&u.pathname.endsWith('/reply')){
      const id=u.pathname.slice('/api/admin/support/'.length,-'/reply'.length);let raw="";for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      const out=await storage.replySupportTicket(id,body,auth.isAdminEmail((await auth.userFromRequest(req))?.email));await auditAdmin(req,"Replied to support ticket","support",null,{ticketId:id,status:body.status});return send(res,200,out);
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/snapshots')return send(res,200,{ok:true,rows:await storage.listAdminSnapshots(100)});
    if(req.method==='POST'&&u.pathname==='/api/admin/snapshots'){
      const user=await auth.userFromRequest(req),payload={adminConfig:await getAdminRuntime(true),featureFlags:await storage.getFeatureFlags()};const row=await storage.saveAdminSnapshot("Operational configuration snapshot",payload,user.email);await auditAdmin(req,"Created configuration snapshot","recovery",null,{snapshotId:row.id});return send(res,201,{ok:true,row,payload});
    }
    if(req.method==='POST'&&u.pathname.startsWith('/api/admin/snapshots/')&&u.pathname.endsWith('/restore')){
      const id=u.pathname.slice('/api/admin/snapshots/'.length,-'/restore'.length),snap=await storage.getAdminSnapshot(id);if(!snap)return send(res,404,{ok:false,error:"Snapshot not found"});await storage.restoreAdminConfig(snap);const saved=await storage.getAdminConfig();setAdminRuntime(saved);await auditAdmin(req,"Restored configuration snapshot","recovery",null,{snapshotId:id});return send(res,200,{ok:true,config:saved});
    }
    if(req.method==='POST'&&u.pathname==='/api/admin/emergency'){
      let raw="";for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      const current=await getAdminRuntime(true),next=Object.assign({},current,body);const saved=await storage.saveAdminConfig(next);setAdminRuntime(saved);await auditAdmin(req,"Changed emergency control state","emergency",null,{changed:Object.keys(body)});return send(res,200,{ok:true,config:saved});
    }
    if(req.method==='GET'&&u.pathname==='/api/account/memory'){
      const user=await auth.userFromRequest(req);if(!user)return send(res,401,{ok:false,error:"Authentication required"});
      try{
        const memory=await storage.getAccountMemory(user.id);
        return send(res,200,{ok:true,user:{id:user.id,email:user.email},memory});
      }catch(e){return send(res,500,{ok:false,error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/account/memory'){
      const user=await auth.userFromRequest(req);if(!user)return send(res,401,{ok:false,error:"Authentication required"});
      let raw="";for await(const chunk of req)raw+=chunk;
      let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      try{return send(res,200,{ok:true,memory:await storage.saveAccountMemory(user.id,body.memory||{})})}catch(e){return send(res,400,{ok:false,error:e.message})}
    }

    if(req.method==='GET'&&u.pathname==='/api/config'){const flags=await storage.getFeatureFlags();return send(res,200,{symbols:SYMBOLS,labels,intervals:['15m','30m','1h','4h','1d'],memory:storage.status(),learning:{state:'LOADING'},phase4:PHASE4_VERSION,phase5:PHASE5_VERSION,phase6:PHASE6_VERSION,phase7:PHASE7_VERSION,phase9:PHASE9_VERSION,phase10:PHASE10_VERSION,phase11:PHASE11_VERSION,phase12:PHASE12_VERSION,phase13:PHASE13_VERSION,adminMode:adminCfg.mode||"normal",maintenance:adminCfg.maintenanceMode,readOnly:adminCfg.readOnlyMode,maintenanceMessage:adminCfg.maintenanceMessage,flags});}if(req.method==='POST'&&u.pathname==='/api/ai'){
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
    
    if(req.method==='GET'&&u.pathname==='/api/fast-ticker'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase();
      if(!SYMBOLS.includes(symbol))return send(res,400,{ok:false,error:'Unsupported symbol'});
      const now=Date.now(),cached=FAST_TICKER_CACHE.get(symbol);
      if(cached&&now-cached.ts<3000)return send(res,200,{ok:true,...cached.payload,cached:true,cacheAgeMs:now-cached.ts});
      try{
        const live=flowBucket(symbol);
        if(Number.isFinite(Number(live.markPrice))&&now-Number(live.lastTs||0)<10000){
          const payload={symbol,price:Number(live.markPrice),source:"Bybit live flow",updatedAt:now};
          FAST_TICKER_CACHE.set(symbol,{ts:now,payload});
          return send(res,200,{ok:true,...payload});
        }
        const snapshot=await Promise.race([
          dataFabric.krakenSnapshot(symbol),
          dataFabric.coinbaseSnapshot(symbol)
        ]);
        const payload={symbol,price:Number(snapshot.price),source:snapshot.name,updatedAt:now};
        FAST_TICKER_CACHE.set(symbol,{ts:now,payload});
        return send(res,200,{ok:true,...payload});
      }catch(e){
        if(cached)return send(res,200,{ok:true,...cached.payload,stale:true,cacheAgeMs:now-cached.ts});
        return send(res,503,{ok:false,error:String(e.message||e)});
      }
    }
    if(req.method==='GET'&&u.pathname==='/api/decision'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol)||!['15m','30m','1h','4h','1d'].includes(interval))return send(res,400,{ok:false,error:'Unsupported symbol or interval'});
      try{
        const payload=await Promise.race([
          buildDecisionSnapshot(symbol,interval,u.searchParams),
          new Promise((_,reject)=>setTimeout(()=>reject(new Error('DECISION_ENGINE_TIMEOUT')),8500))
        ]);
        return send(res,200,payload);
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e),phase9:PHASE9_VERSION,phase10:PHASE10_VERSION})}
    }
    if(req.method==='GET'&&u.pathname==='/api/core'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{error:'Unsupported symbol'});
      try{
        const candles=await getFastKlines(symbol,interval);
        if(!candles||candles.length<220)throw Error('Insufficient candles');
        const analysis=analyze(candles,{interval,lower:null,higher:null,deriv:null});
        const analytics=queueCoreAnalytics(symbol,interval,candles);
        return send(res,200,{
          ok:true,symbol,interval,candles,analysis,derivatives:null,learning:null,
          backtest:analytics?.backtest||null,validation:analytics?.validation||null,setupStats:analytics?.setupStats||null,
          source:candles?.[0]?.source||'market data',dataConsensus:null,
          phase2:PHASE2_VERSION,phase3:PHASE3_VERSION,phase4:PHASE4_VERSION,
          dataQuality:{candleCount:candles.length,candleAgeMs:candles.length?Math.max(0,Date.now()-Number(candles[candles.length-1].t)):null,derivativesAvailable:false},
          updatedAt:Date.now(),performance:{fastPath:true,enrichmentBackground:true,analyticsBackground:true}
        });
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e),source:'market data'})}
    }
    if(req.method==='GET'&&u.pathname==='/api/core-enrichment'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{ok:false,error:'Unsupported symbol'});
      try{
        const base=await getFastKlines(symbol,interval);
        const [lower,higher,deriv]=await Promise.all([
          interval==='15m'?Promise.resolve(null):Promise.race([klines(symbol,'15m'),new Promise(resolve=>setTimeout(()=>resolve(null),2200))]).catch(()=>null),
          interval==='4h'?Promise.resolve(null):Promise.race([klines(symbol,'4h'),new Promise(resolve=>setTimeout(()=>resolve(null),2200))]).catch(()=>null),
          Promise.race([derivatives(symbol,interval),new Promise(resolve=>setTimeout(()=>resolve(null),2200))]).catch(()=>null)
        ]);
        let analysis=analyze(base,{interval,
          lower:lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null,
          higher:higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null,
          deriv
        });
        let learned=null;
        try{learned=await learning.process(symbol,interval,base,analysis)}catch{}
        try{phase4.updateLive(requestDevice(req),symbol,interval,learned?.analysis||analysis,base).catch(()=>{})}catch{}
        return send(res,200,{ok:true,symbol,interval,
          analysis:learned?.analysis||analysis,
          lower:lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null,
          higher:higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null,
          derivatives:deriv,learning:learned?await learning.status().catch(()=>null):null,updatedAt:Date.now()
        });
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e)})}
    }
    if(req.method==='GET'&&u.pathname==='/api/core-analytics'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{ok:false,error:'Unsupported symbol'});
      if(!['15m','30m','1h','4h','1d'].includes(interval))return send(res,400,{ok:false,error:'Unsupported interval'});
      try{
        const key=symbol+'|'+interval,cached=CORE_ANALYTICS_CACHE.get(key);
        if(cached&&Date.now()-cached.ts<CORE_ANALYTICS_TTL)return send(res,200,{ok:true,ready:true,symbol,interval,...cached.payload,updatedAt:cached.ts});
        const candles=await getFastKlines(symbol,interval),payload=queueCoreAnalytics(symbol,interval,candles);
        if(payload)return send(res,200,{ok:true,ready:true,symbol,interval,...payload,updatedAt:Date.now()});
        return send(res,200,{ok:true,ready:false,symbol,interval,message:'Analytics are warming up.'});
      }catch(e){return send(res,503,{ok:false,ready:false,error:String(e.message||e)})}
    }

    if(req.method==='GET'&&u.pathname==='/api/validation'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{ok:false,error:'Unsupported symbol'});
      if(!['15m','30m','1h','4h','1d'].includes(interval))return send(res,400,{ok:false,error:'Unsupported interval'});
      try{
        const cached=PHASE1113_CACHE.get("P11-13|"+symbol+"|"+interval);
        if(cached&&Date.now()-cached.ts<PHASE1113_TTL)return send(res,200,{ok:true,ready:true,symbol,interval,...cached.payload,updatedAt:cached.ts});
        const candles=closedCandles(await getFastKlines(symbol,interval),interval,Date.now());
        const validation=queuePhase1113Validation(symbol,interval,candles);
        if(validation)return send(res,200,{ok:true,ready:true,symbol,interval,...validation,updatedAt:Date.now()});
        return send(res,200,{ok:true,ready:false,symbol,interval,message:'Validation is warming up in the background.',phase11:PHASE11_VERSION,phase12:PHASE12_VERSION,phase13:PHASE13_VERSION});
      }catch(e){return send(res,503,{ok:false,ready:false,error:String(e.message||e),phase11:PHASE11_VERSION,phase12:PHASE12_VERSION,phase13:PHASE13_VERSION})}
    }
    if(req.method==='GET'&&u.pathname==='/api/data-fabric'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{ok:false,error:'Unsupported symbol'});
      try{
        const candles=await getFastKlines(symbol,interval);
        const consensus=await Promise.race([
          dataFabric.assess(symbol,interval,{primaryPrice:candles?.[candles.length-1]?.c,primaryAgeMs:candles?.[candles.length-1]?.t?Date.now()-Number(candles[candles.length-1].t):null,primarySource:candles?.[0]?.source,liveFlow:flowBucket(symbol)}),
          new Promise(resolve=>setTimeout(()=>resolve(null),2500))
        ]).catch(()=>null);
        return send(res,200,{ok:Boolean(consensus),symbol,interval,consensus});
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e)})}
    }
    if(req.method==='GET'&&u.pathname==='/api/propfirm'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{ok:false,error:'Unsupported symbol'});
      try{
        const core=await Promise.race([
          (async()=>{
            const candles=await klines(symbol,interval);
            if(!candles||candles.length<220)throw new Error("Insufficient candles");
            const lower=interval==='15m'?null:await Promise.race([klines(symbol,'15m'),new Promise(resolve=>setTimeout(()=>resolve(null),1200))]).catch(()=>null);
            const higher=interval==='4h'?null:await Promise.race([klines(symbol,'4h'),new Promise(resolve=>setTimeout(()=>resolve(null),1200))]).catch(()=>null);
            const deriv=await Promise.race([derivatives(symbol,interval),new Promise(resolve=>setTimeout(()=>resolve(null),2500))]).catch(()=>null);
            const consensus=await Promise.race([
              dataFabric.assess(symbol,interval,{primaryPrice:candles?.[candles.length-1]?.c,primaryAgeMs:candles?.[candles.length-1]?.t?Date.now()-Number(candles[candles.length-1].t):null,primarySource:candles?.[0]?.source,liveFlow:flowBucket(symbol)}),
              new Promise(resolve=>setTimeout(()=>resolve(null),1200))
            ]).catch(()=>null);
            const analysis=analyze(candles,{interval,lower:lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null,higher:higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null,deriv});
            const config=propFirm.normalizeConfig({
              accountSize:Number(u.searchParams.get('accountSize')||process.env.PROP_ACCOUNT_SIZE||5000),
              startingEquity:Number(u.searchParams.get('equity')||process.env.PROP_STARTING_EQUITY||5000),
              dailyLossLimitPct:Number(u.searchParams.get('dailyLossLimitPct')||process.env.PROP_DAILY_LOSS_PCT||3),
              maxDrawdownPct:Number(u.searchParams.get('maxDrawdownPct')||process.env.PROP_MAX_DRAWDOWN_PCT||6),
              riskPerTradePct:Number(u.searchParams.get('riskPerTradePct')||process.env.PROP_RISK_PER_TRADE_PCT||0.5),
              maxOpenRiskPct:Number(u.searchParams.get('maxOpenRiskPct')||process.env.PROP_MAX_OPEN_RISK_PCT||1),
              minSignalScore:Number(u.searchParams.get('minSignalScore')||process.env.PROP_MIN_SIGNAL_SCORE||72),
              minRR:Number(u.searchParams.get('minRR')||process.env.PROP_MIN_RR||1.5),
              minConsensusQualityPct:Number(u.searchParams.get('minConsensusQualityPct')||process.env.PROP_MIN_CONSENSUS_QUALITY_PCT||85),
              maxPriceDispersionBps:Number(u.searchParams.get('maxPriceDispersionBps')||process.env.PROP_MAX_PRICE_DISPERSION_BPS||80),
              blockMixedFlow:String(u.searchParams.get('blockMixedFlow')||process.env.PROP_BLOCK_MIXED_FLOW||"true")!=="false"
            });
            const gate=propFirm.evaluateStandard({
              analysis,derivatives:deriv,
              dataQuality:{candleAgeMs:candles.length?Math.max(0,Date.now()-Number(candles[candles.length-1].t)):null,qualityPct:deriv?.available?100:80,consensusQualityPct:consensus?.consensusQualityPct,priceDispersionBps:consensus?.priceDispersionBps,providerCount:consensus?.sourceCount,independentSourceCount:consensus?.independentSourceCount},
              equity:config.startingEquity,dayStartEquity:config.startingEquity,peakEquity:config.startingEquity,config
            });
            return {symbol,interval,analysis,derivatives:deriv,consensus,gate,updatedAt:Date.now()};
          })(),
          new Promise((_,reject)=>setTimeout(()=>reject(new Error("PROP_EVAL_TIMEOUT")),7000))
        ]);
        return send(res,200,{ok:true,...core});
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e)})}
    }
    if(req.method==='GET'&&u.pathname==='/api/propfirm/event'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'15m';
      if(!SYMBOLS.includes(symbol))return send(res,400,{ok:false,error:'Unsupported symbol'});
      try{
        const candles=await klines(symbol,interval);
        if(!candles||candles.length<220)throw new Error("Insufficient candles");
        const lower=interval==='15m'?null:await Promise.race([klines(symbol,'15m'),new Promise(resolve=>setTimeout(()=>resolve(null),1000))]).catch(()=>null);
        const higher=await Promise.race([klines(symbol,'4h'),new Promise(resolve=>setTimeout(()=>resolve(null),1000))]).catch(()=>null);
        const deriv=await Promise.race([derivatives(symbol,interval),new Promise(resolve=>setTimeout(()=>resolve(null),2200))]).catch(()=>null);
        const consensus=await Promise.race([
          dataFabric.assess(symbol,interval,{primaryPrice:candles?.[candles.length-1]?.c,primaryAgeMs:candles?.[candles.length-1]?.t?Date.now()-Number(candles[candles.length-1].t):null,primarySource:candles?.[0]?.source,liveFlow:flowBucket(symbol)}),
          new Promise(resolve=>setTimeout(()=>resolve(null),1200))
        ]).catch(()=>null);
        const analysis=analyze(candles,{interval,lower:lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null,higher:higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null,deriv});
        const config=propFirm.normalizeConfig({
          accountSize:Number(u.searchParams.get('accountSize')||process.env.PROP_ACCOUNT_SIZE||5000),
          startingEquity:Number(u.searchParams.get('equity')||process.env.PROP_STARTING_EQUITY||5000),
          dailyLossLimitPct:Number(u.searchParams.get('dailyLossLimitPct')||process.env.PROP_DAILY_LOSS_PCT||3),
          maxDrawdownPct:Number(u.searchParams.get('maxDrawdownPct')||process.env.PROP_MAX_DRAWDOWN_PCT||6),
          riskPerTradePct:Number(u.searchParams.get('riskPerTradePct')||process.env.PROP_RISK_PER_TRADE_PCT||0.5),
          maxOpenRiskPct:Number(u.searchParams.get('maxOpenRiskPct')||process.env.PROP_MAX_OPEN_RISK_PCT||1),
          minSignalScore:Number(u.searchParams.get('minSignalScore')||process.env.PROP_MIN_SIGNAL_SCORE||72),
          minRR:Number(u.searchParams.get('minRR')||process.env.PROP_MIN_RR||1.5),
          minConsensusQualityPct:Number(u.searchParams.get('minConsensusQualityPct')||process.env.PROP_MIN_CONSENSUS_QUALITY_PCT||85),
          maxPriceDispersionBps:Number(u.searchParams.get('maxPriceDispersionBps')||process.env.PROP_MAX_PRICE_DISPERSION_BPS||80),
          eventMinSecondsToExpiry:Number(u.searchParams.get('eventMinSecondsToExpiry')||process.env.PROP_EVENT_MIN_SECONDS_TO_EXPIRY||30),
          eventMinStrikeDistanceBps:Number(u.searchParams.get('eventMinStrikeDistanceBps')||process.env.PROP_EVENT_MIN_STRIKE_DISTANCE_BPS||1),
          blockMixedFlow:String(u.searchParams.get('blockMixedFlow')||process.env.PROP_BLOCK_MIXED_FLOW||"true")!=="false"
        });
        const optionalNumber=(name,fallback=null)=>{
          const raw=u.searchParams.get(name);
          if(raw===null||String(raw).trim()==="")return fallback;
          const n=Number(raw);
          return Number.isFinite(n)?n:fallback;
        };
        const gate=propFirm.evaluateEventContract({
          analysis,derivatives:deriv,
          dataQuality:{candleAgeMs:candles.length?Math.max(0,Date.now()-Number(candles[candles.length-1].t)):null,qualityPct:deriv?.available?100:80,consensusQualityPct:consensus?.consensusQualityPct,priceDispersionBps:consensus?.priceDispersionBps,providerCount:consensus?.sourceCount,independentSourceCount:consensus?.independentSourceCount},
          equity:config.startingEquity,dayStartEquity:config.startingEquity,peakEquity:config.startingEquity,
          side:String(u.searchParams.get('side')||"").toUpperCase(),
          premium:optionalNumber('premium'),
          payout:optionalNumber('payout',0),
          fee:optionalNumber('fee',0),
          venue:String(u.searchParams.get('venue')||"GENERIC").toUpperCase(),
          strikePrice:optionalNumber('strikePrice'),
          indexPrice:optionalNumber('indexPrice',consensus?.medianPrice),
          expirationAt:optionalNumber('expirationAt'),
          strictContractContext:String(u.searchParams.get('strictContractContext')||"false")!=="false",
          config
        });
        return send(res,200,{ok:true,symbol,interval,analysis,derivatives:deriv,consensus,gate,updatedAt:Date.now()});
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e)})}
    }

    if(req.method==='GET'&&u.pathname==='/api/research/catalog')return send(res,200,{ok:true,version:research.VERSION,sources:research.CATALOG,updatedAt:Date.now()});
    if(req.method==='GET'&&u.pathname==='/api/research/status')return send(res,200,{ok:true,...RESEARCH_JOB});
    if(req.method==='POST'&&u.pathname==='/api/research/train'){
      if(RESEARCH_JOB.running)return send(res,409,{ok:false,error:"RESEARCH_JOB_ALREADY_RUNNING",job:RESEARCH_JOB});
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      const bars=Math.max(300,Math.min(15000,Number(u.searchParams.get('bars')||5000)));
      RESEARCH_JOB={running:true,startedAt:Date.now(),finishedAt:null,error:null,symbol,interval,bars,records:0,trained:0,skipped:0,mode:"manual",progress:{processed:0,total:0,pct:0}};
      setImmediate(async()=>{
        try{
          const built=await research.buildReplayRecords({symbol,interval,bars,analyze,onProgress:async function(progress){RESEARCH_JOB.progress=progress}});
          RESEARCH_JOB.records=built.records.length;
          RESEARCH_JOB.progress={processed:built.bars,total:built.bars,pct:100};
          const trained=await learning.trainFromReplay(built.records);
          RESEARCH_JOB.trained=trained.trained;RESEARCH_JOB.skipped=trained.skipped;
          RESEARCH_JOB.running=false;RESEARCH_JOB.finishedAt=Date.now();
        }catch(e){
          RESEARCH_JOB.running=false;RESEARCH_JOB.finishedAt=Date.now();RESEARCH_JOB.error=String(e.message||e);
        }
      });
      return send(res,202,{ok:true,job:RESEARCH_JOB});
    }

    if(req.method==='GET'&&u.pathname==='/api/chart'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase();
      const interval=u.searchParams.get('interval')||'1h';
      const allowed=['15m','30m','1h','4h','1d'];
      if(!SYMBOLS.includes(symbol)||!allowed.includes(interval))return send(res,400,{error:'Unsupported chart symbol or interval'});
      try{
        const candles=await klines(symbol,interval);
        return send(res,200,{ok:true,symbol,interval,candles:candles||[],updatedAt:Date.now(),source:candles?.[0]?.source||'market-feed'});
      }catch(e){return send(res,503,{ok:false,error:e.message||'Chart data unavailable',symbol,interval})}
    }

    if(req.method==='GET'&&u.pathname==='/api/core-flow'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{error:'Unsupported symbol'});
      try{
        const warm=mergeFlowSnapshot(symbol,{provider:"Bybit linear futures · live stream"});
        const result=await Promise.race([
          Promise.allSettled([bybitDerivatives(symbol,interval),derivatives(symbol,interval)]).then(function(rs){
            for(const r of rs){if(r.status==="fulfilled"&&r.value)return mergeFlowSnapshot(symbol,r.value)}
            return warm;
          }),
          new Promise(resolve=>setTimeout(()=>resolve(warm),6500))
        ]);
        const data=mergeFlowSnapshot(symbol,result||warm);
        data.provider=(data.provider||"Bybit linear futures")+(data.liveConnected||data.livePointCount?" · live stream":"");
        return send(res,200,{ok:true,data});
      }catch(e){
        return send(res,200,{ok:true,data:mergeFlowSnapshot(symbol,{provider:"Bybit live stream"}),error:String(e.message||e)});
      }
    }

    if(req.method==='GET'&&u.pathname==='/api/core-scan'){
      const interval=u.searchParams.get('interval')||'1h',hit=SCAN_CACHE.get(interval);
      if(hit&&Date.now()-hit.ts<SCAN_TTL)return send(res,200,hit.payload);
      const scanOne=async symbol=>{
        try{
          const candles=await Promise.race([klines(symbol,interval),new Promise((_,reject)=>setTimeout(()=>reject(Error('Primary scan timeout')),6500))]);
          if(!candles||candles.length<220)throw Error('Insufficient candles');
          const higher=interval==='4h'?null:await Promise.race([klines(symbol,'4h'),new Promise(resolve=>setTimeout(()=>resolve(null),1100))]).catch(()=>null);
          const lower=interval==='15m'?null:await Promise.race([klines(symbol,'15m'),new Promise(resolve=>setTimeout(()=>resolve(null),1100))]).catch(()=>null);
          let analysis=analyze(candles,{interval,lower:lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null,higher:higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null,deriv:null});
          try{const learned=await Promise.race([learning.process(symbol,interval,candles,analysis),new Promise(resolve=>setTimeout(()=>resolve(null),200))]);if(learned?.analysis)analysis=learned.analysis}catch{}
          return{symbol,label:labels[symbol]||symbol,price:analysis.price,change24h:analysis.change24h,regime:analysis.regime,side:analysis.side,type:analysis.type,status:analysis.status,score:analysis.score,bias:analysis.bias,probabilityLabel:analysis.probabilityLabel,structure:analysis.structure,derivatives:null};
        }catch(e){
          return{symbol,label:labels[symbol]||symbol,status:'WAITING',side:'WAIT',score:0,error:e.message};
        }
      };
      const rows=await Promise.all(SYMBOLS.map(scanOne));
      const payload={ok:true,interval,rows,updatedAt:Date.now(),cacheTtlMs:SCAN_TTL,mode:"fast-cached-scan-v2"};
      SCAN_CACHE.set(interval,{ts:Date.now(),payload});return send(res,200,payload);
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

    if(req.method==='GET'&&u.pathname==='/api/portfolio'){
      const interval=u.searchParams.get('interval')||'1h';
      const lookback=Math.min(180,Math.max(20,Number(u.searchParams.get('lookback')||60)));
      try{
        const [sets,ex,p6]=await Promise.all([
          Promise.all(SYMBOLS.map(async sym=>({symbol:sym,candles:await klines(sym,interval)}))),
          execution.snapshot(),
          phase6.snapshot()
        ]);
        const series={};const assets=[];
        for(const row of sets){
          series[row.symbol]=row.candles||[];
          const a=analyze(row.candles||[],{interval});
          const pos=(ex.positions||[]).filter(x=>x.symbol===row.symbol);
          const ord=(ex.orders||[]).filter(x=>x.symbol===row.symbol&&!["CANCELLED","REJECTED","EXPIRED","CLOSED"].includes(x.status));
          assets.push({
            symbol:row.symbol,label:labels[row.symbol]||row.symbol,price:a.price,change24h:a.change24h,regime:a.regime,
            side:a.side,status:a.status,score:a.score,positionQty:pos.reduce((s,x)=>s+(Number(x.qty)||0),0),
            activeOrders:ord.length,exposurePct:null,riskPct:null
          });
        }
        const cfg=Object.assign({},p6.config,{account:ex.config?.account??p6.config.account});
        let portfolio=phase6.buildPortfolio(cfg,ex.positions||[],ex.orders||[],Object.fromEntries(Object.entries(series).map(([s,v])=>[s,v.slice(-(lookback+1))])));
        assets.forEach(x=>{x.exposurePct=portfolio.exposureBySymbol[x.symbol]||0;x.riskPct=portfolio.riskBySymbol[x.symbol]||0});
        portfolio=await phase6.savePortfolio(Object.assign(portfolio,{interval,lookback,assets}));
        return send(res,200,{ok:true,interval,lookback,config:cfg,assets,portfolio:portfolio.portfolio,events:portfolio.events,updatedAt:Date.now()});
      }catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/portfolio/config'){
      let raw="";for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      try{return send(res,200,await phase6.setConfig({
        account:body.account,maxPortfolioRiskPct:body.maxPortfolioRiskPct,maxSymbolExposurePct:body.maxSymbolExposurePct,
        maxCorrelatedClusterRiskPct:body.maxCorrelatedClusterRiskPct,correlationLookback:body.correlationLookback,
        correlationBlockThreshold:body.correlationBlockThreshold,stressMovePct:body.stressMovePct
      }))}catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/portfolio/health'){
      try{const x=await phase6.snapshot();return send(res,200,{ok:true,config:x.config,portfolio:x.portfolio,events:x.events,updatedAt:x.updatedAt})}catch(e){return send(res,503,{ok:false,error:e.message})}
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
          try{await storage.saveSignalDNA(records)}catch{}
        }
        try{await learning.trainFromReplay(records)}catch{}
        return send(res,200,{ok:true,filters:{symbol:symbol||"ALL",interval:interval||"ALL"},summary:summarizeDNA(records),records:records.slice(0,limit),learning:await learning.status(),updatedAt:Date.now()});
      }catch(e){return send(res,503,{ok:false,error:e.message})}
    }

    if(req.method==='GET'&&u.pathname==='/api/system-check'){
      const checks={server:true,marketEngine:true,learning:false,memory:false,marketData:false,derivatives:false,oi:false,cvd:false,liquidations:false,execution:false,portfolio:false,phase7:false,coreAnalytics:true,decisionEngine:false,phase11_13:false};
      let marketError=null,derivativesError=null;
      try{checks.learning=Boolean(await learning.status())}catch(e){}
      try{checks.memory=Boolean(storage.status())}catch(e){}
      let marketRows=null;
      try{marketRows=await klines('BTCUSDT','1h');checks.marketData=Boolean(marketRows&&marketRows.length>=50)}catch(e){marketError=e.message}
      try{
        const d=await Promise.race([derivatives('BTCUSDT','15m'),new Promise(resolve=>setTimeout(()=>resolve(null),6500))]);
        checks.derivatives=Boolean(d&&d.available);checks.oi=Boolean(Number.isFinite(Number(d?.oi)));
        checks.cvd=Boolean(Number.isFinite(Number(d?.cvdDelta))||["BUYERS PRESSURE","SELLERS PRESSURE","BALANCED"].includes(d?.cvdState));
        checks.liquidations=Boolean(d&&(d.liveConnected||Number(d.livePointCount)>0||Array.isArray(d?.series?.liq)&&d.series.liq.length>1));
        if(!checks.derivatives)derivativesError="No derivatives provider returned usable data";
      }catch(e){derivativesError=String(e.message||e)}
      try{checks.execution=Boolean(await execution.snapshot())}catch(e){checks.execution=false}
      try{checks.portfolio=Boolean(await phase6.snapshot())}catch(e){checks.portfolio=false}
      try{const st=phase7.selfTest();checks.phase7=Boolean(st&&st.ok)}catch(e){checks.phase7=false}
      try{const st=phase910.selfTest();checks.decisionEngine=Boolean(st&&st.ok)}catch(e){checks.decisionEngine=false}
      try{const st=phase1113.selfTest();checks.phase11_13=Boolean(st&&st.ok)}catch(e){checks.phase11_13=false}
      const result={ok:Object.values(checks).every(Boolean),checks,marketError,derivativesError,phase2:PHASE2_VERSION,phase3:PHASE3_VERSION,phase4:PHASE4_VERSION,phase5:PHASE5_VERSION,phase6:PHASE6_VERSION,phase7:PHASE7_VERSION,phase9:PHASE9_VERSION,phase10:PHASE10_VERSION,phase11:PHASE11_VERSION,phase12:PHASE12_VERSION,phase13:PHASE13_VERSION,routes:{core:true,chart:true,coreAnalytics:true,decision:true,validation:true,coreScan:true,coreFlow:true,cycle:true,ai:true,memory:true,learning:true,replay:true,dna:true,research:true,edge:true,edgeHealth:true,edgeConfig:true,edgeJournal:true,execution:true,executionConfig:true,executionArm:true,executionKill:true,executionReconcile:true,portfolio:true,portfolioConfig:true,phase7Analytics:true,phase7Health:true},timestamp:Date.now()};await auditAdmin(req,"Ran full system check","system",null,{ok:result.ok,checks});return send(res,200,result);
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
server.listen(PORT,()=>{
  console.log('MarketPulse OS listening on :'+PORT);
  setTimeout(()=>{runResearchWarmup().catch(()=>{})},12000);
});