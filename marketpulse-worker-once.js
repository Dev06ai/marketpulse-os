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

const {buildRuntimeConfig,requestDecision,summarizeDecision}=require("./marketpulse-worker");

function dueIntervals(date=new Date()){
  const minute=date.getUTCMinutes();
  const due=["15m"];
  if(minute%15===0)due.push("1h");
  if(minute%30===0)due.push("4h");
  if(minute===0)due.push("1d");
  return due;
}

async function runSweep(config=buildRuntimeConfig(),{now=new Date(),sleepMs=250}={}){
  if(!config.enabled){
    console.log(JSON.stringify({event:"worker_sweep_disabled"}));
    return {ok:true,disabled:true,results:[]};
  }
  const intervals=dueIntervals(now).filter(interval=>config.intervals.includes(interval));
  const results=[];
  for(const interval of intervals){
    for(const symbol of config.symbols){
      const started=Date.now();
      try{
        const decision=await requestDecision(config.baseUrl,symbol,interval,config);
        const summary=summarizeDecision(decision);
        results.push({ok:true,symbol,interval,summary});
        console.log(JSON.stringify({event:"decision_refresh",mode:"cron_sweep",symbol,interval,latencyMs:Date.now()-started,...summary}));
      }catch(error){
        const message=String(error?.message||error);
        results.push({ok:false,symbol,interval,error:message});
        console.error(JSON.stringify({event:"decision_refresh_error",mode:"cron_sweep",symbol,interval,latencyMs:Date.now()-started,error:message}));
      }
      if(sleepMs>0)await new Promise(resolve=>setTimeout(resolve,sleepMs));
    }
  }
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

module.exports={dueIntervals,runSweep};
