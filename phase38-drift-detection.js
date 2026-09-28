/**
 * Phase 38 — Drift Detection
 */
const VERSION="38.0.0";
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
function detect(baseline=[],current=[],threshold=.2){
  if(!baseline.length||!current.length)return {version:VERSION,drift:null,drifted:true,reason:"INSUFFICIENT_DATA"};
  const b=mean(baseline),c=mean(current),drift=Math.abs(c-b)/(Math.abs(b)||1);
  return {version:VERSION,drift,drifted:drift>threshold};
}
function selfTest(){const x=detect([1,1,1,1],[1.5,1.5,1.5,1.5],.2);return {ok:x.drifted&&x.drift>.2,version:VERSION};}
module.exports={VERSION,detect,selfTest};
