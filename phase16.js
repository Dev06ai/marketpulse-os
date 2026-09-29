/*
 * MarketPulse Phase 16 — Production Execution Guard
 * -------------------------------------------------
 * Safe-by-default watchdog orchestration and execution health logic.
 * This module never bypasses risk, reconciliation, or live-arm gates.
 */
const VERSION="16.0.0";
const MAX_INCIDENTS=500;

function now(){return Date.now()}
function bool(v,d=false){if(v==null||v==="")return d;return !["0","false","off","no"].includes(String(v).toLowerCase())}
function num(v,d=0){return Number.isFinite(Number(v))?Number(v):d}

function classifySystemCheck(check={}){
  const failed=Object.entries(check||{}).filter(([,v])=>v===false).map(([k])=>k);
  const executionCritical=["execution","portfolio"];
  const dataCritical=["marketData","derivatives","oi","cvd","liquidations","decisionEngine","phase11_13"];
  const critical=failed.filter(x=>executionCritical.includes(x));
  const market=dataCritical.filter(x=>failed.includes(x));
  return {
    failed,
    executionCritical:critical,
    marketCritical:market,
    healthy:failed.length===0,
    safeForLive:failed.length===0
  };
}

function shouldKillExecution(health={},execution={}){
  const c=classifySystemCheck(health?.checks||health);
  if(c.executionCritical.length)return {kill:true,reason:"Critical execution/portfolio health check failed.",failed:c.executionCritical};
  if(execution?.control?.reconciliation?.ok===false)return {kill:true,reason:"Exchange/local reconciliation is not healthy.",failed:["reconciliation"]};
  if(execution?.control?.killSwitch===true)return {kill:true,reason:"Kill switch already active.",failed:["killSwitch"]};
  return {kill:false,reason:"No automatic execution kill condition detected.",failed:[]};
}

function canAutoRemediate({featureFlags={},mode="observe"}={}){
  return bool(featureFlags.enabled,true)&&mode!=="disabled";
}

function makeIncident(type,severity,message,meta={}){
  return {id:"MP16-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8),ts:now(),type,severity,message,meta};
}

function selfTest(){const a=classifySystemCheck({execution:false,marketData:true}),b=shouldKillExecution({checks:{execution:false}},{control:{}}),c=makeIncident("TEST","LOW","ok");return {ok:a.executionCritical.includes("execution")&&a.safeForLive===false&&b.kill&&String(c.id).startsWith("MP16-"),version:VERSION};}
module.exports={VERSION,now,bool,num,classifySystemCheck,shouldKillExecution,canAutoRemediate,makeIncident,MAX_INCIDENTS,selfTest};
