/**
 * Phase 22 — Authoritative State Bus
 * Pure in-process state publication primitive with monotonic sequences and stale protection.
 */
const VERSION="22.0.0";
class StateBus{
  constructor({maxAgeMs=15000}={}){this.maxAgeMs=maxAgeMs;this.sequence=0;this.current=null}
  publish(state,ts=Date.now()){
    this.sequence++;
    const envelope={sequence:this.sequence,publishedAt:ts,state};
    this.current=envelope;
    return envelope;
  }
  read(now=Date.now()){
    if(!this.current)return {ok:false,state:null,stale:true,reason:"NO_STATE"};
    const age=Math.max(0,now-this.current.publishedAt);
    return {ok:age<=this.maxAgeMs,state:this.current.state,sequence:this.current.sequence,publishedAt:this.current.publishedAt,ageMs:age,stale:age>this.maxAgeMs,reason:age>this.maxAgeMs?"STALE":"FRESH"};
  }
  accept(envelope){
    if(!envelope||!Number.isFinite(Number(envelope.sequence)))return false;
    return !this.current||Number(envelope.sequence)>=Number(this.current.sequence);
  }
}
function selfTest(){
  const b=new StateBus({maxAgeMs:100});
  const a=b.publish({price:100},1000),c=b.publish({price:101},1100);
  return {ok:a.sequence===1&&c.sequence===2&&b.accept(a)===false&&b.read(1150).state.price===101&&b.read(1301).stale,version:VERSION};
}
module.exports={VERSION,StateBus,selfTest};
