/*
 * MarketPulse Phase 18 — Smart Execution Router
 * Chooses an execution venue for planning only. It never enables LIVE trading.
 */
const VERSION="18.0.0";
function n(x,d=null){const v=Number(x);return Number.isFinite(v)?v:d}
function choose(snapshot,side="LONG",mode="PAPER"){
  const venues=(snapshot?.venues||[]).filter(v=>v?.status==="healthy"&&v.venueType==="perp"&&Number.isFinite(Number(v.price)));
  if(String(mode).toUpperCase()==="PAPER")return {ok:true,venue:"PAPER",reason:"Paper mode uses local simulation.",candidates:venues.map(v=>v.exchange)};
  const scored=venues.map(v=>{
    const spread=n(v.spreadBps,25),imb=n(v.imbalance,0),book=Math.max(0,1-Math.min(25,Math.max(0,spread))/25);
    const align=side==="LONG"?imb:side==="SHORT"?-imb:0;
    const depth=Math.log10(Math.max(1,(v.bidQty||0)+(v.askQty||0)));
    const score=book*60+Math.max(0,align)*25+Math.min(15,depth);
    return {exchange:v.exchange,score,spreadBps:spread,imbalance:imb,price:v.price};
  }).sort((a,b)=>b.score-a.score);
  const top=scored[0];
  return {ok:Boolean(top),venue:top?.exchange||null,reason:top?"Best observed executable market-state composite.":"No healthy perpetual venue.",candidates:scored.slice(0,5)};
}
function selfTest(){const p=choose({venues:[{exchange:"BYBIT",status:"healthy",venueType:"perp",price:100,spreadBps:2,imbalance:.1,bidQty:100,askQty:90}]}, "LONG","PAPER"),l=choose({venues:[{exchange:"BYBIT",status:"healthy",venueType:"perp",price:100,spreadBps:2,imbalance:.1,bidQty:100,askQty:90}]}, "LONG","LIVE");return {ok:p.ok&&p.venue==="PAPER"&&l.ok&&l.venue==="BYBIT",version:VERSION};}
module.exports={VERSION,choose,selfTest};
