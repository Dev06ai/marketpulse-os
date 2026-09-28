const assert=(x,m)=>{if(!x)throw new Error(m)};
const p51=require("../phase51-trader-signal-contract");
const p52=require("../phase52-signal-qualification-gate");
const p54=require("../phase54-multi-timeframe-alignment");
const p58=require("../phase58-cvd-oi-divergence");
const p60=require("../phase60-cross-venue-consensus");
const p62=require("../phase62-trigger-quality");
const p63=require("../phase63-invalidation-engine");
const p64=require("../phase64-adaptive-levels");
const p65=require("../phase65-expectancy-gate");
const p71=require("../phase71-probability-calibration-2");
const p72=require("../phase72-ensemble-confidence");
const p73=require("../phase73-uncertainty-coverage");
const p74=require("../phase74-cost-aware-expectancy");
const p80=require("../phase80-no-trade-quality");
const p82=require("../phase82-champion-challenger");
const p87=require("../phase87-portfolio-risk");
const p89=require("../phase89-exchange-health");
const p90=require("../phase90-trader-checklist");
const p99=require("../phase99-free-public-readiness");
const p100=require("../phase100-public-signal-gate");
const stack=require("../phase51-100-stack");

assert(p51.build({action:"LONG"}).automaticExecutionEnabled===false,"51 auto execution");
assert(p52.evaluate({gates:{data:true,risk:true}}).eligible,"52 qualified");
assert(!p52.evaluate({gates:{data:true,risk:false}}).eligible,"52 risk block");
assert(p54.align({higher:"LONG",execution:"LONG",lower:"LONG"}).aligned,"54 MTF");
assert(p58.analyze({priceChange:1,cvdChange:-1}).divergence,"58 divergence");
assert(p60.evaluate([{price:100},{price:100.01}]).consensus,"60 consensus");
assert(p62.evaluate({direction:"LONG",retest:true}).confirmed,"62 trigger");
assert(p63.evaluate({side:"LONG",entry:100,stop:98}).valid,"63 invalidation");
assert(p64.build({side:"LONG",price:100,entryLow:99,entryHigh:100,atr:2}).valid,"64 levels");
assert(p65.evaluate({probability:.7,rr:2,costBps:5}).pass,"65 expectancy");
assert(p71.calibrate([{probability:.7,outcome:1},{probability:.6,outcome:0}]).sample===2,"71 calibration");
assert(p72.combine([{probability:70,weight:1},{probability:80,weight:1}]).probability===75,"72 ensemble");
assert(p73.evaluate({coveragePct:90,calibrationSamples:300,disagreementPct:5}).uncertain===false,"73 uncertainty");
assert(p74.evaluate({winProbability:.7,averageWinR:2,averageLossR:1,costR:.05}).expectancy>.7,"74 expectancy");
assert(p80.evaluate({blockers:["DATA_QUALITY"],dataQuality:40,directionalEdge:5}).justified,"80 wait quality");
assert(p82.compare({championExpectancy:1,challengerExpectancy:1.2,minimumImprovementR:.1,challengerSamples:500}).promote,"82 challenger");
assert(p87.evaluate({positions:[{riskPct:1},{riskPct:1}],maxTotalRiskPct:1.5}).blocked,"87 portfolio");
assert(p89.evaluate({reliabilityPct:80}).healthy===false,"89 exchange");
assert(p90.build({side:"LONG",entry:100,invalidation:98}).items.length===8,"90 checklist");
assert(p99.gate({data:true,validation:true,calibration:true,risk:true,security:true,observability:true,operations:true}).ready,"99 readiness");
assert(p100.evaluate({readiness:true,action:"LONG",blockers:[]}).publicSignalAllowed===true,"100 gate");
const live=stack.evaluate({
 symbol:"BTCUSDT",interval:"15m",price:100,
 decision:{action:"LONG",market:{side:"LONG",confluenceScore:90},levels:{entry:100,stop:98,tp1:103,tp2:105,rr:1.5}},
 analysis:{side:"LONG",regime:{trend:"UP"},confluenceScore:90,marketStructure:{setup:{side:"LONG"}}},
 derivatives:{cvdState:"BUYERS CONFIRM",takerImbalance:.12,oiChangePct:2,orderBook:{imbalance:.1}},
 phaseStack:{data:{quality:{liveEligible:true}},risk:{blocked:false},anomaly:{anomalous:false}},
 triggerConfirmed:true,mtfAligned:true,setupEvidence:true,flowEvidence:true,invalidation:true,levelsValid:true,
 calibration:{probability:.72,source:"CALIBRATED"},uncertainty:{coveragePct:95,calibrationSamples:500,disagreementPct:5},
 publicReadiness:{data:true,validation:true,calibration:true,risk:true,security:true,observability:true,operations:true},
 expectancy:{winProbability:.72,averageWinR:2,averageLossR:1,costR:.05},
 exchangeHealth:{reliabilityPct:100},portfolio:{positions:[]},leverage:{leverage:2,liquidationDistancePct:10}
});
assert(live.signal.action==="LONG"&&live.gate.qualified,"51-100 stack did not publish eligible signal");
assert(live.diagnostics.expectancyProbability===0.72,"Calibrated probability must remain 0–1 inside expectancy math");
assert(live.diagnostics.expectancyGate.expectancy<2,"Expectancy gate probability unit regression");
assert(live.signal.automaticExecutionEnabled===false,"51-100 auto execution");
const blocked=stack.evaluate({dataQualityOk:false,triggerConfirmed:false,mtfAligned:false,calibration:{probability:null}});
assert(blocked.signal.action==="WAIT","51-100 must fail safe to WAIT");
console.log("phase51-100 tests: ok");

// Every Phase 51–100 module must load and expose a self-test.
const fs=require("fs");
const phaseFiles=fs.readdirSync(__dirname+"/..").filter(x=>/^phase(?:5[1-9]|[6-9][0-9]|100)-.*\.js$/.test(x)&&!["phase51-100-stack.js","phase51-100-utils.js","phase51-100-selftest.js"].includes(x)).sort((a,b)=>{
  const pa=Number(a.match(/^phase(\d+)/)[1]),pb=Number(b.match(/^phase(\\d+)/)[1]); return pa-pb;
});
assert(phaseFiles.length===50,"Expected exactly 50 Phase 51–100 modules, found "+phaseFiles.length);
for(const file of phaseFiles){
  const mod=require("../"+file);
  assert(typeof mod.selfTest==="function",file+" missing selfTest");
  assert(mod.selfTest().ok===true,file+" selfTest failed");
}
assert(phaseFiles.every((f,i)=>Number(f.match(/^phase(\\d+)/)[1])===i+51),"Phase module coverage has a gap");
