const storage=require("./storage");

const HORIZON_BARS={"15m":16,"1h":12,"4h":6,"1d":3};
const PRIOR=6;
const MIN_ADAPTIVE_SAMPLE=12;
const MIN_COMPONENT_SAMPLE=20;
const COMPONENT_ADJUSTMENT_CAP=1.25;
const TOTAL_COMPONENT_ADJUSTMENT_CAP=4;
const STATE_VERSION=2;
const MODEL_MIN_UPDATES=30;
const MODEL_LR=0.06;
const MODEL_L2=0.0008;
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
    componentStats:{},
    lastResolvedAt:null,
    lastAdjustment:0,
    lastSetupAdjustment:0,
    lastComponentAdjustment:0,
    calibrationHistory:[],
    model:{version:1,bias:0,weights:{},updates:0,logLoss:0,lastUpdateAt:null,trainedKeys:[]}
  };
}
function ensureState(raw){
  const s=raw&&typeof raw==="object"?raw:baseState();
  if(!s.buckets||typeof s.buckets!=="object")s.buckets={};
  if(!s.scoreBuckets||typeof s.scoreBuckets!=="object")s.scoreBuckets={};
  if(!s.componentStats||typeof s.componentStats!=="object")s.componentStats={};
  if(!Array.isArray(s.calibrationHistory))s.calibrationHistory=[];
  if(!s.model||typeof s.model!=="object")s.model={version:1,bias:0,weights:{},updates:0,logLoss:0,lastUpdateAt:null};
  if(!s.model.weights||typeof s.model.weights!=="object")s.model.weights={};
  s.model.bias=Number(s.model.bias)||0;
  s.model.updates=Number(s.model.updates)||0;
  s.model.logLoss=Number(s.model.logLoss)||0;
  if(!Array.isArray(s.model.trainedKeys))s.model.trainedKeys=[];
  s.version=STATE_VERSION;
  s.resolved=Number(s.resolved)||0;
  s.wins=Number(s.wins)||0;
  s.losses=Number(s.losses)||0;
  s.netR=Number(s.netR)||0;
  return s;
}
function bucketKey(a){return [a.type||"UNKNOWN",a.side||"WAIT",a.regime||"UNKNOWN"].join("|")}
function scoreKey(score){return String(clamp(Math.floor(Number(score||0)/10),0,9)*10)}
function componentMax(name){
  return ({Regime:16,"Trend strength":11,Momentum:11,Volume:9,Structure:9,"4H alignment":9,"15M alignment":7,"CVD pressure":10,"OI context":8,"Liquidation context":6})[name]||10;
}
function componentContextKey(pred,name){return [pred.regime||"UNKNOWN",pred.side||"WAIT",name].join("|")}
function componentState(pred,comp){
  const max=componentMax(comp.name),value=Number(comp.value)||0;
  return value/max>=0.6?"strong":"weak";
}
function featureVector(pred){
  const d=pred?.features?.derivatives||pred?.derivatives||{};
  const mtf=pred?.features?.mtf||pred?.mtf||{};
  const side=pred?.side==="LONG"?1:pred?.side==="SHORT"?-1:0;
  const regime=String(pred?.regime||"");
  const cvd=String(d.cvdState||"");
  const positioning=String(d.positioning||"");
  const liq=String(d.liquidationBias||"");
  const rsi=Number(pred?.features?.rsi??pred?.rsi);
  const adx=Number(pred?.features?.adx??pred?.adx);
  const volumeZ=Number(pred?.features?.volumeZ??pred?.volumeZ);
  const score=Number(pred?.score);
  const rr=Number(pred?.rr);
  const oi=Number(d.oiChangePct);
  const ob=Number(d.orderBookImbalance);
  const taker=Number(d.takerImbalance);
  return {
    bias:side,
    score:Number.isFinite(score)?(score-50)/25:0,
    adx:Number.isFinite(adx)?Math.min(adx,50)/25:0,
    rsi:Number.isFinite(rsi)?(rsi-50)/25:0,
    volume:Number.isFinite(volumeZ)?Math.max(-3,Math.min(3,volumeZ))/3:0,
    rr:Number.isFinite(rr)?Math.min(rr,3)/3:0,
    trend:(regime==="UPTREND"?1:regime==="DOWNTREND"?-1:0)*side,
    mtf4:(mtf.higher==="UPTREND"?1:mtf.higher==="DOWNTREND"?-1:0)*side,
    mtf15:(mtf.lower==="UPTREND"?1:mtf.lower==="DOWNTREND"?-1:0)*side,
    cvd:(cvd.includes("BUYERS")||cvd==="BULLISH DIVERGENCE"?1:cvd.includes("SELLERS")||cvd==="BEARISH DIVERGENCE"?-1:0)*side,
    oi:(positioning.includes("LONG PARTICIPATION")||positioning.includes("SHORT COVERING")?1:positioning.includes("SHORT PARTICIPATION")||positioning.includes("LONG LIQUIDATION")?-1:0)*side,
    liquidation:(liq==="SHORT LIQS DOMINANT"?1:liq==="LONG LIQS DOMINANT"?-1:0)*side,
    orderbook:Number.isFinite(ob)?Math.max(-1,Math.min(1,ob))*side:0,
    taker:Number.isFinite(taker)?Math.max(-1,Math.min(1,taker))*side:0
  };
}
function sigmoid(z){return 1/(1+Math.exp(-Math.max(-20,Math.min(20,z))))}
function modelPredict(pred){
  const m=state.model||{},x=featureVector(pred);
  let z=Number(m.bias)||0;
  for(const [k,v] of Object.entries(x))z+=(Number(m.weights?.[k])||0)*v;
  return {probability:sigmoid(z),features:x};
}
function updateOnlineModel(pred,outcome){
  if(outcome!=="WIN"&&outcome!=="LOSS")return;
  const y=outcome==="WIN"?1:0;
  const {probability,features}=modelPredict(pred);
  const m=state.model;
  const n=Number(m.updates)||0;
  const lr=MODEL_LR/Math.sqrt(1+n/100);
  const error=y-probability;
  m.bias=clamp((Number(m.bias)||0)+lr*error,-3,3);
  for(const [k,x] of Object.entries(features)){
    const old=Number(m.weights[k])||0;
    m.weights[k]=clamp(old+lr*(error*x-MODEL_L2*old),-2.5,2.5);
  }
  const p=clamp(probability,0.001,0.999);
  m.logLoss+=-(y*Math.log(p)+(1-y)*Math.log(1-p));
  m.updates=n+1;
  m.lastUpdateAt=Date.now();
}
function updateComponentAggregate(pred,outcome){
  const comps=Array.isArray(pred?.features?.components)?pred.features.components:[];
  for(const comp of comps){
    const name=String(comp?.name||"UNKNOWN"),key=componentContextKey(pred,name);
    const row=state.componentStats[key]||(state.componentStats[key]={name,regime:pred.regime||"UNKNOWN",side:pred.side||"WAIT",strong:{n:0,wins:0,losses:0},weak:{n:0,wins:0,losses:0}});
    const bucket=componentState(pred,comp);
    const b=row[bucket]||(row[bucket]={n:0,wins:0,losses:0});
    b.n+=1;
    if(outcome==="WIN")b.wins+=1;
    if(outcome==="LOSS")b.losses+=1;
  }
}
function smoothedRate(b){
  const n=Number(b?.n)||0;
  return n?(Number(b.wins||0)+PRIOR)/(n+PRIOR*2):0.5;
}
function componentSignal(a,comp){
  const key=componentContextKey(a,comp.name),row=state.componentStats[key];
  const current=componentState(a,comp);
  if(!row)return {name:comp.name,current,nStrong:0,nWeak:0,strongWinRate:null,weakWinRate:null,uplift:0,adjustment:0,eligible:false,context:key};
  const strong=row.strong||{n:0,wins:0},weak=row.weak||{n:0,wins:0};
  const eligible=Number(strong.n)>=MIN_COMPONENT_SAMPLE&&Number(weak.n)>=MIN_COMPONENT_SAMPLE;
  const strongWinRate=Number(strong.n)?smoothedRate(strong):null;
  const weakWinRate=Number(weak.n)?smoothedRate(weak):null;
  const uplift=eligible?strongWinRate-weakWinRate:0;
  let adjustment=0;
  if(eligible)adjustment=clamp((current==="strong"?uplift:-uplift)*3,-COMPONENT_ADJUSTMENT_CAP,COMPONENT_ADJUSTMENT_CAP);
  return {name:comp.name,current,nStrong:Number(strong.n)||0,nWeak:Number(weak.n)||0,strongWinRate,weakWinRate,uplift,adjustment,eligible,context:key};
}
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
  updateComponentAggregate(pred,outcome);
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
      updateOnlineModel(p,o.outcome);
      changed=true;
    }
  }
  if(changed)await storage.saveLearningState(state);
  return changed;
}
function recalibrate(a){
  const baseScore=Number(a.score)||0;
  const key=bucketKey(a);
  const model=modelPredict(a);
  const modelReady=Number(state?.model?.updates||0)>=MODEL_MIN_UPDATES;
  const b=state?.buckets?.[key];
  let setupAdjustment=0;
  let smoothedWinRate=0.5;
  if(b&&Number(b.n)>=MIN_ADAPTIVE_SAMPLE){
    smoothedWinRate=(Number(b.wins)+PRIOR)/(Number(b.n)+PRIOR*2);
    setupAdjustment=clamp(Math.round((smoothedWinRate-0.5)*25*10)/10,-6,6);
  }
  const componentSignals=(Array.isArray(a.components)?a.components:[]).map(function(comp){return componentSignal(a,comp)});
  const rawComponentAdjustment=componentSignals.reduce(function(sum,x){return sum+(Number(x.adjustment)||0)},0);
  const componentAdjustment=clamp(rawComponentAdjustment,-TOTAL_COMPONENT_ADJUSTMENT_CAP,TOTAL_COMPONENT_ADJUSTMENT_CAP);
  const totalAdjustment=setupAdjustment+componentAdjustment;
  let score=clamp(Math.round(baseScore+totalAdjustment),0,92);
  if(modelReady){
    const modelScore=50+(model.probability-0.5)*100;
    score=clamp(Math.round(score*0.55+modelScore*0.45),0,92);
  }
  state.lastAdjustment=totalAdjustment;
  state.lastSetupAdjustment=setupAdjustment;
  state.lastComponentAdjustment=componentAdjustment;
  if(Math.abs(totalAdjustment)>=0.1){
    state.calibrationHistory=(state.calibrationHistory||[]).concat([{
      ts:Date.now(),bucket:key,scoreBefore:baseScore,scoreAfter:score,
      setupAdjustment,componentAdjustment,totalAdjustment,sample:b?Number(b.n):0
    }]).slice(-50);
  }
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
    phase:2,
    bucket:key,
    samples:b?Number(b.n):0,
    resolvedWins:b?Number(b.wins):0,
    smoothedWinRate,
    setupAdjustment,
    componentAdjustment,
    adjustment:totalAdjustment,
    modelReady,
    modelProbability:modelReady?model.probability:null,
    modelUpdates:Number(state?.model?.updates)||0,
    eligible,
    componentSignals,
    note:eligible?"Historical outcome calibration is influencing the confluence score.":"Collecting resolved signals before changing the live model."
  };
  if(Math.abs(totalAdjustment)>=1){
    a.contributors=a.contributors||[];
    a.contributors.push("adaptive historical calibration "+(totalAdjustment>0?"+":"")+totalAdjustment.toFixed(1));
  }
  if(modelReady){
    a.contributors=a.contributors||[];
    a.contributors.push("online outcome model calibration");
    a.thesisParts=a.thesisParts||[];
    a.thesisParts.push("The online model has enough resolved outcomes to calibrate the rule-based confluence score.");
    a.thesis=a.thesisParts.join(" ");
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
async function trainFromReplay(records){
  await init();
  const rows=Array.isArray(records)?records:[];
  let trained=0,skipped=0;
  const seen=new Set(state.model.trainedKeys||[]);
  for(const row of rows){
    const outcome=row?.outcome?.status==="TARGET_1"?"WIN":row?.outcome?.status==="STOP"?"LOSS":null;
    if(!outcome){skipped++;continue}
    const key=String(row.signalKey||[row.symbol,row.interval,row.candleTs,row.side,row.score].join("|"));
    if(seen.has(key)){skipped++;continue}
    const pred=Object.assign({},row.snapshot||{},{
      score:Number(row.score??row.snapshot?.score)||0,
      side:row.side||row.snapshot?.side||"WAIT",
      type:row.type||row.snapshot?.type||"UNKNOWN",
      regime:row.regime||row.snapshot?.regime||"UNKNOWN",
      derivatives:row.snapshot?.derivatives||row.snapshot?.deriv||{}
    });
    updateOnlineModel(pred,outcome);
    seen.add(key);trained++;
  }
  state.model.trainedKeys=Array.from(seen).slice(-20000);
  if(trained)await storage.saveLearningState(state);
  return {trained,skipped,total:rows.length,updates:Number(state.model.updates)||0,ready:Number(state.model.updates||0)>=MODEL_MIN_UPDATES};
}
function componentSummary(){
  const grouped={};
  for(const row of Object.values(state.componentStats||{})){
    const g=grouped[row.name]||(grouped[row.name]={name:row.name,strongN:0,strongWins:0,weakN:0,weakWins:0,contexts:0});
    g.strongN+=Number(row.strong?.n)||0;
    g.strongWins+=Number(row.strong?.wins)||0;
    g.weakN+=Number(row.weak?.n)||0;
    g.weakWins+=Number(row.weak?.wins)||0;
    g.contexts+=1;
  }
  return Object.values(grouped).map(function(g){
    const eligible=g.strongN>=MIN_COMPONENT_SAMPLE&&g.weakN>=MIN_COMPONENT_SAMPLE;
    const strongRate=g.strongN?(g.strongWins+PRIOR)/(g.strongN+PRIOR*2):null;
    const weakRate=g.weakN?(g.weakWins+PRIOR)/(g.weakN+PRIOR*2):null;
    return {name:g.name,strongN:g.strongN,weakN:g.weakN,contexts:g.contexts,strongWinRate:strongRate,weakWinRate:weakRate,uplift:eligible?strongRate-weakRate:0,eligible};
  }).sort(function(a,b){return (b.strongN+b.weakN)-(a.strongN+a.weakN)}).slice(0,10);
}
async function status(){
  await init();
  const total=Number(state.resolved)||0;
  const winRate=total?state.wins/total*100:null;
  return {
    version:state.version,
    phase:2,
    state:total>=MIN_ADAPTIVE_SAMPLE?"ADAPTIVE":"COLLECTING",
    resolved:total,
    wins:state.wins,
    losses:state.losses,
    winRate,
    netR:Number(state.netR)||0,
    minSamples:MIN_ADAPTIVE_SAMPLE,
    componentMinSamples:MIN_COMPONENT_SAMPLE,
    componentProfiles:Object.keys(state.componentStats||{}).length,
    componentSummary:componentSummary(),
    model:{ready:Number(state.model?.updates||0)>=MODEL_MIN_UPDATES,updates:Number(state.model?.updates)||0,logLoss:Number(state.model?.logLoss)||0,averageLogLoss:Number(state.model?.updates)?Number(state.model.logLoss)/Number(state.model.updates):null,trainedKeys:Number(state.model?.trainedKeys?.length)||0,weights:state.model?.weights||{},lastUpdateAt:state.model?.lastUpdateAt||null},
    calibrationHistory:(state.calibrationHistory||[]).slice(-12),
    lastResolvedAt:state.lastResolvedAt,
    durable:storage.status().durable,
    lastAdjustment:Number(state.lastAdjustment)||0,
    lastSetupAdjustment:Number(state.lastSetupAdjustment)||0,
    lastComponentAdjustment:Number(state.lastComponentAdjustment)||0
  };
}
module.exports={init,process,recalibrate,status,resolve,trainFromReplay};
