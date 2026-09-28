/**
 * Phase 44 — Decision Explainability 2.0
 */
const VERSION="44.0.0";
function explain(snapshot={}){
  const reasons=[],conflicts=[];
  if(snapshot.structure?.setup)reasons.push("STRUCTURE: "+snapshot.structure.setup);
  if(snapshot.flow?.cvd&&snapshot.flow.cvd!=="UNKNOWN")reasons.push("CVD: "+snapshot.flow.cvd);
  if(Number.isFinite(snapshot.flow?.orderBookImbalance))reasons.push("ORDER BOOK IMBALANCE: "+snapshot.flow.orderBookImbalance);
  if(snapshot.validation?.paperOnly)conflicts.push("PAPER_ONLY");
  if(snapshot.risk?.blocked)conflicts.push("RISK_BLOCK");
  return {version:VERSION,action:snapshot.action||"WAIT",reasons,conflicts,missing:reasons.length?"":"NO_EVIDENCE"};
}
function selfTest(){const x=explain({action:"WAIT",structure:{setup:"SFP"},validation:{paperOnly:true}});return {ok:x.reasons.length===1&&x.conflicts.includes("PAPER_ONLY"),version:VERSION};}
module.exports={VERSION,explain,selfTest};
