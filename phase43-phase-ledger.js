/**
 * Phase 43 — Admin Phase History
 */
const history=require("./phase-history"),VERSION="43.0.0";
function summary(){const phases=history.getPhaseHistory();return {version:VERSION,currentPhase:history.getCurrentPhase(),complete:phases.filter(x=>x.status==="COMPLETE").length,phases}}
function selfTest(){const x=summary();return {ok:x.phases.length===200&&x.currentPhase===20,version:VERSION};}
module.exports={VERSION,summary,selfTest};
