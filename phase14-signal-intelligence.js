/*
  Phase 14 — Signal Intelligence
  ------------------------------
  Turns the structured knowledge layer into setup-specific, regime-aware
  decision support. It does not create an unconditional trade signal.

  Design:
  - deterministic setup registry
  - knowledge-domain alignment
  - conflict detection / resolution
  - bounded historical calibration from FINAL_GATED outcomes only
  - shadow/signal evidence summaries
  - setup-level walk-forward aggregation
*/

const VERSION="14.0.0";
const MIN_CALIBRATION_SAMPLE=30;
const PROFILE_CACHE_TTL=5*60*1000;
const PROFILE_CACHE=new Map();

const SETUPS={
  SFP:{
    label:"Swing Failure Pattern",
    required:["market-structure","liquidity","sfp","multi-timeframe","cvd","order-flow","risk"],
    bonus:["support-resistance","derivatives","liquidation"],
    rr:3
  },
  LIQUIDITY_SWEEP_RECLAIM:{
    label:"Liquidity Sweep + Reclaim",
    required:["market-structure","liquidity","multi-timeframe","order-flow","cvd","risk"],
    bonus:["support-resistance","derivatives","liquidation","fibonacci"],
    rr:1.8
  },
  NPOC:{
    label:"Naked POC Reaction",
    required:["market-structure","liquidity","support-resistance","sfp","multi-timeframe","risk"],
    bonus:["cvd","order-flow","derivatives"],
    rr:3
  },
  D_LINE_BREAKOUT:{
    label:"D-Line Breakout / Retest",
    required:["market-structure","d-line","multi-timeframe","order-flow","cvd","risk"],
    bonus:["support-resistance","volume-profile"],
    rr:2
  },
  BREAKOUT_RETEST:{
    label:"Breakout / Retest",
    required:["market-structure","liquidity","multi-timeframe","order-flow","cvd","risk"],
    bonus:["support-resistance","derivatives"],
    rr:3
  },
  ORDER_BLOCK:{
    label:"Order Block Rejection",
    required:["market-structure","liquidity","multi-timeframe","order-flow","risk"],
    bonus:["support-resistance","cvd","derivatives"],
    rr:3
  },
  ELLIOTT:{
    label:"Elliott Wave Context",
    required:["market-structure","elliott","fibonacci","multi-timeframe","risk"],
    bonus:["liquidity","cvd","derivatives"],
    rr:1.5
  },
  TREND_CONTINUATION:{
    label:"Trend Continuation",
    required:["market-structure","multi-timeframe","support-resistance","risk"],
    bonus:["derivatives","cvd","order-flow"],
    rr:1.5
  },
  RANGE_REVERSION:{
    label:"Range Reversion",
    required:["market-structure","support-resistance","liquidity","risk"],
    bonus:["volume-profile","cvd","order-flow"],
    rr:1.5
  },
  GENERIC:{
    label:"Generic Directional Setup",
    required:["market-structure","multi-timeframe","risk","backtesting"],
    bonus:["support-resistance","liquidity","derivatives","cvd"],
    rr:1.5
  }
};

function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function n(x,f=null){return Number.isFinite(Number(x))?Number(x):f}
function sideOf(a){const s=String(a?.side||a?.action||"WAIT").toUpperCase();return s==="LONG"||s==="SHORT"?s:"WAIT"}

function normaliseSetupToken(value=""){
  return String(value||"").toUpperCase().replace(/[^A-Z0-9]+/g,"_").replace(/^_+|_+$/g,"");
}
function setupKey(analysis={}){
  const raw=normaliseSetupToken(
    analysis?.strategyFamily||
    analysis?.marketStructure?.setup?.kind||
    analysis?.marketStructure?.strategySetup?.kind||
    analysis?.type||
    ""
  );
  if(raw.includes("LIQUIDITY_SWEEP")||raw.includes("SWEEP_RECLAIM"))return "LIQUIDITY_SWEEP_RECLAIM";
  if(raw.includes("SFP"))return "SFP";
  if(raw.includes("NPOC"))return "NPOC";
  if(raw.includes("D_LINE"))return "D_LINE_BREAKOUT";
  if(raw.includes("ORDER_BLOCK"))return "ORDER_BLOCK";
  if(raw.includes("BREAKOUT_RETEST")||raw.includes("LEVEL RETEST"))return "BREAKOUT_RETEST";
  if(raw.includes("ELLIOTT")||raw.includes("WAVE"))return "ELLIOTT";
  if(raw.includes("RANGE"))return "RANGE_REVERSION";
  if(raw.includes("LONG SETUP")||raw.includes("SHORT SETUP")||raw.includes("CONTINUATION"))return "TREND_CONTINUATION";
  return "GENERIC";
}

function domainIds(knowledgeContext={}){
  return new Set((knowledgeContext.domains||[]).map(x=>String(x?.id||"")));
}

function preferredSetup(setup){return SETUPS[setup]||SETUPS.GENERIC}

function flowSignals(side,deriv={}){
  const cvd=String(deriv.cvdState||"UNKNOWN").toUpperCase();
  const pos=String(deriv.positioning||"UNKNOWN").toUpperCase();
  const liq=String(deriv.liquidationBias||"UNKNOWN").toUpperCase();
  const ob=n(deriv.orderBookImbalance);
  const taker=n(deriv.takerImbalance);
  const out=[];
  if((side==="LONG"&&cvd==="BUYERS CONFIRM")||(side==="SHORT"&&cvd==="SELLERS CONFIRM"))out.push({key:"cvd_confirm",score:8,text:"CVD confirms direction."});
  if((side==="LONG"&&cvd==="BEARISH DIVERGENCE")||(side==="SHORT"&&cvd==="BULLISH DIVERGENCE"))out.push({key:"cvd_conflict",score:-14,text:"CVD diverges against direction."});
  if((side==="LONG"&&pos.includes("LONG PARTICIPATION"))||(side==="LONG"&&pos.includes("SHORT COVERING"))||(side==="SHORT"&&pos.includes("SHORT PARTICIPATION"))||(side==="SHORT"&&pos.includes("LONG LIQUIDATION")))out.push({key:"oi_support",score:6,text:"OI/positioning context supports direction."});
  if((side==="LONG"&&pos.includes("SHORT PARTICIPATION"))||(side==="SHORT"&&pos.includes("LONG PARTICIPATION")))out.push({key:"oi_conflict",score:-6,text:"OI/positioning context conflicts with direction."});
  if((side==="LONG"&&liq==="SHORT LIQS DOMINANT")||(side==="SHORT"&&liq==="LONG LIQS DOMINANT"))out.push({key:"liq_support",score:4,text:"Liquidation context provides directional tailwind."});
  if((side==="LONG"&&liq==="LONG LIQS DOMINANT")||(side==="SHORT"&&liq==="SHORT LIQS DOMINANT"))out.push({key:"liq_conflict",score:-5,text:"Liquidation pressure works against direction."});
  if(ob!==null&&((side==="LONG"&&ob>=.12)||(side==="SHORT"&&ob<=-.12)))out.push({key:"book_support",score:4,text:"Order-book imbalance agrees with direction."});
  if(ob!==null&&((side==="LONG"&&ob<=-.12)||(side==="SHORT"&&ob>=.12)))out.push({key:"book_conflict",score:-4,text:"Order-book imbalance disagrees with direction."});
  if(taker!==null&&((side==="LONG"&&taker>=.08)||(side==="SHORT"&&taker<=-.08)))out.push({key:"taker_support",score:3,text:"Taker flow agrees with direction."});
  if(taker!==null&&((side==="LONG"&&taker<=-.08)||(side==="SHORT"&&taker>=.08)))out.push({key:"taker_conflict",score:-4,text:"Taker flow disagrees with direction."});
  return out;
}

function mtfSignals(side,higher={},lower={}){
  const out=[];
  const h=String(higher?.regime||"UNKNOWN").toUpperCase(),l=String(lower?.regime||"UNKNOWN").toUpperCase();
  if((side==="LONG"&&h==="UPTREND")||(side==="SHORT"&&h==="DOWNTREND"))out.push({key:"htf_support",score:10,text:"Higher-timeframe regime agrees."});
  if((side==="LONG"&&h==="DOWNTREND")||(side==="SHORT"&&h==="UPTREND"))out.push({key:"htf_conflict",score:-18,text:"Higher-timeframe regime conflicts."});
  if((side==="LONG"&&l==="UPTREND")||(side==="SHORT"&&l==="DOWNTREND"))out.push({key:"ltf_support",score:6,text:"Lower-timeframe regime agrees."});
  if((side==="LONG"&&l==="DOWNTREND")||(side==="SHORT"&&l==="UPTREND"))out.push({key:"ltf_conflict",score:-10,text:"Lower-timeframe regime conflicts."});
  return out;
}

function setupSignals(setup,analysis){
  const ms=analysis?.marketStructure?.setup||analysis?.marketStructure?.strategySetup||null;
  const reaction=analysis?.reactionMap?.active||null;
  const out=[];
  if(setup==="SFP"){
    const ready=String(ms?.kind||"").toUpperCase()==="SFP"&&n(ms?.score,0)>=74;
    out.push({key:"sfp_structure",score:ready?10:-4,text:ready?"SFP structure is sufficiently developed.":"SFP structure is not fully confirmed."});
    if(reaction?.action===analysis.side&&/CONFIRM|BREAKOUT|BREAKDOWN/.test(String(reaction.state||"")))out.push({key:"sfp_reaction",score:10,text:"Reaction map confirms the directional reaction."});
    else out.push({key:"sfp_reaction_missing",score:-6,text:"The reaction map does not yet confirm the SFP."});
  }
  if(setup==="LIQUIDITY_SWEEP_RECLAIM"){
    const confirmed=Boolean(
      reaction?.action===analysis.side &&
      /CONFIRM_LONG|CONFIRM_SHORT/.test(String(reaction?.state||"")) &&
      /sweep|reclaim/i.test(String(reaction?.trigger||""))
    );
    out.push({
      key:"liquidity_sweep_reclaim",
      score:confirmed?12:-3,
      text:confirmed
        ?"Liquidity sweep/reclaim is confirmed at the mapped reaction zone."
        :"Waiting for a confirmed liquidity sweep and reclaim."
    });
  }
  if(setup==="NPOC"){
    const ready=String(ms?.kind||"").toUpperCase()==="NPOC"&&n(ms?.score,0)>=80;
    out.push({key:"npoc_structure",score:ready?10:-5,text:ready?"NPOC sweep/reclaim structure is confirmed.":"NPOC reaction is not fully confirmed."});
  }
  if(setup==="D_LINE_BREAKOUT"){
    const check=ms?.checklist||analysis?.marketStructure?.dLine?.checklist||{};
    const pass=Boolean(check?.bodyClose!==false&&check?.timeframePass!==false&&check?.touchesPass!==false);
    out.push({key:"dline_checklist",score:pass?10:-6,text:pass?"D-Line checklist is substantially satisfied.":"D-Line checklist has unresolved requirements."});
    if(check?.touchesPreferred)out.push({key:"dline_touch_quality",score:3,text:"D-Line has preferred trendline touch quality."});
    if(check?.anglePass)out.push({key:"dline_angle",score:2,text:"D-Line angle is within the validated band."});
  }
  if(setup==="BREAKOUT_RETEST"){
    const msReady=n(ms?.score,0)>=80;
    out.push({key:"breakout_structure",score:msReady?7:-4,text:msReady?"Breakout/retest structure is strong.":"Breakout/retest structure is incomplete."});
  }
  if(setup==="ORDER_BLOCK"){
    const msReady=n(ms?.score,0)>=80;
    out.push({key:"ob_structure",score:msReady?7:-4,text:msReady?"Order-block structure is confirmed.":"Order-block structure is not sufficiently confirmed."});
  }
  if(setup==="ELLIOTT"){
    const ec=analysis?.elliottConfluence||{};
    out.push({key:"elliott_context",score:n(ec?.score,0)>=0?Math.round(clamp(n(ec?.score,0),-20,20)/3):-4,text:"Elliott context is included as supporting structure, not an independent trigger."});
  }
  return out;
}

function regimeSignals(side,analysis){
  const regime=String(analysis?.regime||"UNKNOWN").toUpperCase();
  const setup=setupKey(analysis);
  const out=[];
  if(regime==="UPTREND"&&side==="LONG")out.push({key:"regime_long",score:4,text:"Trend regime supports long continuation."});
  if(regime==="DOWNTREND"&&side==="SHORT")out.push({key:"regime_short",score:4,text:"Trend regime supports short continuation."});
  if(regime==="RANGE"){
    if(["RANGE_REVERSION","SFP","NPOC","LIQUIDITY_SWEEP_RECLAIM"].includes(setup))out.push({key:"regime_range_fit",score:4,text:"Setup family is compatible with range conditions."});
    else out.push({key:"regime_range_conflict",score:-4,text:"Continuation setup is operating inside a range regime."});
  }
  if(regime==="HIGH VOLATILITY"){
    out.push({key:"regime_high_vol",score:-8,text:"High-volatility regime reduces tolerance for marginal setup quality."});
  }
  return out;
}

function rangeSignals(side,analysis){
  const out=[];
  const label=String(analysis?.marketStructure?.advancedPriceAction?.dealingRange?.positionLabel||"").toUpperCase();
  if(label==="DISCOUNT"&&side==="LONG")out.push({key:"discount_long",score:5,text:"Price is on the preferred discount side for a long."});
  if(label==="PREMIUM"&&side==="SHORT")out.push({key:"premium_short",score:5,text:"Price is on the preferred premium side for a short."});
  if(label==="PREMIUM"&&side==="LONG")out.push({key:"premium_long_conflict",score:-4,text:"Long is attempting to initiate from premium."});
  if(label==="DISCOUNT"&&side==="SHORT")out.push({key:"discount_short_conflict",score:-4,text:"Short is attempting to initiate from discount."});
  if(analysis?.regime==="HIGH VOLATILITY")out.push({key:"volatility_penalty",score:-8,text:"High volatility reduces the reliability of marginal setups."});
  return out;
}

function buildSignalIntelligence({analysis={},knowledgeContext={},derivatives={},higher={},lower={}}={}){
  const side=sideOf(analysis),setup=setupKey(analysis),profile=preferredSetup(setup);
  const domains=domainIds(knowledgeContext),required=profile.required||[];
  const present=required.filter(x=>domains.has(x)),missing=required.filter(x=>!domains.has(x));
  const domainCoverage=required.length?present.length/required.length:1;
  const signals=[];
  if(side!=="WAIT"){
    signals.push(...mtfSignals(side,higher,lower));
    signals.push(...flowSignals(side,derivatives));
    signals.push(...setupSignals(setup,analysis));
    signals.push(...regimeSignals(side,analysis));
    signals.push(...rangeSignals(side,analysis));
  }
  const rawSignalsScore=signals.reduce((sum,x)=>sum+(Number(x.score)||0),0);
  const coverageScore=Math.round(domainCoverage*10);
  const conflictCount=signals.filter(x=>Number(x.score)<0).length;
  const positiveCount=signals.filter(x=>Number(x.score)>0).length;
  let adjustment=clamp(rawSignalsScore*.35+coverageScore-((missing.length>=2)?4:0),-12,12);
  if(side==="WAIT")adjustment=0;
  const confirmedSweep=Boolean(
    setup==="LIQUIDITY_SWEEP_RECLAIM" &&
    analysis?.reactionMap?.active?.action===side &&
    /CONFIRM_LONG|CONFIRM_SHORT/.test(String(analysis?.reactionMap?.active?.state||""))
  );
  const hardConflicts=signals.filter(x=>
    ["htf_conflict","cvd_conflict"].includes(x.key) &&
    !(x.key==="htf_conflict"&&confirmedSweep)
  );
  const blocks=[];
  if(hardConflicts.length)blocks.push(...hardConflicts.map(x=>x.text));
  if(profile.rr&&n(analysis.rr)!==null&&n(analysis.rr)<profile.rr)blocks.push("Setup-specific minimum R:R is not met.");
  return {
    version:VERSION,setupKey:setup,setupLabel:profile.label,side,
    requiredDomains:required,presentDomains:present,missingDomains:missing,
    domainCoveragePct:Math.round(domainCoverage*100),
    positiveCount,conflictCount,signals,
    rawSignalsScore:Number(rawSignalsScore.toFixed(2)),
    scoreAdjustment:Number(adjustment.toFixed(2)),
    hardConflicts:hardConflicts.map(x=>x.key),
    blocks,
    status:blocks.length?"CAUTION":"ALIGNED"
  };
}

function outcomeStats(rows){
  const resolved=rows.filter(r=>["WIN","LOSS","TARGET_1","STOP"].includes(String(r.outcome||"").toUpperCase()));
  const wins=resolved.filter(r=>["WIN","TARGET_1"].includes(String(r.outcome||"").toUpperCase()));
  const losses=resolved.filter(r=>["LOSS","STOP"].includes(String(r.outcome||"").toUpperCase()));
  const netR=resolved.reduce((s,r)=>s+(n(r.resultR,0)||0),0);
  return {
    n:resolved.length,wins:wins.length,losses:losses.length,
    winRate:resolved.length?wins.length/resolved.length*100:null,
    avgR:resolved.length?netR/resolved.length:null,netR
  };
}

function profileKey(row){
  return [row.setupKey||row.type||"GENERIC",row.regime||"UNKNOWN",row.side||"WAIT"].join("|");
}

function buildAdaptiveProfile(rows=[],opts={}){
  const minSample=Math.max(10,Number(opts.minSample||MIN_CALIBRATION_SAMPLE));
  const groups={};
  for(const row of Array.isArray(rows)?rows:[]){
    if(!row?.outcome)continue;
    const key=profileKey(row),g=groups[key]||(groups[key]=[]);
    g.push(row);
  }
  const profiles={};
  for(const [key,rows0] of Object.entries(groups)){
    const s=outcomeStats(rows0);
    const n0=s.n;
    if(n0<minSample){
      profiles[key]={key,...s,eligible:false,adjustment:0,reason:"insufficient_sample"};
      continue;
    }
    const winAdj=((s.winRate??50)-50)/8;
    const rAdj=(Number(s.avgR||0))*12;
    const adjustment=clamp(Number((0.55*winAdj+0.45*rAdj).toFixed(2)),-4,4);
    profiles[key]={key,...s,eligible:true,adjustment,reason:"sample_sufficient"};
  }
  return {version:VERSION,minSample,profiles,generatedAt:Date.now()};
}

function adaptiveForAnalysis(analysis,profile){
  const key=[setupKey(analysis),analysis?.regime||"UNKNOWN",sideOf(analysis)].join("|");
  const p=profile?.profiles?.[key]||null;
  return {key,sample:p?.n||0,eligible:Boolean(p?.eligible),adjustment:Number(p?.adjustment||0),stats:p?{winRate:p.winRate,avgR:p.avgR,netR:p.netR}:null};
}

function enrichAnalysis(analysis,{knowledgeContext={},derivatives={},higher={},lower={},adaptiveProfile=null}={}){
  const a=JSON.parse(JSON.stringify(analysis||{}));
  const intelligence=buildSignalIntelligence({analysis:a,knowledgeContext,derivatives,higher,lower});
  const adaptive=adaptiveForAnalysis(a,adaptiveProfile||{});
  const before=n(a.score,0);
  const after=clamp(Math.round(before+intelligence.scoreAdjustment+adaptive.adjustment),0,92);
  a.score=after;
  const knowledgeValue=clamp(Math.round(50+intelligence.scoreAdjustment*4),0,100);
  a.components=Array.isArray(a.components)?a.components:[];
  a.components=a.components.filter(x=>x?.name!=="Knowledge alignment");
  a.components.push({name:"Knowledge alignment",value:Math.round(knowledgeValue/10),max:10,source:"Phase 14 setup-specific knowledge, context and conflict engine"});
  a.contributors=Array.isArray(a.contributors)?a.contributors.slice():[];
  if(Math.abs(intelligence.scoreAdjustment)>=1)a.contributors.push("knowledge intelligence "+(intelligence.scoreAdjustment>0?"+":"")+intelligence.scoreAdjustment.toFixed(1));
  if(Math.abs(adaptive.adjustment)>=0.1)a.contributors.push("historical setup calibration "+(adaptive.adjustment>0?"+":"")+adaptive.adjustment.toFixed(1));
  a.reasons=Array.isArray(a.reasons)?a.reasons.slice():[];
  for(const x of intelligence.signals.filter(x=>Number(x.score)!==0).slice(0,5))if(!a.reasons.includes(x.text))a.reasons.push(x.text);
  const rr=n(a.rr);
  if(a.side!=="WAIT"){
    const hardHigher=(a.mtf?.higher==="DOWNTREND"&&a.side==="LONG")||(a.mtf?.higher==="UPTREND"&&a.side==="SHORT");
    const confirmedSweep=Boolean(
      intelligence.setupKey==="LIQUIDITY_SWEEP_RECLAIM" &&
      a.reactionMap?.active?.action===a.side &&
      /CONFIRM_LONG|CONFIRM_SHORT/.test(String(a.reactionMap?.active?.state||""))
    );
    const setup=preferredSetup(intelligence.setupKey);
    const higherBlock=hardHigher&&!confirmedSweep;
    if(after>=72&&rr!==null&&rr>=setup.rr&&!higherBlock&&intelligence.blocks.length===0)a.status="READY";
    else if(after>=55)a.status="WATCH";
    else a.status="WAITING";
  }
  a.probabilityLabel=after>=80?"HIGH CONFLUENCE":after>=68?"MODERATE-HIGH CONFLUENCE":after>=55?"EARLY / WATCH":"LOW CONFLUENCE";
  a.phase14={version:VERSION,intelligence,adaptive,mode:"RULES_PLUS_BOUNDED_HISTORICAL_CALIBRATION"};
  a.thesisParts=Array.isArray(a.thesisParts)?a.thesisParts.slice():[];
  a.thesisParts.push(
    "Phase 14 knowledge alignment: "+intelligence.status+
    " ("+intelligence.domainCoveragePct+"% required-domain coverage, "+intelligence.conflictCount+" conflict flags)."
  );
  a.thesis=a.thesisParts.join(" ");
  return a;
}

function aggregateSetupBuckets(rows=[]){
  const groups={};
  for(const row of Array.isArray(rows)?rows:[]){
    const key=String(row.setupKey||row.type||"GENERIC").toUpperCase();
    (groups[key]||(groups[key]=[])).push(row);
  }
  return Object.fromEntries(Object.entries(groups).map(([key,rows0])=>{
    const s=outcomeStats(rows0);
    return [key,{setupKey:key,...s,coverage:rows0.length,side:{LONG:outcomeStats(rows0.filter(x=>x.side==="LONG")),SHORT:outcomeStats(rows0.filter(x=>x.side==="SHORT"))},regimes:Object.fromEntries([...new Set(rows0.map(x=>x.regime||"UNKNOWN"))].map(reg=>[reg,outcomeStats(rows0.filter(x=>(x.regime||"UNKNOWN")===reg))]))}];
  }));
}

function aggregateRegimeBuckets(rows=[]){
  const groups={};
  for(const row of Array.isArray(rows)?rows:[]){
    const key=String(row.regime||"UNKNOWN");(groups[key]||(groups[key]=[])).push(row);
  }
  return Object.fromEntries(Object.entries(groups).map(([key,rows0])=>[key,{regime:key,...outcomeStats(rows0),coverage:rows0.length}]));
}

function summariseValidation(validation={}){
  const setupBuckets=validation.setupBuckets||{};
  const ready=Object.values(setupBuckets).filter(x=>Number(x.n)>=MIN_CALIBRATION_SAMPLE);
  return {
    phase14:VERSION,
    sufficientSetupSamples:ready.length,
    setupBuckets,
    regimeBuckets:validation.regimeBuckets||{},
    method:"Phase 14 uses the Phase 11/12 rolling walk-forward replay; no future candles are used to construct each signal window."
  };
}

async function getAdaptiveProfile(storage,opts={}){
  const now=Date.now(),symbol=opts.symbol||"",interval=opts.interval||"";
  const key=[symbol,interval].join("|");
  const hit=PROFILE_CACHE.get(key);
  if(hit&&now-hit.ts<PROFILE_CACHE_TTL)return hit.profile;
  const rows=await storage.getLearningPredictions({symbol:symbol||null,interval:interval||null,limit:Number(opts.limit||5000),resolvedOnly:true});
  const normalized=rows.map(r=>{
    const f=r.features&&typeof r.features==="object"?r.features:{};
    return {
      outcome:r.outcome||null,resultR:n(r.resultR,0),setupKey:String(f.setupKey||r.type||"GENERIC").toUpperCase(),
      type:r.type||f.type||"UNKNOWN",regime:r.regime||f.regime||"UNKNOWN",side:r.side||f.side||"WAIT",
      score:n(r.score,0)
    };
  });
  const profile=buildAdaptiveProfile(normalized,opts);
  PROFILE_CACHE.set(key,{ts:now,profile});
  return profile;
}

async function refreshAdaptiveState(storage,opts={}){
  const profile=await getAdaptiveProfile(storage,opts);
  const current=await storage.getLearningState();
  const payload=current?.payload&&typeof current.payload==="object"?current.payload:{};
  await storage.saveLearningState({...payload,phase14:{...profile,storedAt:Date.now()}});
  return profile;
}

function shadowRecord(decision){
  const d=decision||{},m=d.market||{},lv=d.levels||{},p=d.phase14||{};
  return {
    source:"PHASE14_SHADOW",
    signalKey:["P14",d.symbol||"BTCUSDT",d.interval||"1h",m.type||"NONE",m.side||"WAIT"].join("|"),
    ts:Date.now(),symbol:d.symbol||"BTCUSDT",interval:d.interval||"1h",
    side:m.side||d.action||"WAIT",type:m.type||"NO TRADE",regime:m.regime||"UNKNOWN",
    score:n(m.confluenceScore,0),entry:n(lv.entry),stop:n(lv.stop),target:n(lv.tp1),
    setupKey:p.intelligence?.setupKey||"GENERIC",knowledgeScore:p.intelligence?.domainCoveragePct??null,
    intelligence:p.intelligence||null,adaptive:p.adaptive||null
  };
}

function selfTest(){
  const base={
    side:"LONG",status:"READY",score:78,rr:3,regime:"UPTREND",strategyFamily:"SFP",
    mtf:{higher:"UPTREND",lower:"UPTREND"},
    components:[],reasons:[],contributors:[],
    marketStructure:{score:90,setup:{kind:"SFP",side:"LONG",score:88},advancedPriceAction:{dealingRange:{positionLabel:"DISCOUNT"}}},
    reactionMap:{active:{action:"LONG",state:"CONFIRM_LONG",confidence:90}},
    derivatives:{cvdState:"BUYERS CONFIRM",positioning:"PRICE + OI: LONG PARTICIPATION",liquidationBias:"SHORT LIQS DOMINANT",orderBookImbalance:.15,takerImbalance:.1}
  };
  const kc={domains:(SETUPS.SFP.required||[]).map(id=>({id}))};
  const intelligence=buildSignalIntelligence({analysis:base,knowledgeContext:kc,derivatives:base.derivatives,higher:{regime:"UPTREND"},lower:{regime:"UPTREND"}});
  const enriched=enrichAnalysis(base,{knowledgeContext:kc,derivatives:base.derivatives,higher:{regime:"UPTREND"},lower:{regime:"UPTREND"}});
  return {ok:intelligence.scoreAdjustment>0&&enriched.phase14?.intelligence?.setupKey==="SFP"&&enriched.score>=78,summary:{setup:intelligence.setupKey,adjustment:intelligence.scoreAdjustment,score:enriched.score}};
}

module.exports={VERSION,SETUPS,setupKey,buildSignalIntelligence,buildAdaptiveProfile,adaptiveForAnalysis,enrichAnalysis,aggregateSetupBuckets,aggregateRegimeBuckets,summariseValidation,getAdaptiveProfile,refreshAdaptiveState,shadowRecord,outcomeStats,selfTest};
