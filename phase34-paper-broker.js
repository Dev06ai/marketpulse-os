/**
 * Phase 34 — Paper Execution Simulator
 */
const VERSION="34.0.0";
class PaperBroker{
  constructor(){this.nextId=1;this.orders=new Map();this.positions=[]}
  place(order){const id=String(this.nextId++),row={id,status:"OPEN",createdAt:Date.now(),...order};this.orders.set(id,row);return row}
  fill(id,fill={}){const o=this.orders.get(String(id));if(!o)return null;const filledPrice=Number(fill.price??o.price),filledQty=Number(fill.qty??o.qty);
    const row={...o,status:"FILLED",filledAt:Date.now(),fillPrice:filledPrice,filledQty};
    this.orders.set(String(id),row);
    const symbol=String(o.symbol||"UNKNOWN"),side=String(o.side||"").toUpperCase();
    if(["LONG","SHORT","BUY","SELL"].includes(side)&&Number.isFinite(filledQty)&&filledQty>0&&Number.isFinite(filledPrice)){
      const signed=/LONG|BUY/.test(side)?1:-1;
      const existing=this.positions.find(p=>p.symbol===symbol);
      if(existing){
        const nextQty=Math.max(0,Number(existing.qty||0)+signed*filledQty);
        existing.qty=nextQty;
        existing.side=nextQty===0?"FLAT":(nextQty>0?"LONG":"SHORT");
        existing.avgPrice=nextQty===0?null:filledPrice;
        existing.updatedAt=Date.now();
        if(nextQty===0)this.positions=this.positions.filter(p=>p!==existing);
      }else{
        this.positions.push({symbol,side:signed>0?"LONG":"SHORT",qty:signed*filledQty,avgPrice:filledPrice,updatedAt:Date.now()});
      }
    }
    return row}
  reject(id,reason){const o=this.orders.get(String(id));if(!o)return null;const row={...o,status:"REJECTED",reason:String(reason||"REJECTED")};this.orders.set(String(id),row);return row}
  snapshot(){return {version:VERSION,orders:[...this.orders.values()],positions:[...this.positions]}}
}
function selfTest(){const b=new PaperBroker(),o=b.place({symbol:"BTCUSDT",side:"LONG",price:100,qty:1});const f=b.fill(o.id,{price:100.2});const p=b.snapshot().positions[0];return {ok:f.status==="FILLED"&&b.snapshot().orders.length===1&&p?.symbol==="BTCUSDT"&&p?.side==="LONG"&&p?.qty===1,version:VERSION};}
module.exports={VERSION,PaperBroker,selfTest};
