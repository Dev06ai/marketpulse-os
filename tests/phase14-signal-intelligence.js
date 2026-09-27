const assert=require("assert");
const p14=require("../phase14-signal-intelligence");

assert(p14.VERSION==="14.0.0","Phase 14 version missing");
assert(p14.SETUPS.SFP.required.includes("sfp"),"SFP registry missing its defining knowledge domain");
assert(p14.SETUPS.D_LINE_BREAKOUT.required.includes("d-line"),"D-Line registry missing D-Line knowledge");
assert(p14.setupKey({strategyFamily:"D_LINE_BREAKOUT"})==="D_LINE_BREAKOUT","setup detection failed");
assert(p14.setupKey({type:"1H SFP LONG"})==="SFP","SFP type detection failed");

const analysis={
  side:"LONG",status:"READY",score:78,rr:3,regime:"UPTREND",strategyFamily:"SFP",
  type:"SFP LONG",mtf:{higher:"UPTREND",lower:"UPTREND"},
  marketStructure:{
    score:90,
    setup:{kind:"SFP",side:"LONG",score:88},
    advancedPriceAction:{dealingRange:{positionLabel:"DISCOUNT"}}
  },
  reactionMap:{active:{action:"LONG",state:"CONFIRM_LONG",confidence:90}},
  derivatives:{
    cvdState:"BUYERS CONFIRM",
    positioning:"PRICE + OI: LONG PARTICIPATION",
    liquidationBias:"SHORT LIQS DOMINANT",
    orderBookImbalance:.15,
    takerImbalance:.1
  },
  components:[],reasons:[],contributors:[]
};
const kc={domains:p14.SETUPS.SFP.required.map(id=>({id}))};
const intelligence=p14.buildSignalIntelligence({analysis,knowledgeContext:kc,derivatives:analysis.derivatives,higher:{regime:"UPTREND"},lower:{regime:"UPTREND"}});
assert(intelligence.scoreAdjustment>0,"knowledge alignment should improve a strongly aligned SFP");

const profile=p14.buildAdaptiveProfile([
  ...Array.from({length:30},(_,i)=>({setupKey:"SFP",regime:"UPTREND",side:"LONG",outcome:i<18?"WIN":"LOSS",resultR:i<18?1:-1})),
  ...Array.from({length:35},(_,i)=>({setupKey:"D_LINE_BREAKOUT",regime:"DOWNTREND",side:"SHORT",outcome:i<10?"WIN":"LOSS",resultR:i<10?1:-1}))
],{minSample:30});
assert(profile.profiles["SFP|UPTREND|LONG"].eligible===true,"SFP adaptive profile should be eligible");
assert(profile.profiles["SFP|UPTREND|LONG"].adjustment>0,"positive SFP sample should calibrate positively");
assert(profile.profiles["D_LINE_BREAKOUT|DOWNTREND|SHORT"].adjustment<0,"negative D-Line sample should calibrate negatively");

const enriched=p14.enrichAnalysis(analysis,{knowledgeContext:kc,derivatives:analysis.derivatives,higher:{regime:"UPTREND"},lower:{regime:"UPTREND"},adaptiveProfile:profile});
assert(enriched.phase14?.intelligence?.setupKey==="SFP","Phase 14 metadata missing");
assert(enriched.components.some(x=>x.name==="Knowledge alignment"),"Knowledge alignment component missing");
assert(enriched.score>=78,"Aligned SFP score should not decrease in this fixture");

const grouped=p14.aggregateSetupBuckets([
  {setupKey:"SFP",side:"LONG",regime:"UPTREND",outcome:"WIN",resultR:1},
  {setupKey:"SFP",side:"LONG",regime:"UPTREND",outcome:"LOSS",resultR:-1}
]);
assert(grouped.SFP.n===2,"setup aggregation failed");

console.log("Phase 14 signal-intelligence checks passed:",{
  version:p14.VERSION,
  setups:Object.keys(p14.SETUPS).length,
  intelligenceAdjustment:intelligence.scoreAdjustment,
  calibratedSfp:profile.profiles["SFP|UPTREND|LONG"],
  knowledgeComponent:enriched.components.find(x=>x.name==="Knowledge alignment")
});
