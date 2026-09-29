(()=>{
"use strict";

const $=id=>document.getElementById(id);
const state={
  symbol:"BTCUSDT",interval:"1h",cfg:null,ticker:null,live:null,market:null,chart:null,decision:null,phases:null,
  livePrice:null,previousPrice:null,pricePulse:0,lastLiveEventAt:0,lastServerSeq:0,
  crosshair:null,selectedCandle:null,drag:null,chartUserInteracted:false,viewStart:0,viewCount:110,fullscreen:false,navFocusTimer:null,
  ws:null,wsConnected:false,wsReconnectTimer:null,wsRetryMs:1000,
  style:{up:"#37e6a2",down:"#ff5d77",bg:"#0b0d10",grid:"#2b3036"},
  tickerTimer:null,flowTimer:null,chartTimer:null,decisionTimer:null,
  chartDrawFrame:null,marketEpoch:0
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
  $("source").textContent=state.wsConnected?"Bybit live WebSocket":(t.source||"exchange feed");
  $("age").textContent=tickAge(state.market?.dataTs??t.updatedAt);
  $("lastTrade").textContent="LAST "+fmt(p,2);
  $("dataBadge").textContent=p===null?"CONNECTING":(state.wsConnected?"LIVE WS":"LIVE FALLBACK");
  $("chartState").textContent=state.wsConnected?"Live exchange ticks":(state.previousPrice!==null&&p!==null&&p!==state.previousPrice?"Live price fallback":"Synchronized candles");$("chartTransport").textContent=state.wsConnected?"WS LIVE · 1s fallback ready":"HTTP FALLBACK · 1s";
}
function tickAge(ts){
  const n=safeNum(ts);return n===null?"—":"updated "+Math.max(0,Math.round((Date.now()-n)/1000))+"s ago";
}
function loadChartStyle(){
  try{
    const saved=JSON.parse(localStorage.getItem("mp-chart-style")||"null");
    if(saved&&typeof saved==="object")state.style={...state.style,...saved};
    if(state.style.bg==="#07090f")state.style.bg="#0b0d10";
    if(state.style.grid==="#2b3040")state.style.grid="#2b3036";
  }catch{}
  if($("candleUpColor"))$("candleUpColor").value=state.style.up;
  if($("candleDownColor"))$("candleDownColor").value=state.style.down;
  if($("chartBgColor"))$("chartBgColor").value=state.style.bg;
  if($("chartGridColor"))$("chartGridColor").value=state.style.grid;
}
function saveChartStyle(){
  try{localStorage.setItem("mp-chart-style",JSON.stringify(state.style))}catch{}
}
function updateChartStyle(){
  state.style.up=$("candleUpColor").value;
  state.style.down=$("candleDownColor").value;
  state.style.bg=$("chartBgColor").value;
  state.style.grid=$("chartGridColor").value;
  saveChartStyle();drawChart();
}
function resetChartView(){
  const total=Array.isArray(state.chart)?state.chart.length:0;
  state.chartUserInteracted=false;
  state.viewCount=Math.min(110,Math.max(25,total||110));
  state.viewStart=Math.max(0,(total||state.viewCount)-state.viewCount);
  drawChart();
}
function zoomChart(multiplier,anchorRatio=.5){
  const total=Array.isArray(state.chart)?state.chart.length:0;
  if(!total)return;
  const oldCount=clamp(Math.floor(state.viewCount||Math.min(110,total)),25,total);
  const oldStart=clamp(Math.floor(state.viewStart||0),0,Math.max(0,total-oldCount));
  const anchorIndex=oldStart+Math.round(anchorRatio*(oldCount-1));
  const nextCount=clamp(Math.round(oldCount*multiplier),25,total);
  state.viewCount=nextCount;
  state.viewStart=clamp(anchorIndex-Math.round(anchorRatio*(nextCount-1)),0,Math.max(0,total-nextCount));
  state.chartUserInteracted=true;drawChart();
}
function liveStreamUrl(){
  const proto=location.protocol==="https:"?"wss:":"ws:";
  return proto+"//"+location.host+"/api/live-stream?symbol="+encodeURIComponent(state.symbol);
}
function closeLiveStream(){
  clearTimeout(state.wsReconnectTimer);state.wsReconnectTimer=null;
  try{state.ws?.close()}catch{}
  state.ws=null;state.wsConnected=false;
}
function connectLiveStream(){
  closeLiveStream();
  const url=liveStreamUrl();
  try{
    const ws=new WebSocket(url);state.ws=ws;
    ws.addEventListener("open",()=>{
      if(state.ws!==ws)return;
      state.wsConnected=true;state.wsRetryMs=1000;runtime("LIVE exchange stream connected","ok","Canonical last-traded price is driving the entire terminal.");
      $("dataBadge").textContent="LIVE WS";
    });
    ws.addEventListener("message",ev=>{
      if(state.ws!==ws)return;
      try{
        const frame=JSON.parse(ev.data);
        if(frame.type!=="market-sync"||String(frame.symbol).toUpperCase()!==state.symbol)return;
        applyCanonicalMarket(frame);
      }catch{}
    });
    ws.addEventListener("close",()=>{
      if(state.ws!==ws)return;
      state.wsConnected=false;
      $("dataBadge").textContent="RECONNECTING";
      runtime("Exchange stream reconnecting…","warn","Polling remains active as a safety fallback.");
      clearTimeout(state.wsReconnectTimer);
      state.wsReconnectTimer=setTimeout(()=>connectLiveStream(),state.wsRetryMs);
      state.wsRetryMs=Math.min(state.wsRetryMs*2,10000);
    });
    ws.addEventListener("error",()=>{try{ws.close()}catch{}});
  }catch{
    state.wsConnected=false;
    clearTimeout(state.wsReconnectTimer);
    state.wsReconnectTimer=setTimeout(()=>connectLiveStream(),state.wsRetryMs);
    state.wsRetryMs=Math.min(state.wsRetryMs*2,10000);
  }
}
function renderLiveMetrics(frame){
  const f=frame||{};
  const cvd=safeNum(f.cvdRatio),book=safeNum(f.orderBook?.imbalance),funding=safeNum(f.fundingRate),liq=safeNum(f.liquidationTotal),oi=safeNum(f.oi);
  $("oi").textContent=fmt(oi,0);$("cvd").textContent=fmt(cvd,4);
  $("book").textContent=book===null?"—":(book*100).toFixed(1)+"%";
  $("funding").textContent=funding===null?"—":(funding*100).toFixed(4)+"%";
  $("liquidations").textContent=fmt(liq,0);
  $("cvdState").textContent=f.cvdState||"LIVE";
  $("liqState").textContent=f.liquidationBias||"LIVE";
  $("tapeFlow").textContent=f.cvdState||"LIVE FLOW";
  $("tapeLiquidity").textContent=book===null?"LIVE BOOK":(book>=0?"Bid support ":"Offer pressure ")+Math.abs(book*100).toFixed(1)+"%";
  $("syncState").textContent=state.wsConnected?"LOCKED":"FALLBACK";
}
function applyCanonicalMarket(frame){
  const p=safeNum(frame.lastPrice??frame.price);if(p===null)return;
  state.previousPrice=state.livePrice;state.livePrice=p;state.lastLiveEventAt=Date.now();state.lastServerSeq=safeNum(frame.seq)||state.lastServerSeq;
  state.market=frame;state.live=frame;
  state.ticker={...(state.ticker||{}),symbol:state.symbol,price:p,change24h:safeNum(frame.change24h),source:frame.source||(state.wsConnected?"Bybit live WebSocket":"HTTP fallback"),updatedAt:safeNum(frame.dataTs)||Date.now()};
  renderTicker();renderLiveMetrics(frame);drawChart();
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
function drawChartNow(){
  const c=$("chart");if(!c)return;
  const rect=c.getBoundingClientRect(),dpr=window.devicePixelRatio||1,w=Math.max(1,rect.width),h=Math.max(1,rect.height);
  const targetW=Math.max(1,Math.floor(w*dpr)),targetH=Math.max(1,Math.floor(h*dpr));
  const resized=c.width!==targetW||c.height!==targetH;
  if(resized){c.width=targetW;c.height=targetH;}
  const g=c.getContext("2d");
  g.setTransform(1,0,0,1,0,0);
  if(resized||state.chartForceClear)g.clearRect(0,0,targetW,targetH);
  g.setTransform(dpr,0,0,dpr,0,0);
  g.clearRect(0,0,w,h);g.fillStyle=state.style.bg;g.fillRect(0,0,w,h);

  const rows=normalizedRows();
  if(!rows.length){g.fillStyle="#647084";g.font="700 11px system-ui";g.fillText("Waiting for exchange candles…",18,27);return}

  const total=rows.length;
  if(!state.chartUserInteracted){
    state.viewCount=Math.min(110,total);
    state.viewStart=Math.max(0,total-state.viewCount);
  }
  state.viewCount=clamp(Math.floor(state.viewCount||Math.min(110,total)),25,total);
  state.viewStart=clamp(Math.floor(state.viewStart||0),0,Math.max(0,total-state.viewCount));

  const start=state.viewStart,end=Math.min(total,start+state.viewCount),visible=rows.slice(start,end);
  const L=12,R=78,T=18,B=40,volH=Math.min(62,h*.13),priceH=Math.max(120,h-T-B-volH-8),pw=Math.max(1,w-L-R);
  const vals=visible.flatMap(r=>[candleValue(r,"h"),candleValue(r,"l"),candleValue(r,"c")]).filter(v=>v!==null);
  if(state.livePrice!==null)vals.push(state.livePrice);
  let hi=Math.max(...vals),lo=Math.min(...vals),range=hi-lo;
  if(!Number.isFinite(range)||range<=0)range=Math.max(1,Math.abs(hi)*.002);
  hi+=range*.055;lo-=range*.055;range=hi-lo;
  const x=i=>L+(i+.5)*pw/visible.length;
  const y=v=>T+(hi-v)/range*priceH;
  const maxVol=Math.max(1,...visible.map(r=>candleValue(r,"v")||0));
  const yVol=v=>T+priceH+8+(1-v/maxVol)*volH;

  g.font="9px ui-monospace,SFMono-Regular,Menlo,monospace";g.textAlign="left";
  for(let i=0;i<=6;i++){
    const yy=T+priceH*i/6;
    g.strokeStyle=state.style.grid;g.globalAlpha=.26;g.beginPath();g.moveTo(L,yy+.5);g.lineTo(L+pw,yy+.5);g.stroke();g.globalAlpha=1;
    g.fillStyle="#657084";g.fillText(fmt(hi-range*i/6,2),L+pw+9,yy+3);
  }
  for(let i=0;i<=8;i++){
    const xx=L+pw*i/8;g.strokeStyle=state.style.grid;g.globalAlpha=.16;g.beginPath();g.moveTo(xx,T);g.lineTo(xx,T+priceH+volH+8);g.stroke();g.globalAlpha=1;
  }
  g.strokeStyle="rgba(255,255,255,.06)";g.beginPath();g.moveTo(L,T+priceH+4);g.lineTo(L+pw,T+priceH+4);g.stroke();

  const bw=Math.max(2,Math.min(11,pw/visible.length*.68));
  visible.forEach((r,j)=>{
    const o=candleValue(r,"o"),cl=candleValue(r,"c"),hh=candleValue(r,"h"),ll=candleValue(r,"l"),vol=candleValue(r,"v")||0;
    if([o,cl,hh,ll].some(v=>v===null))return;
    const up=cl>=o,xx=x(j),bodyTop=y(Math.max(o,cl)),bodyBot=y(Math.min(o,cl));
    g.strokeStyle=up?state.style.up:state.style.down;g.lineWidth=1;g.beginPath();g.moveTo(xx,y(hh));g.lineTo(xx,y(ll));g.stroke();
    g.fillStyle=up?state.style.up:state.style.down;g.fillRect(xx-bw/2,bodyTop,bw,Math.max(1,bodyBot-bodyTop));
    const volBase=T+priceH+8,volTop=volBase+(1-vol/maxVol)*volH;
    g.globalAlpha=.16;g.fillRect(xx-bw/2,volTop,bw,Math.max(1,volBase+volH-volTop));g.globalAlpha=1;
  });

  if(Number.isInteger(state.selectedCandle) && state.selectedCandle>=start && state.selectedCandle<end){
    const sj=state.selectedCandle-start,sr=visible[sj],sx=x(sj);
    g.strokeStyle="rgba(98,244,224,.65)";g.setLineDash([3,5]);g.beginPath();g.moveTo(sx,T);g.lineTo(sx,T+priceH+volH+8);g.stroke();g.setLineDash([]);
    const sc=candleValue(sr,"c");if(sc!==null){const sy=y(sc);g.fillStyle="#62f4e0";g.beginPath();g.arc(sx,sy,3.2,0,Math.PI*2);g.fill();}
  }

  // EMA(50), calculated over the complete loaded series and then clipped to the viewport.
  let ema=null;const emaK=2/51,emaValues=[];
  rows.forEach((r,i)=>{const cl=candleValue(r,"c");if(cl===null){emaValues[i]=null;return}ema=ema===null?cl:cl*emaK+ema*(1-emaK);emaValues[i]=ema});
  g.strokeStyle="#72f5e0";g.lineWidth=1.7;g.beginPath();let started=false;
  for(let i=start;i<end;i++){const v=emaValues[i];if(v===null)continue;const yy=y(v),xx=x(i-start);if(!started){g.moveTo(xx,yy);started=true}else g.lineTo(xx,yy)}
  if(started)g.stroke();

  g.fillStyle="#5f6b7d";g.textAlign="center";
  const labels=Math.min(8,visible.length);
  for(let j=0;j<labels;j++){
    const idx=Math.round(j*(visible.length-1)/(labels-1||1)),r=visible[idx],ts=rowTime(r);if(ts===null)continue;
    const dt=new Date(ts),lab=state.interval==="1d"?dt.toLocaleDateString(undefined,{month:"short",day:"numeric"}):dt.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    g.fillText(lab,x(idx),h-12);
  }

  const lp=safeNum(state.livePrice);
  if(lp!==null&&lp>=lo&&lp<=hi){
    const yy=y(lp);g.setLineDash([6,4]);g.strokeStyle="rgba(180,188,198,.82)";g.lineWidth=1;g.beginPath();g.moveTo(L,yy);g.lineTo(L+pw,yy);g.stroke();g.setLineDash([]);
    const tagY=clamp(yy-10,3,h-25),tagW=67,tagH=20,tagX=w-R+4;
    g.fillStyle="#b9c0c9";g.beginPath();if(g.roundRect)g.roundRect(tagX,tagY,tagW,tagH,5);else g.rect(tagX,tagY,tagW,tagH);g.fill();
    g.fillStyle="#11151b";g.font="950 9px ui-monospace,SFMono-Regular,Menlo,monospace";g.textAlign="center";g.fillText(fmt(lp,2),tagX+tagW/2,tagY+13);
  }

  const lv=state.decision?.levels||state.decision?.apex?.executionGate||{};
  [["ENTRY",lv.entry??lv.entryLow,"#70a7ff"],["TP1",lv.tp1??lv.target,"#d8ff72"],["SL",lv.stop,"#ff5d77"]].forEach(([label,v,col])=>{
    const n=safeNum(v);if(n===null||n<lo||n>hi)return;const yy=y(n);
    g.setLineDash([7,6]);g.strokeStyle=col;g.beginPath();g.moveTo(L,yy);g.lineTo(L+pw,yy);g.stroke();g.setLineDash([]);
    g.fillStyle=col;g.textAlign="left";g.font="900 8px ui-monospace,SFMono-Regular,Menlo,monospace";g.fillText(label+"  "+fmt(n,2),L+7,yy-5);
  });

  if(state.crosshair){
    const cx=clamp(state.crosshair.x,L,L+pw),cy=clamp(state.crosshair.y,T,T+priceH),ratio=(cx-L)/pw,idx=clamp(Math.floor(ratio*visible.length),0,visible.length-1),r=visible[idx],cv=candleValue(r,"c"),ts=rowTime(r);
    g.strokeStyle="rgba(225,235,245,.20)";g.setLineDash([3,3]);g.beginPath();g.moveTo(cx,T);g.lineTo(cx,T+priceH);g.moveTo(L,cy);g.lineTo(L+pw,cy);g.stroke();g.setLineDash([]);
    const hover=$("chartHover");hover.style.display="block";hover.style.left=Math.min(w-190,Math.max(8,cx+12))+"px";hover.style.top=Math.max(8,Math.min(h-54,cy+8))+"px";hover.textContent=(ts?new Date(ts).toLocaleString()+" · ":"")+fmt(cv,2)+" · "+fmt(hi-(cy-T)/priceH*range,2);
  }else $("chartHover").style.display="none";
}
function drawChart(){
  if(state.chartDrawFrame!==null)return;
  const run=()=>{
    state.chartDrawFrame=null;
    try{drawChartNow()}catch{}
  };
  state.chartDrawFrame=typeof requestAnimationFrame==="function"
    ?requestAnimationFrame(run)
    :setTimeout(run,0);
}
function decisionParts(d){
  const apex=d?.apex||d?.phase401to500?.apex||{},p=d?.probabilities||apex.probabilities||{},m=d?.market||{},lv=d?.levels||apex.executionGate||{},g=d?.deploymentGate||apex.executionGate||{};
  const action=String(d?.action??apex.action??m.side??"WAIT").toUpperCase();
  return {d,apex,p,m,lv,g,action};
}
function renderDecision(){
  const x=decisionParts(state.decision||{}),d=x.d,p=x.p||{},m=x.m||{},lv=x.lv||{},g=x.g||{},action=["LONG","SHORT"].includes(x.action)?x.action:"WAIT";
  const analysis=d?.analysis||{};
  const candidateSide=String(
    d?.signalCandidate?.side||
    d?.decisionDiagnostics?.candidate?.side||
    d?.candidateEvidence?.action||
    d?.rawAction||
    analysis?.side||
    m?.side||
    "WAIT"
  ).toUpperCase();
  const candidate=["LONG","SHORT"].includes(candidateSide)?candidateSide:"WAIT";
  const looseWatchSide=["LONG","SHORT"].includes(String(
    d?.earlyCandidate?.side||
    d?.analysis?.side||
    d?.analysis?.marketStructure?.setup?.side||
    d?.analysis?.regime==="UPTREND"?"LONG":
    d?.analysis?.regime==="DOWNTREND"?"SHORT":"WAIT"
  ).toUpperCase())
    ?String(d?.earlyCandidate?.side||d?.analysis?.side||d?.analysis?.marketStructure?.setup?.side||(d?.analysis?.regime==="UPTREND"?"LONG":d?.analysis?.regime==="DOWNTREND"?"SHORT":"WAIT")).toUpperCase()
    :"WAIT";
  const gateChain=d?.signalGateChain||{};
  const earlyCandidateSide=["LONG","SHORT"].includes(String(d?.earlyCandidate?.side||"").toUpperCase())
    ?String(d.earlyCandidate.side).toUpperCase():"WAIT";
  const visibleCandidate=candidate!=="WAIT"?candidate:earlyCandidateSide;
  const staleCandidate=Boolean(d?.stale&&d?.signalCandidate?.stale);
  const blockingStage=action!=="WAIT"?"READY":
    gateChain?.phase9to10?.gate==="BLOCKED"?"P9–10":
    (Array.isArray(gateChain?.phase11to13?.reasons)&&gateChain.phase11to13.reasons.length)?"P11–13":
    (Array.isArray(gateChain?.phase51to100?.blockers)&&gateChain.phase51to100.blockers.length)?"P51–100":
    (Array.isArray(gateChain?.phase101to200?.blockers)&&gateChain.phase101to200.blockers.length)?"P101–200":
    (Array.isArray(gateChain?.phase201to300?.blockers)&&gateChain.phase201to300.blockers.length)?"P201–300":
    (Array.isArray(gateChain?.phase301to400?.blockers)&&gateChain.phase301to400.blockers.length)?"P301–400":
    (Array.isArray(gateChain?.phase401to500?.reasons)&&gateChain.phase401to500.reasons.length)?"P401–500":
    "WAITING";
  const rawScore=safeNum(
    m?.confluenceScore??
    analysis?.score??
    d?.candidateEvidence?.market?.confluenceScore??
    d?.score??
    d?.phase401to500?.apex?.quality
  );
  const confluencePct=rawScore===null?null:clamp(Math.round(rawScore<=1?rawScore*100:rawScore),0,100);
  const stability=d?.signalStability||{};
  const diagnostics=d?.decisionDiagnostics||{};
  const blockerSets=[
    ...(Array.isArray(diagnostics?.profitability?.blockers)?diagnostics.profitability.blockers:[]),
    ...(Array.isArray(diagnostics?.adaptive?.blockers)?diagnostics.adaptive.blockers:[]),
    ...(Array.isArray(diagnostics?.canonical?.reasons)?diagnostics.canonical.reasons:[]),
    ...(Array.isArray(diagnostics?.advanced?.blockers)?diagnostics.advanced.blockers:[])
  ].filter(Boolean);
  const gateReason=String(
    g?.reason||
    d?.deploymentGate?.reason||
    blockerSets[0]||
    "Waiting for the decision gates to resolve."
  ).trim();

  $("decision").textContent=action;
  $("stateLabel").textContent=action==="WAIT"?"WAIT / NO TRADE":action+" — CURRENT AUTHORITY";
  statusPill(action==="WAIT"?(blockingStage==="READY"?"WAIT":"BLOCKED · "+blockingStage):String(g.state||g.status||action),action==="LONG"?"long":action==="SHORT"?"short":"wait");

  const candidateEl=$("candidateState");
  if(candidateEl){
    candidateEl.className="candidate-state "+(
      staleCandidate?"stale":
      action==="LONG"?"long":action==="SHORT"?"short":
      stability.state==="CONFIRMING"?"confirming":"wait"
    );
    if(staleCandidate&&candidate!=="WAIT"){
      const age=Number(d?.signalCandidate?.staleAgeMs);
      candidateEl.textContent=candidate+" CANDIDATE · STALE"+(Number.isFinite(age)?" · "+Math.round(age/1000)+"s":"");
    }else if(action==="LONG"||action==="SHORT"){
      candidateEl.textContent="FINAL "+action+" · CONFIRMED";
    }else if(candidate!=="WAIT"){
      const progress=stability.confirmations&&stability.required
        ?" · "+stability.confirmations+"/"+stability.required+" confirmations"
        :"";
      candidateEl.textContent=candidate+" CANDIDATE"+(confluencePct===null?"":" · "+confluencePct+"% CONFLUENCE")+progress;
    }else if(earlyCandidateSide!=="WAIT"){
      candidateEl.textContent=earlyCandidateSide+" WATCH CANDIDATE · FINAL GATE NOT PASSED";
    }else if(looseWatchSide!=="WAIT"){
      candidateEl.textContent=looseWatchSide+" WATCH · EVIDENCE DIRECTION";
    }else{
      candidateEl.textContent="NO DIRECTIONAL CANDIDATE";
    }
  }

  $("thesis").textContent=
    d?.evidence?.thesis?.[0]||
    d?.thesis||
    (staleCandidate
      ?"Previous "+candidate+" candidate retained for context only — fresh validation is required."
      :null)||
    (candidate==="WAIT"&&earlyCandidateSide!=="WAIT"
      ?earlyCandidateSide+" watch candidate detected — current blocker: "+blockingStage
      :null)||
    (candidate==="WAIT"&&earlyCandidateSide==="WAIT"&&looseWatchSide!=="WAIT"
      ?looseWatchSide+" is the current evidence direction; final gate remains unchanged."
      :null)||
    (candidate!=="WAIT"&&blockerSets.length
      ?candidate+" candidate detected — waiting on: "+blockerSets[0].replaceAll("_"," ").toLowerCase()+"."
      :null)||
    d?.phase20?.transition?.hardLock||
    d?.phase51to100?.signal?.confidenceSource||
    m.directionalLean||
    "Waiting for synchronized evidence and a confirmed final gate.";

  // These are confluence indicators, not calibrated probabilities.
  [
    {id:"longProb",bar:"longBar",value:candidate==="LONG"?confluencePct:null},
    {id:"shortProb",bar:"shortBar",value:candidate==="SHORT"?confluencePct:null},
    {id:"waitProb",bar:"waitBar",value:null}
  ].forEach(r=>{
    $(r.id).textContent=r.value===null?"—":r.value+"%";
    $(r.bar).style.width=r.value===null?"0":r.value+"%";
  });

  const levelValue=v=>{const n=safeNum(v);return n===null||n<=0?null:n};
  const entry=levelValue(lv.entry??lv.entryLow),stop=levelValue(lv.stop),tp1=levelValue(lv.tp1??lv.target),rr=safeNum(lv.rr);
  $("entry").textContent=entry===null?"—":fmt(entry,2);
  $("stop").textContent=stop===null?"—":fmt(stop,2);
  $("tp1").textContent=tp1===null?"—":fmt(tp1,2);
  $("rr").textContent=rr===null||rr<=0?"—":Number(rr).toFixed(2)+"R";

  const score=safeNum(d?.data?.score??d?.phase301to400?.dataQuality?.score??rawScore??x.apex.quality);
  $("quality").textContent=score===null?"—":Math.round(score*(score<=1?100:1))+"/100";
  $("syncState").textContent=x.apex?.synchronization?.ok||d?.synchronization?.ok?"LOCKED":(d?.stale?"STALE":"PENDING");
  $("execution").textContent=x.apex?.executionGate?.automaticExecutionReady
    ?"AUTO READY"
    :(d?.liveSignalEligible===true&&action!=="WAIT"?"MANUAL READY":"GATED");

  const flow=extractFlow(d);
  $("oi").textContent=fmt(flow.oi,0);$("cvd").textContent=fmt(flow.cvd,3);$("book").textContent=flow.book===null?"—":(flow.book*100).toFixed(1)+"%";$("funding").textContent=flow.funding===null?"—":(flow.funding*100).toFixed(4)+"%";$("liquidations").textContent=fmt(flow.liq,0);
  $("cvdState").textContent=flow.cvdState||"warming";$("liqState").textContent=flow.liqState||"warming";

  $("tapeMarket").textContent=action+" · "+(visibleCandidate!=="WAIT"?visibleCandidate+" candidate":"neutral");
  $("tapeFlow").textContent=flow.cvd===null?"Waiting for CVD":flow.cvdState||fmt(flow.cvd,3);
  $("tapeLiquidity").textContent=flow.book===null?"Waiting for book":(flow.book>=0?"Bid support ":"Offer pressure ")+Math.abs(flow.book*100).toFixed(1)+"%";

  $("reasons").innerHTML="";
  const reasons=[
    gateReason,
    candidate!=="WAIT"&&diagnostics?.validation?.gate&&diagnostics.validation.gate!=="SIGNAL_ELIGIBLE"
      ?"Validation gate: "+String(diagnostics.validation.gate).replaceAll("_"," ")
      :null,
    stability.state==="CONFIRMING"
      ?"Directional candidate is being confirmed across live refreshes."
      :null,
    staleCandidate
      ?"Stale decision: execution remains blocked until a fresh synchronized decision is available."
      :null,
    blockingStage!=="READY"
      ?"Signal gate currently blocked at "+blockingStage+"."
      :null,
    ...(Array.isArray(gateChain?.phase11to13?.reasons)?gateChain.phase11to13.reasons.map(v=>"P11–13: "+String(v).replaceAll("_"," ")):[]),
    ...(Array.isArray(gateChain?.phase201to300?.blockers)?gateChain.phase201to300.blockers.map(v=>"P201–300: "+String(v).replaceAll("_"," ")):[]),
    ...(Array.isArray(g.reasons)?g.reasons:[]),
    ...(Array.isArray(d?.phase20?.transition?.waitCondition)?d.phase20.transition.waitCondition:[]),
    ...(Array.isArray(d?.evidence?.thesis)?d.evidence.thesis.slice(0,3):[]),
    ...(Array.isArray(d?.reasons)?d.reasons.slice(0,3):[])
  ].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).slice(0,7);

  (reasons.length?reasons:["No additional blocking reason was published by the decision engine."]).forEach(v=>{
    const el=document.createElement("div");el.className="reason";el.textContent=String(v);$("reasons").appendChild(el)
  });

  const probHeader=document.querySelector(".prob-header");
  if(probHeader){
    const label=probHeader.querySelector("span");if(label)label.textContent="SIGNAL CONFLUENCE";
    const small=probHeader.querySelector("small");if(small)small.textContent=confluencePct===null?"LIVE":"SCORE "+confluencePct+"%";
  }
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
  const epoch=state.marketEpoch,symbol=state.symbol,interval=state.interval;
  runtime("Loading live market…","warn","Cached chart and price render immediately; live services connect in parallel.");
  const cachedT=readCache(cacheKey("ticker")),cachedC=readCache(cacheKey("chart")),cachedD=readCache(cacheKey("decision"));
  if(cachedT){state.ticker=cachedT;state.livePrice=safeNum(cachedT.price);renderTicker()}
  if(cachedC){state.chart=cachedC.candles||cachedC;drawChart()}
  if(cachedD){state.decision=cachedD;renderDecision()}

  // Start the decision request immediately instead of waiting for the slower chart/config calls.
  // Market and decision requests intentionally run in parallel for a faster first useful state.
  const decisionBoot=refreshDecision(false).catch(()=>null);

  const requests=[
    ["config",api("/api/config",2500)],
    ["ticker",api("/api/fast-ticker?symbol="+encodeURIComponent(symbol),1800)],
    ["chart",api("/api/chart?symbol="+encodeURIComponent(symbol)+"&interval="+encodeURIComponent(interval),3500)],
    ["live",api("/api/live-sync?symbol="+encodeURIComponent(symbol),1800)]
  ];

  requests.forEach(([kind,promise])=>{
    promise.then(value=>{
      if(state.marketEpoch!==epoch||state.symbol!==symbol||state.interval!==interval)return;
      if(kind==="config"){
        state.cfg=value;populateSymbols(value?.symbols);
      }else if(kind==="ticker"){
        if(!state.wsConnected){
          state.ticker=value;
          state.livePrice=safeNum(value?.price);
          state.lastLiveEventAt=Date.now();
          writeCache(cacheKey("ticker"),state.ticker);
          renderTicker();
          drawChart();
        }
      }else if(kind==="chart"){
        if(Array.isArray(value?.candles)&&value.candles.length){
          state.chart=value.candles;
          writeCache(cacheKey("chart"),value);
          drawChart();
        }
      }else if(kind==="live"){
        state.live=value||{};
        if(safeNum(value?.price)!==null){
          applyCanonicalMarket({...value,type:"market-sync",seq:value.seq||state.lastServerSeq});
        }
      }
      runtime("MarketPulse online","ok","Live market services loading in parallel.");
    }).catch(()=>{});
  });

  await decisionBoot;
  if(state.marketEpoch!==epoch||state.symbol!==symbol||state.interval!==interval)return;
  const hasMarket=state.livePrice!==null||Array.isArray(state.chart)&&state.chart.length>0;
  if(hasMarket){
    runtime("MarketPulse online","ok","Price, chart and decision services are loading independently.");
  }else{
    runtime("UI online — market feed retrying","warn","Cached state is available; live providers are retrying automatically.");
  }
}
async function tickLoop(){
  if(state.wsConnected&&Date.now()-state.lastLiveEventAt<2500)return;
  try{
    const t=await api("/api/fast-ticker?symbol="+encodeURIComponent(state.symbol)+"&fallback=1",2200);
    const p=safeNum(t.price);if(p!==null)applyCanonicalMarket({...t,type:"market-sync",symbol:state.symbol,seq:state.lastServerSeq});
  }catch{}
}
async function flowLoop(){
  if(state.wsConnected&&Date.now()-state.lastLiveEventAt<4000)return;
  try{
    const d=await api("/api/live-sync?symbol="+encodeURIComponent(state.symbol),2500);
    if(d?.price!==null)applyCanonicalMarket({...d,type:"market-sync",seq:d.seq});
  }catch{}
}
async function chartLoop(){
  const epoch=state.marketEpoch,symbol=state.symbol,interval=state.interval;
  try{
    const c=await api("/api/chart?symbol="+encodeURIComponent(symbol)+"&interval="+encodeURIComponent(interval),4500);
    if(state.marketEpoch!==epoch||state.symbol!==symbol||state.interval!==interval)return;
    if(Array.isArray(c.candles)&&c.candles.length){state.chart=c.candles;writeCache(cacheKey("chart"),c);drawChart()}
  }catch{}
}
async function refreshDecision(showStatus=true){
  const epoch=state.marketEpoch,symbol=state.symbol,interval=state.interval;
  if(showStatus)runtime("Refreshing decision engine…","warn","Last confirmed frame remains visible until a fresh result arrives.");
  try{
    const d=await api("/api/decision?symbol="+encodeURIComponent(symbol)+"&interval="+encodeURIComponent(interval),6500);
    if(state.marketEpoch!==epoch||state.symbol!==symbol||state.interval!==interval)return;
    state.decision=d;writeCache(cacheKey("decision"),d);renderDecision();
    runtime("MarketPulse online","ok","Canonical market + decision surfaces are synchronized.");
  }catch{
    if(!state.decision){
      try{
        const a=await api("/api/phase401-500?symbol="+encodeURIComponent(symbol)+"&interval="+encodeURIComponent(interval),7500);
        if(state.marketEpoch!==epoch||state.symbol!==symbol||state.interval!==interval)return;
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
  $("phaseList").classList.remove("hidden");
  $("phaseSummary").innerHTML=
    '<div class="phase-chip"><b>500</b><span>registry items</span></div>'+
    '<div class="phase-chip"><b>120</b><span>complete</span></div>'+
    '<div class="phase-chip"><b>378</b><span>validated</span></div>'+
    '<div class="phase-chip"><b>2</b><span>runtime pending</span></div>'+
    '<div class="phase-highlight"><strong>PHASE 500 · DATA MISMATCH HUD</strong><span>VALIDATED · engine 500.0.0</span></div>';
  $("phaseList").innerHTML='<div class="placeholder">Synchronizing the full Phase 1 → 500 registry…</div>';
  try{
    const d=await api("/api/phases",5000);state.phases=d;
    const list=Array.isArray(d.phases)?d.phases:[];
    const complete=list.filter(x=>x.status==="COMPLETE").length;
    const validated=list.filter(x=>x.status==="VALIDATED").length;
    const pending=list.filter(x=>/PENDING_RUNTIME/.test(String(x.status))).length;
    $("phaseHeadline").textContent="PHASE 1 → 500 · "+(d.engineeringPhase||"ENGINEERING REGISTRY");
    $("phaseSummary").innerHTML=
      '<div class="phase-chip"><b>'+list.length+'</b><span>registry items</span></div>'+
      '<div class="phase-chip"><b>'+complete+'</b><span>complete</span></div>'+
      '<div class="phase-chip"><b>'+validated+'</b><span>validated</span></div>'+
      '<div class="phase-chip"><b>'+pending+'</b><span>runtime pending</span></div>'+
      '<div class="phase-highlight"><strong>PHASE '+String(d.currentPhase||499)+' · '+String((list.find(x=>x.phase===Number(d.currentPhase||499))||{}).title||"CURRENT ENGINEERING PHASE")+'</strong><span>'+String(d.promotion?.engineeringStatus||"PROMOTED")+' · engine '+String(d.promotion?.signalEngineVersion||"500.0.0")+'</span></div>';
    $("phaseList").innerHTML=list.length
      ?list.slice().reverse().slice(0,60).map(x=>'<div class="phase"><b>#'+x.phase+'</b><strong>'+String(x.title||"")+'</strong><em>'+String(x.status||"")+'</em></div>').join("")
      :'<div class="placeholder">Registry returned no phase rows.</div>';
  }catch(e){
    $("phaseList").innerHTML='<div class="placeholder">Live registry is temporarily unavailable. The verified 500-item summary above remains available.</div>';
  }
}
async function checkSystem(){
  $("systemChecks").innerHTML='<div class="placeholder">Running bounded checks…</div>';
  try{const d=await api("/api/system-check",9000);renderSystemChecks(d.checks||{});runtime(d.ok?"System checks passed":"Core checks reported blockers",d.ok?"ok":"warn",d.ok?"All bounded checks returned within their gates.":"See runtime safety panel; these checks never block first paint.")}catch(e){$("systemChecks").innerHTML='<div class="placeholder">System check unavailable: '+String(e.message||e)+'</div>'}
}
function selectCandleAt(clientX,clientY){
  const canvas=$("chart");if(!canvas||!Array.isArray(state.chart)||!state.chart.length)return;
  const r=canvas.getBoundingClientRect(),rows=normalizedRows(),total=rows.length;
  const viewCount=clamp(Math.floor(state.viewCount||Math.min(110,total)),25,total);
  const viewStart=clamp(Math.floor(state.viewStart||0),0,Math.max(0,total-viewCount));
  const L=12,R=78,pw=Math.max(1,r.width-L-R),x=clamp(clientX-r.left,L,L+pw);
  const local=clamp(Math.floor(((x-L)/pw)*viewCount),0,viewCount-1);
  state.selectedCandle=viewStart+local;state.crosshair={x:clientX-r.left,y:clamp(clientY-r.top,18,r.height-44)};state.chartUserInteracted=true;drawChart();
}
function setNavView(id){
  const target=document.getElementById(id);if(!target)return;
  const button=document.querySelector('.nav-item[data-target="'+id+'"]');
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b===button));
  const appRoot=$("app");
  const view=id==="chartShell"?"market":id==="decisionPanel"?"decision":id==="flowPanel"?"flow":"system";
  appRoot?.setAttribute("data-workspace",view);
  document.querySelectorAll(".workspace-target").forEach(el=>el.classList.remove("workspace-target"));
  target.classList.add("workspace-target");
  const offset=96;
  const top=Math.max(0,target.getBoundingClientRect().top+window.scrollY-offset);
  window.scrollTo({top,behavior:"smooth"});
  clearTimeout(state.navFocusTimer);
  state.navFocusTimer=setTimeout(()=>target.classList.remove("workspace-target"),1300);
  if(history.replaceState){
    try{history.replaceState(null,"","#"+id)}catch{}
  }
}
function setFullscreen(on){
  state.fullscreen=!!on;const shell=$("chartShell");if(!shell)return;
  shell.classList.toggle("is-fullscreen",state.fullscreen);document.documentElement.classList.toggle("chart-lock",state.fullscreen);document.body.classList.toggle("chart-lock",state.fullscreen);
  const btn=$("fullscreenChart");if(btn){btn.textContent=state.fullscreen?"⛶ EXIT":"⛶";btn.title=state.fullscreen?"Exit chart full screen":"Enter chart full screen";}
  setTimeout(drawChart,40);
}
function toggleFullscreen(){setFullscreen(!state.fullscreen)}
function bind(){
  $("symbol").addEventListener("change",()=>{state.symbol=cleanSymbol($("symbol").value)||"BTCUSDT";$("symbolName").textContent=displaySymbol(state.symbol);$("assetIcon").textContent=state.symbol==="BTCUSDT"?"₿":"◈";refreshAll()});
  $("interval").addEventListener("change",()=>{state.interval=$("interval").value;document.querySelectorAll(".tf-tabs button").forEach(b=>b.classList.toggle("active",({"15m":"15m","30m":"30m","1H":"1h","4H":"4h","1D":"1d"}[b.dataset.tf]===state.interval)));refreshAll()});
  $("sync").addEventListener("click",refreshAll);
  $("fitChart").addEventListener("click",()=>{state.chartUserInteracted=false;state.selectedCandle=null;resetChartView();runtime("Chart fitted to live range","ok","Right edge is locked to the latest synchronized candle.")});
  $("zoomIn").addEventListener("click",()=>zoomChart(.78,.5));
  $("zoomOut").addEventListener("click",()=>zoomChart(1.28,.5));
  $("resetView").addEventListener("click",()=>{state.selectedCandle=null;resetChartView()});
  $("chartCursor").addEventListener("click",()=>{state.selectedCandle=null;state.crosshair=null;drawChart()});
  $("fullscreenChart").addEventListener("click",toggleFullscreen);
  $("chartStyleToggle").addEventListener("click",()=>$("chartStyle").classList.toggle("hidden"));
  ["candleUpColor","candleDownColor","chartBgColor","chartGridColor"].forEach(id=>$(id).addEventListener("input",updateChartStyle));
  $("loadPhases").addEventListener("click",loadPhases);$("checkSystem").addEventListener("click",checkSystem);
  document.querySelectorAll(".tf-tabs button").forEach(b=>b.addEventListener("click",()=>setIntervalFromToolbar(b.dataset.tf)));
  document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>setNavView(b.dataset.target)));

  const canvas=$("chart");let pointerMoved=false;
  canvas.addEventListener("pointerdown",e=>{if(e.button!==0)return;state.drag={x:e.clientX,start:state.viewStart};pointerMoved=false;canvas.setPointerCapture?.(e.pointerId);state.crosshair={x:e.offsetX,y:e.offsetY}});
  canvas.addEventListener("pointermove",e=>{
    const r=canvas.getBoundingClientRect();
    if(state.drag){const dx=e.clientX-state.drag.x;if(Math.abs(dx)>3)pointerMoved=true;const total=Array.isArray(state.chart)?state.chart.length:0,delta=dx/Math.max(1,r.width)*state.viewCount;state.viewStart=clamp(Math.round(state.drag.start-delta),0,Math.max(0,total-state.viewCount));state.chartUserInteracted=true;state.crosshair={x:e.clientX-r.left,y:e.clientY-r.top};drawChart()}
    else{state.crosshair={x:e.clientX-r.left,y:e.clientY-r.top};drawChart()}
  });
  const stopDrag=e=>{if(e&&e.button!==0)return;const wasDrag=pointerMoved;state.drag=null;if(!wasDrag&&e)selectCandleAt(e.clientX,e.clientY)};
  canvas.addEventListener("pointerup",stopDrag);canvas.addEventListener("pointercancel",()=>{state.drag=null});
  canvas.addEventListener("pointerleave",()=>{if(!state.drag){state.crosshair=null;drawChart()}});
  canvas.addEventListener("dblclick",e=>{e.preventDefault();toggleFullscreen()});
  canvas.addEventListener("wheel",e=>{e.preventDefault();const r=canvas.getBoundingClientRect(),ratio=clamp((e.clientX-r.left)/Math.max(1,r.width),0,1);zoomChart(e.deltaY<0?.78:1.28,ratio)},{passive:false});

  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&state.fullscreen){e.preventDefault();setFullscreen(false)}if((e.key==="f"||e.key==="F")&&!state.fullscreen&&!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||"")){e.preventDefault();setFullscreen(true)}});
  document.addEventListener("click",e=>{if(!$("chartStyle").contains(e.target)&&!$("chartStyleToggle").contains(e.target))$("chartStyle").classList.add("hidden")});
  window.addEventListener("resize",drawChart);
}
function refreshAll(){
  state.marketEpoch++;
  if(state.chartDrawFrame!==null){
    if(typeof cancelAnimationFrame==="function"&&typeof state.chartDrawFrame==="number")cancelAnimationFrame(state.chartDrawFrame);
    else clearTimeout(state.chartDrawFrame);
    state.chartDrawFrame=null;
  }
  clearInterval(state.tickerTimer);clearInterval(state.flowTimer);clearInterval(state.chartTimer);clearInterval(state.decisionTimer);
  closeLiveStream();
  state.ticker=null;state.live=null;state.market=null;state.chart=null;state.decision=null;state.chartForceClear=true;state.livePrice=null;state.previousPrice=null;state.phases=null;state.lastLiveEventAt=0;state.chartUserInteracted=false;state.selectedCandle=null;state.crosshair=null;
  $("symbolName").textContent=displaySymbol(state.symbol);connectLiveStream();loadCore();startLoops();
}
function startLoops(){
  state.tickerTimer=setInterval(tickLoop,1000);
  state.flowTimer=setInterval(flowLoop,2000);
  state.chartTimer=setInterval(chartLoop,15000);
  state.decisionTimer=setInterval(()=>refreshDecision(false),8000);
}
function boot(){
  try{
    loadChartStyle();bind();populateSymbols();connectLiveStream();startLoops();runtime("UI ready — connecting to exchange…","warn","WebSocket drives the canonical price; HTTP is fallback only.");loadCore();setTimeout(()=>loadPhases(),450);
  }catch(e){
    runtime("UI recovery mode","warn","Boot error isolated: "+String(e.message||e));
  }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();