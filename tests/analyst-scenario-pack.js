const assert=require("assert");
const {getActiveAnalystPack}=require("../analyst-scenario-pack");

const asOf=Date.parse("2026-09-25T20:30:00Z");
const active=getActiveAnalystPack(asOf+24*3600000);
assert(active.active===true,"Analyst scenario pack should be active within validity window.");
assert(active.zones.some(z=>z.id==="VIDEO_R1"&&z.low===85700&&z.high===85900),"85.7–85.9K resistance zone missing.");
assert(active.zones.find(z=>z.id==="VIDEO_R1").primaryAction==="SHORT","Primary resistance reaction should be SHORT.");
assert(active.zones.some(z=>z.id==="VIDEO_S1"&&z.low===81000&&z.high===82000),"81–82K support zone missing.");
assert(active.scenarios.some(x=>x.id==="BULLISH_BREAKOUT"&&x.confirmation.some(y=>/volume/i.test(y))),"Bullish breakout scenario missing.");
assert(active.structureModifiers.some(x=>x.id==="WAVE2_TIME_EXTENSION"),"Wave-duration modifier missing.");

const expired=getActiveAnalystPack(asOf+73*3600000);
assert(expired.active===false,"Analyst scenario pack should expire automatically.");

console.log("Analyst scenario pack checks passed:",{
  active:active.status,
  zones:active.zones.length,
  scenarios:active.scenarios.length,
  expiresAt:new Date(active.expiresAt).toISOString()
});
