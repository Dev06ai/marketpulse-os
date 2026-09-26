const assert=require("assert");
const {summarizeSources}=require("../data-fabric");
const {alignDerivativeSnapshot}=require("../research-data");

const confirmed=summarizeSources([
  {name:"Primary Engine",role:"engine-candle",status:"healthy",price:100000},
  {name:"Coinbase Spot",role:"spot-price-cross-check",status:"healthy",price:100005},
  {name:"Kraken Spot",role:"spot-price-cross-check",status:"healthy",price:100004}
]);
assert(confirmed.independentSourceCount===2,"independent count");
assert(confirmed.consensus==="CONFIRMED","confirmed consensus");
assert(confirmed.consensusQualityPct>=95,"high consensus quality");

const weak=summarizeSources([
  {name:"Primary Engine",role:"engine-candle",status:"healthy",price:100000},
  {name:"Coinbase Spot",role:"spot-price-cross-check",status:"healthy",price:100100}
]);
assert(weak.independentSourceCount===1,"single independent source");
assert(weak.consensusQualityPct<85,"single source remains weak");

const conflict=summarizeSources([
  {name:"Primary Engine",role:"engine-candle",status:"healthy",price:100000},
  {name:"Coinbase Spot",role:"spot-price-cross-check",status:"healthy",price:100000},
  {name:"Kraken Spot",role:"spot-price-cross-check",status:"healthy",price:101500}
]);
assert(conflict.consensus==="CONFLICT","feed conflict");
assert(conflict.consensusQualityPct<60,"conflict quality");

const historical=alignDerivativeSnapshot(
  {t:1000,cvdDelta:120,cvdRatio:.04},
  {t:1000,oi:100000},
  99000,
  {
    taker:{takerImbalance:.18},
    longShort:{longShortRatio:1.25,longPercent:55.5,shortPercent:44.5},
    funding:{fundingRate:.0001}
  }
);
assert(historical.available,"historical derivative snapshot available");
assert(historical.oiChangePct>0,"historical OI change");
assert(historical.takerImbalance===.18,"historical taker flow");
assert(historical.longShortRatio===1.25,"historical long/short ratio");
assert(historical.fundingRate===.0001,"historical funding");

console.log("Data Fabric smoke checks passed:",{
  confirmed:confirmed.consensus,
  weak:weak.consensus,
  conflict:conflict.consensus
});
