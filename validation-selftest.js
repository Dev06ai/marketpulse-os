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
  out[119]={t:start+119*hour,o:105.8,c:104.5,h:107.2,l:104.1,v:2800};
  return out;
}

const npoc=detectStrategySetups(strategyCandles(),{interval:"1h"});
assert(npoc.setup?.kind==="NPOC","Naked POC detector did not identify the synthetic SFP.");
assert(npoc.setup?.side==="SHORT","Bearish naked POC SFP must map to SHORT.");
assert(String(npoc.setup?.reason||"").includes("Naked DAILY POC"),"Naked POC thesis reason missing.");

function dlineCandles(){
  const out=[],start=Date.UTC(2026,8,25,0,0,0),m=15*60000;
  for(let i=0;i<100;i++)out.push({t:start+i*m,o:100,c:100.2,h:101,l:99,v:1000});
  out[70]={t:start+70*m,o:100,c:109,h:110,l:99,v:1000};
  out[85]={t:start+85*m,o:100,c:105,h:106,l:99,v:1000};
  out[97]={t:start+97*m,o:100,c:102,h:103,l:99,v:1000};
  out[98]={t:start+98*m,o:100,c:102,h:103,l:99,v:1000};
  out[99]={t:start+99*m,o:104,c:110,h:111,l:103,v:2200};
  return out;
}
const dline=detectStrategySetups(dlineCandles(),{interval:"15m",higher8h:{regime:"UPTREND"}});
assert(dline.setup?.kind==="D_LINE_BREAKOUT","D-Line breakout detector did not identify the synthetic breakout.");
assert(dline.setup?.side==="LONG","Bullish D-Line breakout must map to LONG.");
