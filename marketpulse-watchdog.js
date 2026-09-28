/*
 * MarketPulse Phase 16 — 24/7 Watchdog
 * ------------------------------------
 * Monitors the production app continuously. It can perform only bounded,
 * fail-safe remediation:
 *   1) retry transient health failures
 *   2) reset server-side decision caches when repeated stale/corrupt state is detected
 *   3) reconcile execution state
 *   4) engage the execution kill switch when execution integrity is compromised
 * It NEVER edits trading strategy code, relaxes risk gates, changes live
 * thresholds, or turns live trading on by itself.
 */

const http=require("http");
const {execFile}=require("child_process");
const {promisify}=require("util");
const execFileAsync=promisify(execFile);
const phase16=require("./phase16");

const PORT=Number(process.env.PORT||3000);
const BASE_URL=String(process.env.MARKETPULSE_WEB_URL||"").replace(/\/$/,"");
const TOKEN=String(process.env.MARKETPULSE_WATCHDOG_TOKEN||"");
const INTERVAL_MS=Math.max(15000,Number(process.env.MARKETPULSE_WATCHDOG_INTERVAL_MS||30000));
const SYSTEM_CHECK_INTERVAL_MS=Math.max(120000,Number(process.env.MARKETPULSE_WATCHDOG_SYSTEM_CHECK_INTERVAL_MS||300000));
const SELF_TEST_INTERVAL_MS=Math.max(300000,Number(process.env.MARKETPULSE_WATCHDOG_SELF_TEST_INTERVAL_MS||900000));
const DECISION_SPOT_INTERVAL_MS=Math.max(60000,Number(process.env.MARKETPULSE_WATCHDOG_DECISION_SPOT_INTERVAL_MS||120000));
const LOAD_STATUS_INTERVAL_MS=Math.max(30000,Number(process.env.MARKETPULSE_WATCHDOG_LOAD_STATUS_INTERVAL_MS||60000));
const HEALTH_TIMEOUT_MS=Math.max(8000,Number(process.env.MARKETPULSE_WATCHDOG_HEALTH_TIMEOUT_MS||8000));
const HEALTH_RETRY_TIMEOUT_MS=Math.max(15000,Number(process.env.MARKETPULSE_WATCHDOG_HEALTH_RETRY_TIMEOUT_MS||45000));
const LOAD_STRESS_REQUESTS_PER_MIN=Math.max(20,Number(process.env.MARKETPULSE_WATCHDOG_STRESS_REQUESTS_PER_MIN||80));
const LOAD_STRESS_LATENCY_MS=Math.max(1000,Number(process.env.MARKETPULSE_WATCHDOG_STRESS_LATENCY_MS||3500));
const LOAD_STRESS_ERROR_PCT=Math.max(1,Number(process.env.MARKETPULSE_WATCHDOG_STRESS_ERROR_PCT||5));
const CACHE_RESET_COOLDOWN_MS=Math.max(120000,Number(process.env.MARKETPULSE_WATCHDOG_CACHE_RESET_COOLDOWN_MS||600000));
const DECISION_SYMBOLS=String(process.env.MARKETPULSE_WATCHDOG_SYMBOLS||"BTCUSDT,ETHUSDT,SOLUSDT").split(",").map(x=>x.trim()).filter(Boolean);
const DECISION_INTERVALS=String(process.env.MARKETPULSE_WATCHDOG_INTERVALS||"15m,1h").split(",").map(x=>x.trim()).filter(Boolean);
const MAX_INCIDENTS=phase16.MAX_INCIDENTS;

const state={
  startedAt:Date.now(),lastRunAt:null,lastHealthyAt:null,consecutiveFailures:0,
  checks:0,remediations:0,incidents:[],lastHealth:null,lastExecution:null,selfTest:null,lastSystemCheckAt:0,lastSelfTestAt:0,lastDecisionSpotAt:0,lastLoadStatusAt:0,lastLoad:null,loadStressed:false,lastCacheResetAt:0,cycleRunning:false,deferredChecks:0
};

function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function loadStress(load){
  const recent=load?.metrics?.recent60s||{};
  return Boolean(
    Number(recent.requests||0)>=LOAD_STRESS_REQUESTS_PER_MIN ||
    Number(recent.avgLatencyMs||0)>=LOAD_STRESS_LATENCY_MS ||
    Number(recent.errorRatePct||0)>=LOAD_STRESS_ERROR_PCT
  );
}
async function refreshLoadStatus(){
  const status=await fetchJson("/api/watchdog/internal?action=status",{timeout:10000});
  state.lastLoad=status?.metrics||null;
  const stressed=loadStress(status);
  if(stressed!==state.loadStressed){
    state.loadStressed=stressed;
    record(stressed?"LOAD_STRESS_ACTIVE":"LOAD_STRESS_CLEARED",stressed?"warning":"info",
      stressed?"Watchdog is throttling expensive diagnostics to protect MarketPulse responsiveness.":"MarketPulse load returned to normal; diagnostic cadence restored.",
      {recent60s:status?.metrics?.recent60s||null});
  }
  return status;
}
function record(type,severity,message,meta={}){
  const row=phase16.makeIncident(type,severity,message,meta);
  state.incidents.push(row);
  state.incidents=state.incidents.slice(-MAX_INCIDENTS);
  console.log(JSON.stringify({event:"phase16_incident",...row}));
  return row;
}
async function fetchJson(path,{method="GET",body=null,timeout=12000}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const res=await fetch(BASE_URL+path,{
      method,headers:{
        accept:"application/json",
        "content-type":"application/json",
        "x-marketpulse-watchdog-token":TOKEN,
        "user-agent":"MarketPulse-Phase16-Watchdog/1.0"
      },
      body:body==null?undefined:JSON.stringify(body),signal:controller.signal,cache:"no-store"
    });
    const raw=await res.text();let json={};try{json=JSON.parse(raw)}catch{}
    if(!res.ok){const e=new Error(json?.error||("HTTP "+res.status));e.status=res.status;throw e}
    return json;
  }finally{clearTimeout(timer)}
}

async function runSelfTest(){
  try{
    const r=await execFileAsync(process.execPath,["validation-selftest.js"],{timeout:60000,maxBuffer:2*1024*1024});
    return {ok:true,output:String(r.stdout||"").slice(-4000),checkedAt:Date.now()};
  }catch(e){
    return {ok:false,error:String(e?.stderr||e?.message||e),checkedAt:Date.now()};
  }
}

async function safeRemediation(health,execution){
  const decision=phase16.shouldKillExecution(health,execution);

  if(execution?.control?.reconciliation?.ok===false && execution?.mode && execution.mode!=="SIMULATION"){
    try{
      const rec=await fetchJson("/api/watchdog/internal?action=reconcile",{method:"POST",body:{}});
      state.remediations++;
      record("RECONCILIATION_ATTEMPT","warning","Watchdog attempted exchange/local reconciliation.",{result:rec?.ok??false});
    }catch(e){
      record("RECONCILIATION_FAILED","critical","Watchdog could not reconcile execution state.",{error:String(e?.message||e)});
    }
  }

  if(decision.kill && execution?.mode && execution.mode!=="SIMULATION" && !execution?.control?.killSwitch){
    try{
      const killed=await fetchJson("/api/watchdog/internal?action=kill-execution",{method:"POST",body:{}});
      state.remediations++;
      record("EXECUTION_KILL_SWITCH","critical",decision.reason,{result:killed?.ok??false});
    }catch(e){
      record("EXECUTION_KILL_FAILED","critical","Watchdog could not engage the execution kill switch.",{error:String(e?.message||e)});
    }
  }

  // Cache reset is deliberately bounded by both a failure threshold and a cooldown.
  if(state.consecutiveFailures>=3 && Date.now()-state.lastCacheResetAt>=CACHE_RESET_COOLDOWN_MS){
    state.lastCacheResetAt=Date.now();
    try{
      const reset=await fetchJson("/api/watchdog/internal?action=reset-caches",{method:"POST",body:{}});
      state.remediations++;
      record("CACHE_RESET","warning","Watchdog reset server-side decision/validation caches after repeated failures.",{result:reset?.ok??false});
      state.consecutiveFailures=0;
    }catch(e){
      record("CACHE_RESET_FAILED","warning","Watchdog could not reset server-side caches.",{error:String(e?.message||e)});
    }
  }
}

async function cycle(){
  if(state.cycleRunning){
    state.deferredChecks++;
    return;
  }
  state.cycleRunning=true;
  state.checks++;
  state.lastRunAt=Date.now();
  let ranSystemCheck=false;
  try{
    let healthOk=false;
    try{
      await fetchJson("/health",{timeout:HEALTH_TIMEOUT_MS});
      healthOk=true;
    }catch(e){
      try{
        await fetchJson("/health",{timeout:HEALTH_RETRY_TIMEOUT_MS});
        healthOk=true;
      }catch(retryError){
        state.consecutiveFailures++;
        record("MAIN_HEALTH_UNAVAILABLE","critical","Main MarketPulse health endpoint is unavailable after a bounded retry.",{
          error:String(retryError?.message||e),
          firstError:String(e?.message||e),
          consecutiveFailures:state.consecutiveFailures
        });
        return;
      }
    }

    if(Date.now()-state.lastLoadStatusAt>=LOAD_STATUS_INTERVAL_MS){
      state.lastLoadStatusAt=Date.now();
      try{await refreshLoadStatus()}catch(e){
        record("LOAD_STATUS_UNAVAILABLE","warning","Watchdog could not read MarketPulse load telemetry.",{error:String(e?.message||e)});
      }
    }

    const stressed=state.loadStressed;
    if(!stressed &&
       String(process.env.MARKETPULSE_WATCHDOG_ONESHOT||"false").toLowerCase()!=="true" &&
       Date.now()-state.lastSelfTestAt>=SELF_TEST_INTERVAL_MS &&
       !ranSystemCheck){
      state.lastSelfTestAt=Date.now();
      const selfTest=await runSelfTest();
      state.selfTest=selfTest;
      if(!selfTest.ok)record("SELF_TEST_FAILED","critical","Repository self-test failed; no strategy or risk rules were modified.",{error:selfTest.error});
    }

    let health=state.lastHealth,execution=state.lastExecution;
    if(!stressed && Date.now()-state.lastSystemCheckAt>=SYSTEM_CHECK_INTERVAL_MS){
      state.lastSystemCheckAt=Date.now();
      ranSystemCheck=true;
      try{
        health=await fetchJson("/api/watchdog/internal?action=system-check",{timeout:20000});
        state.lastHealth=health;
      }catch(e){
        state.consecutiveFailures++;
        record("SYSTEM_CHECK_UNAVAILABLE","critical","Main MarketPulse system-check endpoint is unavailable.",{error:String(e?.message||e),consecutiveFailures:state.consecutiveFailures});
        return;
      }
      try{
        execution=await fetchJson("/api/watchdog/internal?action=execution",{timeout:10000});
        state.lastExecution=execution;
      }catch(e){
        state.consecutiveFailures++;
        record("EXECUTION_HEALTH_UNAVAILABLE","critical","Execution health endpoint is unavailable.",{error:String(e?.message||e),consecutiveFailures:state.consecutiveFailures});
      }

      const classification=phase16.classifySystemCheck(health?.checks||{});
      if(classification.healthy && (!execution||execution.ok!==false)){
        state.consecutiveFailures=0;state.lastHealthyAt=Date.now();
      }else{
        state.consecutiveFailures++;
        record("SYSTEM_HEALTH_DEGRADED",classification.executionCritical.length?"critical":"warning","MarketPulse health checks are not fully green.",classification);
      }
      await safeRemediation(health,execution);
    }else if(stressed){
      state.deferredChecks++;
      // Under elevated load, avoid generating additional expensive market-data traffic.
      // The lightweight /health and load telemetry remain active.
    }

    // Never stack a decision probe on top of a full system-check in the same cycle.
    if(!stressed && !ranSystemCheck && Date.now()-state.lastDecisionSpotAt>=DECISION_SPOT_INTERVAL_MS){
      state.lastDecisionSpotAt=Date.now();
      const slots=Math.max(1,DECISION_SYMBOLS.length*DECISION_INTERVALS.length);
      const index=Math.floor(state.checks/Math.max(1,Math.round(DECISION_SPOT_INTERVAL_MS/INTERVAL_MS)))%slots;
      const symbol=DECISION_SYMBOLS[Math.floor(index/Math.max(1,DECISION_INTERVALS.length))%Math.max(1,DECISION_SYMBOLS.length)];
      const interval=DECISION_INTERVALS[index%Math.max(1,DECISION_INTERVALS.length)];
      try{
        const d=await fetchJson("/api/decision?symbol="+encodeURIComponent(symbol)+"&interval="+encodeURIComponent(interval),{timeout:15000});
        if(!d?.ok)throw new Error("Decision response invalid");
      }catch(e){
        state.consecutiveFailures++;
        record("DECISION_SPOT_CHECK_FAILED","warning","Decision engine spot-check failed.",{symbol,interval,error:String(e?.message||e)});
      }
    }else if(stressed){
      state.deferredChecks++;
    }

    if(state.consecutiveFailures===0)state.lastHealthyAt=Date.now();
    console.log(JSON.stringify({
      event:"phase16_watchdog_cycle",
      checks:state.checks,
      healthy:state.consecutiveFailures===0,
      consecutiveFailures:state.consecutiveFailures,
      remediations:state.remediations,
      deferredChecks:state.deferredChecks,
      loadStressed:state.loadStressed,
      recentLoad:state.lastLoad?.recent60s||null,
      lastHealthyAt:state.lastHealthyAt,
      nextSystemCheckInMs:Math.max(0,SYSTEM_CHECK_INTERVAL_MS-(Date.now()-state.lastSystemCheckAt)),
      nextSelfTestInMs:Math.max(0,SELF_TEST_INTERVAL_MS-(Date.now()-state.lastSelfTestAt)),
      nextDecisionSpotInMs:Math.max(0,DECISION_SPOT_INTERVAL_MS-(Date.now()-state.lastDecisionSpotAt))
    }));
  }finally{
    state.cycleRunning=false;
  }
}

function startWatchdogServer(){
  const server=http.createServer((req,res)=>{
    if(req.url==="/health"||req.url==="/"){
      const body=JSON.stringify({ok:true,service:"marketpulse-phase16-watchdog",version:phase16.VERSION,uptimeMs:Date.now()-state.startedAt,lastRunAt:state.lastRunAt,lastHealthyAt:state.lastHealthyAt,consecutiveFailures:state.consecutiveFailures});
      res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});
      return res.end(body);
    }
    if(req.url==="/status"){
      const body=JSON.stringify({ok:true,version:phase16.VERSION,state});
      res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});
      return res.end(body);
    }
    res.writeHead(404);res.end();
  });
  server.listen(PORT,"0.0.0.0",()=>{
    console.log(JSON.stringify({event:"phase16_watchdog_started",version:phase16.VERSION,port:PORT,intervalMs:INTERVAL_MS,baseUrl:BASE_URL,symbols:DECISION_SYMBOLS,intervals:DECISION_INTERVALS}));
    cycle().catch(e=>record("WATCHDOG_CYCLE_FATAL","critical","Initial watchdog cycle failed.",{error:String(e?.stack||e)}));
    setInterval(()=>cycle().catch(e=>record("WATCHDOG_CYCLE_FATAL","critical","Watchdog cycle failed.",{error:String(e?.stack||e)})),INTERVAL_MS);
  });
  return server;
}

if(require.main===module){
  startWatchdogServer();
}
process.on("unhandledRejection",e=>record("UNHANDLED_REJECTION","critical","Watchdog encountered an unhandled rejection.",{error:String(e)}));
process.on("uncaughtException",e=>record("UNCAUGHT_EXCEPTION","critical","Watchdog encountered an uncaught exception.",{error:String(e?.stack||e)}));

module.exports={cycle,state,startWatchdogServer};
