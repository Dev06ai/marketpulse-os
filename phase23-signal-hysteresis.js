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
  if(invalidated)return {side:"WAIT",pending:"WAIT",count:0,reason:"INVALIDATED"};
  if(next==="WAIT")return {side:current,pending:"WAIT",count:0,reason:current==="WAIT"?"HOLD":"NO_NEW_CANDIDATE"};
  if(current==="WAIT"){
    const pending=side(prev.pending)===next?next:"WAIT";
    const count=pending===next?Number(prev.count||0)+1:1;
    if(count>=required)return {side:next,pending:"WAIT",count:0,reason:"CONFIRMED_FROM_WAIT"};
    return {side:"WAIT",pending:next,count,reason:"CONFIRMING_FROM_WAIT"};
  }
  if(next===current)return {side:current,pending:"WAIT",count:0,reason:"HOLD"};
  if(opposite){
    const pending=side(prev.pending)===next?next:"WAIT";
    const count=pending===next?Number(prev.count||0)+1:1;
    if(count>=required)return {side:next,pending:"WAIT",count:0,reason:"CONFIRMED"};
    return {side:current,pending:next,count,reason:"CONFIRMING_FLIP"};
  }
  return {side:current,pending:"WAIT",count:0,reason:"HOLD"};
}
function selfTest(){
  let x={side:"LONG",pending:"WAIT",count:0};
  x=update(x,"SHORT",{confirmations:3}); const a=x;
  x=update(x,"SHORT",{confirmations:3}); const b=x;
  x=update(x,"SHORT",{confirmations:3}); const c=x;
  let n={side:"WAIT",pending:"WAIT",count:0};
  n=update(n,"LONG",{confirmations:2}); const fromWait=n;
  n=update(n,"LONG",{confirmations:2}); const fromWaitConfirmed=n;
  return {ok:a.side==="LONG"&&a.pending==="SHORT"&&b.side==="LONG"&&c.side==="SHORT"&&c.reason==="CONFIRMED"&&fromWait.side==="WAIT"&&fromWait.pending==="LONG"&&fromWaitConfirmed.side==="LONG",version:VERSION};
}
module.exports={VERSION,update,selfTest};
