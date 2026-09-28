const assert=require("assert");
const market=require("../phase18-market-state");
const radar=require("../phase18-opportunity");
const router=require("../phase18-execution-router");

const bm=market.bookMetrics([["100","5"],["99","3"]],[["101","4"],["102","2"]],2);
assert.strictEqual(bm.bestBid,100);
assert.strictEqual(bm.bestAsk,101);
assert(bm.imbalance>0);

const decision={
  ok:true,symbol:"BTCUSDT",interval:"15m",updatedAt:Date.now(),action:"LONG",
  state:"READY",liveSignalEligible:true,
  market:{confluenceScore:76,regime:"UPTREND",type:"LIQUIDITY_SWEEP_RECLAIM",price:100},
  levels:{entry:100,entryLow:99.8,entryHigh:100.2,stop:98.8,tp1:101.6,tp2:103.0,rr:1.6},
  data:{score:90},
  derivatives:{cvdState:"BUYERS CONFIRM"}
};
const ms={
  ok:true,
  summary:{venueCount:4,consensusQuality:92,dispersionBps:4,avgOrderbookImbalance:0.18,avgFundingRate:0.0001,medianPerpPrice:100},
  regime:{state:"BUYER_PRESSURE",bias:"BUYERS"},
  venues:[
    {name:"BYBIT",exchange:"BYBIT",status:"healthy",venueType:"perp",price:100,spreadBps:1,imbalance:.2,fundingRate:.0001,openInterest:1000},
    {name:"BINANCE",exchange:"BINANCE",status:"healthy",venueType:"perp",price:100.01,spreadBps:1,imbalance:.15,fundingRate:.0001,openInterest:1200},
    {name:"HYPERLIQUID",exchange:"HYPERLIQUID",status:"healthy",venueType:"perp",price:99.99,spreadBps:2,imbalance:.1,fundingRate:.0001,openInterest:900},
    {name:"OKX",exchange:"OKX",status:"healthy",venueType:"perp",price:100.00,spreadBps:1,imbalance:.1,fundingRate:.0001,openInterest:1100}
  ]
};
const rr=radar.evaluate(decision,ms,{easyMode:true});
assert(["ARMED","TRIGGERED"].includes(rr.status),"Expected a qualified radar state");
assert.strictEqual(rr.side,"LONG");
const route=router.choose(ms,"LONG","PAPER");
assert.strictEqual(route.venue,"PAPER");
assert(route.ok);

console.log(JSON.stringify({ok:true,radarVersion:radar.VERSION,marketVersion:market.VERSION,routeVersion:router.VERSION,status:rr.status}));
