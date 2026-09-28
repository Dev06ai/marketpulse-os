const assert=require("assert");
const bot=require("../autotrader");

const cfg=bot.normalizeConfig({enabled:true,mode:"PAPER",symbols:["btcusdt","BTCUSDT"],strategies:{SCALP:true,INTRADAY:true,SWING:true,POSITION:false}});
assert.deepStrictEqual(cfg.symbols,["BTCUSDT"]);
assert.strictEqual(bot.strategyForInterval("15m",cfg.strategies),"SCALP");
assert.strictEqual(bot.strategyForInterval("1h",cfg.strategies),"INTRADAY");
assert.strictEqual(bot.strategyForInterval("4h",cfg.strategies),"SWING");

const d={
  ok:true,symbol:"BTCUSDT",interval:"15m",updatedAt:Date.now(),
  state:"READY",action:"SHORT",liveSignalEligible:true,
  signalStability:{state:"CONFIRMED"},
  deploymentGate:{state:"PAPER_ONLY"},
  market:{confluenceScore:92,regime:"DOWNTREND",type:"LIQUIDITY_SWEEP_RECLAIM"},
  levels:{entry:83000,entryLow:82950,entryHigh:83050,stop:83500,tp1:82000,tp2:81000,rr:2}
};
const e=bot.decisionEligible(d,cfg);
assert(e.eligible,"Confirmed paper signal should pass the Phase 17 bot router");
const signal=bot.buildExecutionSignal(d,{config:cfg});
assert(signal.id.includes("MP17"));
assert.strictEqual(signal.strategy,"SCALP");
assert.strictEqual(signal.side,"SHORT");

const stale=Object.assign({},d,{updatedAt:Date.now()-60000});
assert(!bot.decisionEligible(stale,cfg).eligible,"Stale decisions must be blocked");

const snapshot={
  bot:{enabled:true,mode:"PAPER",maxPositions:1,maxDailyTrades:4,cooldownMs:600000,tradesToday:0,lastTradeAt:null,lastSignalKey:null},
  execution:{killSwitch:false,reconciliation:{ok:true},metrics:{activePositions:0,dailyLossPct:0}}
};
assert(bot.botCycleGate(snapshot,cfg,d).eligible,"Clean paper snapshot should allow a fresh confirmed signal");
snapshot.bot.lastSignalKey=signal.id;
assert(bot.botCycleGate(snapshot,cfg,d).reasons.includes("DUPLICATE_SIGNAL"),"Duplicate signal must be blocked");

console.log(JSON.stringify({ok:true,version:bot.VERSION}));
