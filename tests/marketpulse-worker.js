const assert=require("assert");
const worker=require("../marketpulse-worker");
const once=require("../marketpulse-worker-once");

const symbols=worker.parseCsv("BTCUSDT, ETHUSDT,BTCUSDT");
assert.deepStrictEqual(symbols,["BTCUSDT","ETHUSDT"],"CSV de-duplication");

const plan=worker.buildPlan({symbols:["BTCUSDT","ETHUSDT"],intervals:["15m","1h"],now:0});
assert(plan.length===4,"worker plan");
assert(plan[0].interval==="15m","15m cadence group");
assert(plan[0].cadenceMs===5*60*1000,"15m cadence");
assert(plan[2].interval==="1h","1h cadence group");
assert(plan[2].cadenceMs===15*60*1000,"1h cadence");

const due=worker.dueJobs(plan,20000);
assert(due.length===4,"all initial jobs are due after startup stagger");

const next=worker.nextWakeMs(plan,Date.now());
assert(next>=250&&next<=5000,"wake bound");

const summary=worker.summarizeDecision({
  state:"NO_TRADE",action:"WAIT",market:{confluenceScore:84,regime:"RANGE",type:"ORDER BLOCK"},
  phase14:{intelligence:{setupKey:"ORDER_BLOCK",status:"CAUTION"}},phase11_13:{summary:{trades:2}},updatedAt:123
});
assert(summary.score===84&&summary.setup==="ORDER_BLOCK"&&summary.phase14Status==="CAUTION","decision summary");

assert(worker.normaliseBaseUrl("https://example.com/")==="https://example.com","base URL normalization");

const top=once.dueIntervals(new Date("2026-09-27T12:00:00Z"));
assert.deepStrictEqual(top,["15m","1h","4h","1d"],"hour boundary sweep intervals");
assert.deepStrictEqual(
  once.dueIntervals(new Date("2026-09-27T12:32:00Z")),
  ["15m","1h","4h"],
  "30-minute sweep intervals"
);
assert.deepStrictEqual(
  once.dueIntervals(new Date("2026-09-27T12:07:00Z")),
  ["15m"],
  "5-minute sweep intervals"
);
assert(once.MAX_CONCURRENCY===3,"bounded cron concurrency");
assert(worker.isRetryableError(Object.assign(new Error("timeout"),{name:"AbortError"})),"abort retries");
assert(worker.isRetryableError(Object.assign(new Error("rate limit"),{status:429})),"rate-limit retries");
assert(!worker.isRetryableError(Object.assign(new Error("bad request"),{status:400})),"client errors do not retry");

console.log("MarketPulse worker checks passed:",{
  plan:plan.length,cadence15m:worker.CADENCE_MS["15m"],cadence1h:worker.CADENCE_MS["1h"]
});
