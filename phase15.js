/*
  MarketPulse Phase 15 — Signal Validation, Replay & Calibration Lab
  -------------------------------------------------------------------
  Phase 15 turns every final decision into measurable telemetry:
  - final/live-eligible signals
  - suppressed/missed candidates
  - gate reasons
  - setup/regime buckets
  - resolved outcome summaries
  - calibration readiness

  It is deliberately observational. It does not invent future outcomes and
  it does not bypass the existing risk/deployment gates.
*/

const storage=require("./storage");

const VERSION="15.0.0";
const MAX_AUDIT=5000;

function n(x,d=null){return Number.isFinite(Number(x))?Number(x):d}
function s(x,d=""){return x===null||x===undefined?d:String(x)}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function pct(n0,d0){return d0?Number((n0/d0*100).toFixed(2)):0}

function setupKey(decision={}){
  return s(
    decision?.phase14?.intelligence?.setupKey ||
    decision?.analysis?.strategyFamily ||
    decision?.market?.type ||
    decision?.candidateEvidence?.strategyFamily ||
    "NONE"
  ).toUpperCase();
}

function reasonBuckets(decision={}){
  const text=[
    ...(Array.isArray(decision?.reasons)?decision.reasons:[]),
    ...(Array.isArray(decision?.contributors)?decision.contributors:[]),
    s(decision?.deploymentGate?.reason),
    s(decision?.candidateEvidence?.thesis),
    s(decision?.evidence?.thesis)
  ].filter(Boolean).join(" | ").toLowerCase();

  const out=[];
  const add=(key,match)=>{if(match.test(text)&&!out.includes(key))out.push(key)};
  add("15M_CONFLICT",/15m.*conflict|15m.*working against/);
  add("4H_CONFLICT",/4h.*conflict|higher-timeframe.*conflict/);
  add("RR",/r:r|rr|risk.?reward/);
  add("CVD",/cvd.*diverg|cvd.*confirm|aggressive flow/);
  add("OI",/open interest|oi conflict|positioning/);
  add("DATA",/data quality|stale|fresh|consensus|price dispersion/);
  add("VALIDATION",/validation|historical validation|evidence/);
  add("REACTION",/reaction|sweep|reclaim/);
  add("SCORE",/confluence score|below.*threshold|min.?score/);
  add("RISK",/risk gate|risk blocked|max daily|max open risk/);
  add("STABILITY",/stability|confirmation/);
  if(!out.length&&text)out.push("OTHER");
  return out;
}

function bucketSummary(rows,keyFn){
  const map=new Map();
  for(const row of rows){
    const key=keyFn(row)||"UNKNOWN";
    const g=map.get(key)||{key,n:0,eligible:0,suppressed:0,resolved:0,wins:0,losses:0,netR:0};
    g.n++;
    if(row.liveSignalEligible)g.eligible++;else if(["LONG","SHORT"].includes(row.rawAction))g.suppressed++;
    map.set(key,g);
  }
  return Array.from(map.values()).map(g=>({
    ...g,
    suppressionRate:g.suppressed?Number((g.suppressed/Math.max(1,g.eligible+g.suppressed)*100).toFixed(2)):0,
    winRate:g.resolved?pct(g.wins,g.resolved):null,
    expectancyR:g.resolved?Number((g.netR/g.resolved).toFixed(3)):null
  })).sort((a,b)=>b.n-a.n);
}

async function readState(){
  const r=await storage.getLearningState();
  return {storage:r.storage,payload:r.payload&&typeof r.payload==="object"?r.payload:{}};
}

async function writeState(payload){
  return storage.saveLearningState(payload);
}

async function recordDecision({symbol,interval,candleTs,decision,analysis}={}){
  if(!symbol||!interval||!Number.isFinite(Number(candleTs))||!decision)return {recorded:false,reason:"missing_input"};
  const {payload}=await readState();
  const p15=payload.phase15&&typeof payload.phase15==="object"?payload.phase15:{
    version:VERSION,
    audit:[],
    counters:{decisions:0,eligible:0,suppressed:0}
  };

  const rawAction=s(decision.rawAction||decision?.candidateEvidence?.action||analysis?.side||decision?.action||"WAIT").toUpperCase();
  const finalAction=s(decision.action||"WAIT").toUpperCase();
  const liveSignalEligible=Boolean(decision.liveSignalEligible===true&&decision.state==="READY"&&["LONG","SHORT"].includes(finalAction));
  const missedCandidate=!liveSignalEligible&&["LONG","SHORT"].includes(rawAction);

  const row={
    id:[symbol,interval,candleTs,rawAction,s(decision.market?.type||decision.type,"NONE")].join("|"),
    ts:Date.now(),
    symbol,interval,candleTs:Number(candleTs),
    rawAction,finalAction,
    liveSignalEligible,
    missedCandidate,
    finalState:s(decision.state,"NO_TRADE"),
    gateState:s(decision.deploymentGate?.state,"UNKNOWN"),
    gateReason:s(decision.deploymentGate?.reason,""),
    setupKey:setupKey(decision),
    regime:s(decision.market?.regime||analysis?.regime,"UNKNOWN"),
    score:n(decision.market?.confluenceScore??analysis?.score,0),
    rr:n(decision.levels?.rr??analysis?.rr),
    type:s(decision.market?.type||decision.type,"NONE"),
    reasonBuckets:reasonBuckets(decision),
    reasons:(Array.isArray(decision.reasons)?decision.reasons:[]).slice(0,8),
    contributors:(Array.isArray(decision.contributors)?decision.contributors:[]).slice(0,8),
    reactionState:s(decision?.analysis?.reactionMap?.active?.state||decision?.reactionMap?.active?.state,""),
    candidateEvidence:decision.candidateEvidence?{
      action:s(decision.candidateEvidence.action,"WAIT"),
      state:s(decision.candidateEvidence.state,""),
      type:s(decision.candidateEvidence.type,""),
      strategyFamily:s(decision.candidateEvidence.strategyFamily,"NONE"),
      thesis:s(decision.candidateEvidence.thesis,"")
    }:null
  };

  const existingIndex=p15.audit.findIndex(x=>x.id===row.id);
  if(existingIndex>=0)p15.audit[existingIndex]=row;
  else p15.audit.push(row);

  p15.audit=p15.audit.slice(-MAX_AUDIT);
  p15.counters.decisions=p15.audit.length;
  p15.counters.eligible=p15.audit.filter(x=>x.liveSignalEligible).length;
  p15.counters.suppressed=p15.audit.filter(x=>x.missedCandidate).length;
  p15.lastAt=Date.now();

  payload.phase15=p15;
  await writeState(payload);
  return {recorded:true,missedCandidate,liveSignalEligible};
}

async function calibration({symbol=null,interval=null,limit=5000}={}){
  const {payload}=await readState();
  const audit=Array.isArray(payload.phase15?.audit)?payload.phase15.audit:[];
  const filtered=audit.filter(x=>
    (!symbol||x.symbol===symbol)&&(!interval||x.interval===interval)
  );
  const resolved=await storage.getLearningPredictions({symbol,interval,limit,resolvedOnly:true});
  const finalGated=resolved.filter(x=>x?.features?.source==="FINAL_GATED");

  const setupMap=new Map();
  const regimeMap=new Map();
  for(const p of finalGated){
    const setup=s(p.features?.setupKey||p.type,"UNKNOWN").toUpperCase();
    const regime=s(p.regime,"UNKNOWN");
    for(const [map,key] of [[setupMap,setup],[regimeMap,regime]]){
      const g=map.get(key)||{key,n:0,wins:0,losses:0,netR:0};
      const isWin=String(p.outcome||"").toUpperCase()==="WIN";
      const isLoss=String(p.outcome||"").toUpperCase()==="LOSS";
      g.n++;if(isWin)g.wins++;if(isLoss)g.losses++;g.netR+=n(p.resultR,0)||0;
      map.set(key,g);
    }
  }

  const suppress= bucketSummary(filtered,x=>x.setupKey);
  const regimes=suppress.length?bucketSummary(filtered,x=>x.regime):[];
  const eligible=filtered.filter(x=>x.liveSignalEligible).length;
  const suppressed=filtered.filter(x=>x.missedCandidate).length;
  const outcomeN=finalGated.length;
  const netR=finalGated.reduce((a,x)=>a+(n(x.resultR,0)||0),0);

  const setupOutcomes=Array.from(setupMap.values()).map(g=>({
    ...g,winRate:pct(g.wins,g.n),expectancyR:g.n?Number((g.netR/g.n).toFixed(3)):0
  })).sort((a,b)=>b.n-a.n);

  const regimeOutcomes=Array.from(regimeMap.values()).map(g=>({
    ...g,winRate:pct(g.wins,g.n),expectancyR:g.n?Number((g.netR/g.n).toFixed(3)):0
  })).sort((a,b)=>b.n-a.n);

  const readiness={
    auditSamples:filtered.length,
    resolvedFinalSignals:outcomeN,
    calibrationEvidence:outcomeN>=80,
    note:outcomeN>=80
      ?"Enough final-gated outcomes exist to make setup/regime calibration statistically more useful, subject to sample composition and non-stationarity."
      :"Continue collecting resolved final-gated outcomes before using setup/regime statistics to change thresholds automatically."
  };

  return {
    version:VERSION,
    symbol,interval,
    auditSamples:filtered.length,
    eligible,
    suppressed,
    suppressionRate:pct(suppressed,eligible+suppressed),
    resolvedFinalSignals:outcomeN,
    resolvedNetR:Number(netR.toFixed(3)),
    setupSuppression:suppress,
    regimeSuppression:regimes,
    setupOutcomes,
    regimeOutcomes,
    readiness,
    generatedAt:Date.now()
  };
}

async function snapshot(opts={}){
  const c=await calibration(opts);
  const {payload}=await readState();
  return {
    version:VERSION,
    counters:payload.phase15?.counters||{decisions:0,eligible:0,suppressed:0},
    lastAt:payload.phase15?.lastAt||null,
    calibration:c
  };
}

async function audit({symbol=null,interval=null,limit=200}={}){
  const {payload}=await readState();
  const rows=Array.isArray(payload.phase15?.audit)?payload.phase15.audit:[];
  return rows.filter(x=>(!symbol||x.symbol===symbol)&&(!interval||x.interval===interval)).slice(-Math.max(1,Math.min(Number(limit)||200,1000))).reverse();
}

function selfTest(){return {ok:VERSION==="15.0.0"&&typeof recordDecision==="function"&&typeof calibration==="function"&&typeof snapshot==="function"&&typeof audit==="function",version:VERSION};}
module.exports={VERSION,recordDecision,calibration,snapshot,audit};
