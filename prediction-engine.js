function buildFeatures(a,ctx={}){
  const d=ctx.derivatives||a?.derivatives||{},o=ctx.orderbook||a?.microstructure||{},liq=ctx.liquidity||liquidityContext(ctx.candles||[]);
  const side=sideNum(a?.side);
  const mtf=((a?.mtf?.higher==="UPTREND"&&side>0)||(a?.mtf?.higher==="DOWNTREND"&&side<0)?1:0)
    +((a?.mtf?.lower==="UPTREND"&&side>0)||(a?.mtf?.lower==="DOWNTREND"&&side<0)?1:0)
    -((a?.mtf?.higher==="DOWNTREND"&&side>0)||(a?.mtf?.higher==="UPTREND"&&side<0)?1:0)
    -((a?.mtf?.lower==="DOWNTREND"&&side>0)||(a?.mtf?.lower==="UPTREND"&&side<0)?1:0);
  const cvd=finite(d.cvdRatio,finite(ctx.takerFlow,0));
  const oi=finite(d.oiChangePct,0);
  const funding=finite(d.fundingRate,0)*1000;
  const liqLong=finite(d.longLiquidations,0),liqShort=finite(d.shortLiquidations,0),liqTotal=liqLong+liqShort;
  const liqImbalance=(liqLong-liqShort)/(liqTotal||1);
  const flowPrice=finite(d.flowPriceChangePct,finite(d.tradePriceChangePct,0));
  return {
    base_score:finite(a?.score)/100,
    rsi:(finite(a?.rsi,50)-50)/50,
    adx:clamp(finite(a?.adx)/40,0,1.5),
    atr_pct:clamp(finite(a?.atrPct)/5,-2,2),
    volume_z:clamp(finite(a?.volumeZ)/3,-2,2),
    range_position:clamp(finite(a?.rangePosition,.5)*2-1,-1,1),
    ema20_gap:clamp((finite(a?.price)-finite(a?.ema20,a?.price))/(finite(a?.price)||1)*100,-5,5)/5,
    ema50_gap:clamp((finite(a?.price)-finite(a?.ema50,a?.price))/(finite(a?.price)||1)*100,-8,8)/8,
    structure:structureNum(a?.structure),
    side,
    mtf_alignment:clamp(mtf/2,-1,1),
    cvd_ratio:clamp(cvd,-1,1),
    oi_change_pct:clamp(oi/5,-2,2),
    funding:clamp(funding,-2,2),
    liq_imbalance:clamp(liqImbalance,-1,1),
    book_imbalance:clamp(finite(o.imbalance,0),-1,1),
    book_spread_bps:clamp(finite(o.spreadBps,0)/10,0,3),
    micro_delta_bps:clamp(finite(o.microDeltaBps,0)/10,-3,3),
    depth_imbalance:clamp(finite(o.depthImbalance,0),-1,1),
    flow_price_delta:clamp(flowPrice/2,-2,2),
    liquidity_above_proximity:clamp(finite(liq.aboveDist,0),-10,10)/10,
    liquidity_below_proximity:clamp(finite(liq.belowDist,0),-10,10)/10,
    sweep_bias:clamp(finite(liq.sweepBias,0),-1,1),
    break_strength:clamp(finite(liq.breakStrength,.5)*2-1,-1,1)
  };
}

function vector(f){return FEATURE_NAMES.map(k=>finite(f?.[k],0))}
function meanStd(rows){
  const n=rows.length||1,dim=FEATURE_NAMES.length,mean=Array(dim).fill(0),std=Array(dim).fill(0);
  for(const r of rows){const x=vector(r);for(let j=0;j<dim;j++)mean[j]+=x[j]}
  for(let j=0;j<dim;j++)mean[j]/=n;
  for(const r of rows){const x=vector(r);for(let j=0;j<dim;j++)std[j]+=(x[j]-mean[j])**2}
  for(let j=0;j<dim;j++)std[j]=Math.sqrt(std[j]/n)||1;
  return {mean,std};
}
function standardize(x,scaler){return x.map((v,i)=>(v-scaler.mean[i])/scaler.std[i])}
function dot(w,x){let s=w[0]||0;for(let i=0;i<x.length;i++)s+=(w[i+1]||0)*x[i];return s}

function fitLogistic(rows,epochs,lr,l2){
  const splitScaler=meanStd(rows),w=Array(FEATURE_NAMES.length+1).fill(0);
  for(let epoch=0;epoch<epochs;epoch++){
    const g=Array(w.length).fill(0);
    for(const r of rows){
      const x=standardize(vector(r.features),splitScaler),p=sigmoid(dot(w,x)),e=p-r.label;
      g[0]+=e;for(let j=0;j<x.length;j++)g[j+1]+=e*x[j];
    }
    const inv=1/(rows.length||1);
    for(let j=0;j<w.length;j++){const penalty=j?l2*w[j]:0;w[j]-=lr*(g[j]*inv+penalty)}
  }
  return {w,scaler:splitScaler};
}
function evaluateModel(fit,set){
  let brier=0,logLoss=0,correct=0;
  for(const r of set){
    const p=sigmoid(dot(fit.w,standardize(vector(r.features),fit.scaler)));
    brier+=(p-r.label)**2;
    logLoss-=r.label*Math.log(Math.max(p,1e-6))+(1-r.label)*Math.log(Math.max(1-p,1e-6));
    if((p>=.5?1:0)===r.label)correct++;
  }
  const n=set.length||1;return {n,brier:brier/n,logLoss:logLoss/n,accuracy:correct/n*100};
}
function walkForwardValidation(rows,folds=3){
  const out=[];const n=rows.length;
  for(let k=0;k<folds;k++){
    const testStart=Math.floor(n*(0.55+k*0.12)),testEnd=Math.min(n,Math.floor(n*(0.67+k*0.11)));
    if(testEnd-testStart<30||testStart<80)continue;
    const train=rows.slice(0,testStart),test=rows.slice(testStart,testEnd);
    const fit=fitLogistic(train,120,.045,.02),metrics=evaluateModel(fit,test);
    const baseline={n:test.length,brier:.25,logLoss:Math.log(2),accuracy:Math.max(
      test.filter(x=>x.label===1).length,
      test.filter(x=>x.label===0).length
    )/test.length*100};
    out.push({...metrics,baseline,brierImprovement:baseline.brier-metrics.brier,logLossImprovement:baseline.logLoss-metrics.logLoss});
  }
  const mean=k=>out.length?out.reduce((a,x)=>a+Number(x[k]||0),0)/out.length:null;
  return {folds:out.length,meanBrier:mean("brier"),meanLogLoss:mean("logLoss"),meanAccuracy:mean("accuracy"),meanBrierImprovement:mean("brierImprovement"),meanLogLossImprovement:mean("logLossImprovement"),allFoldsBeatBaseline:out.length>0&&out.every(x=>x.brier<.25&&x.logLoss<Math.log(2))};
}
function trainLogistic(rows,options={}){
  if(!Array.isArray(rows)||rows.length<120)throw new Error("At least 120 resolved training samples are required.");
  const epochs=Math.max(80,Math.min(500,Number(options.epochs)||260)),lr=Number(options.lr)||0.05,l2=Number(options.l2)||0.015;
  const split=Math.max(80,Math.floor(rows.length*.7));
  const train=rows.slice(0,split),test=rows.slice(split);
  const fit=fitLogistic(train,epochs,lr,l2);
  const trainMetrics=evaluateModel(fit,train),validation=evaluateModel(fit,test),walkForward=walkForwardValidation(rows,3);
  return {
    version:2,
    kind:"binary_setup_quality",
    trainedAt:Date.now(),
    samples:rows.length,
    featureNames:FEATURE_NAMES,
    scaler:fit.scaler,
    weights:fit.w,
    trainMetrics,
    validationMetrics:validation,
    walkForwardMetrics:walkForward,
    validationBaseline:{brier:.25,logLoss:Math.log(2)}
  };
}
function predict(model,features){
  if(!model?.weights||!model?.scaler||!Array.isArray(model.featureNames)||model.featureNames.length!==FEATURE_NAMES.length)return null;
  const p=sigmoid(dot(model.weights,standardize(vector(features),model.scaler)));
  return clamp(p,0,1);
}
function outcomeForSetup(a,candles,i,horizon){
  if(!a||a.side==="WAIT"||!Number.isFinite(a.stop)||!Number.isFinite(a.tp1))return null;
  const end=Math.min(candles.length-1,i+Math.max(1,horizon||12));
  for(let j=i+1;j<=end;j++){
    const x=candles[j];
    if(a.side==="LONG"){
      if(x.l<=a.stop)return 0;
      if(x.h>=a.tp1)return 1;
    }else if(a.side==="SHORT"){
      if(x.h>=a.stop)return 0;
      if(x.l<=a.tp1)return 1;
    }
  }
  return null;
}
function nearestContext(series,ts){
  if(!Array.isArray(series)||!series.length)return null;
  let lo=0,hi=series.length-1,best=null;
  while(lo<=hi){
    const mid=(lo+hi)>>1,mt=Number(series[mid]?.ts);
    if(!Number.isFinite(mt)){lo=mid+1;continue}
    if(mt<=ts){best=series[mid];lo=mid+1}else hi=mid-1;
  }
  return best;
}
function buildTrainingRows(candles,interval="1h",context={}){
  const rows=[];
  if(!Array.isArray(candles)||candles.length<260)return rows;
  const horizon=interval==="15m"?16:interval==="4h"?6:interval==="1d"?3:12;
  for(let i=220;i<candles.length-horizon;i++){
    let a;try{a=marketEngine.analyze(candles.slice(0,i+1),{interval})}catch{continue}
    if(a.side==="WAIT"||a.status==="WAITING")continue;
    const label=outcomeForSetup(a,candles,i,horizon);if(label===null)continue;
    const c=candles[i],ts=Number(c?.t);
    const buyPressure=Number.isFinite(c?.takerBuyQuote)?(2*Number(c.takerBuyQuote)-Number(c.quoteVolume||0))/(Number(c.quoteVolume||1)):0;
    const oiCtx=nearestContext(context.oiSeries,ts),fundCtx=nearestContext(context.fundingSeries,ts);
    const derivatives={
      ...(a.derivatives||{}),
      oiChangePct:Number.isFinite(Number(oiCtx?.oiChangePct))?Number(oiCtx.oiChangePct):null,
      fundingRate:Number.isFinite(Number(fundCtx?.fundingRate))?Number(fundCtx.fundingRate):null
    };
    const features=buildFeatures(a,{takerFlow:buyPressure,orderbook:{},derivatives,candles:candles.slice(0,i+1)});
    rows.push({timestamp:ts,label,features,side:a.side,score:a.score,type:a.type});
  }
  return rows;
}
function applyModel(a,model,ctx={}){
  const features=buildFeatures(a,ctx);
  const p=predict(model,features);
  const out={
    enabled:Boolean(model&&p!==null),
    probability:p,
    featureQuality:{
      orderbook:Boolean(ctx.orderbook?.valid),
      derivatives:Boolean(a.derivatives?.available),
      liveFlow:Boolean(a.derivatives?.livePointCount)
    },
    modelVersion:model?.version??null,
    validation:model?.validationMetrics||null,
    edge:null,
    scoreAdjustment:0
  };
  if(p===null){a.predictionModel=out;return a}
  const directionProb=a.side==="LONG"?p:a.side==="SHORT"?1-p:.5;
  const dataReady=out.featureQuality.derivatives||out.featureQuality.orderbook;
  out.probability=directionProb;
  out.edge=(directionProb-.5)*100;
  if(!dataReady){out.scoreAdjustment=-2;out.note="Microstructure inputs incomplete; model influence reduced."}
  else{
    out.scoreAdjustment=clamp((directionProb-.5)*24,-12,12);
    if(directionProb<.54)out.note="Model edge is weak; directional setup is being downgraded.";
    else if(directionProb>=.68)out.note="Model evidence supports the rule-based setup.";
    else out.note="Model evidence is supportive but not decisive.";
  }
  a.score=clamp(Math.round(finite(a.score)+out.scoreAdjustment),0,92);
  a.predictionModel=out;
  a.probabilityLabel=directionProb>=.78?"VERY HIGH MODEL SUPPORT":directionProb>=.68?"HIGH MODEL SUPPORT":directionProb>=.58?"MODERATE MODEL SUPPORT":"LOW MODEL SUPPORT";
  if(a.side!=="WAIT"&&a.status==="READY"&&directionProb<.58)a.status="WATCH";
  if(a.side!=="WAIT"&&a.status==="WATCH"&&directionProb<.50)a.status="WAITING";
  return a;
}

module.exports={FEATURE_NAMES,buildFeatures,buildTrainingRows,trainLogistic,predict,applyModel};
