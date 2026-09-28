/**
 * Phase 34 — Paper Execution Simulator
 */
const VERSION="34.0.0";
class PaperBroker{
  constructor(){this.nextId=1;this.orders=new Map();this.positions=[]}
  place(order){const id=String(this.nextId++),row={id,status:"OPEN",createdAt:Date.now(),...order};this.orders.set(id,row);return row}
  fill(id,fill={}){const o=this.orders.get(String(id));if(!o)return null;const row={...o,status:"FILLED",filledAt:Date.now(),fillPrice:Number(fill.price??o.price),filledQty:Number(fill.qty??o.qty)};this.orders.set(String(id),row);return row}
  reject(id,reason){const o=this.orders.get(String(id));if(!o)return null;const row={...o,status:"REJECTED",reason:String(reason||"REJECTED")};this.orders.set(String(id),row);return row}
  snapshot(){return {version:VERSION,orders:[...this.orders.values()],positions:[...this.positions]}}
}
function selfTest(){const b=new PaperBroker(),o=b.place({side:"LONG",price:100,qty:1});const f=b.fill(o.id,{price:100.2});return {ok=f.status==="FILLED"&&b.snapshot().orders.length===1,version:VERSION};}
module.exports={VERSION,PaperBroker,selfTest};
