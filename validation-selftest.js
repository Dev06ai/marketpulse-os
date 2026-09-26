const fs=require("fs");
const phase=require("./phase11-13");

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
