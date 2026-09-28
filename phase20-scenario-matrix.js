/*
 * MarketPulse Phase 20 — Scenario Matrix & Decision Forensics
 * -----------------------------------------------------------
 * Converts the existing MarketPulse evidence stack into a compact,
 * deterministic "what must happen next?" map.
 *
 * Phase 20 is observational and safety-preserving:
 * - It never promotes WAIT to LONG/SHORT.
 * - It never creates an executable entry/SL/TP.
 * - It uses the same final decision + strategy intelligence snapshot.
 * - It emits a snapshot hash so UI surfaces can prove they are rendering
 *   the same decision context.
 */

const crypto=require("crypto");
const VERSION="20.0.0";

function n(x,d=null){const v=Number(x);return Number.isFinite(v)?v:d}
function s(x,d="UNKNOWN"){const v=String(x??"").trim();return v?v:d}
function sideOf(x){
  const v=String(x||"").toUpperCase();
  return v==="LONG"||v==="SHORT"?v:"WAIT";
}
function has(re, value){return re.test(String(value||"").toUpperCase())}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function uniq(a){return [...new Set((Array.isArray(a)?a:[]).filter(Boolean))]}

function flowState(decision={}){
  const d=decision?.derivatives||decision?.analysis?.derivatives||{};
  return {
    cvd:s(d.cvdState,"UNKNOWN").toUpperCase(),
    positioning:s(d.positioning,"UNKNOWN").toUpperCase(),
    liquidation:s(d.liquidationBias,"UNKNOWN").toUpperCase(),
    orderBook:n(d.orderBookImbalance),
    taker:n(d.takerImbalance),
    oi:n(d.oiChangePct)
  };
}

function structureState(analysis={},intel={}){
  const ms=analysis?.marketStructure||{};
  const setup=ms?.setup||ms?.strategySetup||{};
  const reaction=analysis?.reactionMap?.active||{};
  const gp=intel?.goldenPocket||{};
  const dl=intel?.dLine||{};
  const sfp=intel?.sfp||{};
  return {
    regime:s(analysis?.regime||analysis?.marketStructure?.regime,"UNKNOWN").toUpperCase(),
    htf:s(analysis?.mtf?.higher,"UNKNOWN").toUpperCase(),
    ltf:s(analysis?.mtf?.lower,"UNKNOWN").toUpperCase(),
    setupKind:s(setup?.kind||analysis?.strategyFamily||intel?.setup?.kind,"NONE").toUpperCase(),
    setupSide:sideOf(setup?.side||analysis?.side),
    setupScore:n(setup?.score,0),
    reactionState:s(reaction?.state,"UNKNOWN").toUpperCase(),
    reactionSide:sideOf(reaction?.action),
    sfpDetected:Boolean(sfp?.detected),
    dlineDetected:Boolean(dl?.detected),
    goldenPocketDetected:Boolean(gp?.detected),
    goldenPocketDirection:sideOf(gp?.direction),
    invalidation:n(intel?.invalidation?.primary)
  };
}

function evidenceForSide(side,st,flow,intel,decision){
  const positive=[],negative=[],next=[],invalidate=[];
  let score=0;

  if((side==="LONG"&&st.htf==="UPTREND")||(side==="SHORT"&&st.htf==="DOWNTREND")){
    score+=18;positive.push("Higher-timeframe structure agrees.");
  }else if((side==="LONG"&&st.htf==="DOWNTREND")||(side==="SHORT"&&st.htf==="UPTREND")){
    score-=24;negative.push("Higher-timeframe structure conflicts.");
  }else next.push("Wait for the higher-timeframe structure to align or a qualified reversal condition.");

  if((side==="LONG"&&st.ltf==="UPTREND")||(side==="SHORT"&&st.ltf==="DOWNTREND")){
    score+=10;positive.push("Lower-timeframe structure agrees.");
  }else if((side==="LONG"&&st.ltf==="DOWNTREND")||(side==="SHORT"&&st.ltf==="UPTREND")){
    score-=12;negative.push("Lower-timeframe structure conflicts.");
  }else next.push("Wait for lower-timeframe confirmation.");

  if(side==="LONG"&&has(/BUYERS CONFIRM|BULLISH/,flow.cvd)){
    score+=14;positive.push("CVD is directionally supportive.");
  }else if(side==="SHORT"&&has(/SELLERS CONFIRM|BEARISH/,flow.cvd)){
    score+=14;positive.push("CVD is directionally supportive.");
  }else if(side==="LONG"&&has(/SELLERS|BEARISH/,flow.cvd)){
    score-=14;negative.push("CVD is opposing the long case.");
  }else if(side==="SHORT"&&has(/BUYERS|BULLISH/,flow.cvd)){
    score-=14;negative.push("CVD is opposing the short case.");
  }else next.push("Wait for a cleaner CVD confirmation.");

  if(flow.orderBook!==null){
    const ok=side==="LONG"?flow.orderBook>=0.08:flow.orderBook<=-0.08;
    const bad=side==="LONG"?flow.orderBook<=-0.08:flow.orderBook>=0.08;
    if(ok){score+=8;positive.push("Order-book imbalance agrees.");}
    else if(bad){score-=8;negative.push("Order-book imbalance conflicts.");}
    else next.push("Wait for order-book pressure to align.");
  }

  if(flow.taker!==null){
    const ok=side==="LONG"?flow.taker>=0.06:flow.taker<=-0.06;
    const bad=side==="LONG"?flow.taker<=-0.06:flow.taker>=0.06;
    if(ok){score+=5;positive.push("Taker flow agrees.");}
    else if(bad){score-=5;negative.push("Taker flow conflicts.");}
  }

  if((side==="LONG"&&flow.liquidation.includes("SHORT LIQS"))||(side==="SHORT"&&flow.liquidation.includes("LONG LIQS"))){
    score+=5;positive.push("Liquidation context provides directional support.");
  }

  if(st.sfpDetected&&st.setupSide===side){
    score+=10;positive.push("SFP evidence is present for this side.");
  }
  if(st.dlineDetected&&st.setupSide===side){
    score+=9;positive.push("D-Line evidence is present for this side.");
  }
  if(st.goldenPocketDetected&&st.goldenPocketDirection===side){
    score+=7;positive.push("Golden Pocket context supports this side.");
  }

  const setupMatches=st.setupSide===side;
  if(setupMatches&&st.setupScore>=74){
    score+=8;positive.push("Primary strategy setup is sufficiently developed.");
  }else if(setupMatches&&st.setupScore>0){
    next.push("Let the primary setup complete its confirmation checklist.");
  }

  const gate=String(decision?.deploymentGate?.state||"PAPER_ONLY").toUpperCase();
  const finalReady=Boolean(
    decision?.liveSignalEligible===true &&
    decision?.state==="READY" &&
    sideOf(decision?.action)===side &&
    String(decision?.signalStability?.state||"").toUpperCase()==="CONFIRMED"
  );

  if(gate==="BLOCKED"){
    score-=18;negative.push("Final deployment gate is blocked.");
    next.push("Clear the final data, validation and risk gates.");
  }
  if(decision?.stale===true){
    score-=30;negative.push("Decision snapshot is stale.");
    next.push("Refresh the canonical market snapshot.");
  }
  const rr=n(decision?.levels?.rr);
  if(finalReady&&rr!==null&&rr>=1.5){
    score+=8;positive.push("Final trade map satisfies the configured minimum R:R.");
  }else if(finalReady&&rr!==null&&rr<1.5){
    score-=18;negative.push("Final trade map fails the configured minimum R:R.");
    invalidate.push("Do not authorize the setup unless the validated trade-level builder produces an acceptable R:R.");
  }else{
    next.push("Wait for the final trade-level builder and safety gates to confirm.");
  }

  invalidate.push(
    side==="LONG"
      ?"Invalidate the long thesis if its protected structural boundary is lost."
      :"Invalidate the short thesis if its protected structural boundary is reclaimed."
  );

  const clipped=clamp(score,-100,100);
  const status=
    finalReady&&clipped>=55?"CONFIRMED":
    clipped>=35?"DEVELOPING":
    clipped<=-20?"BLOCKED":"WATCH";

  return {
    side,alignmentScore:clipped,status,
    evidence:positive.slice(0,6),
    conflicts:negative.slice(0,5),
    nextConfirmations:uniq(next).slice(0,5),
    invalidationRules:uniq(invalidate).slice(0,4),
    finalReady
  };
}

function makeSnapshotHash(input){
  const canonical={
    ts:Number(input?.ts||0),
    symbol:s(input?.symbol,"UNKNOWN"),
    interval:s(input?.interval,"UNKNOWN"),
    price:n(input?.price),
    decisionAction:sideOf(input?.decision?.action),
    decisionState:s(input?.decision?.state),
    signalStability:input?.decision?.signalStability||null,
    levels:input?.decision?.levels||null,
    analysis:{
      regime:input?.structure?.regime,
      htf:input?.structure?.htf,
      ltf:input?.structure?.ltf,
      setupKind:input?.structure?.setupKind,
      setupSide:input?.structure?.setupSide,
      setupScore:input?.structure?.setupScore
    },
    flow:input?.flow||null
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0,20).toUpperCase();
}

function buildScenarioMatrix({symbol,interval,price,decision={},analysis={},decisionIntelligence=null,marketState=null,ts=Date.now()}={}){
  const d=decision||{},flow=flowState({derivatives:d.derivatives||analysis?.derivatives||{}});
  const st=structureState(analysis,decisionIntelligence||{});
  const long=evidenceForSide("LONG",st,flow,decisionIntelligence,d);
  const short=evidenceForSide("SHORT",st,flow,decisionIntelligence,d);

  const action=sideOf(d.action);
  const executable=Boolean(
    d.liveSignalEligible===true &&
    d.state==="READY" &&
    ["LONG","SHORT"].includes(action) &&
    String(d.signalStability?.state||"").toUpperCase()==="CONFIRMED"
  );

  const waitReasons=uniq([
    ...(Array.isArray(d.reasons)?d.reasons:[]),
    ...(Array.isArray(d.contributors)?d.contributors.filter(x=>/block|wait|conflict|below|gate/i.test(String(x))):[]),
    String(d.deploymentGate?.reason||"")
  ]).filter(Boolean).slice(0,6);

  const rangeCompatible=["RANGE","CHOPPY"].includes(st.regime);
  const wait={
    side:"WAIT",
    status:executable?"INACTIVE":(rangeCompatible||waitReasons.length?"ACTIVE":"WATCH"),
    alignmentScore:clamp(100-Math.max(long.alignmentScore,short.alignmentScore),-100,100),
    evidence:[
      rangeCompatible?"Range/choppy context favors waiting for reaction confirmation.":"Final decision is not executable.",
      ...(waitReasons.length?waitReasons:["No final authorization is currently present."])
    ].slice(0,5),
    nextConfirmations:uniq([
      "One side must satisfy the final confirmation chain.",
      "Entry must be produced by the authoritative trade-level builder.",
      "All data, validation and risk gates must clear.",
      ...long.nextConfirmations.slice(0,1),
      ...short.nextConfirmations.slice(0,1)
    ]).slice(0,5),
    invalidationRules:["No active trade invalidation exists while the final decision is WAIT."]
  };

  const activeScenario=executable
    ?(action==="LONG"?long:short)
    :wait;

  const transition={
    currentState:executable?action:"WAIT",
    longTrigger:long.nextConfirmations.slice(0,3),
    shortTrigger:short.nextConfirmations.slice(0,3),
    waitCondition:wait.nextConfirmations.slice(0,4),
    hardLock:!executable
      ? "WAIT is authoritative until the final server-side decision becomes confirmed."
      : "Confirmed direction remains authoritative until its invalidation or final gate fails."
  };

  const hash=makeSnapshotHash({
    ts,symbol,interval,price,decision:d,structure:st,flow
  });

  return {
    version:VERSION,
    symbol:s(symbol),
    interval:s(interval),
    generatedAt:ts,
    snapshotId:hash,
    canonical:{
      price:n(price),
      regime:st.regime,
      htf:st.htf,
      ltf:st.ltf,
      flow:{
        cvd:flow.cvd,
        orderBook:flow.orderBook,
        taker:flow.taker,
        liquidation:flow.liquidation
      }
    },
    state:{
      action:executable?action:"WAIT",
      state:executable?"CONFIRMED":"WAIT",
      executable,
      gate:String(d.deploymentGate?.state||"PAPER_ONLY").toUpperCase(),
      stability:String(d.signalStability?.state||"UNKNOWN").toUpperCase()
    },
    scenarios:{
      long,
      short,
      wait
    },
    activeScenario:{
      side:activeScenario.side,
      status:activeScenario.status,
      alignmentScore:activeScenario.alignmentScore,
      evidence:activeScenario.evidence,
      nextConfirmations:activeScenario.nextConfirmations,
      invalidationRules:activeScenario.invalidationRules
    },
    transition,
    integrity:{
      source:"AUTHORITATIVE FINAL DECISION + PHASE 14 STRATEGY INTELLIGENCE",
      snapshotId:hash,
      fields:["price","market regime","HTF/LTF structure","CVD","order book","taker flow","liquidation context","strategy setup","final gate","signal stability"],
      sameSnapshot:true
    },
    notes:[
      "Scenario alignment is evidence aggregation, not a guaranteed probability.",
      "WAIT never inherits an executable LONG/SHORT trade map.",
      "Phase 20 does not bypass validation, risk, paper-only or execution gates."
    ],
    marketState:marketState?.summary?{
      consensusQuality:n(marketState.summary.consensusQuality),
      dispersionBps:n(marketState.summary.dispersionBps),
      venuesHealthy:n(marketState.summary.healthyVenues)
    }:null
  };
}

function selfTest(){
  const decision={
    action:"WAIT",state:"NO_TRADE",liveSignalEligible:false,
    deploymentGate:{state:"BLOCKED",reason:"Final gate blocked"},
    signalStability:{state:"RELEASED"},
    levels:{},
    derivatives:{cvdState:"SELLERS CONFIRM",orderBookImbalance:-.11,takerImbalance:-.08,liquidationBias:"LONG LIQS DOMINANT"}
  };
  const analysis={
    side:"SHORT",regime:"DOWNTREND",strategyFamily:"SFP",
    mtf:{higher:"DOWNTREND",lower:"DOWNTREND"},
    marketStructure:{setup:{kind:"SFP",side:"SHORT",score:82}},
    reactionMap:{active:{action:"SHORT",state:"CONFIRM_SHORT"}}
  };
  const intel={sfp:{detected:true},dLine:{detected:false},goldenPocket:{detected:false},invalidation:{primary:105}};
  const out=buildScenarioMatrix({symbol:"BTCUSDT",interval:"1h",price:100,decision,analysis,decisionIntelligence:intel,ts:123});
  return {
    ok:out.snapshotId.length===20&&out.state.action==="WAIT"&&out.scenarios.long.side==="LONG"&&out.scenarios.short.side==="SHORT"&&out.scenarios.wait.side==="WAIT"&&out.integrity.sameSnapshot===true,
    snapshotId:out.snapshotId,
    active:out.activeScenario
  };
}

module.exports={VERSION,buildScenarioMatrix,makeSnapshotHash,selfTest};
