/**
 * Phase 28 — Confluence Scoring 2.0
 */
const VERSION="28.0.0";
const n=(x,d=0)=>Number.isFinite(Number(x))?Number(x):d;
function score(evidence=[]){
  let raw=50,reasons=[],conflicts=0;
  for(const e of Array.isArray(evidence)?evidence:[]){
    const w=Math.max(-30,Math.min(30,n(e.weight,0)));
    raw+=w;
    if(w>0)reasons.push(String(e.label||e.key||"evidence"));
    if(w<0)conflicts+=1;
  }
  const score=Math.max(0,Math.min(100,Math.round(raw)));
  return {version:VERSION,score,reasons,conflicts,band:score>=80?"HIGH":score>=65?"MEDIUM":"LOW"};
}
function selfTest(){const x=score([{label:"structure",weight:20},{label:"flow",weight:15},{label:"conflict",weight:-10}]);return {ok:x.score===75&&x.conflicts===1,version:VERSION};}
module.exports={VERSION,score,selfTest};
