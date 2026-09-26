const fs=require("fs");
const phase=require("./phase11-13");
const {detectMarketStructure}=require("./market-structure");
const {analyze}=require("./market-engine");

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



function assert(condition,message){
  if(!condition)throw new Error(message);
}

const phaseResult=phase.selfTest();
assert(phaseResult.ok,"Phase 11-13 self-test failed");

const serverSource=fs.readFileSync("./server.js","utf8");
new Function(serverSource);

console.log(JSON.stringify({
  ok:true,
  phase:phase.VERSION,
  phase11:phase.PHASE11,
  phase12:phase.PHASE12,
  phase13:phase.PHASE13,
  deploymentGate:phaseResult.gate,
  validationSummary:phaseResult.summary
},null,2));
