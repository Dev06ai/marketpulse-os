/**
 * Phase 43 — Admin Phase History
 */
const history=require("./phase-history"),VERSION="43.0.0";
function summary(){const phases=history.getPhaseHistory();const engineeringPhase=typeof history.getEngineeringPhase==="function"?history.getEngineeringPhase():history.getCurrentPhase();return {version:VERSION,currentPhase:engineeringPhase,latestCompletePhase:history.getCurrentPhase(),complete:phases.filter(x=>x.status==="COMPLETE").length,phases}}
function selfTest(){const x=summary();return {ok:x.phases.length===500&&x.currentPhase===500&&x.latestCompletePhase===499,version:VERSION};}
module.exports={VERSION,summary,selfTest};
