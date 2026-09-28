/**
 * Phase 25 — Cross-Exchange Flow Normalization
 * Values remain unit-aware; no synthetic missing values are invented.
 */
const VERSION="25.0.0";
const n=(x,d=null)=>Number.isFinite(Number(x))?Number(x):d;
function normalizeVenue(v={}){
  return {
    exchange:String(v.exchange||"UNKNOWN").toUpperCase(),
    price:n(v.price),
    bid:n(v.bestBid||v.bid),
    ask:n(v.bestAsk||v.ask),
    spreadBps:n(v.spreadBps),
    imbalance:n(v.imbalance),
    fundingRate:n(v.fundingRate),
    openInterest:n(v.openInterest),
    oiChangePct:n(v.oiChangePct),
    cvd:n(v.cvd),
    cvdDelta:n(v.cvdDelta),
    sourceTs:n(v.sourceTs)
  };
}
function aggregate(rows=[]){
  const venues=rows.map(normalizeVenue);
  const valid=venues.filter(x=>Number.isFinite(x.price));
  const avg=(xs)=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
  return {
    version:VERSION,
    venueCount:valid.length,
    medianPrice:valid.length?valid.map(x=>x.price).sort((a,b)=>a-b)[Math.floor(valid.length/2)]:null,
    avgImbalance:avg(valid.map(x=>x.imbalance).filter(Number.isFinite)),
    avgFunding:avg(valid.map(x=>x.fundingRate).filter(Number.isFinite)),
    avgOiChangePct:avg(valid.map(x=>x.oiChangePct).filter(Number.isFinite)),
    venues
  };
}
function selfTest(){
  const a=aggregate([{exchange:"binance",price:"100",imbalance:.2},{exchange:"bybit",price:101,imbalance:.1,oiChangePct:2}]);
  return {ok:a.venueCount===2&&a.avgImbalance===.15000000000000002&&a.avgOiChangePct===2,version:VERSION};
}
module.exports={VERSION,normalizeVenue,aggregate,selfTest};
