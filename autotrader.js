/*
 * MarketPulse Phase 17 — AutoTrader
 * Strategy routing and execution planning are deterministic and fail-closed.
 * This module never enables production trading by itself.
 */

const VERSION="17.1.0";

const STRATEGIES={
  SCALP:{intervals:["15m","30m"],riskPct:0.25,expectedHoldBars:16},
  INTRADAY:{intervals:["15m","1h"],riskPct:0.50,expectedHoldBars:12},
  SWING:{intervals:["1h","4h"],riskPct:0.75,expectedHoldBars:6},
  POSITION:{intervals:["4h","1d"],riskPct:1.00,expectedHoldBars:3}
};

const DEFAULT_CONFIG={
  enabled:false,
  mode:"PAPER",
  symbols:["BTCUSDT"],
  strategies:{SCALP:true,INTRADAY:true,SWING:true,POSITION:false},
  riskByStrategy:{SCALP:0.25,INTRADAY:0.50,SWING:0.75,POSITION:1.00},
  maxPositions:1,
  maxDailyTrades:4,
  cooldownMs:600000,
  easyMode:true,
  weekdayOnly:true,
  autoManage:true,
  minScore:72,
  minRR:1.2,
  minDataScore:80,
  requireConfirmed:false
};

function finite(x,f=null){return Number.isFinite(Number(x))?Number(x):f}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function normSymbol(x){return String(x||"").trim().toUpperCase()}

function normalizeConfig(input={}){
  const x=Object.assign({},DEFAULT_CONFIG,input||{});
  x.enabled=Boolean(x.enabled);
  x.mode=["OFF","PAPER","TESTNET","LIVE"].includes(String(x.mode||"").toUpperCase())?String(x.mode).toUpperCase():"PAPER";
  x.symbols=Array.from(new Set((Array.isArray(x.symbols)?x.symbols:["BTCUSDT"]).map(normSymbol).filter(Boolean))).slice(0,20);
  x.strategies=Object.assign({},DEFAULT_CONFIG.strategies,x.strategies||{});
  Object.keys(STRATEGIES).forEach(k=>{x.strategies[k]=Boolean(x.strategies[k])});
  x.riskByStrategy=Object.assign({},DEFAULT_CONFIG.riskByStrategy,x.riskByStrategy||{});
  Object.keys(STRATEGIES).forEach(k=>{x.riskByStrategy[k]=clamp(finite(x.riskByStrategy[k],STRATEGIES[k].riskPct),0.05,2)});
  x.maxPositions=Math.round(clamp(finite(x.maxPositions,1),1,10));
  x.maxDailyTrades=Math.round(clamp(finite(x.maxDailyTrades,4),1,50));
  x.cooldownMs=Math.round(clamp(finite(x.cooldownMs,600000),60000,86400000));
  x.easyMode=x.easyMode!==false;
  x.weekdayOnly=x.weekdayOnly!==false;
  x.autoManage=x.autoManage!==false;
  x.minScore=clamp(finite(x.minScore,72),70,100);
  x.minRR=clamp(finite(x.minRR,1.2),1.1,5);
  x.minDataScore=clamp(finite(x.minDataScore,80),70,100);
  x.requireConfirmed=Boolean(x.requireConfirmed);
  return x;
}

function strategyForInterval(interval,enabled={}){
  const iv=String(interval||"").toLowerCase();
  const order=iv==="15m"?["SCALP","INTRADAY"]:iv==="30m"?["SCALP","INTRADAY"]:iv==="1h"?["INTRADAY","SWING"]:iv==="4h"?["SWING","POSITION"]:iv==="1d"?["POSITION","SWING"]:[];
  return order.find(k=>enabled[k])||null;
}

function decisionFresh(decision,maxAgeMs=30000){
  const ts=Number(decision?.updatedAt||0);
  return Boolean(ts>0&&Date.now()-ts<=maxAgeMs);
}

function isWeekday(ts=Date.now()){
  const day=Number(new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Kolkata",weekday:"short"}).format(new Date(Number(ts))));
  return day>=1&&day<=5;
}
function effectiveDecision(decision){
  const d=decision||{};
  const c=d.candidateEvidence||{};
  const useCandidate=String(d.action||"").toUpperCase()==="WAIT"&&c&&["LONG","SHORT"].includes(String(c.action||"").toUpperCase());
  if(!useCandidate)return {base:d,fromCandidate:false};
  return {
    base:{
      ...d,
      action:c.action,
      market:c.market||d.market||{},
      levels:c.levels||d.levels||{},
      state:c.state||d.state,
      stale:d.stale===true,
      liveSignalEligible:d.liveSignalEligible,
      deploymentGate:d.deploymentGate||d.deploymentGate
    },
    fromCandidate:true
  };
}
function hardEasyBlock(decision,base){
  const reason=String(decision?.reason||"").toLowerCase();
  const gate=String(decision?.deploymentGate?.state||"").toUpperCase();
  const dataScore=Number(decision?.data?.score??decision?.evidence?.dataScore??decision?.market?.dataScore??0);
  if(decision?.stale===true)return "STALE_DECISION";
  if(String(decision?.state||"").toUpperCase()==="DATA_BLOCKED")return "DATA_BLOCKED";
  if(String(decision?.state||"").toUpperCase()==="RISK_BLOCKED"||gate==="BLOCKED")return "HARD_RISK_BLOCK";
  if(reason.includes("derivatives unavailable")||reason.includes("insufficient derivatives completeness"))return "DERIVATIVES_UNAVAILABLE";
  if(Number.isFinite(dataScore)&&dataScore>0&&dataScore<base.minDataScore)return "LOW_DATA_QUALITY";
  return null;
}
function decisionEligible(decision,config){
  const d=decision||{},c=normalizeConfig(config),eff=effectiveDecision(d),base=eff.base;
  const side=String(base.action||"").toUpperCase();
  const gate=String(base.deploymentGate?.state||"").toUpperCase();
  const stability=String(d.signalStability?.state||"").toUpperCase();
  const score=Number(base.market?.confluenceScore??d.market?.confluenceScore??0);
  const rr=Number(base.levels?.rr??d.levels?.rr??0);
  const strategy=strategyForInterval(d.interval,c.strategies);
  const reasons=[];
  if(!c.enabled||c.mode==="OFF")reasons.push("BOT_DISABLED");
  if(!strategy)reasons.push("NO_ENABLED_STRATEGY");
  if(!["LONG","SHORT"].includes(side))reasons.push("NO_DIRECTION");
  if(c.weekdayOnly&&!isWeekday())reasons.push("WEEKEND_PAUSE");
  if(c.easyMode){
    const hard=hardEasyBlock(d,base);
    if(hard)reasons.push(hard);
    if(!Number.isFinite(score)||score<c.minScore)reasons.push("MIN_SCORE");
    if(!Number.isFinite(rr)||rr<c.minRR)reasons.push("MIN_RR");
    if(!decisionFresh(d,45000))reasons.push("DECISION_TOO_OLD");
  }else{
    if(d.state!=="READY"||d.liveSignalEligible!==true)reasons.push("FINAL_GATE_NOT_ELIGIBLE");
    if(c.requireConfirmed&&stability!=="CONFIRMED")reasons.push("SIGNAL_NOT_CONFIRMED");
    if(gate==="BLOCKED"||gate==="CONFIRMING")reasons.push("DEPLOYMENT_GATE_BLOCKED");
    if(!Number.isFinite(score)||score<c.minScore)reasons.push("MIN_SCORE");
    if(!Number.isFinite(rr)||rr<c.minRR)reasons.push("MIN_RR");
    if(d.stale===true)reasons.push("STALE_DECISION");
    if(!decisionFresh(d,30000))reasons.push("DECISION_TOO_OLD");
  }
  const levels=base.levels||d.levels||{};
  if(!Number.isFinite(Number(levels.entry))||!Number.isFinite(Number(levels.stop))||!Number.isFinite(Number(levels.tp1)))reasons.push("MISSING_EXECUTION_LEVELS");
  return {eligible:reasons.length===0,reasons,strategy,side,score,rr,fromCandidate:eff.fromCandidate,dataScore:Number(base.data?.score??d.data?.score??0),setup:String(base.market?.type||"GENERIC"),regime:String(base.market?.regime||"UNKNOWN")};
}

function signalKey(decision,meta={}){
  const d=decision||{};
  const candleTs=Number(d.candleTs||d.analysis?.candleTs||d.updatedAt||0);
  return ["MP17",d.symbol,d.interval,candleTs,String(d.action||"").toUpperCase(),meta.strategy||strategyForInterval(d.interval,meta.strategies||DEFAULT_CONFIG.strategies)].join("|");
}

function buildExecutionSignal(decision,meta={}){
  const cfg=normalizeConfig(meta.config||DEFAULT_CONFIG),check=decisionEligible(decision,cfg);
  if(!check.eligible)throw new Error("AUTOTRADER_GATE:"+check.reasons.join(","));
  const eff=effectiveDecision(decision),d=eff.base,levels=d.levels||{};
  return {
    id:signalKey(d,{strategy:check.strategy,strategies:cfg.strategies}),
    symbol:String(d.symbol||decision.symbol||"BTCUSDT").toUpperCase(),
    interval:d.interval||decision.interval||"1h",
    side:check.side,
    status:"READY",
    score:check.score,
    entryLow:levels.entryLow??levels.entry,
    entryHigh:levels.entryHigh??levels.entry,
    entry:levels.entry,
    stop:levels.stop,
    target:levels.tp1,
    tp2:levels.tp2,
    rr:check.rr,
    riskPct:Number(cfg.riskByStrategy?.[check.strategy]||STRATEGIES[check.strategy].riskPct),
    easyMode:cfg.easyMode,
    setup:check.setup,
    type:d.market?.type||"AUTOTRADER",
    regime:d.market?.regime||"UNKNOWN",
    tradeStyle:d.tradeStyle||check.strategy,
    strategy:check.strategy,
    decisionAt:Number(decision.updatedAt||Date.now()),
    source:cfg.easyMode?"PHASE17_EASY_AUTOTRADER":"PHASE17_AUTOTRADER"
  };
}

function nextDue(nowTs,lastTradeAt,cooldownMs){
  if(!lastTradeAt)return true;
  return nowTs-Number(lastTradeAt)>=Number(cooldownMs||600000);
}

function botCycleGate(snapshot,config,decision){
  const c=normalizeConfig(config),out=decisionEligible(decision,c);
  if(!out.eligible)return {eligible:false,reasons:out.reasons,strategy:out.strategy};
  const exec=snapshot?.execution||{},bot=snapshot?.bot||{};
  if(exec.killSwitch)return {eligible:false,reasons:["EXECUTION_KILL_SWITCH"],strategy:out.strategy};
  if(!exec.reconciliation?.ok&&c.mode!=="PAPER")return {eligible:false,reasons:["RECONCILIATION_REQUIRED"],strategy:out.strategy};
  if(Number(exec.metrics?.activePositions||0)>=c.maxPositions)return {eligible:false,reasons:["MAX_BOT_POSITIONS"],strategy:out.strategy};
  if(Number(bot.tradesToday||0)>=c.maxDailyTrades)return {eligible:false,reasons:["MAX_DAILY_TRADES"],strategy:out.strategy};
  if(!nextDue(Date.now(),bot.lastTradeAt,c.cooldownMs))return {eligible:false,reasons:["BOT_COOLDOWN"],strategy:out.strategy};
  if(bot.lastSignalKey&&bot.lastSignalKey===signalKey(decision,{strategy:out.strategy,strategies:c.strategies}))return {eligible:false,reasons:["DUPLICATE_SIGNAL"],strategy:out.strategy};
  if(Number(exec.metrics?.dailyLossPct||0)>=3)return {eligible:false,reasons:["DAILY_LOSS_GUARD"],strategy:out.strategy};
  return {eligible:true,reasons:[],strategy:out.strategy,score:out.score,rr:out.rr,easyMode:c.easyMode};
}

module.exports={
  VERSION,
  STRATEGIES,
  DEFAULT_CONFIG,
  normalizeConfig,
  strategyForInterval,
  decisionFresh,
  decisionEligible,
  signalKey,
  buildExecutionSignal,
  botCycleGate,
  nextDue
};
