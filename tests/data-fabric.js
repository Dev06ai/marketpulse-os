const assert=require("assert");
const {summarizeSources}=require("../data-fabric");

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

console.log("Data Fabric smoke checks passed:",{
  confirmed:confirmed.consensus,
  weak:weak.consensus,
  conflict:conflict.consensus
});
