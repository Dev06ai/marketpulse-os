const assert=require("assert");
const {buildAdvancedContext,advancedConfluence,detectFvg,detectBreakers}=require("../advanced-price-action-pack");

const c=[];
for(let i=0;i<30;i++){
  const base=100+i*.2;
  c.push({t:Date.now()+i*60000,o:base,c:base+.1,h:base+1,l:base-1,v:1000});
}
// Add bullish FVG: candle 1 high below candle 3 low.
c[20]={...c[20],o:104,c:104.2,h:104.4,l:103.8,v:1000};
c[21]={...c[21],o:105,c:107,h:108,l:104.8,v:1800};
c[22]={...c[22],o:108,c:109,h:110,l:106,v:1700};

const fvgs=detectFvg(c);
assert(fvgs.some(x=>x.kind==="FVG"&&x.side==="LONG"),"Bullish FVG not detected.");

const breakers=detectBreakers([
  {t:1,o:100,c:98,h:101,l:95,v:1000},
  {t:2,o:98,c:99,h:100,l:94,v:1000},
  {t:3,o:99,c:103,h:104,l:98,v:1800}
]);
assert(breakers.some(x=>x.kind==="BREAKER_BLOCK"&&x.side==="LONG"),"Bullish breaker not detected.");

const ctx=buildAdvancedContext(c,{oiContext:{oiChangePct:2,cvdState:"BUYERS CONFIRM",priceChangePct:.3}});
assert(ctx.rules.htf.weekly.includes("WEEKLY_OPEN"),"HTF weekly mapping rule missing.");
assert(ctx.rules.sfp.closeBackInsideRequired===true,"SFP close-back-inside rule missing.");
assert(ctx.rules.advancedExecution.advancedRRFloor===3,"Advanced 1:3 rule missing.");
assert(ctx.rules.liquidity.premium.includes("50%"),"Premium/discount framework missing.");
assert(ctx.dealingRange&&["PREMIUM","DISCOUNT"].includes(ctx.dealingRange.positionLabel),"Dealing range context missing.");

const conf=advancedConfluence({
  side:"LONG",
  setup:{kind:"SFP",side:"LONG",levelPrice:100,sweepPrice:98,reason:"closed back above"},
  context:ctx,
  derivatives:{cvdState:"BUYERS CONFIRM"},
  candles:c
});
assert(Number.isFinite(conf.score),"Advanced confluence score missing.");
assert(Array.isArray(conf.reasons)&&Array.isArray(conf.flags),"Advanced confluence metadata missing.");

console.log("Advanced price-action knowledge checks passed:",{
  fvgs:fvgs.length,
  breakers:breakers.length,
  position:ctx.dealingRange.positionLabel,
  confluence:conf.score
});
