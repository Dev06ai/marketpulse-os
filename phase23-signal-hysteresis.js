/**
 * Phase 23 — Directional Hysteresis
 * Deterministic anti-flip release policy for LONG/SHORT/WAIT.
 */
const VERSION="23.0.0";
const side=x=>["LONG","SHORT"].includes(String(x||"").toUpperCase())?String(x).toUpperCase():"WAIT";
function update(prev={},candidate="WAIT",opts={}){
  const current=side(prev.side),next=side(candidate);
  const required=Math.max(1,Number(opts.confirmations||3));
  const opposite=current!=="WAIT"&&next!=="WAIT"&&current!==next;
  const invalidated=Boolean(opts.invalidated);
  if(invalidated||current==="WAIT"||next===current)return {side:invalidated?"WAIT":current||"WAIT",pending:"WAIT",count:0,reason:invalidated?"INVALIDATED":"HOLD"};
  const pending=side(prev.pending)===next?next:"WAIT";
  const count=pending===next?Number(prev.count||0)+1:1;
  if(count>=required)return {side:next,pending:"WAIT",count:0,reason:"CONFIRMED"};
  if(opposite)return {side:current,pending:next,count,reason:"CONFIRMING_FLIP"};
  return {side:next,pending:"WAIT",count:0,reason:"RELEASE"};
}
function selfTest(){
  let x={side:"LONG",pending:"WAIT",count:0};
  x=update(x,"SHORT",{confirmations:3}); const a=x;
  x=update(x,"SHORT",{confirmations:3}); const b=x;
  x=update(x,"SHORT",{confirmations:3}); const c=x;
  return {ok:a.side==="LONG"&&a.pending==="SHORT"&&b.side==="LONG"&&c.side==="SHORT"&&c.reason==="CONFIRMED",version:VERSION};
}
module.exports={VERSION,update,selfTest};
