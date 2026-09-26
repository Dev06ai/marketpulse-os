const assert=require("assert");
const {analyze,backtest,backtestBySetup,walkForwardBacktest}=require("../market-engine");

function candles(n=420){
  const out=[];let p=100;
  for(let i=0;i<n;i++){
    const wave=Math.sin(i/11)*1.5+Math.sin(i/37)*2;
    const drift=i*0.03;
    const close=p+0.2+wave*.08+drift*.01;
    const open=p;
    const high=Math.max(open,close)+1.1;
    const low=Math.min(open,close)-1.1;
    out.push({t:Date.now()-((n-i)*3600000),o:open,h:high,l:low,c:close,v:1000+Math.abs(wave)*80});
    p=close;
  }
  return out;
}
const c=candles();
const a=analyze(c,{interval:"1h"});
assert(Number.isFinite(a.price),"price");
assert(Number.isFinite(a.score),"score");
assert(a.components.length===10,"10 confluence components");
assert(["READY","WATCH","WAITING"].includes(a.status),"status");
assert(a.thesisParts.length>=1,"thesis");
const b=backtest(c);
assert(Number.isFinite(b.trades),"backtest trades");
assert(Number.isFinite(b.coverage),"backtest coverage");
const w=walkForwardBacktest(c);
assert(w.train&&w.validation,"walk forward");
const s=backtestBySetup(c);
assert(s&&typeof s==="object","setup stats");
console.log("MarketPulse Phase 2 smoke checks passed:",{
  price:a.price,score:a.score,status:a.status,backtestTrades:b.trades,
  validationTrades:w.validation.trades,setupBuckets:Object.keys(s).length
});
