const fs=require("fs");
const phase=require("./phase11-13");
const {detectMarketStructure}=require("./market-structure");
const {analyze}=require("./market-engine");
const tradeLevels=require("./trade-levels");
const decisionIntelligence=require("./decision-intelligence");
const phase20=require("./phase20-scenario-matrix");
const phase21=require("./phase21-state-contract");
const phase22=require("./phase22-state-bus");
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
const phase34=require("./phase34-paper-broker");
const phase35=require("./phase35-execution-model");
const phase36=require("./phase36-forensics");
const phase37=require("./phase37-learning-guardrails");
const phase38=require("./phase38-drift-detection");
const phase39=require("./phase39-calibration-audit");
const phase40=require("./phase40-anomaly-detector");
const phase41=require("./phase41-kill-switch");
const phase42=require("./phase42-observability");
const phase43=require("./phase43-phase-ledger");
const phase44=require("./phase44-explainability");
const phase45=require("./phase45-security-review");
const phase46=require("./phase46-deployment-gate");
const phase47=require("./phase47-recovery");
const phase48=require("./phase48-performance-budget");
const phase49=require("./phase49-live-readiness");
const phase50=require("./phase50-shadow-controller");



function syntheticCandles(mode){
  const out=[],start=Date.UTC(2026,8,15,0,0,0),hour=60*60*1000;
  for(let i=0;i<240;i++){
    const day=Math.floor(i/24),base=100+(day%3)*.15;
    out.push({t:start+i*hour,o:base,c:base+.03,h:base+1,l:base-1,v:1000});
  }
  // Previous completed UTC day: establish a clear daily high/low.
  for(let i=192;i<216;i++){out[i].h=108;out[i].l=98;out[i].o=102;out[i].c=103;out[i].v=1200;}
  out[203].h=110;
  if(mode==="sfp"){
    const i=239;
    out[i]={t:start+i*hour,o:109,c:108,h:112,l:107,v:2600};
  }else{
    const j=238,i=239;
    out[j]={t:start+j*hour,o:109.5,c:112,h:113,l:109.2,v:2400};
    out[i]={t:start+i*hour,o:110.4,c:111.2,h:112,l:109.85,v:1900};
  }
  return out;
}

const sfpCandles=syntheticCandles("sfp");
const sfpStructure=detectMarketStructure(sfpCandles,{interval:"1h"});
assert(sfpStructure.setup?.kind==="SFP","Daily/weekly SFP detector did not identify the synthetic rejection.");
assert(sfpStructure.setup?.side==="SHORT","Bearish SFP must map to SHORT.");
const sfpAnalysis=analyze(sfpCandles,{interval:"1h"});
assert(sfpAnalysis.side==="SHORT","Core engine did not expose the SFP as a short setup.");
assert(sfpAnalysis.marketStructure?.setup?.kind==="SFP","Analysis did not carry market-structure evidence.");

const retestCandles=syntheticCandles("retest");
const retestStructure=detectMarketStructure(retestCandles,{interval:"1h"});
assert(retestStructure.setup?.kind==="BREAKOUT_RETEST","Breakout-retest detector did not identify the synthetic retest.");
assert(retestStructure.setup?.side==="LONG","Bullish breakout-retest must map to LONG.");
const retestAnalysis=analyze(retestCandles,{interval:"1h"});
assert(retestAnalysis.side==="LONG","Core engine did not expose the breakout-retest as a long setup.");

// Regression: a live provider may legitimately return orderBook:null while other
// derivatives data remains available. This must never crash the core analyzer.
const nullOrderBookAnalysis=analyze(retestCandles,{interval:"1h",deriv:{available:true,orderBook:null,takerImbalance:null,cvdState:"UNKNOWN",liquidationBias:"UNKNOWN"}});
assert(nullOrderBookAnalysis&&nullOrderBookAnalysis.derivatives,"Null order-book regression crashed the core analyzer.");



function assert(condition,message){
  if(!condition)throw new Error(message);
}

const phaseResult=phase.selfTest();
assert(phaseResult.ok,"Phase 11-13 self-test failed");
const tradeLevelResult=tradeLevels.selfTest();
assert(decisionIntelligence.selfTest(),"Decision Center strategy-intelligence self-test failed.");
assert(phase20.selfTest().ok,"Phase 20 scenario-matrix self-test failed.");
const phase21Result=phase21.selfTest();
assert(phase21Result.ok,"Phase 21 canonical state self-test failed.");
assert(phase22.selfTest().ok,"Phase 22 state-bus self-test failed.");
assert(phase23.selfTest().ok,"Phase 23 hysteresis self-test failed.");
assert(phase24.selfTest().ok,"Phase 24 data-quality self-test failed.");
assert(phase25.selfTest().ok,"Phase 25 flow-normalizer self-test failed.");
assert(phase26.selfTest().ok,"Phase 26 regime-engine self-test failed.");
assert(phase27.selfTest().ok,"Phase 27 structure-graph self-test failed.");
assert(phase28.selfTest().ok,"Phase 28 confluence self-test failed.");
assert(phase29.selfTest().ok,"Phase 29 calibration self-test failed.");
assert(phase30.selfTest().ok,"Phase 30 risk-engine self-test failed.");
assert(phase31.selfTest().ok,"Phase 31 backtest self-test failed.");
assert(phase32.selfTest().ok,"Phase 32 walk-forward self-test failed.");
assert(phase33.selfTest().ok,"Phase 33 Monte Carlo self-test failed.");
assert(phase34.selfTest().ok,"Phase 34 paper broker self-test failed.");
assert(phase35.selfTest().ok,"Phase 35 execution-model self-test failed.");
assert(phase36.selfTest().ok,"Phase 36 forensics self-test failed.");
assert(phase37.selfTest().ok,"Phase 37 learning-guardrails self-test failed.");
assert(phase38.selfTest().ok,"Phase 38 drift-detection self-test failed.");
assert(phase39.selfTest().ok,"Phase 39 calibration-audit self-test failed.");
assert(phase40.selfTest().ok,"Phase 40 anomaly-detector self-test failed.");
assert(phase41.selfTest().ok,"Phase 41 kill-switch self-test failed.");
assert(phase42.selfTest().ok,"Phase 42 observability self-test failed.");
assert(phase43.selfTest().ok,"Phase 43 phase-ledger self-test failed.");
assert(phase44.selfTest().ok,"Phase 44 explainability self-test failed.");
assert(phase45.selfTest().ok,"Phase 45 security-review self-test failed.");
assert(phase46.selfTest().ok,"Phase 46 deployment-gate self-test failed.");
assert(phase47.selfTest().ok,"Phase 47 recovery self-test failed.");
assert(phase48.selfTest().ok,"Phase 48 performance-budget self-test failed.");
assert(phase49.selfTest().ok,"Phase 49 live-readiness self-test failed.");
assert(phase50.selfTest().ok,"Phase 50 shadow-controller self-test failed.");
assert(tradeLevelResult.ok,"Conservative trade-level self-test failed.");
assert(tradeLevelResult.long.rr>=1.5&&tradeLevelResult.short.rr>=1.5,"Trade-level builder must enforce minimum 1.5R.");
assert(tradeLevelResult.long.stop<tradeLevelResult.long.entry&&tradeLevelResult.long.tp1>tradeLevelResult.long.entry,"LONG level geometry is invalid.");
assert(tradeLevelResult.short.stop>tradeLevelResult.short.entry&&tradeLevelResult.short.tp1<tradeLevelResult.short.entry,"SHORT level geometry is invalid.");

const serverSource=fs.readFileSync("./server.js","utf8");
new Function(serverSource);
const htmlSource=fs.readFileSync("./public/index.html","utf8");
const waitVisualChecks=[
  'var cls=side==="LONG"?"signal-long":side==="SHORT"?"signal-short":"signal-wait";',
  'if(!executionReady)return {',
  'reason:"FINAL_DECISION_NOT_EXECUTABLE"',
  'No active invalidation level — final trade gate is blocked.',
  'decisionSection.signal-wait .mpdc-execution-panel'
];
for(const x of waitVisualChecks)assert(htmlSource.includes(x),"WAIT/execution-map regression missing: "+x);
const inlineScripts=[...htmlSource.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(Boolean);
for(const script of inlineScripts)new Function(script);
assert(inlineScripts.length>0,"Dashboard inline JavaScript was not found for syntax validation.");

console.log(JSON.stringify({
  ok:true,
  phase:phase.VERSION,
  phase11:phase.PHASE11,
  phase12:phase.PHASE12,
  phase13:phase.PHASE13,
  deploymentGate:phaseResult.gate,
  validationSummary:phaseResult.summary
},null,2));

const phase4=require("./phase4");
const phase910=require("./phase9-10");
const autotrader=require("./autotrader");
const learning=require("./learning");
assert(typeof learning.observeFinalDecision==="function","Final-gated adaptive learning observer is not exported.");
assert(typeof phase4.updateFinalDecision==="function","Phase 4 final-signal learner is not exported.");
assert(autotrader.VERSION==="17.1.0","Phase 17 AutoTrader module version mismatch.");
assert(autotrader.strategyForInterval("15m",{SCALP:true,INTRADAY:true,SWING:false,POSITION:false})==="SCALP","Phase 17 scalp router failed.");
assert(autotrader.strategyForInterval("4h",{SCALP:true,INTRADAY:true,SWING:true,POSITION:false})==="SWING","Phase 17 swing router failed.");
const styleCheck=phase910.evaluate({
  interval:"15m",
  analysis:{side:"LONG",status:"WAITING",score:80,price:100,entryLow:99,entryHigh:100,stop:97,tp1:104,tp2:108},
  higher:{regime:"UPTREND"},lower:{regime:"UPTREND"},
  derivatives:{available:true,cvdState:"BUYERS CONFIRM",oiChangePct:2,orderBook:{imbalance:.15},takerImbalance:.1,liquidationBias:"SHORT LIQS DOMINANT",livePointCount:10},
  consensus:{consensusQualityPct:95,priceDispersionBps:10},
  dataQuality:{candleAgeMs:1000},liveFlow:{liveConnected:true,livePointCount:10},
  propGate:{decision:"ELIGIBLE"}
});
assert(styleCheck.tradeStyle==="SCALP","15m final decision must be classified as SCALP.");
assert(styleCheck.market?.tradeStyle==="SCALP","15m market payload must expose SCALP style.");

const {detectStrategySetups}=require("./strategy-setups");

function strategyCandles(){
  const out=[],start=Date.UTC(2026,8,20,0,0,0),hour=3600000;
  for(let i=0;i<120;i++){
    const t=start+i*hour;
    out.push({t,o:100,c:100.4,h:101,l:99,v:1000});
  }
  // Prior day profile concentrated around 105, then untouched by later candles.
  for(let i=0;i<24;i++){
    out[i].o=104.8;out[i].c=105.2;out[i].h=105.5;out[i].l=104.5;out[i].v=2000;
  }
  // Current day's candles remain away from the prior POC until the final SFP.
  for(let i=24;i<119;i++){
    out[i].o=107;out[i].c=107.2;out[i].h=108;out[i].l=106;out[i].v=1100;
  }
  out[119]={t:start+119*hour,o:105.7,c:104.5,h:108,l:104.1,v:2800};
  return out;
}

const npoc=detectStrategySetups(strategyCandles(),{interval:"1h"});
assert(npoc.setup?.kind==="NPOC","Naked POC detector did not identify the synthetic SFP.");
assert(npoc.setup?.side==="SHORT","Bearish naked POC SFP must map to SHORT.");
assert(/^Naked (DAILY|WEEKLY) POC/.test(String(npoc.setup?.reason||"")),"Naked POC thesis reason missing.");


