const assert=require("assert");
(async()=>{
const {analyze,backtest,backtestBySetup,walkForwardBacktest}=require("../market-engine");
const phase4=require("../phase4");
const execution=require("../execution");
const phase6=require("../phase6");

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
assert(a.components.length===12,"12 confluence components");
assert(["READY","WATCH","WAITING"].includes(a.status),"status");
assert(a.thesisParts.length>=1,"thesis");
const b=backtest(c);
assert(Number.isFinite(b.trades),"backtest trades");
assert(Number.isFinite(b.coverage),"backtest coverage");
const w=walkForwardBacktest(c);
assert(w.train&&w.validation,"walk forward");
const s=backtestBySetup(c);
assert(s&&typeof s==="object","setup stats");
const p4=phase4.createState();
const rq=phase4.riskCheck({entry:100,stop:95,target:110,rr:2},p4.config,0);
assert(rq.allowed,"phase4 risk gate");
assert(rq.rr>=1.5,"phase4 rr");
const q4=phase4.signalQuality({score:80,status:"READY",components:[{name:"Momentum",value:11}]},{sample:20,matchScore:82});
assert(q4.components.length===1&&q4.marketScore===80,"phase4 quality");
const p4s=phase4.summarizeTrades([{resultR:1,pnl:100},{resultR:-1,pnl:-50}]);
assert(p4s.trades===2&&p4s.netR===0,"phase4 paper summary");
const p5=execution.createState();
const g5=await execution.marketGate({symbol:"BTCUSDT",side:"LONG",entry:100,stop:95,target:110,qty:10},p5);
assert(g5.allowed&&g5.rr>=1.5&&g5.qty===10,"phase5 execution gate");
p5.control.killSwitch=true;
const g5b=await execution.marketGate({symbol:"BTCUSDT",side:"LONG",entry:100,stop:95,target:110,qty:10},p5);
assert(!g5b.allowed&&g5b.reason==="KILL SWITCH ACTIVE","phase5 kill switch");

const p6=phase6.createState();
const series6={BTCUSDT:c,ETHUSDT:c.map(x=>Object.assign({},x,{c:x.c*1.01,o:x.o*1.01,h:x.h*1.01,l:x.l*1.01}))};
const pf6=phase6.buildPortfolio(p6.config,[{symbol:"BTCUSDT",side:"LONG",entry:100,qty:10,riskCash:1000}],[],series6);
assert(pf6.grossRiskPct===1,"phase6 portfolio risk");
assert(pf6.correlation.BTCUSDT.ETHUSDT>0.99,"phase6 correlation");
const st6=phase6.stressTest(Object.assign({},p6.config,{stressMovePct:5}),[{symbol:"BTCUSDT",side:"LONG",entry:100,qty:10,riskCash:1000}],[]);
assert(st6.rows.length===2&&st6.rows[0].pnl<0&&st6.rows[1].pnl>0,"phase6 stress lab");
const cg6=phase6.correlationGate(p6.config,{BTCUSDT:2,ETHUSDT:1},"BTCUSDT",{correlation:{BTCUSDT:{BTCUSDT:1,ETHUSDT:.92},ETHUSDT:{BTCUSDT:.92,ETHUSDT:1}}});
assert(cg6.available&&cg6.clusterRiskPct===3,"phase6 correlated risk gate");

console.log("MarketPulse Phase 6 smoke checks passed:",{
  price:a.price,score:a.score,status:a.status,backtestTrades:b.trades,
  validationTrades:w.validation.trades,setupBuckets:Object.keys(s).length
});
})();
