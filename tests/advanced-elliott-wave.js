const assert=require("assert");
const {buildElliottContext,goldenPocketFromWave1}=require("../advanced-elliott-wave");

const gp=goldenPocketFromWave1(100,200,"BULLISH");
assert(gp.protocolA.low===70 && gp.protocolA.high===76.4,"0.618–0.65 Golden Pocket math mismatch.");
assert(gp.protocolB.low===76.4 && gp.protocolB.high===100,"0.500–0.618 institutional zone math mismatch.");

const c=[];
const start=Date.UTC(2026,0,1);
for(let i=0;i<100;i++){
  const base=100+i*.2;
  c.push({t:start+i*3600000,o:base,c:base+.1,h:base+1,l:base-1,v:1000});
}
// Force a clean alternating impulse candidate in the most recent window.
c[78]={t:start+78*3600000,o:100,c:105,h:106,l:99,v:1200};
c[82]={t:start+82*3600000,o:105,c:102,h:106,l:101,v:900};
c[86]={t:start+86*3600000,o:102,c:120,h:121,l:101,v:1800};
c[90]={t:start+90*3600000,o:120,c:114,h:121,l:113,v:950};
c[94]={t:start+94*3600000,o:114,c:130,h:131,l:113,v:1700};
c[99]={t:start+99*3600000,o:130,c:128,h:132,l:126,v:1200};

const perp=buildElliottContext(c,{
  marketType:"PERPETUAL",
  liquidationCascade:false,
  oiChangePct:30,
  fundingRate:0,
  rsi4h:60
});
assert(perp.version==="2.0+4.2","Elliott context version missing.");
assert(perp.overlapRule.maxOverlapPct===0,"Perpetual overlap must stay disabled without liquidation cascade.");
assert(perp.protocols.wave3.min===1.618 && perp.protocols.wave3.max===2.618,"Wave-3 execution range missing.");
assert(perp.protocols.extendedWave3.min===2.618 && perp.protocols.extendedWave3.max===4.236,"Bitcoin extended Wave-3 range missing.");
assert(perp.protocols.wave2GoldenPocketA.low===.618 && perp.protocols.wave2GoldenPocketA.high===.65,"Golden Pocket protocol missing.");
assert(perp.protocols.wave2InstitutionalB.low===.5 && perp.protocols.wave2InstitutionalB.high===.618,"Institutional Wave-2 protocol missing.");

const cascade=buildElliottContext(c,{marketType:"PERPETUAL",liquidationCascade:true});
assert(cascade.overlapRule.maxOverlapPct===4.5 && cascade.overlapRule.allowed===true,"Perpetual 4.5% overlap exception should require liquidation cascade.");

const spot=buildElliottContext(c,{marketType:"SPOT",liquidationCascade:true});
assert(spot.overlapRule.maxOverlapPct===0 && spot.overlapRule.allowed===false,"Spot should never receive perpetual overlap exception.");

console.log("Advanced Elliott Wave checks passed:",{
  candidates:perp.candidates.length,
  activeScore:perp.active?.score||0,
  perpOverlap:perp.overlapRule,
  cascadeOverlap:cascade.overlapRule
});
