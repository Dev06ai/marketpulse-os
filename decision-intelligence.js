/*
 * Decision Center Strategy Intelligence
 * ------------------------------------
 * Normalizes the strategy/price-action evidence that already exists in
 * MarketPulse into one explainable payload for the Decision Center.
 *
 * This layer is explanatory and safety-preserving:
 * it never upgrades a setup to executable by itself.
 */

const n=(x,d=null)=>Number.isFinite(Number(x))?Number(x):d;
const text=(x,fallback="UNKNOWN")=>{
  const s=String(x??"").trim();
  return s?s:fallback;
};
const sideOf=s=>{
  s=String(s||"").toUpperCase();
  return ["LONG","SHORT"].includes(s)?s:"WAIT";
};
const zone=(z,label)=>{
  if(!z||typeof z!=="object")return null;
  const low=n(z.low),high=n(z.high);
  if(low===null||high===null)return null;
  return {
    label:label||text(z.label,"ZONE"),
    low:Math.min(low,high),
    high:Math.max(low,high)
  };
};
const firstZone=(...zs)=>zs.find(Boolean)||null;

function buildDecisionIntelligence({analysis={},decision={}}={}){
  const a=analysis||{},m=a.marketStructure||{},adv=a.advancedPriceAction||{},elliott=a.elliottWave||{};
  const reaction=a.reactionMap||{},activeReaction=reaction.active||null;
  const setup=m.strategySetup||m.setup||null;
  const dline=m.dLine||a.strategyFamily==="D_LINE_BREAKOUT"?m.strategySetup:null;
  const activeSide=sideOf(decision?.action||decision?.rawAction||a.side);
  const structuralSide=sideOf(setup?.side||a.side);

  const setupKind=text(setup?.kind||a.strategyFamily||"NONE","NONE").toUpperCase();
  const setupLabel={
    SFP:"SWING FAILURE PATTERN",
    NPOC:"NAKED POC SFP",
    D_LINE_BREAKOUT:"D-LINE BREAKOUT / RETEST",
    BREAKOUT_RETEST:"BREAKOUT RETEST",
    ORDER_BLOCK:"ORDER BLOCK",
    LIQUIDITY_SWEEP_RECLAIM:"LIQUIDITY SWEEP + RECLAIM"
  }[setupKind]||text(setup?.kind||a.type||"NO ACTIVE SETUP","NO ACTIVE SETUP");

  const sfp=(
    setupKind==="SFP"||setupKind==="NPOC"||
    String(activeReaction?.state||"").toUpperCase().includes("CONFIRM")
  ) ? {
    detected:true,
    kind:setupKind==="NPOC"?"NPOC SFP":"SFP",
    side:sideOf(setup?.side||activeReaction?.action),
    score:n(setup?.score||activeReaction?.confidence),
    sweptLevel:n(setup?.levelPrice||setup?.price||activeReaction?.center),
    sweepExtreme:n(setup?.sweepPrice||activeReaction?.price),
    reclaim:text(activeReaction?.state||setup?.reason,"SWEEP + CLOSE-BACK"),
    rule:"Sweep a defined liquidity/structural extreme, then close back inside the prior structure.",
    invalidation:n(activeReaction?.invalidation)||(
      sideOf(setup?.side||activeReaction?.action)==="LONG"
        ?n(setup?.sourceLow)||n(m.nearestSupport)
        :n(setup?.sourceHigh)||n(m.nearestResistance)
    )
  } : {
    detected:false,
    kind:"SFP",
    side:"WAIT",
    rule:"Requires a defined swing/level sweep followed by a close back inside the prior structure.",
    invalidation:null
  };

  const dLineData=dline||a.strategySetup||null;
  const dLineInfo=(
    dLineData&&String(dLineData.kind||"").toUpperCase()==="D_LINE_BREAKOUT"
  ) ? {
    detected:true,
    side:sideOf(dLineData.side),
    mode:text(dLineData.entryMode),
    lineType:text(dLineData.lineType),
    timeframe:text(dLineData.timeframe),
    touches:n(dLineData.trendTouches,0),
    angleDeg:n(dLineData.angleDeg),
    pivot1:n(dLineData.pivot1?.p),
    pivot2:n(dLineData.pivot2?.p),
    bodyClose:Boolean(dLineData.checklist?.bodyCloseConfirmed),
    biggerTrend:text(dLineData.checklist?.biggerTrend),
    checklist:dLineData.checklist||null,
    rule:"Require a structural D-Line break or retest, body-close confirmation and higher-timeframe alignment; do not equate the first candle outside the line with acceptance.",
    invalidation:sideOf(dLineData.side)==="LONG"
      ?n(dLineData.recentLow)||n(m.nearestSupport)
      :n(dLineData.recentHigh)||n(m.nearestResistance)
  } : {
    detected:false,
    side:"WAIT",
    mode:"NONE",
    rule:"Requires a qualified D-Line breakout/retest with structural and higher-timeframe confirmation.",
    invalidation:null
  };

  const gp=elliott?.goldenPocket||null;
  const goldenPocket={
    detected:Boolean(gp),
    direction:elliott?.active?.direction||"UNKNOWN",
    protocolA:zone(gp?.protocolA),
    protocolB:zone(gp?.protocolB),
    invalidation:n(gp?.invalidation),
    rule:"0.618–0.65 is the Golden Pocket reference in the loaded Elliott protocol. It is confluence, not a standalone trade trigger.",
    activeWaveScore:n(elliott?.active?.score)
  };

  const fvg=adv.activeFvg&&typeof adv.activeFvg==="object"?adv.activeFvg:null;
  const breakers=Array.isArray(adv.nearbyBreakers)?adv.nearbyBreakers:[];
  const liquidity=adv.liquidity&&typeof adv.liquidity==="object"?adv.liquidity:{};
  const dealingRange=adv.dealingRange&&typeof adv.dealingRange==="object"?adv.dealingRange:null;

  const primaryInvalidation=
    n(decision?.levels?.stop) ??
    n(decision?.conditionalLevels?.stop) ??
    n(decision?.candidateEvidence?.levels?.stop) ??
    n(sfp.invalidation) ??
    n(dLineInfo.invalidation) ??
    n(goldenPocket.invalidation);

  const invalidation={
    primary:primaryInvalidation,
    side:activeSide!=="WAIT"?activeSide:structuralSide,
    source:decision?.levels?.stop!=null?"FINAL DECISION LEVEL":
      decision?.conditionalLevels?.stop!=null?"CONDITIONAL TRADE MAP":
      sfp.invalidation!=null?"SFP / LIQUIDITY EXTREME":
      dLineInfo.invalidation!=null?"D-LINE STRUCTURE":
      goldenPocket.invalidation!=null?"GOLDEN POCKET / WAVE RULE":"STRUCTURE",
    rules:[
      "Invalidate the specific thesis at the structural boundary that the setup depends on.",
      "A wick through a level is not the same as structural invalidation; use the configured close/zone rule for the setup.",
      "Stop placement comes before position sizing."
    ],
    details:activeSide==="LONG"
      ?"LONG thesis fails if the protected structural/entry condition is lost at the defined invalidation boundary."
      :activeSide==="SHORT"
        ?"SHORT thesis fails if the protected structural/entry condition is reclaimed at the defined invalidation boundary."
        :"No directional invalidation is active because the final decision is WAIT."
  };

  const confluence=[
    {key:"MARKET STRUCTURE",value:text(a.structure),status:"CONTEXT"},
    {key:"HTF",value:text(a.mtf?.higher),status:"CONTEXT"},
    {key:"LTF",value:text(a.mtf?.lower),status:"CONTEXT"},
    {key:"SFP",value:sfp.detected?sfp.side+" · "+(n(sfp.score)!==null?n(sfp.score)+"":"DETECTED"):"NOT DETECTED",status:sfp.detected?"ACTIVE":"NONE"},
    {key:"D-LINE",value:dLineInfo.detected?dLineInfo.side+" · "+dLineInfo.mode:"NOT DETECTED",status:dLineInfo.detected?"ACTIVE":"NONE"},
    {key:"GOLDEN POCKET",value:goldenPocket.detected?"0.618–0.65 reference":"NOT AVAILABLE",status:goldenPocket.detected?"CONTEXT":"NONE"},
    {key:"FVG",value:fvg?text(fvg.state||fvg.label||"ACTIVE FVG"):"NONE",status:fvg?"ACTIVE":"NONE"},
    {key:"BREAKERS",value:breakers.length?String(breakers.length)+" nearby":"NONE",status:breakers.length?"ACTIVE":"NONE"},
    {key:"LIQUIDITY",value:text(liquidity.summary||liquidity.bias||"STRUCTURAL POOLS"),status:Object.keys(liquidity).length?"CONTEXT":"NONE"}
  ];

  const activeConcepts=[
    sfp.detected?"SFP":"NULL",
    dLineInfo.detected?"D-LINE":"NULL",
    goldenPocket.detected?"GOLDEN POCKET":"NULL",
    fvg?"FVG":"NULL",
    breakers.length?"BREAKER":"NULL",
    activeReaction?"REACTION MAP":"NULL"
  ].filter(x=>x!=="NULL");

  return {
    version:"1.0.0",
    setup:{kind:setupKind,label:setupLabel,side:sideOf(setup?.side||a.side),score:n(setup?.score)},
    activeConcepts,
    sfp,
    dLine:dLineInfo,
    goldenPocket,
    fvg:{detected:Boolean(fvg),data:fvg,rule:"3-candle non-overlap imbalance; the loaded framework uses 50% mitigation with higher-timeframe alignment."},
    breakers:{count:breakers.length,nearby:breakers.slice(0,4)},
    liquidity:{data:liquidity,dealingRange,rule:"Map resting liquidity around structural extremes; premium/discount is context, not a standalone trigger."},
    invalidation,
    confluence,
    explanation:activeConcepts.length
      ?("Decision context currently has: "+activeConcepts.join(", ")+". These are evidence modules; the final gate still controls executable direction.")
      :"No specialized setup module is currently active. Market structure, flow and higher-timeframe context remain the base frame.",
    executable:Boolean(decision?.liveSignalEligible===true&&decision?.state==="READY"&&["LONG","SHORT"].includes(String(decision?.action||"").toUpperCase())),
    informationalBias:activeSide==="WAIT"?structuralSide:activeSide
  };
}

function selfTest(){
  const x=buildDecisionIntelligence({
    analysis:{
      side:"LONG",structure:"HIGHER HIGHS",mtf:{higher:"UPTREND",lower:"UPTREND"},
      marketStructure:{setup:{kind:"SFP",side:"LONG",score:86,sourceLow:95}},
      advancedPriceAction:{dealingRange:{positionLabel:"DISCOUNT"}},
      elliottWave:{goldenPocket:{protocolA:{low:101,high:102,label:"0.618–0.65 Golden Pocket"},invalidation:94}}
    },
    decision:{action:"WAIT",state:"NO_TRADE",conditionalLevels:{stop:94}}
  });
  return Boolean(x.sfp.detected&&x.goldenPocket.detected&&x.invalidation.primary===94);
}

module.exports={VERSION:"1.0.0",buildDecisionIntelligence,selfTest};
