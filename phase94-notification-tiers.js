/** Phase 94 */
const V="94.0.0";function classify(i={}){const side=String(i.side||"WAIT"),confidence=Number(i.confidence||0),qualified=Boolean(i.qualified);let tier="NONE";if(qualified&&confidence>=80&&side!=="WAIT")tier="URGENT";else if(qualified&&confidence>=65&&side!=="WAIT")tier="SIGNAL";else if(side!=="WAIT")tier="WATCH";return {version:V,tier};
}
function selfTest(){const a=classify({side:"LONG",confidence:85,qualified:true}),b=classify({side:"LONG",confidence:70,qualified:true}),c=classify({side:"LONG",confidence:50,qualified:true}),d=classify({side:"WAIT",confidence:99,qualified:true});return {ok:a.tier==="URGENT"&&b.tier==="SIGNAL"&&c.tier==="WATCH"&&d.tier==="NONE",version:V};}
module.exports={VERSION:V,classify,selfTest};
