/**
 * MarketPulse Phase 21–50 Stack
 * --------------------------------
 * Integration layer for the phase primitives. It is deliberately fail-safe:
 * diagnostic/validation layers can add blockers but cannot turn an unsafe
 * decision into a live trade.
 */
const phase21=require("./phase21-state-contract");
const {StateBus}=require("./phase22-state-bus");
const phase23=require("./phase23-signal-hysteresis");
const phase24=require("./phase24-data-quality");
const phase25=require("./phase25-flow-normalizer");
const phase26=require("./phase26-regime-engine");
const phase27=require("./phase27-structure-graph");
const phase28=require("./phase28-confluence");
const phase29=require("./phase29-calibration");
const phase30=require("./phase30-risk-engine");
const phase31=require("./phase31-backtest-engine");
const phase32=require("./phase32-walk-forward");
const phase33=require("./phase33-monte-carlo");
const {PaperBroker}=require("./phase34-paper-broker");
const phase35=require("./phase35-execution-model");
const phase36=require("./phase36-forensics");
const phase37=require("./phase37-learning-guardrails");
const phase38=require("./phase38-drift-detection");
const phase39=require("./phase39-calibration-audit");
const phase40=require("./phase40-anomaly-detector");
const phase41=require("./phase41-kill-switch");
const {Metrics}=require("./phase42-observability");
const phase43=require("./phase43-phase-ledger");
const phase44=require("./phase44-explainability");
const phase45=require("./phase45-security-review");
const phase46=require("./phase46-deployment-gate");
const phase47=require("./phase47-recovery");
const phase48=require("./phase48-performance-budget");
const phase49=require("./phase49-live-readiness");
const phase50=require("./phase50-shadow-controller");

const VERSION="21-50.0.0";
const bus=new StateBus({maxAgeMs:20000});
const metrics=new Metrics();

function n(x,d=null){const v=Number(x);return Number.isFinite(v)?v:d}
function pct(x,d=0){return Math.max(0,Math.min(100,n(x,d)))}

function evaluate(input={}){
  const decision=input.decision||{};
  const analysis=input.analysis||{};
  const derivatives=input.derivatives||decision.derivatives||{};
  const consensus=input.consensus||{};
  const validation=input.validation||decision.validation||{};
  const risk=input.risk||decision.risk||{};
  const marketState=input.marketState||{};
  const now=n(input.ts,Date.now());
  const price=n(input.price??decision?.market?.price??analysis?.price);

  const canonicalInput={
    symbol:input.symbol,interval:input.interval,ts:now,price,
    decision:{...decision,derivatives},
    structure:analysis?.marketStructure||{},
    liquidity:analysis?.liquidity||derivatives?.liquidity||{}
  };
  const canonical=phase21.normalize(canonicalInput);
  const snapshotId=phase21.hash(canonical);
  const envelope=bus.publish(canonical,now);

  const candidate=String(decision.action||"WAIT").toUpperCase();
  const prior=input.priorDirection||"WAIT";
  const hysteresis=phase23.update({side:prior,pending:input.pendingSide,count:n(input.pendingCount,0)},candidate,{
    confirmations:Math.max(1,n(input.requiredConfirmations,3)),
    invalidated:Boolean(input.invalidated)
  });

  const venues=Array.isArray(marketState?.venues)
    ?marketState.venues.map(v=>v?.result||v).filter(Boolean)
    :Array.isArray(input.venues)?input.venues:[];
  const flow=phase25.aggregate(venues);
  const quality=phase24.score({
    venueCount:Number(marketState?.summary?.venueCount??flow.venueCount),
    requiredVenues:2,
    freshnessPct:pct(input.freshnessPct??(n(input.dataAgeMs,0)<=10000?100:50)),
    completenessPct:pct(input.completenessPct??100),
    consensusPct:pct(consensus?.consensusQualityPct??marketState?.summary?.consensusQuality??0),
    timestampIntegrityPct:pct(input.timestampIntegrityPct??100)
  });

  const regime=phase26.classify({
    trend:analysis?.regime?.trend||analysis?.marketStructure?.regime||decision?.market?.regime,
    volatility:analysis?.volatilityRegime||decision?.market?.volatility,
    liquidityScore:pct(input.liquidityScore??50),
    crowdingScore:pct(input.crowdingScore??50)
  });

  const di=input.decisionIntelligence||{};
  const structureGraph=phase27.build({
    sfp:di.sfp,dLine:di.dLine,goldenPocket:di.goldenPocket,
    fvg:di.fvg,breaker:di.breakers?.nearby?.[0],npoc:di.npoc,
    liquidity:di.liquidity||{}
  });

  const evidence=[
    {label:"FINAL DECISION",weight:candidate==="LONG"?10:candidate==="SHORT"?-10:0},
    {label:"CVD",weight:/BUY/i.test(String(derivatives?.cvdState||""))?12:/SELL/i.test(String(derivatives?.cvdState||""))?-12:0},
    {label:"ORDER FLOW",weight:n(derivatives?.takerImbalance,0)*25},
    {label:"DATA QUALITY",weight:quality.liveEligible?8:-20},
    {label:"STRUCTURE",weight:n(analysis?.confluenceScore,0)>75?12:0}
  ];
  const confluence=phase28.score(evidence);

  const levels=decision.levels||decision.conditionalLevels||{};
  const riskEval=phase30.evaluate({
    riskPct:risk?.riskPct??input.riskPct,
    maxRiskPct:input.maxRiskPct??1,
    dailyDrawdownPct:risk?.dailyDrawdownPct??input.dailyDrawdownPct,
    maxDailyDrawdownPct:input.maxDailyDrawdownPct??3,
    liquidationDistancePct:input.liquidationDistancePct,
    minLiquidationDistancePct:input.minLiquidationDistancePct??0.5,
    openPositions:input.openPositions??0,
    maxPositions:input.maxPositions??3
  });

  const anomaly=phase40.detect({
    priceGapPct:input.priceGapPct,
    maxGapPct:input.maxGapPct,
    dispersionBps:consensus?.priceDispersionBps,
    maxDispersionBps:input.maxDispersionBps??25,
    freshnessMs:input.dataAgeMs,
    maxFreshnessMs:input.maxFreshnessMs??30000,
    volatilityShock:input.volatilityShock,
    maxVolShock:input.maxVolShock??4
  });

  const kill=phase41.evaluate({
    manualStop:Boolean(input.manualStop),
    dataBlocked:!quality.liveEligible,
    riskBlocked:riskEval.blocked,
    modelBlocked:Boolean(input.modelBlocked),
    infrastructureBlocked:Boolean(input.infrastructureBlocked)
  });

  const paperBroker=new PaperBroker();
  const deployment=phase46.gate({
    testsPass:Boolean(input.testsPass),
    healthPass:Boolean(input.healthPass),
    rollbackReady:Boolean(input.rollbackReady),
    canaryErrorRate:n(input.canaryErrorRate,0),
    maxCanaryErrorRate:n(input.maxCanaryErrorRate,1)
  });

  const security=phase45.audit(input.security||{});
  const observability={metrics:metrics.snapshot(),version:"42.0.0"};
  const recovery=phase47.manifest(input.recovery||{});
  const performance=phase48.evaluate(input.performance||{});
  const learning=phase37.evaluate(input.model||{},{
    minSamples:n(input.minLearningSamples,100),
    samples:n(input.learningSamples,0),
    drift:n(input.modelDrift,0),
    maxDrift:n(input.maxModelDrift,.2),
    approvedVersion:Boolean(input.approvedModelVersion)
  });

  const readiness=phase49.gate({
    data:Boolean(quality.liveEligible),
    validation:Boolean(validation?.deploymentGate?.state==="PASS"||validation?.gate==="PASS"),
    robustness:Boolean(input.robustnessPass),
    paperExecution:Boolean(input.paperExecutionPass),
    risk:!riskEval.blocked,
    security:Boolean(security.ok),
    observability:Boolean(input.observabilityPass),
    operations:Boolean(input.operationsPass)
  });

  const live=phase50.state({
    readiness:readiness.ready,
    shadow:input.shadow!==false,
    operatorApproved:Boolean(input.operatorApproved)
  });

  const hardBlockers=[];
  if(!quality.liveEligible)hardBlockers.push("DATA_QUALITY");
  if(riskEval.blocked)hardBlockers.push(...riskEval.reasons);
  if(anomaly.anomalous)hardBlockers.push(...anomaly.blockers);
  if(kill.locked)hardBlockers.push(...kill.reasons);
  if(!readiness.ready)hardBlockers.push(...readiness.blockers);

  metrics.inc("phase_stack_evaluation");
  return {
    version:VERSION,
    snapshotId,
    canonical,
    stateBus:{sequence:envelope.sequence,publishedAt:envelope.publishedAt},
    direction:{candidate,stabilized:hysteresis.side,pending:hysteresis.pending,count:hysteresis.count,reason:hysteresis.reason},
    data:{quality,flow,regime},
    structure:{graph:structureGraph},
    confluence,
    risk:riskEval,
    anomaly,
    killSwitch:kill,
    learning:{guardrails:learning},
    deployment,
    security,
    recovery,
    performance,
    readiness,
    liveController:live,
    diagnostics:{forensicVersion:phase36.VERSION,paperBrokerVersion:paperBroker.snapshot().version,calibrationVersion:phase29.VERSION,walkForwardVersion:phase32.VERSION,monteCarloVersion:phase33.VERSION,executionModelVersion:phase35.VERSION},
    hardBlockers:[...new Set(hardBlockers)],
    safeForLiveExecution:false,
    mode:"DECISION_SUPPORT"
  };
}

function selfTest(){
  const x=evaluate({
    symbol:"BTCUSDT",interval:"15m",price:100,
    decision:{action:"WAIT",market:{price:100}},
    consensus:{consensusQualityPct:100},
    marketState:{summary:{venueCount:3,consensusQuality:100},venues:[
      {exchange:"BINANCE",price:100,imbalance:.1},
      {exchange:"BYBIT",price:100.1,imbalance:.1}
    ]},
    validation:{gate:"BLOCKED"},
    testsPass:true,healthPass:true,rollbackReady:true,
    security:{adminMfa:true,secureCookies:true,csrf:true,rateLimits:true,headers:true,secretsPrivate:true},
    robustnessPass:false,paperExecutionPass:true,observabilityPass:true,operationsPass:true,
    approvedModelVersion:true,learningSamples:200
  });
  return {ok:x.snapshotId&&x.hardBlockers.includes("DATA_QUALITY")===false&&x.readiness.ready===false&&x.safeForLiveExecution===false,version:VERSION};
}

module.exports={VERSION,evaluate,selfTest};
