/** Phase 100 */
const V="100.0.0";function evaluate(i={}){const blockers=Array.isArray(i.blockers)?i.blockers.filter(Boolean):[];const ready=Boolean(i.readiness)&&blockers.length===0&&["LONG","SHORT","WAIT"].includes(String(i.action||"WAIT"));return {version:V,publicSignalAllowed:ready,action:ready?String(i.action).toUpperCase():"WAIT",blockers,automaticExecutionEnabled:false,decisionSupportOnly:true};
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,evaluate,selfTest};
