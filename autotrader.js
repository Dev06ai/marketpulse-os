/*
 * MarketPulse Phase 17 — AutoTrader
 * Strategy routing and execution planning are deterministic and fail-closed.
 * This module never enables production trading by itself.
 */

const VERSION="17.0.0";

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
  minScore:78,
  minRR:1.5,
  requireConfirmed:true
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
  x.minScore=clamp(finite(x.minScore,78),70,100);
  x.minRR=clamp(finite(x.minRR,1.5),1.5,5);
  x.requireConfirmed=x.requireConfirmed!==false;
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

function decisionEligible(decision,config){
  const d=decision||{},c=normalizeConfig(config);
  const side=String(d.action||"").toUpperCase();
  const gate=String(d.deploymentGate?.state||"").toUpperCase();
  const stability=String(d.signalStability?.state||"").toUpperCase();
  const score=Number(d.market?.confluenceScore??0);
  const rr=Number(d.levels?.rr??0);
  const strategy=strategyForInterval(d.interval,c.strategies);
  const reasons=[];
  if(!c.enabled||c.mode==="OFF"){reasons.push("BOT_DISABLED");}
  if(!strategy){reasons.push("NO_ENABLED_STRATEGY");}
  if(!["LONG","SHORT"].includes(side)){reasons.push("NO_DIRECTION");}
  if(d.state!=="READY"||d.liveSignalEligible!==true){reasons.push("FINAL_GATE_NOT_ELIGIBLE");}
  if(c.requireConfirmed&&stability!=="CONFIRMED"){reasons.push("SIGNAL_NOT_CONFIRMED");}
  if(gate==="BLOCKED"||gate==="CONFIRMING"){reasons.push("DEPLOYMENT_GATE_BLOCKED");}
  if(!Number.isFinite(score)||score<c.minScore){reasons.push("MIN_SCORE");}
  if(!Number.isFinite(rr)||rr<c.minRR){reasons.push("MIN_RR");}
  if(d.stale===true){reasons.push("STALE_DECISION");}
  if(!decisionFresh(d,30000)){reasons.push("DECISION_TOO_OLD");}
  const levels=d.levels||{};
  if(!Number.isFinite(Number(levels.entry))||!Number.isFinite(Number(levels.stop))||!Number.isFinite(Number(levels.tp1))){reasons.push("MISSING_EXECUTION_LEVELS");}
  return {eligible:reasons.length===0,reasons,strategy,side,score,rr};
}

function signalKey(decision,meta={}){
  const d=decision||{};
  const candleTs=Number(d.candleTs||d.analysis?.candleTs||d.updatedAt||0);
  return ["MP17",d.symbol,d.interval,candleTs,String(d.action||"").toUpperCase(),meta.strategy||strategyForInterval(d.interval,meta.strategies||DEFAULT_CONFIG.strategies)].join("|");
}

function buildExecutionSignal(decision,meta={}){
  const check=decisionEligible(decision,meta.config||DEFAULT_CONFIG);
  if(!check.eligible)throw new Error("AUTOTRADER_GATE:"+check.reasons.join(","));
  const d=decision,levels=d.levels||{};
  return {
    id:signalKey(d,{strategy:check.strategy,strategies:meta.config?.strategies}),
    symbol:String(d.symbol||"BTCUSDT").toUpperCase(),
    interval:d.interval||"1h",
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
    type:d.market?.type||"AUTOTRADER",
    regime:d.market?.regime||"UNKNOWN",
    tradeStyle:d.tradeStyle||check.strategy,
    strategy:check.strategy,
    decisionAt:Number(d.updatedAt||Date.now()),
    source:"PHASE17_AUTOTRADER"
  };
}

function nextDue(nowTs,lastTradeAt,cooldownMs){
  if(!lastTradeAt)return true;
  return nowTs-Number(lastTradeAt)>=Number(cooldownMs||600000);
}

function botCycleGate(snapshot,config,decision){
  const c=normalizeConfig(config);
  const out=decisionEligible(decision,c);
  if(!out.eligible)return {eligible:false,reasons:out.reasons,strategy:out.strategy};
  const exec=snapshot?.execution||{};
  const bot=snapshot?.bot||{};
  if(exec.killSwitch){return {eligible:false,reasons:["EXECUTION_KILL_SWITCH"],strategy:out.strategy}}
  if(!exec.reconciliation?.ok&&c.mode!=="PAPER"){return {eligible:false,reasons:["RECONCILIATION_REQUIRED"],strategy:out.strategy}}
  if(Number(exec.metrics?.activePositions||0)>=c.maxPositions){return {eligible:false,reasons:["MAX_BOT_POSITIONS"],strategy:out.strategy}}
  if(Number(bot.tradesToday||0)>=c.maxDailyTrades){return {eligible:false,reasons:["MAX_DAILY_TRADES"],strategy:out.strategy}}
  if(!nextDue(Date.now(),bot.lastTradeAt,c.cooldownMs)){return {eligible:false,reasons:["BOT_COOLDOWN"],strategy:out.strategy}}
  if(bot.lastSignalKey&&bot.lastSignalKey===signalKey(decision,{strategy:out.strategy,strategies:c.strategies})){return {eligible:false,reasons:["DUPLICATE_SIGNAL"],strategy:out.strategy}}
  if(Number(exec.metrics?.dailyLossPct||0)>=3){return {eligible:false,reasons:["DAILY_LOSS_GUARD"],strategy:out.strategy}}
  return {eligible:true,reasons:[],strategy:out.strategy};
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
