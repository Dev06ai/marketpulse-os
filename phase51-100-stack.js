/**
 * MarketPulse Phase 51–100 — Public Signal Intelligence Stack.
 * This layer turns the canonical Phase 21–50 decision into a trader-facing,
 * evidence-gated LONG / SHORT / WAIT package. It never submits orders.
 */
const u=require("./phase51-100-utils");
const p52=require("./phase52-signal-qualification-gate");
const p54=require("./phase54-multi-timeframe-alignment");
const p62=require("./phase62-trigger-quality");
const p63=require("./phase63-invalidation-engine");
const p64=require("./phase64-adaptive-levels");
const p65=require("./phase65-expectancy-gate");
const p67=require("./phase67-leverage-safety");
const p68=require("./phase68-signal-ttl");
const p70=require("./phase70-anti-chop-cooldown");
const p73=require("./phase73-uncertainty-coverage");
const p74=require("./phase74-cost-aware-expectancy");
const p80=require("./phase80-no-trade-quality");
const p87=require("./phase87-portfolio-risk");
const p89=require("./phase89-exchange-health");
const p90=require("./phase90-trader-checklist");
const p99=require("./phase99-free-public-readiness");
const p100=require("./phase100-public-signal-gate");
const VERSION="51-100.0.0";

function norm(input={}){
  const decision=input.decision||{};
  const analysis=input.analysis||{};
  const flow=input.derivatives||decision.derivatives||{};
  return {
    symbol:String(input.symbol||"UNKNOWN"),
    interval:String(input.interval||"UNKNOWN"),
    price:u.n(input.price??decision?.market?.price??analysis?.price),
    candidate:u.side(decision.action),
    market:decision.market||{},
    levels:decision.levels||{},
    analysis,flow,consensus:input.consensus||{},
    intelligence:input.decisionIntelligence||{},
    phase20:input.phase20||{},
    phaseStack:input.phaseStack||{}
  };
}

function evidence(s){
  const d=s.market||{},a=s.analysis||{},f=s.flow||{},di=s.intelligence||{},c=s.consensus||{};
  const rows=[];
  const setupSide=u.side(a.side||a.marketStructure?.setup?.side||d.side);
  if(setupSide!=="WAIT")rows.push({key:"SETUP",side:setupSide,weight:12});
  const trend=String(a.regime?.trend||a.marketStructure?.regime||d.directionalLean||"").toUpperCase();
  if(/UP|BULL/.test(trend))rows.push({key:"TREND",side:"LONG",weight:8});
  else if(/DOWN|BEAR/.test(trend))rows.push({key:"TREND",side:"SHORT",weight:8});
  const cvd=String(f.cvdState||"").toUpperCase();
  if(/BUY|BULL/.test(cvd))rows.push({key:"CVD",side:"LONG",weight:10});
  else if(/SELL|BEAR/.test(cvd))rows.push({key:"CVD",side:"SHORT",weight:10});
  const taker=Number(f.takerImbalance);
  const oi=Number(f.oiChangePct);
  if(Number.isFinite(taker)&&Math.abs(taker)>=0.03){
    rows.push({key:"TAKER_FLOW",side:taker>0?"LONG":"SHORT",weight:8});
  }
  if(Number.isFinite(oi)&&Math.abs(oi)>=0.5&&Number.isFinite(taker)&&Math.sign(oi)===Math.sign(taker)){
    rows.push({key:"OI_FLOW_AGREEMENT",side:taker>0?"LONG":"SHORT",weight:6});
  }
  const ob=Number(f.orderBook?.imbalance??f.orderBookImbalance);
  if(Number.isFinite(ob)&&Math.abs(ob)>=0.05)rows.push({key:"ORDERBOOK",side:ob>0?"LONG":"SHORT",weight:7});
  const con=Number(a.confluenceScore??d.confluenceScore);
  if(Number.isFinite(con)&&setupSide!=="WAIT")rows.push({key:"CONFLUENCE",side:setupSide,weight:Math.max(0,Math.min(10,(con-50)/5))});
  if(Number(c.consensusQualityPct)<70)rows.push({key:"VENUE_CONFLICT",side:"WAIT",weight:-12});
  if(Array.isArray(di.conflicts)&&di.conflicts.length)rows.push({key:"INTELLIGENCE_CONFLICT",side:"WAIT",weight:-8});
  return rows;
}

function qualify(s,ctx){
  const blockers=[];
  const ev=evidence(s);
  const dir=u.directionalScore(ev);
  const coverage=u.evidenceCoverage([
    {present:Boolean(ctx.dataQualityOk)},
    {present:Boolean(ctx.structureEvidence)},
    {present:Boolean(ctx.flowEvidence)},
    {present:Boolean(ctx.mtfAligned)},
    {present:Boolean(ctx.trigger)},
    {present:Boolean(ctx.invalidation)},
    {present:Boolean(ctx.levelsValid)},
    {present:Boolean(ctx.riskClear)}
  ]);
  if(coverage.coverage<75)blockers.push("INSUFFICIENT_EVIDENCE_COVERAGE");
  if(!ctx.dataQualityOk)blockers.push("DATA_QUALITY");
  if(!ctx.riskClear)blockers.push("RISK_BLOCK");
  if(!ctx.anomalyClear)blockers.push("MARKET_ANOMALY");
  if(!ctx.invalidation)blockers.push("INVALIDATION_UNDEFINED");
  if(!ctx.levelsValid)blockers.push("LEVELS_INVALID");
  if(!ctx.trigger)blockers.push("TRIGGER_NOT_CONFIRMED");
  if(!ctx.mtfAligned)blockers.push("MTF_CONFLICT");
  if(ctx.cooldown)blockers.push("COOLDOWN");
  const dominant=dir.long>dir.short?"LONG":dir.short>dir.long?"SHORT":"WAIT";
  if(dominant==="WAIT"||Math.abs(dir.long-dir.short)<15)blockers.push("DIRECTIONAL_EDGE_TOO_SMALL");
  return {dominant,dir,coverage,blockers,qualified:blockers.length===0};
}

function evaluate(input={}){
  const s=norm(input),ps=s.phaseStack||{};
  const dataGood=Boolean(ps?.data?.quality?.liveEligible ?? input.dataQualityOk);
  const riskClear=!Boolean(ps?.risk?.blocked||input.riskBlocked);
  const anomalyClear=!Boolean(ps?.anomaly?.anomalous||input.anomalyBlocked);
  const mtfResult=p54.align(input.mtf||{higher:input.mtfHigher,execution:input.mtfExecution,lower:input.mtfLower});
  const triggerResult=p62.evaluate(input.trigger||{direction:s.candidate,closeConfirmation:input.triggerConfirmed});
  const levelResult=p64.build(input.levelContext||{side:s.candidate,price:s.price,entryLow:s.levels?.entryLow??s.levels?.entry,entryHigh:s.levels?.entryHigh??s.levels?.entry,atr:input.atr});
  const invalidationResult=p63.evaluate({side:s.candidate,entry:s.levels?.entry??levelResult.entry,stop:s.levels?.stop??levelResult.stop});
  const leverageResult=p67.evaluate(input.leverage||{});
  const ttlResult=p68.evaluate({ageMs:input.signalAgeMs,ttlMs:input.signalTtlMs});
  const chopResult=p70.evaluate(input.chop||{});
  const mtfAligned=Boolean(input.mtfAligned??mtfResult.aligned);
  const invalidation=Boolean(input.invalidation??invalidationResult.valid);
  const levelsValid=Boolean(input.levelsValid??(s.levels?.entry!=null||s.levels?.entryLow!=null||levelResult.valid));
  const trigger=Boolean(input.triggerConfirmed??triggerResult.confirmed);
  const q=qualify(s,{dataQualityOk:dataGood,riskClear,anomalyClear,invalidation,levelsValid,trigger,mtfAligned,
    structureEvidence:Boolean(input.setupEvidence??(s.analysis?.marketStructure?.setup||s.analysis?.setup)),
    flowEvidence:Boolean(input.flowEvidence??(s.flow?.cvdState||s.flow?.takerImbalance!=null)),
    cooldown:Boolean(input.cooldown??chopResult.blocked)
  });
  const ageMs=u.n(input.signalAgeMs,0);
  const ttlMs=Math.max(60000,u.n(input.signalTtlMs,15*60*1000));
  const aged=Boolean(input.signalAgeExpired??ttlResult.expired);
  if(aged&&!q.blockers.includes("SIGNAL_EXPIRED"))q.blockers.push("SIGNAL_EXPIRED");
  const rawCalibration=Number(input.calibration?.probability);
  const calibrated=Number.isFinite(rawCalibration)?u.probability(rawCalibration<=1?rawCalibration*100:rawCalibration):null;
  const relative=u.probability(Math.max(0,Math.min(100,Math.max(q.dir.long,q.dir.short)*.75+q.coverage.coverage*.25)));
  const confidence=calibrated??relative;
  const expectancy=p74.evaluate(input.expectancy||{});
  const expectancyGate=p65.evaluate({
    probability:calibrated,
    rr:s.levels?.rr??levelResult.rr,
    costBps:input.costBps
  });
  const uncertainty=p73.evaluate(input.uncertainty||{});
  const portfolio=p87.evaluate(input.portfolio||{});
  const exchange=p89.evaluate(input.exchangeHealth||{});
  const checklist=p90.build(input.checklist||{});
  const freeGate=p99.gate(input.publicReadiness||{});
  const qualification=p52.evaluate({gates:{
    data:dataGood,structure:Boolean(input.setupEvidence??(s.analysis?.marketStructure?.setup||s.analysis?.setup)),
    flow:Boolean(input.flowEvidence??(s.flow?.cvdState||s.flow?.takerImbalance!=null)),
    mtf:mtfAligned,trigger,invalidation,levels:levelsValid,risk:riskClear,
    anomaly:anomalyClear,exchange:exchange.healthy,portfolio:!portfolio.blocked,uncertainty:!uncertainty.uncertain,
    calibrated:calibrated!=null,expectancy:expectancyGate.pass,publicReadiness:freeGate.ready
  }});
  const leverageClear=!leverageResult.blocked;
  const publicAllowed=qualification.eligible&&!aged&&Boolean(expectancyGate.pass)&&!uncertainty.uncertain&&!portfolio.blocked&&exchange.healthy&&leverageClear&&freeGate.ready;
  const publicAction=publicAllowed?q.dominant:"WAIT";
  const publicBlockers=u.unique([
    ...q.blockers,
    ...(calibrated==null?["CALIBRATION_NOT_AVAILABLE"]:[]),
    ...(expectancyGate.pass?[]:["EXPECTANCY_GATE"]),
    ...(uncertainty.uncertain?uncertainty.reasons:[]),
    ...(portfolio.blocked?["PORTFOLIO_RISK"]:[]),
    ...(exchange.healthy?[]:exchange.blockers),
    ...(leverageClear?[]:leverageResult.blockers),
    ...(freeGate.ready?[]:freeGate.missing)
  ]);
  const publicGate=p100.evaluate({readiness:publicAllowed,action:publicAction,blockers:publicBlockers,automaticExecutionEnabled:false});
  const action=publicGate.publicSignalAllowed?publicAction:"WAIT";
  return {
    version:VERSION,
    signal:{
      symbol:s.symbol,interval:s.interval,timestamp:Date.now(),action,candidateAction:q.dominant,status:action==="WAIT"?"WAIT":"QUALIFIED_CANDIDATE",
      price:s.price,confidence,confidenceSource:calibrated!=null?"CALIBRATED":"RELATIVE_EVIDENCE_ONLY",calibrated:calibrated!=null,
      evidence:evidence(s),direction:q.dir,coverage:q.coverage,
      entry:s.levels?.entry??levelResult.entry??s.levels?.entryLow??null,entryHigh:s.levels?.entryHigh??levelResult.entryHigh??null,
      stop:s.levels?.stop??levelResult.stop??null,tp1:s.levels?.tp1??levelResult.tp1??null,tp2:s.levels?.tp2??levelResult.tp2??null,rr:s.levels?.rr??levelResult.rr??null,
      invalidation:invalidation?String(input.invalidationText||"Structural invalidation is defined."):null,
      blockers:publicBlockers,ageMs,ttlMs,realMoneyUse:"DECISION_SUPPORT_ONLY",automaticExecutionEnabled:false
    },
    gate:{qualified:publicGate.publicSignalAllowed,candidateQualified:q.qualified&&!aged,blockers:u.unique(publicBlockers)},
    diagnostics:{relativeConfidence:relative,calibratedConfidence:calibrated,
      mtf:mtfResult,trigger:triggerResult,invalidation:invalidationResult,levels:levelResult,
      leverage:leverageResult,ttl:ttlResult,chop:chopResult,expectancy,expectancyGate,uncertainty,portfolio,exchange,
      checklist,qualification,publicReadiness:freeGate,publicGate}
  };
}

function confidenceToProb(x){const n=Number(x);return Number.isFinite(n)?Math.max(0,Math.min(100,n))/100:null}
function selfTest(){
  const x=evaluate({
    symbol:"BTCUSDT",interval:"15m",price:100,
    decision:{action:"LONG",market:{side:"LONG",confluenceScore:85},levels:{entry:100,stop:98,tp1:103,tp2:105,rr:1.5}},
    analysis:{side:"LONG",regime:{trend:"UP"},confluenceScore:85,marketStructure:{setup:{side:"LONG"}}},
    derivatives:{cvdState:"BUYERS CONFIRM",takerImbalance:.12,oiChangePct:2,orderBook:{imbalance:.1}},
    phaseStack:{data:{quality:{liveEligible:true}},risk:{blocked:false},anomaly:{anomalous:false}},
    triggerConfirmed:true,mtfAligned:true,setupEvidence:true,flowEvidence:true,invalidation:true,levelsValid:true,
    calibration:{probability:.72},
    uncertainty:{coveragePct:95,calibrationSamples:500,disagreementPct:5},
    publicReadiness:{data:true,validation:true,calibration:true,risk:true,security:true,observability:true,operations:true},
    expectancy:{winProbability:.72,averageWinR:2,averageLossR:1,costR:.05},
    exchangeHealth:{reliabilityPct:100},
    portfolio:{positions:[]},
    leverage:{leverage:2,liquidationDistancePct:10}
  });
  const y=evaluate({dataQualityOk:false,triggerConfirmed:false,mtfAligned:false});
  return {ok:x.signal.action==="LONG"&&x.gate.qualified&&x.signal.automaticExecutionEnabled===false&&y.signal.action==="WAIT",version:VERSION};
}
module.exports={VERSION,evaluate,selfTest,evidence};
