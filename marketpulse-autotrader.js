/*
 * MarketPulse Phase 17 — AutoTrader service
 * Separate from the main app so automated decision/execution orchestration
 * does not consume the dashboard process's event loop.
 */
const http=require("http");
const autotrader=require("./autotrader");

const PORT=Number(process.env.PORT||3000);
const BASE_URL=String(process.env.MARKETPULSE_WEB_URL||"https://marketpulse-os-d4p9.onrender.com").replace(/\/$/,"");
const TOKEN=String(process.env.MARKETPULSE_AUTOTRADER_TOKEN||"");
const INTERVAL_MS=Math.max(30000,Number(process.env.MARKETPULSE_AUTOTRADER_INTERVAL_MS||30000));
const STRESS_HALT_ERROR_PCT=Math.max(1,Number(process.env.MARKETPULSE_AUTOTRADER_STRESS_ERROR_PCT||5));
const STRESS_HALT_LATENCY_MS=Math.max(1000,Number(process.env.MARKETPULSE_AUTOTRADER_STRESS_HALT_LATENCY_MS||3500));
const BOT_INTERVALS={SCALP:"15m",INTRADAY:"1h",SWING:"4h",POSITION:"1d"};
const BOT_CADENCE_MS={SCALP:60000,INTRADAY:120000,SWING:300000,POSITION:900000};
const state={startedAt:Date.now(),lastRunAt:null,checks:0,trades:0,failures:0,deferred:0,lastResult:null,lastProbeAt:{},running:false};

function record(result){state.lastResult={...result,at:Date.now()};console.log(JSON.stringify({event:"phase17_autotrader_cycle",...state.lastResult}))}
async function fetchJson(path,{method="GET",body=null,timeout=12000}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const res=await fetch(BASE_URL+path,{method,headers:{accept:"application/json","content-type":"application/json","x-marketpulse-watchdog-token":TOKEN,"user-agent":"MarketPulse-Phase17-AutoTrader/1.0"},body:body==null?undefined:JSON.stringify(body),signal:controller.signal,cache:"no-store"});
    const raw=await res.text();let json={};try{json=JSON.parse(raw)}catch{}
    if(!res.ok){const e=new Error(json?.error||("HTTP "+res.status));e.status=res.status;throw e}
    return json;
  }finally{clearTimeout(timer)}
}
function probeDue(strategy){
  return Date.now()-Number(state.lastProbeAt[strategy]||0)>=Number(BOT_CADENCE_MS[strategy]||300000);
}
function loadStressed(metrics){
  const r=metrics?.recent60s||{};
  return Number(r.errorRatePct||0)>=STRESS_HALT_ERROR_PCT || Number(r.avgLatencyMs||0)>=STRESS_HALT_LATENCY_MS;
}
async function cycle(){
  if(state.running)return;
  state.running=true;state.checks++;state.lastRunAt=Date.now();
  try{
    const bot=await fetchJson("/api/watchdog/internal?action=autotrader-status",{timeout:15000});
    const cfg=autotrader.normalizeConfig(bot?.bot||{});
    if(!cfg.enabled||cfg.mode==="OFF"){record({ok:true,traded:false,reason:"disabled"});return}
    const telemetry=await fetchJson("/health",{timeout:5000}).catch(()=>null);
    if(telemetry?.ok===false){state.deferred++;record({ok:true,traded:false,reason:"main_health_blocked"});return}
    const due=Object.keys(BOT_INTERVALS).filter(k=>cfg.strategies?.[k]&&probeDue(k));
    if(!due.length){record({ok:true,traded:false,reason:"not_due"});return}
    const strategy=due.sort((a,b)=>Number(state.lastProbeAt[a]||0)-Number(state.lastProbeAt[b]||0))[0];
    state.lastProbeAt[strategy]=Date.now();
    const symbols=cfg.symbols?.length?cfg.symbols:["BTCUSDT"];
    const symbol=symbols[(state.checks-1)%symbols.length];
    const interval=BOT_INTERVALS[strategy];
    const decision=await fetchJson("/api/decision?symbol="+encodeURIComponent(symbol)+"&interval="+encodeURIComponent(interval),{timeout:15000});
    if(!decision?.ok){state.failures++;record({ok:false,traded:false,strategy,symbol,interval,reason:"decision_invalid"});return}
    const gate=autotrader.decisionEligible(decision,cfg);
    if(!gate.eligible){record({ok:true,traded:false,strategy,symbol,interval,reason:"gate_blocked",gates:gate.reasons,score:gate.score});return}
    const executed=await fetchJson("/api/watchdog/internal?action=autotrader-execute",{method:"POST",body:{decision},timeout:20000});
    if(!executed?.ok){state.failures++;record({ok:false,traded:false,strategy,symbol,interval,reason:executed?.error||"execution_blocked"});return}
    state.trades++;
    record({ok:true,traded:true,strategy,symbol,interval,side:decision.action,score:decision.market?.confluenceScore||0,orderStatus:executed?.order?.status||null,signalKey:executed?.signal?.id||null});
  }catch(e){
    state.failures++;
    record({ok:false,traded:false,error:String(e?.message||e)});
  }finally{state.running=false}
}
const server=http.createServer((req,res)=>{
  const body=JSON.stringify({ok:true,service:"marketpulse-autotrader",version:autotrader.VERSION,uptimeMs:Date.now()-state.startedAt,checks:state.checks,trades:state.trades,failures:state.failures,deferred:state.deferred,lastRunAt:state.lastRunAt,lastResult:state.lastResult});
  res.writeHead(req.url==="/health"||req.url==="/"||req.url==="/status"?200:404,{"content-type":"application/json","cache-control":"no-store"});
  res.end(body);
});
server.listen(PORT,"0.0.0.0",()=>{
  console.log(JSON.stringify({event:"phase17_autotrader_started",version:autotrader.VERSION,port:PORT,baseUrl:BASE_URL,intervalMs:INTERVAL_MS}));
  cycle().catch(()=>{});
  setInterval(()=>cycle().catch(()=>{}),INTERVAL_MS);
});
