const VERSION="9.10.0";
const n=(x,f=null)=>Number.isFinite(Number(x))?Number(x):f;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const sideOf=a=>["LONG","SHORT"].includes(String(a?.side||"").toUpperCase())?String(a.side).toUpperCase():"WAIT";

function trendAlignment(side,higher,lower){
  const h=String(higher?.regime||"UNKNOWN").toUpperCase(),l=String(lower?.regime||"UNKNOWN").toUpperCase();
  let s=50;
  if(side==="LONG"){if(h==="UPTREND")s+=25;else if(h==="DOWNTREND")s-=25;if(l==="UPTREND")s+=15;else if(l==="DOWNTREND")s-=15}
  if(side==="SHORT"){if(h==="DOWNTREND")s+=25;else if(h==="UPTREND")s-=25;if(l==="DOWNTREND")s+=15;else if(l==="UPTREND")s-=15}
  return clamp(s,0,100);
}
function flowAlignment(side,d){
  if(!d||d.available===false)return 50;
  let s=50,cvd=String(d.cvdState||"UNKNOWN").toUpperCase(),liq=String(d.liquidationBias||"UNKNOWN").toUpperCase(),obi=n(d.orderBookImbalance??d.orderBook?.imbalance),taker=n(d.takerImbalance);
  if(side==="LONG"){if(cvd==="BUYERS CONFIRM"||cvd==="BUYERS PRESSURE")s+=18;if(cvd==="BEARISH DIVERGENCE")s-=25;if(liq==="SHORT LIQS DOMINANT")s+=10;if(liq==="LONG LIQS DOMINANT")s-=10;if(obi!==null)s+=obi>=.12?10:obi<=-.12?-10:0;if(taker!==null)s+=taker>=.08?10:taker<=-.08?-10:0}
  if(side==="SHORT"){if(cvd==="SELLERS CONFIRM"||cvd==="SELLERS PRESSURE")s+=18;if(cvd==="BULLISH DIVERGENCE")s-=25;if(liq==="LONG LIQS DOMINANT")s+=10;if(liq==="SHORT LIQS DOMINANT")s-=10;if(obi!==null)s+=obi<=-.12?10:obi>=.12?-10:0;if(taker!==null)s+=taker<=-.08?10:taker>=.08?-10:0}
  if(Number.isFinite(n(d.oiChangePct)))s+=side==="LONG"?(d.oiChangePct>1?6:d.oiChangePct<-1?2:4):(d.oiChangePct<-1?6:d.oiChangePct>1?2:4);
  return clamp(s,0,100);
}
function strictSignalChecks(a,side,higher,lower,flowScore,dataScore,levels,derivatives){
  const reasons=[];
  const h=String(higher?.regime||"UNKNOWN").toUpperCase();
  const l=String(lower?.regime||"UNKNOWN").toUpperCase();
  const d=derivatives||{};
  if(!["LONG","SHORT"].includes(side))reasons.push("no directional side");
  if(dataScore<85)reasons.push("live data quality below 85");
  if(flowScore<65)reasons.push("order-flow confirmation below 65");
  if(a?.regime==="HIGH VOLATILITY")reasons.push("high-volatility regime");
  if(side==="LONG"&&h!=="UPTREND")reasons.push(h==="UNKNOWN"?"4H trend unavailable":"4H trend conflicts");
  if(side==="SHORT"&&h!=="DOWNTREND")reasons.push(h==="UNKNOWN"?"4H trend unavailable":"4H trend conflicts");
  if(side==="LONG"&&l==="DOWNTREND")reasons.push("15M trend conflicts");
  if(side==="SHORT"&&l==="UPTREND")reasons.push("15M trend conflicts");
  if(String(d.cvdState||"").toUpperCase().includes("DIVERGENCE"))reasons.push("CVD divergence");
  if(Number.isFinite(Number(levels?.rr))&&Number(levels.rr)<1.5)reasons.push("R:R below 1.5");
  if(d.available===false)reasons.push("derivatives unavailable");
  const completeness=d.completeness&&typeof d.completeness==="object"
    ?Object.values(d.completeness).filter(Boolean).length
    :null;
  if(completeness!==null&&completeness<3)reasons.push("insufficient derivatives completeness");
  if(Number.isFinite(Number(d.livePointCount))&&Number(d.livePointCount)<5)reasons.push("live flow sample too small");
  return {eligible:reasons.length===0,reasons};
}

function dataIntegrity({analysis,derivatives,consensus,dataQuality={},liveFlow={}}={}){
  let s=100,w=[],age=n(dataQuality.candleAgeMs),q=n(consensus?.consensusQualityPct),disp=n(consensus?.priceDispersionBps);
  if(age!==null){if(age>900000){s-=18;w.push("stale candles")}else if(age>300000){s-=8;w.push("candle freshness degraded")}}
  if(!derivatives||derivatives.available===false){s-=12;w.push("derivatives unavailable")}
  const errs=Array.isArray(derivatives?.errors)?derivatives.errors.filter(Boolean).length:0;if(errs){s-=Math.min(12,errs*3);w.push("provider errors")}
  if(q!==null){if(q<70){s-=15;w.push("low source consensus")}else if(q<85){s-=7;w.push("consensus degraded")}}
  if(disp!==null&&disp>80){s-=12;w.push("high price dispersion")}
  if((liveFlow?.liveConnected||liveFlow?.wsConnected)&&n(liveFlow?.livePointCount,0)>=3)s+=3;
  if(n(analysis?.price,null)===null){s=0;w.push("analysis missing")}
  return {score:clamp(Math.round(s),0,100),warnings:w};
}
function levels(a){
  const lo=n(a?.entryLow),hi=n(a?.entryHigh),entry=lo!==null&&hi!==null?(lo+hi)/2:n(a?.price),stop=n(a?.stop),tp1=n(a?.tp1),tp2=n(a?.tp2);
  const risk=entry!==null&&stop!==null?Math.abs(entry-stop):null,reward=entry!==null&&tp1!==null?Math.abs(tp1-entry):null;
  return {side:sideOf(a),entryLow:lo,entryHigh:hi,entry,stop,tp1,tp2,riskDistance:risk,target1Distance:reward,rr:reward!==null&&risk>0?reward/risk:n(a?.rr)};
}
function readiness(a,confluence,dataScore,gate,strict={eligible:true,reasons:[]}){
  const side=sideOf(a);
  if(dataScore<60)return {state:"DATA_BLOCKED",action:"WAIT",reason:"Critical data quality is below the safe threshold."};
  if(side==="WAIT"||a?.status==="WAITING")return {state:"NO_TRADE",action:"WAIT",reason:"No directional trigger is active."};
  if(gate?.decision==="BLOCKED")return {state:"RISK_BLOCKED",action:"WAIT",reason:"The configured risk gate is blocking this setup."};
  if(!strict.eligible)return {state:"NO_TRADE",action:"WAIT",reason:"High-confidence evidence gate not satisfied: "+strict.reasons.join(", ")+"."};
  if(a?.status==="READY"&&confluence>=78)return {state:"READY",action:side,reason:"Directional and high-confidence evidence thresholds are satisfied."};
  return {state:"NO_TRADE",action:"WAIT",reason:"Evidence is not aligned enough for a high-confidence directional setup."};
}
function evaluate(x={}){
  const a=x.analysis||{},side=sideOf(a),base=clamp(Math.round(n(a.score,50)),0,100);
  const data=dataIntegrity(x),mtf=trendAlignment(side,x.higher,x.lower),flow=flowAlignment(side,x.derivatives);
  const qScore=clamp(Math.round(base*.60+mtf*.14+flow*.16+data.score*.10),0,100);
  const lv=levels(a);
  const strict=strictSignalChecks(a,side,x.higher,x.lower,flow,data.score,lv,x.derivatives);
  const r=readiness(a,qScore,data.score,x.propGate,x.strictEvidence===false?{eligible:true,reasons:[]}:strict);
  const f=c=>Math.round(clamp(n(c,50),0,100));
  const components=[
    {name:"Core model",score:f(base),source:"structure + momentum + volume"},
    {name:"Higher timeframe",score:f(mtf),source:"4H / 15M alignment"},
    {name:"Order flow",score:f(flow),source:"CVD + book + taker"},
    {name:"Data integrity",score:f(data.score),source:"freshness + consensus"},
    {name:"Risk gate",score:x.propGate?.decision==="ELIGIBLE"?100:x.propGate?.decision==="ELIGIBLE_WITH_WARNINGS"?75:x.propGate?.decision==="BLOCKED"?0:50,source:"prop-firm safety checks"}
  ];
  const thesis=[];
  thesis.push(side==="LONG"?"Bullish setup under the current structure and momentum model.":side==="SHORT"?"Bearish setup under the current structure and momentum model.":"Neutral conditions: waiting for clearer structure.");
  if(x.higher?.regime)thesis.push("4H: "+x.higher.regime);
  if(x.lower?.regime)thesis.push("15M: "+x.lower.regime);
  if(x.derivatives?.cvdState)thesis.push("CVD: "+x.derivatives.cvdState);
  if(x.derivatives?.positioning)thesis.push("Positioning: "+x.derivatives.positioning);
  if(x.derivatives?.orderBook?.imbalance!=null)thesis.push("Order-book imbalance is "+(Number(x.derivatives.orderBook.imbalance)>0?"bid-side":"ask-side")+" leaning.");
  if(data.warnings.length)thesis.push("Data warnings: "+data.warnings.join(", ")+".");
  if(x.propGate?.decision==="BLOCKED")thesis.push("Risk gate: blocked.");
  return {
    version:VERSION,phase9:"9.0.0",phase10:"10.0.0",symbol:x.symbol||"BTCUSDT",interval:x.interval||"1h",generatedAt:Date.now(),
    state:r.state,action:r.action,reason:r.reason,
    market:{side,score:base,confluenceScore:qScore,confluenceLabel:qScore>=80?"HIGH":qScore>=68?"MODERATE-HIGH":qScore>=55?"DEVELOPING":"LOW",price:n(a.price),change24h:n(a.change24h),regime:a.regime||"RANGE",mood:a.mood||"CALM",status:a.status||"WAITING",type:a.type||"NO TRADE",structure:a.structure||"UNKNOWN",momentum:a.momentum||"UNKNOWN",bias:a.directionalLean||a.bias||"NEUTRAL"},
    levels:lv,
    evidence:{mtfScore:f(mtf),flowScore:f(flow),dataScore:f(data.score),components,warnings:data.warnings,strictGate:strict,thesis,primaryScenario:side==="LONG"?"Continuation higher while price holds invalidation and flow stays constructive.":side==="SHORT"?"Continuation lower while price stays beneath invalidation and flow remains constructive.":"Range / rotation until a confirmed boundary break.",invalidationScenario:side==="LONG"?"Loss of invalidation or major timeframe conflict.":side==="SHORT"?"Reclaim of invalidation or major timeframe conflict.":"A directional thesis needs a confirmed break with volume.",contributors:Array.isArray(a.contributors)?a.contributors.slice(0,12):[]},
    data:{score:data.score,candleAgeMs:n(x.dataQuality?.candleAgeMs),derivativesAvailable:Boolean(x.derivatives&&x.derivatives.available!==false),consensusQualityPct:n(x.consensus?.consensusQualityPct),priceDispersionBps:n(x.consensus?.priceDispersionBps),providerCount:n(x.consensus?.sourceCount),independentSourceCount:n(x.consensus?.independentSourceCount),liveConnected:Boolean(x.liveFlow?.liveConnected||x.liveFlow?.wsConnected),livePointCount:n(x.liveFlow?.livePointCount)},
    validation:{available:Boolean(x.validation),sample:n(x.validation?.sample??x.validation?.totalTrades),coverage:n(x.validation?.coverage),note:"Historical validation describes past samples; it is not a guarantee of future results."},
    propGate:x.propGate||{decision:"NOT_EVALUATED"},
    operational:{failSafe:true,executionEnabled:false,generatedBy:"MarketPulse Phase 9/10 Decision Engine"}
  };
}
function selfTest(){
  const analysis={side:"LONG",status:"READY",score:80,price:100,entryLow:99,entryHigh:100,stop:97,tp1:105,tp2:108,components:[{name:"Structure",value:9}]};
  const r=evaluate({analysis,higher:{regime:"UPTREND"},lower:{regime:"UPTREND"},derivatives:{available:true,cvdState:"BUYERS CONFIRM",oiChangePct:2,orderBook:{imbalance:.15},takerImbalance:.1,liquidationBias:"SHORT LIQS DOMINANT"},consensus:{consensusQualityPct:95,priceDispersionBps:10},dataQuality:{candleAgeMs:1000},liveFlow:{liveConnected:true,livePointCount:10},propGate:{decision:"ELIGIBLE"}});
  const blocked=evaluate({analysis,higher:{regime:"DOWNTREND"},lower:{regime:"UPTREND"},derivatives:{available:true,cvdState:"BUYERS CONFIRM",oiChangePct:2,orderBook:{imbalance:.15},takerImbalance:.1,liquidationBias:"SHORT LIQS DOMINANT"},consensus:{consensusQualityPct:95,priceDispersionBps:10},dataQuality:{candleAgeMs:1000},liveFlow:{liveConnected:true,livePointCount:10},propGate:{decision:"ELIGIBLE"}});
  return {ok:r.state==="READY"&&blocked.state==="NO_TRADE"&&blocked.action==="WAIT"&&r.evidence.flowScore>60&&r.levels.stop===97&&r.market.confluenceScore>=55,result:r,blocked};
}
module.exports={VERSION,evaluate,selfTest,dataIntegrity,trendAlignment,flowAlignment};