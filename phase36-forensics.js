/**
 * Phase 36 — Signal Journal & Forensics
 */
const crypto=require("crypto"),VERSION="36.0.0";
let RECORD_SEQUENCE=0;
function record(snapshot,outcome=null){
  const payload={snapshot,outcome,recordedAt:Date.now(),recordSequence:++RECORD_SEQUENCE},hash=crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return {...payload,forensicId:hash.slice(0,24).toUpperCase()};
}
function selfTest(){const a=record({symbol:"BTCUSDT",action:"WAIT"},{}),b=record({symbol:"BTCUSDT",action:"WAIT"},{});return {ok:a.forensicId!==b.forensicId,version:VERSION};}
module.exports={VERSION,record,selfTest};
