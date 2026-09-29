(()=>{
"use strict";

const $=id=>document.getElementById(id);
const state={
  symbol:"BTCUSDT",interval:"1h",cfg:null,ticker:null,live:null,chart:null,decision:null,phases:null,
  livePrice:null,previousPrice:null,pricePulse:0,crosshair:null,fitToken:0,
  tickerTimer:null,flowTimer:null,chartTimer:null,decisionTimer:null
};

function cacheKey(kind){return "mp-apex-"+kind+"-"+state.symbol+"-"+state.interval}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function safeNum(v){const n=Number(v);return Number.isFinite(n)?n:null}
function fmt(v,max=2){const n=safeNum(v);return n===null?"—":n.toLocaleString(undefined,{maximumFractionDigits:max})}
function pct(v){const n=safeNum(v);return n===null?"—":(Math.abs(n)<=1?n*100:n).toFixed(0)+"%"}
function api(path,timeout=4500){
  return new Promise((resolve,reject)=>{
    const c=new AbortController(),t=setTimeout(()=>{c.abort();reject(new Error("TIMEOUT"))},timeout);
    fetch(path,{cache:"no-store",credentials:"same-origin",signal:c.signal,headers:{accept:"application/json"}})
      .then(async r=>{
        const text=await r.text();let data={};
        try{data=JSON.parse(text)}catch{}
        if(!r.ok)throw new Error(data.error||("HTTP "+r.status));
        return data;
      }).then(resolve).catch(reject).finally(()=>clearTimeout(t));
  });
}
function readCache(k){try{const x=sessionStorage.getItem(k);return x?JSON.parse(x):null}catch{return null}}
function writeCache(k,v){try{sessionStorage.setItem(k,JSON.stringify(v))}catch{}}
function runtime(text,kind="warn",meta=""){
  $("runtimeText").textContent=text;$("runtimeMeta").textContent=meta;$("runtimeDot").className="dot "+kind;
  $("sidebarStatus").textContent=kind==="ok"?"LIVE FEED":"FEED RETRY";
  $("sidebarStatusMeta").textContent=meta||"Market data transport";
}
function statusPill(text,kind="wait"){
  const el=$("gate");el.textContent=text;el.className="status-pill "+kind;
}
function cleanSymbol(x){return String(x||"").replace(/[^A-Z0-9]/g,"").toUpperCase()}
function displaySymbol(x){return cleanSymbol(x).replace("USDT","/USDT")}
function populateSymbols(symbols){
  const list=Array.isArray(symbols)&&symbols.length?symbols:["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","ADAUSDT"];
  $("symbol").innerHTML=list.map(x=>{const v=cleanSymbol(x);return '<option value="'+v+'">'+v.replace("USDT","/USDT")+"</option>"}).join("");
  $("symbol").value=state.symbol;
  $("symbolName").textContent=displaySymbol(state.symbol);
  $("assetIcon").textContent=state.symbol==="BTCUSDT"?"₿":"◈";
}
function extractFlow(obj){
  const d=obj?.derivatives||{},f=obj?.canonical||{};
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
  const t=state.ticker||{};
  const p=safeNum(state.livePrice??t.price??t.lastPrice);
  $("price").textContent=fmt(p,2);
  const ch=safeNum(t.change24h);
  $("change24").textContent=ch===null?"—":(ch>=0?"+":"")+ch.toFixed(2)+"%";
  $("change24").style.color=ch===null?"var(--muted)":ch>=0?"var(--green)":"var(--red)";
  $("source").textContent=t.source||"exchange feed";
  $("age").textContent=tickAge(t.updatedAt);
  $("lastTrade").textContent="LAST "+fmt(p,2);
  $("dataBadge").textContent=p===null?"CONNECTING":"LIVE 1S";
  $("chartState").textContent=state.previousPrice!==null&&p!==null&&p!==state.previousPrice?"Live price moving":"Synchronized candles";
}
function tickAge(ts){
  const n=safeNum(ts);return n===null?"—":"updated "+Math.max(0,Math.round((Date.now()-n)/1000))+"s ago";
}
function normalizedRows(){
  const rows=Array.isArray(state.chart)?state.chart.slice(-150):[];
  if(!rows.length)return [];
  const out=rows.map(r=>({...r}));
  const last=out.length-1;
  if(state.livePrice!==null){
    const prev=safeNum(out[last].c??out[last].close);
    const hi=safeNum(out[last].h??out[last].high);
    const lo=safeNum(out[last].l??out[last].low);
    out[last].c=state.livePrice;
    out[last].h=Math.max(state.livePrice,hi??state.livePrice);
    out[last].l=Math.min(state.livePrice,lo??state.livePrice);
    if(prev===null)out[last].o=state.livePrice;
  }
  return out;
}
function candleValue(r,k){const map={o:"open",h:"high",l:"low",c:"close",v:"volume"};return safeNum(r?.[k]??r?.[map[k]])}
function rowTime(r){
  const v=safeNum(r?.t??r?.time??r?.timestamp??r?.openTime);
  return v===null?null:v<1e12?v*1000:v;
}
function drawChart(){
  const c=$("chart");if(!c)return;
  const rect=c.getBoundingClientRect(),dpr=window.devicePixelRatio||1,w=Math.max(1,rect.width),h=Math.max(1,rect.height);
  c.width=Math.floor(w*dpr);c.height=Math.floor(h*dpr);const g=c.getContext("2d");
  g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);g.fillStyle="#07090f";g.fillRect(0,0,w,h);
  const rows=normalizedRows();
  if(!rows.length){
    g.fillStyle="#606c7d";g.font="700 11px system-ui";g.fillText("Waiting for exchange candles…",18,26);return;
  }
  const L=10,R=76,T=18,B=42,volH=Math.min(62,h*.13),priceH=h-T-B-volH-8,pw=Math.max(1,w-L-R);
  const values=rows.flatMap(r=>[candleValue(r,"h"),candleValue(r,"l"),candleValue(r,"c")]).filter(v=>v!==null);
  const lp=safeNum(state.livePrice);if(lp!==null)values.push(lp);
  let hi=Math.max(...values),lo=Math.min(...values),range=hi-lo;if(range<=0)range=Math.max(1,Math.abs(hi)*.002);hi+=range*.05;lo-=range*.05;range=hi-lo;
  const x=i=>L+(i+.5)*pw/rows.length,y=v=>T+(hi-v)/range*priceH,yVol=v=>T+priceH+8+(1-(v/maxVol))*volH;
  const maxVol=Math.max(1,...rows.map(r=>candleValue(r,"v")||0));
  const grid="#";g.font="9px ui-monospace,SFMono-Regular,Menlo,monospace";g.textAlign="left";
  for(let i=0;i<=6;i++){
    const yy=T+priceH*i/6;g.strokeStyle="rgba(180,200,220,.075)";g.lineWidth=1;g.beginPath();g.moveTo(L,yy+.5);g.lineTo(L+pw,yy+.5);g.stroke();
    g.fillStyle="#667286";g.fillText(fmt(hi-range*i/6,2),L+pw+9,yy+3);
  }
  for(let i=0;i<8;i++){
    const xx=L+pw*i/7;g.strokeStyle="rgba(180,200,220,.035)";g.beginPath();g.moveTo(xx,T);g.lineTo(xx,T+priceH+volH+8);g.stroke();
  }
  g.strokeStyle="rgba(255,255,255,.04)";g.beginPath();g.moveTo(L,T+priceH+4);g.lineTo(L+pw,T+priceH+4);g.stroke();
  const bw=Math.max(2,pw/rows.length*.64);
  rows.forEach((r,i)=>{
    const o=candleValue(r,"o"),cl=candleValue(r,"c"),hh=candleValue(r,"h"),ll=candleValue(r,"l"),vol=candleValue(r,"v")||0;
    if([o,cl,hh,ll].some(v=>v===null))return;
    const up=cl>=o,bodyTop=y(Math.max(o,cl)),bodyBot=y(Math.min(o,cl));
    g.strokeStyle=up?"#38df9d":"#ff5d77";g.lineWidth=1;g.beginPath();g.moveTo(x(i),y(hh));g.lineTo(x(i),y(ll));g.stroke();
    g.fillStyle=up?"#38df9d":"#ff5d77";g.fillRect(x(i)-bw/2,bodyTop,bw,Math.max(1,bodyBot-bodyTop));
    g.globalAlpha=.18;g.fillRect(x(i)-bw/2,yVol(vol),bw,Math.max(1,volH-(yVol(vol)-(T+priceH+8))));g.globalAlpha=1;
  });
  // 50 EMA
  let ema=null;const k=2/51;g.strokeStyle="#72f5e0";g.lineWidth=1.7;g.beginPath();
  rows.forEach((r,i)=>{const cl=candleValue(r,"c");if(cl===null)return;ema=ema===null?cl:cl*k+ema*(1-k);const yy=y(ema);i?g.lineTo(x(i),yy):g.moveTo(x(i),yy)});g.stroke();
  // time axis
  g.fillStyle="#5f6b7c";g.textAlign="center";
  const labelCount=Math.min(7,rows.length);
  for(let i=0;i<labelCount;i++){
    const idx=Math.round(i*(rows.length-1)/(labelCount-1||1)),ts=rowTime(rows[idx]);if(ts===null)continue;
    const dt=new Date(ts),lab=state.interval==="1d"?dt.toLocaleDateString(undefined,{month:"short",day:"numeric"}):dt.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
    g.fillText(lab,x(idx),h-12);
  }
  // current price line + exchange-style price tag
  if(lp!==null&&lp>=lo&&lp<=hi){
    const yy=y(lp);g.setLineDash([5,4]);g.strokeStyle="rgba(185,140,255,.75)";g.lineWidth=1;g.beginPath();g.moveTo(L,yy);g.lineTo(L+pw,yy);g.stroke();g.setLineDash([]);
    const tagY=clamp(yy-10,4,h-25),tagH=20,tagW=64,tagX=w-R+3;
    g.fillStyle="#b98cff";g.roundRect?.(tagX,tagY,tagW,tagH,5);if(!g.roundRect)g.fillRect(tagX,tagY,tagW,tagH);
    g.fillStyle="#09090e";g.font="900 9px ui-monospace,SFMono-Regular,Menlo,monospace";g.textAlign="center";g.fillText(fmt(lp,2),tagX+tagW/2,tagY+13);
  }
  // decision levels
  const lv=state.decision?.levels||state.decision?.apex?.executionGate||{};
  const levels=[["ENTRY",lv.entry??lv.entryLow,"#70a7ff"],["TP1",lv.tp1??lv.target,"#d8ff72"],["SL",lv.stop,"#ff5d77"]];
  levels.forEach(([label,v,col])=>{
    const n=safeNum(v);if(n===null||n<lo||n>hi)return;const yy=y(n);
    g.setLineDash([7,6]);g.strokeStyle=col;g.beginPath();g.moveTo(L,yy);g.lineTo(L+pw,yy);g.stroke();g.setLineDash([]);
    g.fillStyle=col;g.textAlign="left";g.font="900 8px ui-monospace,SFMono-Regular,Menlo,monospace";g.fillText(label+"  "+fmt(n,2),L+7,yy-5);
  });
  if(state.crosshair){
    const cx=clamp(state.crosshair.x,L,L+pw),cy=clamp(state.crosshair.y,T,T+priceH+volH+8),idx=clamp(Math.floor((cx-L)/pw*rows.length),0,rows.length-1);
    const r=rows[idx],cv=candleValue(r,"c");
    g.strokeStyle="rgba(225,235,245,.18)";g.setLineDash([3,3]);g.beginPath();g.moveTo(cx,T);g.lineTo(cx,T+priceH);g.moveTo(L,cy);g.lineTo(L+pw,cy);g.stroke();g.setLineDash([]);
    const ts=rowTime(r);const parts=[cv===null?"":fmt(cv,2),ts?new Date(ts).toLocaleString():...[]]; // crosshair anchor only
    const hover=$("chartHover");hover.style.display="block";hover.style.left=Math.min(w-170,Math.max(8,cx+12))+"px";hover.style.top=Math.max(8,Math.min(h-54,cy-12))+"px";hover.textContent=ts?new Date(ts).toLocaleString()+"  ·  "+fmt(cv,2):fmt(cv,2);
  }else $("chartHover").style.display="none";
}
function decisionParts(d){
  const apex=d?.apex||d?.phase401to500?.apex||{},p=d?.probabilities||apex.probabilities||{},m=d?.market||{},lv=d?.levels||apex.executionGate||{},g=d?.deploymentGate||apex.executionGate||{};
  const action=String(d?.action??apex.action??m.side??"WAIT").toUpperCase();
  return {d,apex,p,m,lv,g,action};
}
function renderDecision(){
  const x=decisionParts(state.decision||{}),d=x.d,p=x.p||{},m=x.m||{},lv=x.lv||{},g=x.g||{},action=["LONG","SHORT"].includes(x.action)?x.action:"WAIT";
  $("decision").textContent=action;$("stateLabel").textContent=action==="WAIT"?"WAIT / NO TRADE":action+" — CURRENT AUTHORITY";
  statusPill(String(g.state||g.status||action),action==="LONG"?"long":action==="SHORT"?"short":"wait");
  $("thesis").textContent=d?.evidence?.thesis?.[0]||d?.phase20?.transition?.hardLock||d?.phase51to100?.signal?.confidenceSource||m.directionalLean||"Waiting for synchronized evidence and a confirmed final gate.";
  const probs=[safeNum(p.long),safeNum(p.short),safeNum(p.wait)];
  ["longProb","shortProb","waitProb"].forEach((id,i)=>$(id).textContent=probs[i]===null?"—":pct(probs[i]));
  ["longBar","shortBar","waitBar"].forEach((id,i)=>$(id).style.width=probs[i]===null?"0":clamp(Math.abs(probs[i])<=1?probs[i]*100:probs[i],0,100)+"%");
  $("entry").textContent=safeNum(lv.entry??lv.entryLow)===null?"—":fmt(lv.entry??lv.entryLow,2);
  $("stop").textContent=safeNum(lv.stop)===null?"—":fmt(lv.stop,2);
  $("tp1").textContent=safeNum(lv.tp1??lv.target)===null?"—":fmt(lv.tp1??lv.target,2);
  $("rr").textContent=safeNum(lv.rr)===null?"—":Number(lv.rr).toFixed(2)+"R";
  const score=safeNum(d?.data?.score??d?.phase301to400?.dataQuality?.score??x.apex.quality);
  $("quality").textContent=score===null?"—":Math.round(score*(score<=1?100:1))+"/100";
  $("syncState").textContent=x.apex?.synchronization?.ok||d?.synchronization?.ok?"LOCKED":"PENDING";
  $("execution").textContent=x.apex?.executionGate?.automaticExecutionReady?"READY":"GATED";
  const flow=extractFlow(d);
  $("oi").textContent=fmt(flow.oi,0);$("cvd").textContent=fmt(flow.cvd,3);$("book").textContent=flow.book===null?"—":(flow.book*100).toFixed(1)+"%";$("funding").textContent=flow.funding===null?"—":(flow.funding*100).toFixed(4)+"%";$("liquidations").textContent=fmt(flow.liq,0);
  $("cvdState").textContent=flow.cvdState||"warming";$("liqState").textContent=flow.liqState||"warming";
  $("tapeMarket").textContent=action+" · "+(m.directionalLean||"neutral");
  $("tapeFlow").textContent=flow.cvd===null?"Waiting for CVD":flow.cvdState||fmt(flow.cvd,3);
  $("tapeLiquidity").textContent=flow.book===null?"Waiting for book":(flow.book>=0?"Bid support ":"Offer pressure ")+Math.abs(flow.book*100).toFixed(1)+"%";
  $("reasons").innerHTML="";
  const reasons=[...(Array.isArray(g.reasons)?g.reasons:[]),...(Array.isArray(d?.phase20?.transition?.waitCondition)?d.phase20.transition.waitCondition:[]),...(Array.isArray(d?.evidence?.thesis)?d.evidence.thesis.slice(0,3):[])].filter(Boolean).slice(0,7);
  (reasons.length?reasons:["The system has not published a blocking reason yet."]).forEach(v=>{const el=document.createElement("div");el.className="reason";el.textContent=String(v);$("reasons").appendChild(el)});
  drawChart();
}
function renderSystemChecks(checks){
  $("systemChecks").innerHTML="";
  Object.entries(checks||{}).forEach(([k,v])=>{
    const el=document.createElement("div");el.className="check";
    el.innerHTML='<b><span class="dot '+(v?"ok":"bad")+'"></span>'+String(k)+'</b><span>'+String(v?"PASS":"BLOCKED")+"</span>";
    $("systemChecks").appendChild(el);
  });
}
async function loadCore(){
  runtime("Loading market state…","warn","First paint does not depend on analytics.");
  const cachedT=readCache(cacheKey("ticker")),cachedC=readCache(cacheKey("chart")),cachedD=readCache(cacheKey("decision"));
  if(cachedT){state.ticker=cachedT;state.livePrice=safeNum(cachedT.price);renderTicker()}
  if(cachedC){state.chart=cachedC.candles||cachedC;drawChart()}
  if(cachedD){state.decision=cachedD;renderDecision()}
  const tasks=await Promise.allSettled([
    api("/api/config",3000),
    api("/api/fast-ticker?symbol="+encodeURIComponent(state.symbol),2500),
    api("/api/chart?symbol="+encodeURIComponent(state.symbol)+"&interval="+encodeURIComponent(state.interval),5000),
    api("/api/live-sync?symbol="+encodeURIComponent(state.symbol),2500)
  ]);
  const [cfg,tick,chart,live]=tasks;
  if(cfg.status==="fulfilled"){state.cfg=cfg.value;populateSymbols(cfg.value.symbols)}
  if(tick.status==="fulfilled"){state.ticker=tick.value;state.livePrice=safeNum(tick.value.price);writeCache(cacheKey("ticker"),state.ticker);renderTicker()}
  if(chart.status==="fulfilled"&&Array.isArray(chart.value.candles)){state.chart=chart.value.candles;writeCache(cacheKey("chart"),chart.value);drawChart()}
  if(live.status==="fulfilled")state.live=live.value||{};
  const marketOk=tick.status==="fulfilled"||chart.status==="fulfilled";
  runtime(marketOk?"MarketPulse online":"UI online — market feed retrying",marketOk?"ok":"warn",marketOk?"Live terminal ready. Price transport updates every second; analytics refresh independently.":"No blocking UI dependency failed; retrying providers automatically.");
  if(state.decision)renderDecision();
  refreshDecision(false);
}
async function tickLoop(){
  try{
    const t=await api("/api/fast-ticker?symbol="+encodeURIComponent(state.symbol)+"&stream=1s",1800);
    const p=safeNum(t.price);if(p!==null){
      state.previousPrice=state.livePrice;state.livePrice=p;state.pricePulse=Date.now();
      state.ticker={...state.ticker,...t};
      writeCache(cacheKey("ticker"),state.ticker);
      renderTicker();drawChart();
    }
  }catch{}
}
async function flowLoop(){
  try{const d=await api("/api/live-sync?symbol="+encodeURIComponent(state.symbol)+"&stream=1s",2200);state.live=d||{};if(state.decision)renderDecision()}catch{}
}
async function chartLoop(){
  try{
    const c=await api("/api/chart?symbol="+encodeURIComponent(state.symbol)+"&interval="+encodeURIComponent(state.interval),4500);
    if(Array.isArray(c.candles)&&c.candles.length){state.chart=c.candles;writeCache(cacheKey("chart"),c);drawChart()}
  }catch{}
}
async function refreshDecision(showStatus=true){
  if(showStatus)runtime("Refreshing decision engine…","warn","Last confirmed frame remains visible until a fresh result arrives.");
  try{
    const d=await api("/api/decision?symbol="+encodeURIComponent(state.symbol)+"&interval="+encodeURIComponent(state.interval),6500);
    state.decision=d;writeCache(cacheKey("decision"),d);renderDecision();
    runtime("MarketPulse online","ok","Canonical market + decision surfaces are synchronized.");
  }catch{
    if(!state.decision){
      try{
        const a=await api("/api/phase401-500?symbol="+encodeURIComponent(state.symbol)+"&interval="+encodeURIComponent(state.interval),7500);
        state.decision=a;writeCache(cacheKey("decision"),a);renderDecision();runtime("MarketPulse online","ok","Apex engine connected.");
      }catch{runtime("UI online — decision engine retrying","warn","No decision payload was allowed to block the market screen.")}
    }
  }
}
function setIntervalFromToolbar(tf){
  const map={"15m":"15m","30m":"30m","1H":"1h","4H":"4h","1D":"1d"};const v=map[tf]||tf;
  if(!["15m","30m","1h","4h","1d"].includes(v))return;
  state.interval=v;$("interval").value=v;document.querySelectorAll(".tf-tabs button").forEach(b=>b.classList.toggle("active",map[b.dataset.tf]===v));refreshAll();
}
async function loadPhases(){
  if(state.phases){$("phaseList").classList.toggle("hidden");return}
  $("phaseList").classList.remove("hidden");$("phaseList").innerHTML='<div class="placeholder">Loading phase registry…</div>';
  try{
    const d=await api("/api/phases",5000);state.phases=d;
    $("phaseHeadline").textContent="PHASE 1 → 500 · "+d.engineeringPhase;
    const list=Array.isArray(d.phases)?d.phases:[],complete=list.filter(x=>x.status==="COMPLETE").length,validated=list.filter(x=>/VALIDATED/.test(String(x.status))).length;
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
  try{const d=await api("/api/system-check",9000);renderSystemChecks(d.checks||{});runtime(d.ok?"System checks passed":"Core checks reported blockers",d.ok?"ok":"warn",d.ok?"All bounded checks returned within their gates.":"See runtime safety panel; these checks never block first paint.")}catch(e){$("systemChecks").innerHTML='<div class="placeholder">System check unavailable: '+String(e.message||e)+'</div>'}
}
function bind(){
  $("symbol").addEventListener("change",()=>{state.symbol=cleanSymbol($("symbol").value)||"BTCUSDT";$("symbolName").textContent=displaySymbol(state.symbol);$("assetIcon").textContent=state.symbol==="BTCUSDT"?"₿":"◈";refreshAll()});
  $("interval").addEventListener("change",()=>{state.interval=$("interval").value;document.querySelectorAll(".tf-tabs button").forEach(b=>b.classList.toggle("active",({"15m":"15m","30m":"30m","1H":"1h","4H":"4h","1D":"1d"}[b.dataset.tf]===state.interval)));refreshAll()});
  $("sync").addEventListener("click",refreshAll);
  $("fitChart").addEventListener("click",()=>{state.fitToken++;drawChart()});
  $("loadPhases").addEventListener("click",loadPhases);
  $("checkSystem").addEventListener("click",checkSystem);
  document.querySelectorAll(".tf-tabs button").forEach(b=>b.addEventListener("click",()=>setIntervalFromToolbar(b.dataset.tf)));
  const canvas=$("chart");
  canvas.addEventListener("mousemove",e=>{const r=canvas.getBoundingClientRect();state.crosshair={x:e.clientX-r.left,y:e.clientY-r.top};drawChart()});
  canvas.addEventListener("mouseleave",()=>{state.crosshair=null;drawChart()});
  window.addEventListener("resize",drawChart);
}
function refreshAll(){
  clearInterval(state.tickerTimer);clearInterval(state.flowTimer);clearInterval(state.chartTimer);clearInterval(state.decisionTimer);
  state.ticker=null;state.live=null;state.chart=null;state.decision=null;state.livePrice=null;state.previousPrice=null;state.phases=null;
  $("symbolName").textContent=displaySymbol(state.symbol);loadCore();startLoops();
}
function startLoops(){
  state.tickerTimer=setInterval(tickLoop,1000);
  state.flowTimer=setInterval(flowLoop,3000);
  state.chartTimer=setInterval(chartLoop,15000);
  state.decisionTimer=setInterval(()=>refreshDecision(false),12000);
}
function boot(){
  try{
    bind();populateSymbols();startLoops();runtime("UI ready — connecting to market data…","warn","The terminal renders first; market data never blocks the shell.");loadCore();
  }catch(e){
    runtime("UI recovery mode","warn","Boot error isolated: "+String(e.message||e));
  }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();