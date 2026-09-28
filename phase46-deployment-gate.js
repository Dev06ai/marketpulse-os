/**
 * Phase 46 — Deployment Safety & Canary
 */
const VERSION="46.0.0";
function gate(x={}){
  const blockers=[];
  if(!x.testsPass)blockers.push("TESTS");
  if(!x.healthPass)blockers.push("HEALTH");
  if(!x.rollbackReady)blockers.push("ROLLBACK");
  if(x.canaryErrorRate>Number(x.maxCanaryErrorRate||1))blockers.push("CANARY");
  return {version:VERSION,allowed:blockers.length===0,blockers};
}
function selfTest(){const x=gate({testsPass:true,healthPass:true,rollbackReady:true,canaryErrorRate:0});return {ok:x.allowed,version:VERSION};}
module.exports={VERSION,gate,selfTest};
