/** Phase 100 */
const V="100.0.0";function evaluate(i={}){const blockers=Array.isArray(i.blockers)?i.blockers.filter(Boolean):[];const ready=Boolean(i.readiness)&&blockers.length===0&&["LONG","SHORT","WAIT"].includes(String(i.action||"WAIT"));return {version:V,publicSignalAllowed:ready,action:ready?String(i.action).toUpperCase():"WAIT",blockers,automaticExecutionEnabled:false,decisionSupportOnly:true};
}
function selfTest(){const a=evaluate({readiness:true,action:"LONG",blockers:[]}),b=evaluate({readiness:true,action:"LONG",blockers:["RISK_BLOCK"]}),c=evaluate({readiness:true,action:"OTHER",blockers:[]});return {ok:a.publicSignalAllowed&&a.action==="LONG"&&!b.publicSignalAllowed&&c.action==="WAIT",version:V};}
module.exports={VERSION:V,evaluate,selfTest};
