(()=>{"use strict";
const $=(id)=>document.getElementById(id);
const state={symbol:"BTCUSDT",interval:"1h",cfg:null,ticker:null,chart:null,live:null,decision:null,phases:null,tickerTimer:null,chartTimer:null,decisionTimer:null};
const CACHE_KEYS={ticker:"mp-rebuild-ticker",chart:"mp-rebuild-chart",decision:"mp-rebuild-decision"};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function safeNum(v){const n=Number(v);return Number.isFinite(n)?n:null}
function fmt(v,max=2){const n=safeNum(v);return n===null?"—":n.toLocaleString(undefined,{maximumFractionDigits:max})}
function pct(v){const n=safeNum(v);return n===null?"—":(Math.abs(n)<=1?n*100:n).toFixed(0)+"%"}
function api(path,timeout=4500){
  return new Promise((resolve,reject)=>{
    const c=new AbortController();const t=setTimeout(()=>{c.abort();reject(new Error("TIMEOUT"))},timeout);
    fetch(path,{cache:"no-store",credentials:"same-origin",signal:c.signal,headers:{accept:"application/json"}})
      .then(async r=>{const text=await r.text();let data={};try{data=JSON.parse(text)}catch{}if(!r.ok)throw new Error(data.error||("HTTP "+r.status));return data})
      .then(resolve).catch(reject).finally(()=>clearTimeout(t));
  });
}
function readCache(k){try{const x=sessionStorage.getItem(k);return x?JSON.parse(x):null}catch{return null}}
function writeCache(k,v){try{sessionStorage.setItem(k,JSON.stringify(v))}catch{}}
function runtime(text,kind="warn",meta=""){
  $("runtimeText").textContent=text;$("runtimeMeta").textContent=meta;$("runtimeDot").className="dot "+kind;
}
function badge(text,kind=""){const e=$("gate");e.textContent=text;e.className="badge "+kind}
function populateSymbols(symbols){
  const s=$("symbol");const list=Array.isArray(symbols)&&symbols.length?symbols:["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","ADAUSDT"];
  s.innerHTML=list.map(x=>'<option value="'+String(x).replace(/["&<>]/g,"")+'">'+x.replace("USDT","/USDT")+"</option>").join("");
  s.value=state.symbol;
}
function extractFlow(obj){
  const d=(obj&&obj.derivatives)||{};const f=(obj&&obj.canonical)||{};
  return {
    oi:safeNum(d.oi??f.oi??obj?.oi??state.live?.oi),
    cvd:safeNum(d.cvdRatio??d.cvdDelta??f.cvdRatio??f.cvd??obj?.cvdRatio??state.live?.cvdRatio),
    book:safeNum(d.orderBookImbalance??f.orderBookImbalance??obj?.orderBookImbalance??state.live?.orderBookImbalance),
    funding:safeNum(d.fundingRate??f.fundingRate??obj?.fundingRate??state.live?.fundingRate),
    liq:safeNum(d.liquidationTotal??obj?.liquidationTotal??state.live?.liquidationTotal),
    cvdState:d.cvdState??obj?.cvdState??"WAITING",
    liqState:d.liquidationBias??obj?.liquidationBias??"WAITING"
  };
}
function renderTicker(){
  const t=state.ticker||state.live||{};const p=safeNum(t.price??t.lastPrice);
  $("price").textContent=fmt(p,2);$("change24").textContent=safeNum(t.change24h)===null?"—":(t.change24h>=0?"+":"")+Number(t.change24h).toFixed(2)+"%";
  $("source").textContent=t.source||"market feed";const age=safeNum(t.updatedAt);$("age").textContent=age?"updated "+Math.max(0,Math.round((Date.now()-age)/1000))+"s ago":"—";
  $("dataBadge").textContent=p===null?"CONNECTING":"LIVE";$("dataBadge").className="badge "+(p===null?"wait":"");
}
function drawChart(){
  const c=$("chart");if(!c)return;const rect=c.getBoundingClientRect();const d=window.devicePixelRatio||1;const w=Math.max(1,rect.width),h=Math.max(1,rect.height);
  c.width=Math.floor(w*d);c.height=Math.floor(h*d);const g=c.getContext("2d");g.setTransform(d,0,0,d,0,0);g.clearRect(0,0,w,h);g.fillStyle="#05090f";g.fillRect(0,0,w,h);
  const rows=Array.isArray(state.chart)?state.chart.slice(-140):[];
  if(!rows.length){g.fillStyle="#7890a3";g.font="700 12px system-ui";g.fillText("Waiting for candle data…",18,28);return}
  const hi=Math.max(...rows.map(x=>safeNum(x.h)??0)),lo=Math.min(...rows.map(x=>safeNum(x.l)??0));const range=Math.max(1e-9,hi-lo),L=16,R=74,T=18,B=28,pw=w-L-R,ph=h-T-B;
  const x=i=>L+(i+.5)*pw/rows.length,y=v=>T+(hi-v)/range*ph;
  g.strokeStyle="rgba(180,210,220,.08)";g.fillStyle="#7890a3";g.font="9px system-ui";
  for(let i=0;i<=6;i++){const yy=T+ph*i/6;g.beginPath();g.moveTo(L,yy);g.lineTo(L+pw,yy);g.stroke();g.fillText(fmt(hi-range*i/6,2),L+pw+8,yy+3)}
  const bw=Math.max(2.2,pw/rows.length*.58);
  rows.forEach((r,i)=>{const o=safeNum(r.o),cl=safeNum(r.c),hh=safeNum(r.h),ll=safeNum(r.l);if([o,cl,hh,ll].some(v=>v===null))return;const up=cl>=o;g.strokeStyle=up?"#39e5a6":"#ff5b75";g.beginPath();g.moveTo(x(i),y(hh));g.lineTo(x(i),y(ll));g.stroke();g.fillStyle=up?"#39e5a6":"#ff5b75";g.fillRect(x(i)-bw/2,y(Math.max(o,cl)),bw,Math.max(1,y(Math.min(o,cl))-y(Math.max(o,cl))))});
  let ema=null;const k=2/51;g.strokeStyle="#56f4df";g.lineWidth=1.8;g.beginPath();rows.forEach((r,i)=>{const cl=safeNum(r.c);if(cl===null)return;ema=ema===null?cl:cl*k+ema*(1-k);const yy=y(ema);i?g.lineTo(x(i),yy):g.moveTo(x(i),yy)});g.stroke();
  const lv=state.decision?.levels||state.decision?.apex?.executionGate||{};[["ENTRY",lv.entry??lv.entryLow,"#56f4df"],["TP1",lv.tp1??lv.target,"#d7ff4d"],["SL",lv.stop,"#ff5b75"]].forEach(([label,v,col])=>{const n=safeNum(v);if(n===null||n<lo||n>hi)return;const yy=y(n);g.strokeStyle=col;g.setLineDash([6,6]);g.beginPath();g.moveTo(L,yy);g.lineTo(L+pw,yy);g.stroke();g.setLineDash([]);g.fillStyle=col;g.font="900 9px system-ui";g.fillText(label+" "+fmt(n,2),L+6,yy-5)});
}
function decisionParts(d){
  const apex=d?.apex||d?.phase401to500?.apex||{};
  const p=d?.probabilities||apex.probabilities||{};
  const m=d?.market||{};
  const lv=d?.levels||apex.executionGate||{};
  const g=d?.deploymentGate||apex.executionGate||{};
  const action=String(d?.action??apex.action??m.side??"WAIT").toUpperCase();
  return {d,apex,p,m,lv,g,action};
}
function renderDecision(){
  const x=decisionParts(state.decision||{}),d=x.d,p=x.p||{},m=x.m||{},lv=x.lv||{},g=x.g||{};
  const action=["LONG","SHORT"].includes(x.action)?x.action:"WAIT";
  $("decision").textContent=action;$("stateLabel").textContent=action==="WAIT"?"WAIT / NO TRADE":action+" — CURRENT AUTHORITY";
  badge(String(g.state||g.status||action),action==="LONG"?"long":action==="SHORT"?"short":"wait");
  $("thesis").textContent=(d?.evidence?.thesis?.[0]||d?.phase20?.transition?.hardLock||d?.phase51to100?.signal?.confidenceSource||m.directionalLean||"Waiting for synchronized evidence and a confirmed final gate.");
  const probs=[safeNum(p.long),safeNum(p.short),safeNum(p.wait)];["longProb","shortProb","waitProb"].forEach((id,i)=>$(id).textContent=probs[i]===null?"—":pct(probs[i]));
  $("longBar").style.width=probs[0]===null?"0":clamp((Math.abs(probs[0])<=1?probs[0]*100:probs[0]),0,100)+"%";
  $("shortBar").style.width=probs[1]===null?"0":clamp((Math.abs(probs[1])<=1?probs[1]*100:probs[1]),0,100)+"%";
  $("waitBar").style.width=probs[2]===null?"0":clamp((Math.abs(probs[2])<=1?probs[2]*100:probs[2]),0,100)+"%";
  $("entry").textContent=safeNum(lv.entry??lv.entryLow)===null?"—":fmt(lv.entry??lv.entryLow,2);
  $("stop").textContent=safeNum(lv.stop)===null?"—":fmt(lv.stop,2);
  $("tp1").textContent=safeNum(lv.tp1??lv.target)===null?"—":fmt(lv.tp1??lv.target,2);
  $("rr").textContent=safeNum(lv.rr)===null?"—":Number(lv.rr).toFixed(2)+"R";
  const dataScore=safeNum(d?.data?.score??d?.phase301to400?.dataQuality?.score??x.apex.quality);
  $("quality").textContent=dataScore===null?"—":Math.round(dataScore* (dataScore<=1?100:1))+"/100";
  $("syncState").textContent=(x.apex?.synchronization?.ok||d?.synchronization?.ok)?"LOCKED":"PENDING";
  $("execution").textContent=x.apex?.executionGate?.automaticExecutionReady?"READY":"GATED";
  const flow=extractFlow(d);$("oi").textContent=fmt(flow.oi,0);$("cvd").textContent=fmt(flow.cvd,3);$("book").textContent=flow.book===null?"—":(flow.book*100).toFixed(1)+"%";$("funding").textContent=flow.funding===null?"—":(flow.funding*100).toFixed(4)+"%";$("liquidations").textContent=fmt(flow.liq,0);
  $("cvdState").textContent=flow.cvdState||"warming";$("liqState").textContent=flow.liqState||"warming";
  $("reasons").innerHTML="";
  const reasons=[...(Array.isArray(g.reasons)?g.reasons:[]),...(Array.isArray(d?.phase20?.transition?.waitCondition)?d.phase20.transition.waitCondition:[]),...(Array.isArray(d?.evidence?.thesis)?d.evidence.thesis.slice(0,3):[])].filter(Boolean).slice(0,7);
  (reasons.length?reasons:["The system has not published a blocking reason yet."]).forEach(v=>{const el=document.createElement("div");el.className="reason";el.textContent=String(v);$("reasons").appendChild(el)});
  drawChart();
}
function renderSystemChecks(checks){
  $("systemChecks").innerHTML="";
  Object.entries(checks||{}).forEach(([k,v])=>{const el=document.createElement("div");el.className="check";el.innerHTML='<b><span class="dot '+(v?"ok":"bad")+'"></span>'+k+'</b><span>'+String(v?"PASS":"BLOCKED")+"</span>";$("systemChecks").appendChild(el)});
}
async function loadCore(){
  runtime("Loading market state…","warn","First paint does not depend on analytics.");
  const cachedT=readCache(CACHE_KEYS.ticker),cachedC=readCache(CACHE_KEYS.chart),cachedD=readCache(CACHE_KEYS.decision);
  if(cachedT){state.ticker=cachedT;renderTicker()}
  if(cachedC){state.chart=cachedC.candles||cachedC;drawChart()}
  if(cachedD){state.decision=cachedD;renderDecision()}
  const tasks=await Promise.allSettled([
    api("/api/config",3000),
    api("/api/fast-ticker?symbol="+encodeURIComponent(state.symbol),3500),
    api("/api/chart?symbol="+encodeURIComponent(state.symbol)+"&interval="+encodeURIComponent(state.interval),5000),
    api("/api/live-sync?symbol="+encodeURIComponent(state.symbol),2500)
  ]);
  const cfg=tasks[0],tick=tasks[1],chart=tasks[2],live=tasks[3];
  if(cfg.status==="fulfilled"){state.cfg=cfg.value;populateSymbols(cfg.value.symbols)}
  if(tick.status==="fulfilled"){state.ticker=tick.value;writeCache(CACHE_KEYS.ticker,state.ticker);renderTicker()}
  if(chart.status==="fulfilled"&&Array.isArray(chart.value.candles)){state.chart=chart.value.candles;writeCache(CACHE_KEYS.chart,chart.value);drawChart()}
  if(live.status==="fulfilled"){state.live=live.value||{}}
  runtime(
    (tick.status==="fulfilled"||chart.status==="fulfilled")?"MarketPulse online":"UI online — market feed retrying",
    (tick.status==="fulfilled"||chart.status==="fulfilled")?"ok":"warn",
    (tick.status==="fulfilled"||chart.status==="fulfilled")?"Core UI is live. Deep analytics refresh independently.":"No blocking UI dependency failed; retrying providers automatically."
  );
  renderTicker();if(state.decision)renderDecision();
  refreshDecision(false);
}
async function refreshDecision(showStatus=true){
  if(showStatus)runtime("Refreshing decision engine…","warn","Last confirmed frame remains visible until a fresh result arrives.");
  try{
    const d=await api("/api/decision?symbol="+encodeURIComponent(state.symbol)+"&interval="+encodeURIComponent(state.interval),6500);
    state.decision=d;writeCache(CACHE_KEYS.decision,d);renderDecision();
    runtime("MarketPulse online","ok","Canonical market + decision surfaces are rendered independently.");
  }catch{
    if(!state.decision){
      try{
        const a=await api("/api/phase401-500?symbol="+encodeURIComponent(state.symbol)+"&interval="+encodeURIComponent(state.interval),7500);
        state.decision=a;writeCache(CACHE_KEYS.decision,a);renderDecision();runtime("MarketPulse online","ok","Apex engine connected.");
      }catch{runtime("UI online — decision engine retrying","warn","No decision payload was allowed to block the market screen.")}
    }
  }
}
async function tickLoop(){
  try{
    const t=await api("/api/fast-ticker?symbol="+encodeURIComponent(state.symbol),3000);state.ticker=t;state.live={...state.live,...t};writeCache(CACHE_KEYS.ticker,t);renderTicker();$("age").textContent="updated now";
  }catch{}
}
async function chartLoop(){
  try{const c=await api("/api/chart?symbol="+encodeURIComponent(state.symbol)+"&interval="+encodeURIComponent(state.interval),5000);if(Array.isArray(c.candles)&&c.candles.length){state.chart=c.candles;writeCache(CACHE_KEYS.chart,c);drawChart()}}catch{}
}
async function loadPhases(){
  if(state.phases){$("phaseList").classList.toggle("hidden");return}
  $("phaseList").classList.remove("hidden");$("phaseList").innerHTML='<div class="placeholder">Loading phase registry…</div>';
  try{
    const d=await api("/api/phases",5000);state.phases=d;
    $("phaseHeadline").textContent="PHASE 1 → 500 · "+d.engineeringPhase;
    const list=Array.isArray(d.phases)?d.phases:[];
    const complete=list.filter(x=>x.status==="COMPLETE").length;
    const validated=list.filter(x=>/VALIDATED/.test(String(x.status))).length;
    $("phaseSummary").innerHTML=
      '<div class="phase-chip"><b>'+list.length+'</b><span>registry items</span></div>'+
      '<div class="phase-chip"><b>'+complete+'</b><span>complete</span></div>'+
      '<div class="phase-chip"><b>'+validated+'</b><span>validated</span></div>'+
      '<div class="phase-chip"><b>'+String(d.promotion?.signalEngineVersion||"500.0.0")+'</b><span>engine version</span></div>';
    $("phaseList").innerHTML=list.map(x=>'<div class="phase"><b>#'+x.phase+'</b><strong>'+String(x.title||"")+'</strong><em>'+String(x.status||"")+'</em></div>').join("");
  }catch(e){$("phaseList").innerHTML='<div class="placeholder">Phase registry unavailable: '+String(e.message||e)+'</div>'}
}
async function checkSystem(){
  $("systemChecks").innerHTML='<div class="placeholder">Running bounded checks…</div>';
  try{const d=await api("/api/system-check",9000);renderSystemChecks(d.checks||{});runtime(d.ok?"System checks passed":"Core checks reported blockers",d.ok?"ok":"warn",d.ok?"All bounded checks returned within their gates.":"See runtime safety panel; these checks never block first paint.")}catch(e){$("systemChecks").innerHTML='<div class="placeholder">System check unavailable: '+e.message+'</div>'}
}
function bind(){
  $("symbol").addEventListener("change",()=>{state.symbol=$("symbol").value;writeCache(CACHE_KEYS.ticker,null);refreshAll()});
  $("interval").addEventListener("change",()=>{state.interval=$("interval").value;refreshAll()});
  $("sync").addEventListener("click",refreshAll);
  $("loadPhases").addEventListener("click",loadPhases);
  $("checkSystem").addEventListener("click",checkSystem);
  window.addEventListener("resize",drawChart);
}
function refreshAll(){state.ticker=null;state.chart=null;state.live=null;state.decision=null;loadCore()}
function startLoops(){
  clearInterval(state.tickerTimer);clearInterval(state.chartTimer);clearInterval(state.decisionTimer);
  state.tickerTimer=setInterval(tickLoop,3000);state.chartTimer=setInterval(chartLoop,15000);state.decisionTimer=setInterval(()=>refreshDecision(false),12000);
}
function boot(){
  try{bind();populateSymbols();$("symbol").value=state.symbol;startLoops();runtime("UI ready — connecting to market data…","warn","The page is intentionally usable before analytics finish.");loadCore();}
  catch(e){
    runtime("UI started in recovery mode","warn","Core controls remain available.");
    $("runtimeMeta").textContent="Boot error isolated: "+String(e.message||e);
  }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();