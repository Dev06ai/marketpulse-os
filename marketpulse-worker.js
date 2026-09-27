/*
 * MarketPulse 24/7 Intelligence Worker
 * ------------------------------------
 * Keeps the intelligence loop independent from the browser session.
 *
 * The worker does NOT place trades. It periodically calls the authoritative
 * /api/decision endpoint so the existing server-side decision, validation,
 * Phase 14, and learning pipeline continue to run even when no dashboard is open.
 *
 * Required environment:
 *   MARKETPULSE_WEB_URL=https://<your-web-service>.onrender.com
 *
 * Optional:
 *   MARKETPULSE_WORKER_SYMBOLS=BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT
 *   MARKETPULSE_WORKER_INTERVALS=15m,1h,4h,1d
 *   MARKETPULSE_WORKER_DEVICE=marketpulse-24x7-worker
 *   MARKETPULSE_WORKER_TIMEOUT_MS=20000
 *   MARKETPULSE_WORKER_JITTER_MS=1500
 *   MARKETPULSE_WORKER_ENABLED=true
 *
 * Cadence:
 *   15m: every 5 minutes
 *   1h:  every 15 minutes
 *   4h:  every 30 minutes
 *   1d:  every 60 minutes
 *
 * Requests are staggered to avoid burst-loading the web service.
 */

const DEFAULT_SYMBOLS="BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT";
const DEFAULT_INTERVALS=["15m","1h","4h","1d"];
const CADENCE_MS={"15m":5*60*1000,"1h":15*60*1000,"4h":30*60*1000,"1d":60*60*1000};
const DEFAULT_TIMEOUT_MS=30000;
const DEFAULT_JITTER_MS=1500;
const DEFAULT_RETRY_ATTEMPTS=3;
const DEFAULT_RETRY_BASE_MS=1200;

function parseCsv(value,fallback=[]){
  const rows=String(value==null?"":value).split(",").map(x=>x.trim()).filter(Boolean);
  return rows.length?Array.from(new Set(rows)):fallback.slice();
}
function envBool(value,fallback=true){
  if(value==null||value==="")return fallback;
  return !["0","false","off","no","disabled"].includes(String(value).toLowerCase());
}
function normaliseBaseUrl(value){
  const raw=String(value||"").trim();
  if(!raw)throw new Error("MARKETPULSE_WEB_URL is required for the 24/7 worker.");
  const url=new URL(raw);
  if(!/^https?:$/.test(url.protocol))throw new Error("MARKETPULSE_WEB_URL must use http or https.");
  return url.toString().replace(/\/$/,"");
}
function buildPlan({symbols,intervals=DEFAULT_INTERVALS,now=Date.now()}){
  const jobs=[];
  const activeIntervals=intervals.filter(x=>CADENCE_MS[x]);
  let offset=0;
  for(const interval of activeIntervals){
    for(const symbol of symbols){
      jobs.push({symbol,interval,dueAt:now+offset,cadenceMs:CADENCE_MS[interval]});
      offset+=1500;
    }
    offset+=1000;
  }
  return jobs;
}
function dueJobs(jobs,now=Date.now()){
  return jobs.filter(j=>now>=j.dueAt).sort((a,b)=>a.dueAt-b.dueAt);
}
function nextWakeMs(jobs,now=Date.now()){
  const next=jobs.filter(j=>j.dueAt>now).sort((a,b)=>a.dueAt-b.dueAt)[0];
  return next?Math.max(250,next.dueAt-now):1000;
}
function summarizeDecision(d){
  const p14=d?.phase14?.intelligence||d?.analysis?.phase14?.intelligence||{};
  return {
    state:d?.state||"UNKNOWN",
    action:d?.action||"WAIT",
    score:Number(d?.market?.confluenceScore??d?.analysis?.score??0),
    regime:d?.market?.regime||d?.analysis?.regime||"UNKNOWN",
    setup:p14?.setupKey||d?.market?.type||"GENERIC",
    phase14Status:p14?.status||"UNKNOWN",
    resolvedEvidence:Number(d?.phase11_13?.summary?.trades||0),
    updatedAt:d?.updatedAt||Date.now()
  };
}
async function requestDecision(baseUrl,symbol,interval,{timeoutMs=DEFAULT_TIMEOUT_MS,deviceId="marketpulse-24x7-worker"}={}){
  const url=new URL(baseUrl+"/api/decision");
  url.searchParams.set("symbol",symbol);
  url.searchParams.set("interval",interval);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetch(url,{
      cache:"no-store",
      headers:{
        accept:"application/json",
        "x-marketpulse-device":deviceId,
        "user-agent":"MarketPulse-24x7-Worker/1.0"
      },
      signal:controller.signal
    });
    const text=await res.text();
    let body={};
    try{body=JSON.parse(text)}catch{}
    if(!res.ok){
      const error=new Error(body?.error||("HTTP "+res.status));
      error.status=res.status;
      throw error;
    }
    if(!body?.ok){
      const error=new Error(body?.error||"Decision endpoint returned an invalid payload");
      error.status=res.status;
      error.retryable=true;
      throw error;
    }
    return body;
  }finally{clearTimeout(timer)}
}
function buildRuntimeConfig(env=process.env){
  const symbols=parseCsv(env.MARKETPULSE_WORKER_SYMBOLS||env.SYMBOLS,parseCsv(DEFAULT_SYMBOLS));
  const intervals=parseCsv(env.MARKETPULSE_WORKER_INTERVALS||"15m,1h,4h,1d",DEFAULT_INTERVALS).filter(x=>CADENCE_MS[x]);
  return {
    enabled:envBool(env.MARKETPULSE_WORKER_ENABLED,true),
    baseUrl:normaliseBaseUrl(env.MARKETPULSE_WEB_URL),
    symbols,
    intervals:intervals.length?intervals:DEFAULT_INTERVALS.slice(),
    timeoutMs:Math.max(5000,Number(env.MARKETPULSE_WORKER_TIMEOUT_MS||DEFAULT_TIMEOUT_MS)||DEFAULT_TIMEOUT_MS),
    jitterMs:Math.max(0,Number(env.MARKETPULSE_WORKER_JITTER_MS||DEFAULT_JITTER_MS)||DEFAULT_JITTER_MS),
    retries:Math.max(1,Math.min(5,Number(env.MARKETPULSE_WORKER_RETRIES||DEFAULT_RETRY_ATTEMPTS)||DEFAULT_RETRY_ATTEMPTS)),
    retryBaseMs:Math.max(250,Math.min(10000,Number(env.MARKETPULSE_WORKER_RETRY_BASE_MS||DEFAULT_RETRY_BASE_MS)||DEFAULT_RETRY_BASE_MS)),
    deviceId:String(env.MARKETPULSE_WORKER_DEVICE||"marketpulse-24x7-worker").slice(0,128)
  };
}
function isRetryableError(error){
  const status=Number(error?.status||0);
  if([408,425,429].includes(status)||status>=500)return true;
  if(error?.retryable===true)return true;
  return error?.name==="AbortError"||error?.name==="TypeError";
}
async function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function requestDecisionWithRetry(baseUrl,symbol,interval,{retries=DEFAULT_RETRY_ATTEMPTS,retryBaseMs=DEFAULT_RETRY_BASE_MS,...options}={}){
  let lastError;
  for(let attempt=1;attempt<=Math.max(1,retries);attempt++){
    try{
      return await requestDecision(baseUrl,symbol,interval,options);
    }catch(error){
      lastError=error;
      if(attempt>=Math.max(1,retries)||!isRetryableError(error))throw error;
      const backoff=retryBaseMs*Math.pow(2,attempt-1);
      const jitter=Math.floor(Math.random()*500);
      console.warn(JSON.stringify({
        event:"decision_refresh_retry",
        symbol,interval,attempt,nextAttempt:attempt+1,
        delayMs:backoff+jitter,
        error:String(error?.message||error)
      }));
      await sleep(backoff+jitter);
    }
  }
  throw lastError||new Error("Decision refresh failed");
}
async function runJob(job,config){
  const started=Date.now();
  try{
    const decision=await requestDecisionWithRetry(config.baseUrl,job.symbol,job.interval,config);
    const s=summarizeDecision(decision);
    console.log(JSON.stringify({event:"decision_refresh",symbol:job.symbol,interval:job.interval,latencyMs:Date.now()-started,...s}));
    return {ok:true,decision};
  }catch(error){
    console.error(JSON.stringify({event:"decision_refresh_error",symbol:job.symbol,interval:job.interval,latencyMs:Date.now()-started,error:String(error?.message||error)}));
    return {ok:false,error};
  }
}
async function runWorker(config=buildRuntimeConfig()){
  if(!config.enabled){console.log(JSON.stringify({event:"worker_disabled"}));return;}
  const jobs=buildPlan({symbols:config.symbols,intervals:config.intervals});
  console.log(JSON.stringify({event:"worker_started",version:"1.0.0",symbols:config.symbols,intervals:config.intervals,baseUrl:config.baseUrl,jobs:jobs.length,note:"24/7 intelligence only; execution remains disabled."}));
  let stopped=false;
  const stop=signal=>{
    if(stopped)return;
    stopped=true;
    console.log(JSON.stringify({event:"worker_stopping",signal}));
  };
  process.once("SIGTERM",()=>stop("SIGTERM"));
  process.once("SIGINT",()=>stop("SIGINT"));
  while(!stopped){
    const now=Date.now();
    const due=dueJobs(jobs,now);
    if(!due.length){
      await new Promise(resolve=>setTimeout(resolve,Math.min(nextWakeMs(jobs,now),5000)));
      continue;
    }
    for(const job of due){
      if(stopped)break;
      await runJob(job,config);
      const jitter=config.jitterMs?Math.floor(Math.random()*(config.jitterMs+1)):0;
      job.dueAt=Date.now()+job.cadenceMs+jitter;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
  }
}
if(require.main===module){
  try{
    runWorker().catch(error=>{
      console.error(JSON.stringify({event:"worker_fatal",error:String(error?.stack||error)}));
      process.exitCode=1;
    });
  }catch(error){
    console.error(JSON.stringify({event:"worker_config_error",error:String(error?.message||error)}));
    process.exitCode=1;
  }
}
module.exports={CADENCE_MS,parseCsv,normaliseBaseUrl,buildPlan,dueJobs,nextWakeMs,summarizeDecision,isRetryableError,requestDecision,requestDecisionWithRetry,buildRuntimeConfig,runJob,runWorker};
