const storage=require("./storage");

const HORIZON_BARS={"15m":16,"1h":12,"4h":6,"1d":3};
const PRIOR=6;
const MIN_ADAPTIVE_SAMPLE=12;
const STATE_VERSION=1;
let state=null;
let initPromise=null;

function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function baseState(){
  return {
    version:STATE_VERSION,
    resolved:0,
    wins:0,
    losses:0,
    netR:0,
    buckets:{},
    scoreBuckets:{},
    lastResolvedAt:null,
    lastAdjustment:0
  };
}
function ensureState(raw){
  const s=raw&&typeof raw==="object"?raw:baseState();
  if(!s.buckets||typeof s.buckets!=="object")s.buckets={};
  if(!s.scoreBuckets||typeof s.scoreBuckets!=="object")s.scoreBuckets={};
  s.version=STATE_VERSION;
  s.resolved=Number(s.resolved)||0;
  s.wins=Number(s.wins)||0;
  s.losses=Number(s.losses)||0;
  s.netR=Number(s.netR)||0;
  return s;
}
function bucketKey(a){return [a.type||"UNKNOWN",a.side||"WAIT",a.regime||"UNKNOWN"].join("|")}
function scoreKey(score){return String(clamp(Math.floor(Number(score||0)/10),0,9)*10)}
function updateAggregate(pred,outcome,resultR){
  const key=bucketKey(pred);
  const b=state.buckets[key]||(state.buckets[key]={n:0,wins:0,losses:0,netR:0});
  b.n+=1;
  if(outcome==="WIN"){b.wins+=1;state.wins+=1}
  if(outcome==="LOSS"){b.losses+=1;state.losses+=1}
  b.netR+=Number(resultR)||0;
  state.resolved+=1;
  state.netR+=Number(resultR)||0;
  state.lastResolvedAt=Date.now();

  const sk=scoreKey(pred.score);
  const sb=state.scoreBuckets[sk]||(state.scoreBuckets[sk]={n:0,wins:0,losses:0});
  sb.n+=1;if(outcome==="WIN")sb.wins+=1;if(outcome==="LOSS")sb.losses+=1;
}
function outcomeFromCandles(pred,candles){
  const ts=Number(pred.candle_ts??pred.candleTs);
  const stop=Number(pred.stop),target=Number(pred.target);
  if(!Number.isFinite(ts)||!Number.isFinite(stop)||!Number.isFinite(target))return null;
  let start=-1;
  for(let i=0;i<candles.length;i++){if(Number(candles[i].t)>ts){start=i;break}}
  if(start<0)return null;
  const horizon=Math.max(1,Number(pred.horizon_bars)||HORIZON_BARS[pred.interval]||12);
  const end=start+horizon-1;
  if(end>=candles.length)return null;
  for(let i=start;i<=end;i++){
    const x=candles[i];
    if(pred.side==="LONG"){
      if(Number(x.l)<=stop)return {outcome:"LOSS",resultR:-1,exitTs:x.t};
      if(Number(x.h)>=target)return {outcome:"WIN",resultR:1,exitTs:x.t};
    }else if(pred.side==="SHORT"){
      if(Number(x.h)>=stop)return {outcome:"LOSS",resultR:-1,exitTs:x.t};
      if(Number(x.l)<=target)return {outcome:"WIN",resultR:1,exitTs:x.t};
    }
  }
  return {outcome:"TIMEOUT",resultR:0,exitTs:candles[end].t};
}
async function init(){
  if(initPromise)return initPromise;
  initPromise=(async()=>{
    await storage.init();
    const saved=await storage.getLearningState();
    state=ensureState(saved.payload||baseState());
    if(!saved.payload)await storage.saveLearningState(state);
  })();
  return initPromise;
}
async function resolve(symbol,interval,candles){
  await init();
  const open=await storage.getOpenLearningPredictions(symbol,interval,200);
  let changed=false;
  for(const p of open){
    const o=outcomeFromCandles(p,candles);
    if(!o)continue;
    await storage.resolveLearningPrediction(p.fingerprint,o.outcome,o.resultR);
    if(o.outcome!=="TIMEOUT"){
      updateAggregate(p,o.outcome,o.resultR);
      changed=true;
    }
  }
  if(changed)await storage.saveLearningState(state);
  return changed;
}
function recalibrate(a){
  const baseScore=Number(a.score)||0;
  const key=bucketKey(a);
  const b=state?.buckets?.[key];
  let adjustment=0;
  let smoothedWinRate=0.5;
  if(b&&Number(b.n)>=MIN_ADAPTIVE_SAMPLE){
    smoothedWinRate=(Number(b.wins)+PRIOR)/(Number(b.n)+PRIOR*2);
    adjustment=clamp(Math.round((smoothedWinRate-0.5)*25*10)/10,-6,6);
  }
  const score=clamp(Math.round(baseScore+adjustment),0,92);
  const eligible=Boolean(b&&Number(b.n)>=MIN_ADAPTIVE_SAMPLE);
  if(a.side!=="WAIT"&&eligible){
    if(score>=72&&a.rr>=1.5&&!(a.mtf?.higher==="DOWNTREND"&&a.side==="LONG")&&!(a.mtf?.higher==="UPTREND"&&a.side==="SHORT"))a.status="READY";
    else if(score>=55)a.status="WATCH";
    else a.status="WAITING";
  }
  a.score=score;
  a.probabilityLabel=score>=80?"HIGH CONFLUENCE":score>=68?"MODERATE-HIGH CONFLUENCE":score>=55?"EARLY / WATCH":"LOW CONFLUENCE";
  a.adaptive={
    enabled:true,
    bucket:key,
    samples:b?Number(b.n):0,
    resolvedWins:b?Number(b.wins):0,
    smoothedWinRate,
    adjustment,
    eligible,
    note:eligible?"Historical outcome calibration is influencing the confluence score.":"Collecting resolved signals before changing the live model."
  };
  if(Math.abs(adjustment)>=1){
    a.contributors=a.contributors||[];
    a.contributors.push("adaptive historical calibration "+(adjustment>0?"+":"")+adjustment);
  }
  return a;
}
async function observe(symbol,interval,candleTs,a){
  await init();
  if(!a||a.side==="WAIT"||a.status==="WAITING"||!Number.isFinite(Number(candleTs)))return {recorded:false};
  const fingerprint=[symbol,interval,candleTs,a.type,a.side].join("|");
  return storage.recordLearningPrediction({
    fingerprint,
    symbol,interval,candleTs:Number(candleTs),
    side:a.side,type:a.type,status:a.status,score:Number(a.score)||0,
    price:Number(a.price)||null,stop:Number(a.stop)||null,target:Number(a.tp1)||null,
    regime:a.regime||"UNKNOWN",
    horizonBars:HORIZON_BARS[interval]||12,
    features:{
      score:Number(a.score)||0,regime:a.regime,side:a.side,type:a.type,status:a.status,
      rsi:a.rsi,adx:a.adx,atrPct:a.atrPct,volumeZ:a.volumeZ,structure:a.structure,
      mtf:a.mtf,components:a.components,derivatives:a.derivatives
    }
  });
}
async function process(symbol,interval,candles,a){
  await resolve(symbol,interval,candles);
  const adapted=recalibrate(a);
  const candle=candles?.[candles.length-1];
  const observed=await observe(symbol,interval,candle?.t,adapted);
  return {analysis:adapted,observed};
}
async function status(){
  await init();
  const total=Number(state.resolved)||0;
  const winRate=total?state.wins/total*100:null;
  return {
    version:state.version,
    state:total>=MIN_ADAPTIVE_SAMPLE?"ADAPTIVE":"COLLECTING",
    resolved:total,
    wins:state.wins,
    losses:state.losses,
    winRate,
    netR:Number(state.netR)||0,
    minSamples:MIN_ADAPTIVE_SAMPLE,
    lastResolvedAt:state.lastResolvedAt,
    durable:storage.status().durable,
    lastAdjustment:Number(state.lastAdjustment)||0
  };
}
module.exports={init,process,recalibrate,status,resolve};
