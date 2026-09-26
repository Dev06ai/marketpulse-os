const assert=require("assert");
const phase7=require("../phase7");

const sample=[
  {asset:"BTCUSDT",side:"LONG",regime:"UPTREND",setup:"BREAKOUT LONG",r:2,ts:Date.now()},
  {asset:"BTCUSDT",side:"LONG",regime:"UPTREND",setup:"BREAKOUT LONG",r:-1,ts:Date.now()},
  {asset:"ETHUSDT",side:"SHORT",regime:"RANGE",setup:"RANGE SHORT WATCH",r:0.5,ts:Date.now()},
  {asset:"ETHUSDT",side:"SHORT",regime:"RANGE",setup:"RANGE SHORT WATCH",r:0,ts:Date.now()}
];

const a=phase7.analyzeJournal(sample);
assert(a.totalTrades===4,"total trades");
assert(a.wins===2&&a.losses===1,"win/loss counts");
assert(Math.abs(a.netR-1.5)<1e-9,"net R");
assert(a.byAsset.some(x=>x.key==="BTCUSDT"),"asset bucket");
assert(a.byRegime.some(x=>x.key==="UPTREND"),"regime bucket");

const q=phase7.qualityCheck({analytics:a,storage:true,marketData:true,derivatives:true});
assert(q.ok,"phase7 quality check");

const self=phase7.selfTest();
assert(self.ok,"phase7 self test");

console.log("Phase 7 smoke checks passed:",{trades:a.totalTrades,netR:a.netR,quality:q.ok});
