/**
 * Phase 39 — Confidence Calibration Audit
 */
const VERSION="39.0.0";
function audit(rows=[]){
  const valid=rows.filter(x=>Number.isFinite(Number(x.probability))&&(x.outcome===0||x.outcome===1));
  if(!valid.length)return {version:VERSION,sample:0,brier:null,coverage:0};
  const brier=valid.reduce((s,x)=>s+(Number(x.probability)-x.outcome)**2,0)/valid.length;
  return {version:VERSION,sample:valid.length,brier,coverage:valid.length/(rows.length||1)};
}
function selfTest(){const x=audit([{probability:.8,outcome:1},{probability:.2,outcome:0}]);return {ok=x.brier<.05&&x.coverage===1,version:VERSION};}
module.exports={VERSION,audit,selfTest};
