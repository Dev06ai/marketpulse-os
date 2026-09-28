const {cycle}=require("./marketpulse-watchdog");
cycle().then(()=>{
  process.exitCode=0;
}).catch(error=>{
  console.error(JSON.stringify({event:"phase16_watchdog_once_fatal",error:String(error?.stack||error)}));
  process.exitCode=1;
});
