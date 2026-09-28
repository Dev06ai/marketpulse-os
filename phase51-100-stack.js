/**
 * MarketPulse Phase 51–100 — Public Signal Intelligence Stack.
 * This layer turns the canonical Phase 21–50 decision into a trader-facing,
 * evidence-gated LONG / SHORT / WAIT package. It never submits orders.
 */
const u=require("./phase51-100-utils");
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
  const invalidation=Boolean(input.invalidation??s.levels?.stop!=null);
  const levelsValid=Boolean(input.levelsValid??(s.levels?.entry!=null||s.levels?.entryLow!=null));
  const trigger=Boolean(input.triggerConfirmed);
  const mtfAligned=Boolean(input.mtfAligned);
  const q=qualify(s,{dataQualityOk:dataGood,riskClear,anomalyClear,invalidation,levelsValid,trigger,mtfAligned,
    structureEvidence:Boolean(input.setupEvidence??(s.analysis?.marketStructure?.setup||s.analysis?.setup)),
    flowEvidence:Boolean(input.flowEvidence??(s.flow?.cvdState||s.flow?.takerImbalance!=null)),
    cooldown:Boolean(input.cooldown)
  });
  const ageMs=u.n(input.signalAgeMs,0);
  const ttlMs=Math.max(60000,u.n(input.signalTtlMs,15*60*1000));
  const aged=ageMs>ttlMs;
  if(aged&&!q.blockers.includes("SIGNAL_EXPIRED"))q.blockers.push("SIGNAL_EXPIRED");
  const calibrated=u.probability(input.calibration?.probability);
  const relative=u.probability(Math.max(0,Math.min(100,Math.max(q.dir.long,q.dir.short)*.75+q.coverage.coverage*.25)));
  const confidence=calibrated??relative;
  const action=(!aged&&q.qualified)?q.dominant:"WAIT";
  return {
    version:VERSION,
    signal:{
      symbol:s.symbol,interval:s.interval,timestamp:Date.now(),action,status:action==="WAIT"?"WAIT":"QUALIFIED_CANDIDATE",
      price:s.price,confidence,confidenceSource:calibrated!=null?"CALIBRATED":"RELATIVE_EVIDENCE_ONLY",calibrated:calibrated!=null,
      evidence:evidence(s),direction:q.dir,coverage:q.coverage,
      entry:s.levels?.entry??s.levels?.entryLow??null,entryHigh:s.levels?.entryHigh??null,
      stop:s.levels?.stop??null,tp1:s.levels?.tp1??null,tp2:s.levels?.tp2??null,rr:s.levels?.rr??null,
      invalidation:invalidation?String(input.invalidationText||"Structural invalidation is defined."):null,
      blockers:u.unique(q.blockers),ageMs,ttlMs,realMoneyUse:"DECISION_SUPPORT_ONLY",automaticExecutionEnabled:false
    },
    gate:{qualified:q.qualified&&!aged,blockers:u.unique(q.blockers)},
    diagnostics:{relativeConfidence:relative,calibratedConfidence:calibrated}
  };
}

function selfTest(){
  const x=evaluate({
    symbol:"BTCUSDT",interval:"15m",price:100,
    decision:{action:"LONG",market:{side:"LONG",confluenceScore:85}},
    analysis:{side:"LONG",regime:{trend:"UP"},confluenceScore:85,marketStructure:{setup:{side:"LONG"}}},
    derivatives:{cvdState:"BUYERS CONFIRM",takerImbalance:.12,oiChangePct:2,orderBook:{imbalance:.1}},
    phaseStack:{data:{quality:{liveEligible:true}},risk:{blocked:false},anomaly:{anomalous:false}},
    triggerConfirmed:true,mtfAligned:true,setupEvidence:true,flowEvidence:true,invalidation:true,levelsValid:true
  });
  const y=evaluate({dataQualityOk:false,triggerConfirmed:false,mtfAligned:false});
  return {ok:x.signal.action==="LONG"&&x.gate.qualified&&x.signal.automaticExecutionEnabled===false&&y.signal.action==="WAIT",version:VERSION};
}
module.exports={VERSION,evaluate,selfTest,evidence};
