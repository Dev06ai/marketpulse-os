const VERSION="13.0.0";
const PHASE11="11.0.0";
const PHASE12="12.0.0";
const PHASE13="13.0.0";

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const num=(x,f=null)=>Number.isFinite(Number(x))?Number(x):f;

function outcomeForSetup(candles,side,entry,stop,tp1,horizon=12){
  const dir=String(side||"WAIT").toUpperCase();
  if(!["LONG","SHORT"].includes(dir)||![entry,stop,tp1].every(Number.isFinite))return {outcome:"SKIP",resultR:0,barsHeld:0,reason:"invalid_setup"};
  const risk=Math.abs(entry-stop);
  if(!(risk>0))return {outcome:"SKIP",resultR:0,barsHeld:0,reason:"zero_risk"};
  const rows=candles.slice(0,Math.max(0,horizon));
  for(let i=0;i<rows.length;i++){
    const b=rows[i],hitStop=dir==="LONG"?b.l<=stop:b.h>=stop,hitTarget=dir==="LONG"?b.h>=tp1:b.l<=tp1;
    if(hitStop&&hitTarget)return {outcome:"LOSS",resultR:-1,barsHeld:i+1,reason:"same_bar_conflict_stop_first"};
    if(hitStop)return {outcome:"LOSS",resultR:-1,barsHeld:i+1,reason:"stop"};
    if(hitTarget)return {outcome:"WIN",resultR:1,barsHeld:i+1,reason:"target"};
  }
  const last=rows[rows.length-1];
  if(!last)return {outcome:"OPEN",resultR:0,barsHeld:0,reason:"no_forward_data"};
  const move=(dir==="LONG"?last.c-entry:entry-last.c)/risk;
  return {outcome:move>0?"OPEN_GAIN":"OPEN_LOSS",resultR:clamp(move,-1,1),barsHeld:rows.length,reason:"horizon_close"};
}

function maxDrawdownR(results){
  let equity=0,peak=0,max=0;
  for(const r of results){
    equity+=Number(r.resultR)||0;
    peak=Math.max(peak,equity);
    max=Math.max(max,peak-equity);
  }
  return Number(max.toFixed(3));
}

function summarise(rows,meta={}){
  const trades=rows.filter(x=>x.outcome!=="SKIP"&&Number.isFinite(Number(x.resultR)));
  const wins=trades.filter(x=>x.resultR>0),losses=trades.filter(x=>x.resultR<0);
  const grossWin=wins.reduce((s,x)=>s+x.resultR,0),grossLoss=Math.abs(losses.reduce((s,x)=>s+x.resultR,0));
  const netR=trades.reduce((s,x)=>s+x.resultR,0);
  const pf=grossLoss>0?grossWin/grossLoss:(grossWin>0?999:null);
  const expectancy=trades.length?netR/trades.length:0;
  const winRate=trades.length?wins.length/trades.length*100:0;
  const coverage=meta.opportunities?trades.length/meta.opportunities*100:0;
  const sufficient=trades.length>=Number(meta.minTrades||50)&&Number(meta.testBars||0)>=Number(meta.minTestBars||300);
  return {
    trades:trades.length,wins:wins.length,losses:losses.length,winRate:Number(winRate.toFixed(2)),
    expectancyR:Number(expectancy.toFixed(4)),profitFactor:pf===null?null:Number(pf.toFixed(3)),
    netR:Number(netR.toFixed(3)),maxDrawdownR:maxDrawdownR(trades),
    coveragePct:Number(coverage.toFixed(2)),sufficient,
    sample:{opportunities:Number(meta.opportunities||0),testBars:Number(meta.testBars||0),startTs:meta.startTs||null,endTs:meta.endTs||null}
  };
}

function analyseScoreBuckets(rows){
  const buckets=[
    {name:"72-75",min:72,max:75},{name:"76-79",min:76,max:79},{name:"80-83",min:80,max:83},{name:"84+",min:84,max:100}
  ];
  return buckets.map(b=>{
    const x=rows.filter(r=>Number(r.score)>=b.min&&Number(r.score)<=b.max&&r.outcome!=="SKIP");
    const s=summarise(x,{opportunities:x.length,testBars:x.length});
    return {bucket:b.name,min:b.min,max:b.max,trades:s.trades,winRate:s.winRate,expectancyR:s.expectancyR,profitFactor:s.profitFactor,netR:s.netR};
  });
}

function validatedThreshold(summary,buckets,baseScore){
  const minTrades=25;
  const eligible=(buckets||[])
    .filter(b=>Number(b.trades)>=minTrades&&Number(b.winRate)>=52&&Number(b.expectancyR)>0&&
      (b.profitFactor===null||Number(b.profitFactor)>=1.05)&&Number(b.min||0)>=baseScore);
  if(!eligible.length)return null;
  return eligible.sort((a,b)=>Number(a.min||0)-Number(b.min||0))[0];
}

function adaptivePolicy(validation,base={}){
  const baseScore=clamp(num(base.minScore,78),70,90);
  const baseRR=Math.max(1.5,num(base.minRR,1.5));
  const s=validation.summary||{};
  let minScore=baseScore;
  const reasons=[];
  const bucketGate=validatedThreshold(s,validation.buckets,baseScore);
  if(!s.sufficient)reasons.push("insufficient_out_of_sample_evidence");
  if(s.sufficient){
    if(s.expectancyR<=0){minScore+=6;reasons.push("non_positive_expectancy")}
    else if(s.expectancyR<0.05){minScore+=3;reasons.push("thin_expectancy")}
    if(Number.isFinite(s.profitFactor)&&s.profitFactor<1.10){minScore+=4;reasons.push("weak_profit_factor")}
    if(s.winRate<52){minScore+=4;reasons.push("win_rate_below_52")}
    if(s.maxDrawdownR>10){minScore+=3;reasons.push("drawdown_pressure")}
  }
  if(bucketGate)minScore=Math.max(minScore,Number(bucketGate.min||0));
  else reasons.push("no_score_bucket_meets_validation_thresholds");
  minScore=clamp(Math.round(minScore),baseScore,88);
  const eligibleEvidence=Boolean(
    s.sufficient&&
    s.trades>=80&&
    s.winRate>=52&&
    s.expectancyR>0.05&&
    (s.profitFactor===null||s.profitFactor>=1.10)&&
    s.maxDrawdownR<=10&&
    bucketGate
  );
  return {
    mode:eligibleEvidence?"CALIBRATED_SIGNAL":"PAPER_ONLY",
    minScore,minRR:baseRR,
    evidenceSufficient:Boolean(s.sufficient),
    signalGateReady:eligibleEvidence,
    validatedBucket:bucketGate||null,
    changedFromBase:minScore!==baseScore,
    reasons
  };
}

function runWalkForward(candles,opts={}){
  if(!Array.isArray(candles)||candles.length<260)throw new Error("At least 260 candles are required for Phase 12 validation.");
  const analyze=opts.analyze||require("./market-engine").analyze;
  const phase910=opts.phase910||require("./phase9-10");
  const interval=opts.interval||"1h";
  const higher8h=Array.isArray(opts.higher8h)?opts.higher8h:null;
  const windowSize=Math.max(220,Math.min(480,Number(opts.windowSize)||360));
  const horizon=Math.max(4,Math.min(48,Number(opts.horizonBars)||12));
  const step=Math.max(1,Math.min(10,Number(opts.step)||2));
  const maxSamples=Math.max(60,Math.min(700,Number(opts.maxSamples)||350));
  const start=Math.max(219,windowSize-1);
  const end=candles.length-horizon-1;
  const rows=[];
  let opportunities=0;
  for(let i=start;i<=end&&rows.length<maxSamples;i+=step){
    const window=candles.slice(Math.max(0,i-windowSize+1),i+1);
    let analysis;
    let dlineHigher=null;
    if(interval==="15m"&&higher8h&&higher8h.length>=220){
      const signalTs=Number(candles[i]?.t)||0;
      const eligibleIndex=(()=>{
        let lo=0,hi=higher8h.length-1,best=-1;
        while(lo<=hi){
          const mid=Math.floor((lo+hi)/2);
          const t=Number(higher8h[mid]?.t)||0;
          if(t<=signalTs-480*60*1000){best=mid;lo=mid+1}else hi=mid-1;
        }
        return best;
      })();
      if(eligibleIndex>=219){
        try{dlineHigher=analyze(higher8h.slice(0,eligibleIndex+1),{interval:"8h",lower:null,higher:null,deriv:null})}catch{}
      }
    }
    try{analysis=analyze(window,{interval,lower:null,higher:null,dlineHigher,deriv:null})}catch{continue}
    const decision=phase910.evaluate({
      symbol:opts.symbol||"BTCUSDT",interval,analysis,derivatives:{available:false},
      consensus:{consensusQualityPct:90,priceDispersionBps:20,sourceCount:1,independentSourceCount:1},
      dataQuality:{candleAgeMs:1000},
      liveFlow:{liveConnected:false,livePointCount:0},
      propGate:{decision:"ELIGIBLE"},
      strictEvidence:false
    });
    const actionable=decision.state==="READY"&&["LONG","SHORT"].includes(decision.action)&&Number(decision.market?.confluenceScore)>=72;
    if(actionable)opportunities++;
    if(!actionable)continue;
    const lv=decision.levels||{};
    const fwd=outcomeForSetup(candles.slice(i+1),decision.action,lv.entry,lv.stop,lv.tp1,horizon);
    rows.push({
      ts:candles[i]?.t||null,score:Number(decision.market?.confluenceScore)||0,side:decision.action,
      state:decision.state,entry:lv.entry,stop:lv.stop,tp1:lv.tp1,outcome:fwd.outcome,resultR:fwd.resultR,
      barsHeld:fwd.barsHeld,reason:fwd.reason,regime:decision.market?.regime||"UNKNOWN"
    });
  }
  const testBars=Math.max(0,candles.length-start);
  const summary=summarise(rows,{opportunities,testBars,startTs:candles[start]?.t||null,endTs:candles[end]?.t||null,minTrades:opts.minTrades||50,minTestBars:opts.minTestBars||300});
  const directional={
    long:summarise(rows.filter(x=>x.side==="LONG"),{opportunities:rows.filter(x=>x.side==="LONG").length,testBars}),
    short:summarise(rows.filter(x=>x.side==="SHORT"),{opportunities:rows.filter(x=>x.side==="SHORT").length,testBars})
  };
  const buckets=analyseScoreBuckets(rows);
  const validation={
    version:VERSION,phase11:PHASE11,phase12:PHASE12,phase13:PHASE13,
    interval,symbol:opts.symbol||"BTCUSDT",
    method:"rolling walk-forward replay; no future candles used in the signal window",
    limitations:[
      "Historical replay uses OHLCV candles only unless historical derivatives are explicitly supplied.",
      "D-Line validation uses synchronized 8H OHLCV context when an 8H sample is supplied; it does not reconstruct historical order-book/liquidation microstructure.",
      "Same-bar stop/target conflicts are resolved conservatively in favor of the stop.",
      "Open positions at the replay horizon are marked at the horizon close and capped to ±1R.",
      "Past performance does not establish future profitability."
    ],
    summary,directional,buckets,
    adaptive:null,
    generatedAt:Date.now(),
    recent:rows.slice(-25)
  };
  validation.adaptive=adaptivePolicy(validation,opts.basePolicy);
  return validation;
}

function applyDeploymentGate(decision,validation,opts={}){
  const d=decision||{};
  const v=validation||{};
  const policy=v.adaptive||adaptivePolicy(v,opts.basePolicy);
  const dataScore=num(d?.data?.score,0);
  const riskOk=d?.propGate?.decision!=="BLOCKED";
  const currentScore=num(d?.market?.confluenceScore,0);
  const fresh=!d?.stale;
  const engineHealthy=d?.operational?.failSafe===true&&d?.operational?.executionEnabled===false;
  let signalEligible=false,gateState="PAPER_ONLY",reason="Historical validation evidence is not yet sufficient for live reliance.";
  if(policy.signalGateReady&&fresh&&dataScore>=85&&riskOk&&engineHealthy&&currentScore>=policy.minScore&&d.state==="READY"&&["LONG","SHORT"].includes(String(d.action||"").toUpperCase())){
    signalEligible=true;gateState="SIGNAL_ELIGIBLE";reason="Current signal passed the conservative data, risk and validation gates.";
  }else if(d?.state==="DATA_BLOCKED"||dataScore<70){
    gateState="BLOCKED";reason="Critical live data quality is too weak for a signal.";
  }else if(d?.state==="RISK_BLOCKED"||!riskOk){
    gateState="BLOCKED";reason="The configured risk gate blocks the setup.";
  }else if(!fresh){
    gateState="BLOCKED";reason="Only a stale last-known-good decision is available.";
  }else if(currentScore<policy.minScore){
    gateState="PAPER_ONLY";reason="The current confluence score is below the adaptive validation threshold.";
  }
  const finalSide=signalEligible?(String(d?.market?.side||d?.action||"WAIT").toUpperCase()):"WAIT";
  const finalAction=signalEligible&&["LONG","SHORT"].includes(finalSide)?finalSide:"WAIT";
  const finalMarket=signalEligible
    ?{...(d.market||{}),side:finalSide}
    :{...(d.market||{}),side:"WAIT",status:"WAITING",type:"NO TRADE",bias:"Neutral",directionalLean:"NEUTRAL"};
  const finalLevels=signalEligible
    ?d.levels
    :{...(d.levels||{}),entryLow:null,entryHigh:null,entry:null,stop:null,tp1:null,tp2:null,rr:null};
  return {
    ...d,
    rawAction:d.action,
    action:finalAction,
    state:signalEligible?"READY":"NO_TRADE",
    market:finalMarket,
    levels:finalLevels,
    liveSignalEligible:signalEligible,
    deploymentGate:{state:gateState,reason,validationEvidenceSufficient:Boolean(policy.evidenceSufficient),adaptiveMode:policy.mode,minScore:policy.minScore,minRR:policy.minRR},
    operational:{...(d.operational||{}),failSafe:true,executionEnabled:false,liveUse:gateState==="SIGNAL_ELIGIBLE"?"DECISION_SUPPORT_ONLY":"PAPER_ONLY"}
  };
}

function selfTest(){
  const candles=[];
  for(let i=0;i<560;i++)candles.push({t:Date.now()+i*3600000,o:99,h:103,l:99,c:101,v:1000+i});
  const fakeAnalyze=()=>({});
  const fakePhase={
    evaluate:()=>({
      state:"READY",action:"LONG",
      market:{confluenceScore:80,regime:"UPTREND"},
      levels:{entry:100,stop:98,tp1:102}
    })
  };
  const v=runWalkForward(candles,{
    symbol:"BTCUSDT",interval:"1h",step:8,maxSamples:60,minTrades:80,minTestBars:100,
    analyze:fakeAnalyze,phase910:fakePhase
  });
  const historicalGate=applyDeploymentGate({
    state:"READY",market:{confluenceScore:80},data:{score:92},propGate:{decision:"ELIGIBLE"},
    operational:{failSafe:true,executionEnabled:false}
  },v,{basePolicy:{minScore:72,minRR:1.5}});
  const strongValidation={
    summary:{trades:80,winRate:56,expectancyR:.14,profitFactor:1.2,maxDrawdownR:6,sufficient:true},
    buckets:[{bucket:"80-83",min:80,max:83,trades:30,winRate:56,expectancyR:.14,profitFactor:1.2,netR:4.2}],
    adaptive:null
  };
  strongValidation.adaptive=adaptivePolicy(strongValidation,{minScore:72,minRR:1.5});
  const calibratedGate=applyDeploymentGate({
    state:"READY",market:{confluenceScore:80},data:{score:92},propGate:{decision:"ELIGIBLE"},
    operational:{failSafe:true,executionEnabled:false}
  },strongValidation,{basePolicy:{minScore:72,minRR:1.5}});
  return {
    ok:Boolean(v.summary.trades>0&&v.summary.netR>0&&historicalGate.deploymentGate.state==="PAPER_ONLY"&&calibratedGate.liveSignalEligible===true),
    summary:v.summary,adaptive:v.adaptive,
    historicalGate:historicalGate.deploymentGate,calibratedGate:calibratedGate.deploymentGate
  };
}

module.exports={VERSION,PHASE11,PHASE12,PHASE13,outcomeForSetup,summarise,adaptivePolicy,runWalkForward,applyDeploymentGate,selfTest};
