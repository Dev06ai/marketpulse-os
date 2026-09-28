const assert=require("assert");
const {buildReactionMap,reactionForZone}=require("../reaction-map");

function candles(mode="support"){
  const out=[],start=Date.UTC(2026,8,20,0,0,0),hour=3600000;
  for(let i=0;i<100;i++){
    const t=start+i*hour;
    const base=100+(i<70?0:i*.015);
    out.push({t,o:base,c:base+.1,h:base+1,l:base-1,v:1000});
  }
  if(mode==="support"){
    out[70]={...out[70],o:103,c:104,h:105,l:102,v:1200};
    out[80]={...out[80],o:104,c:103.5,h:104.5,l:102.8,v:1200};
    out[99]={t:start+99*hour,o:100.1,c:100.8,h:101.1,l:98.5,v:2400};
  }else{
    out[70]={...out[70],o:97,c:96,h:98,l:95,v:1200};
    out[80]={...out[80],o:96,c:96.5,h:97.2,l:95.5,v:1200};
    out[99]={t:start+99*hour,o:100.4,c:99.1,h:102.1,l:98.9,v:2400};
  }
  return out;
}

const support=buildReactionMap(candles("support"),{
  interval:"1h",
  marketStructure:{
    levels:[{id:"SUP",label:"Support Confluence",price:100,kind:"SUPPORT"}],
    orderBlocks:[]
  },
  strategySetups:{nakedPocs:[]},
  derivatives:{cvdState:"BUYERS CONFIRM",oiChangePct:2,positioning:"PRICE + OI: LONG PARTICIPATION"}
});
assert(support.zones.length>0,"reaction map should build a support zone");
assert(support.zones.some(x=>x.side==="SUPPORT"),"support zone should be represented");
assert(support.opportunities.some(x=>x.action==="LONG"&&x.state==="CONFIRM_LONG"),"support sweep/reclaim should confirm LONG");

const resistance=buildReactionMap(candles("resistance"),{
  interval:"1h",
  marketStructure:{
    levels:[{id:"RES",label:"Resistance Confluence",price:100,kind:"RESISTANCE"}],
    orderBlocks:[]
  },
  strategySetups:{nakedPocs:[]},
  derivatives:{cvdState:"SELLERS CONFIRM",oiChangePct:2,positioning:"PRICE DOWN + OI UP: SHORT PARTICIPATION"}
});
assert(resistance.zones.some(x=>x.side==="RESISTANCE"),"resistance zone should be represented");
assert(resistance.opportunities.some(x=>x.action==="SHORT"&&x.state==="CONFIRM_SHORT"),"resistance sweep/rejection should confirm SHORT");

const breakdownCandles=[
  {o:100.8,c:100.2,h:101.2,l:99.8,v:1000},
  {o:100.5,c:100.4,h:100.9,l:99.9,v:1100},
  {o:100.6,c:99.7,h:100.1,l:99.4,v:2200}
];
const breakdownResult=reactionForZone(
  breakdownCandles,
  {id:"SUPPORT_BREAK",low:100,high:102,center:101,side:"SUPPORT",confluence:2,evidence:["Support"],evidenceSources:["Test"]},
  2,
  {volumeZ:2,cvdState:"SELLERS CONFIRM",oiChangePct:2,positioning:"SHORT PARTICIPATION"}
);
assert(breakdownResult.action==="SHORT","support breakdown should produce a SHORT reaction candidate");
assert(["CONFIRM_SHORT","BREAKDOWN_SHORT"].includes(breakdownResult.state),"support breakdown should produce a confirmed/breakdown SHORT candidate");
assert(breakdownResult.invalidation>102,"SHORT invalidation must sit above the support zone, not below it");

console.log("Reaction map smoke checks passed:",{
  supportState:support.opportunities[0]?.state||support.active?.state,
  resistanceState:resistance.opportunities[0]?.state||resistance.active?.state,
  supportZones:support.zones.length,
  resistanceZones:resistance.zones.length
});
