/*
 * MarketPulse scheduled intelligence sweep
 * ----------------------------------------
 * Designed for Render Cron Jobs when a native always-on Background Worker
 * is not available through the connected Render control surface.
 *
 * The sweep is intentionally one-shot. Render runs it every 5 minutes and
 * this script selects the timeframes that are due:
 *   15m -> every 5 minutes
 *   1h  -> every 15 minutes
 *   4h  -> every 30 minutes
 *   1d  -> every 60 minutes
 *
 * It does NOT place trades.
 */

const {buildRuntimeConfig,requestDecisionWithRetry,summarizeDecision}=require("./marketpulse-worker");

const SCHEDULE_OFFSET_MINUTE=2;
const MAX_CONCURRENCY=3;

function dueIntervals(date=new Date()){
  const minute=date.getUTCMinutes();
  // The workflow is intentionally scheduled at :02, :07, :12, ... to avoid
  // GitHub's top-of-hour load. Align timeframe cadence to that same offset.
  const shifted=(minute-SCHEDULE_OFFSET_MINUTE+60)%60;
  const due=["15m"];
  if(shifted%15===0)due.push("1h");
  if(shifted%30===0)due.push("4h");
  if(shifted===0)due.push("1d");
  return due;
}

async function mapWithConcurrency(items,worker,limit=MAX_CONCURRENCY){
  const results=new Array(items.length);
  let cursor=0;
  async function runner(){
    while(true){
      const index=cursor++;
      if(index>=items.length)return;
      results[index]=await worker(items[index],index);
    }
  }
  const runners=Array.from({length:Math.min(limit,items.length)},()=>runner());
  await Promise.all(runners);
  return results;
}

async function runSweep(config=buildRuntimeConfig(),{now=new Date()}={}){
  if(!config.enabled){
    console.log(JSON.stringify({event:"worker_sweep_disabled"}));
    return {ok:true,disabled:true,results:[]};
  }
  const intervals=dueIntervals(now).filter(interval=>config.intervals.includes(interval));
  const jobs=intervals.flatMap(interval=>config.symbols.map(symbol=>({interval,symbol})));
  const results=await mapWithConcurrency(jobs,async job=>{
    const started=Date.now();
    try{
      const decision=await requestDecisionWithRetry(config.baseUrl,job.symbol,job.interval,{
        ...config,
        retries:config.retries,
        retryBaseMs:config.retryBaseMs
      });
      const summary=summarizeDecision(decision);
      console.log(JSON.stringify({event:"decision_refresh",mode:"cron_sweep",symbol:job.symbol,interval:job.interval,latencyMs:Date.now()-started,...summary}));
      return {ok:true,symbol:job.symbol,interval:job.interval,summary};
    }catch(error){
      const message=String(error?.message||error);
      console.error(JSON.stringify({event:"decision_refresh_error",mode:"cron_sweep",symbol:job.symbol,interval:job.interval,latencyMs:Date.now()-started,error:message}));
      return {ok:false,symbol:job.symbol,interval:job.interval,error:message};
    }
  },MAX_CONCURRENCY);
  const failures=results.filter(x=>!x.ok).length;
  console.log(JSON.stringify({
    event:"worker_sweep_complete",
    mode:"cron_sweep",
    intervals,
    symbols:config.symbols,
    attempted:results.length,
    failures,
    execution:"disabled"
  }));
  return {ok:failures===0,disabled:false,results};
}

if(require.main===module){
  runSweep().then(result=>{
    process.exitCode=result.ok?0:1;
  }).catch(error=>{
    console.error(JSON.stringify({event:"worker_sweep_fatal",error:String(error?.stack||error)}));
    process.exitCode=1;
  });
}

module.exports={dueIntervals,runSweep,mapWithConcurrency,SCHEDULE_OFFSET_MINUTE,MAX_CONCURRENCY};
