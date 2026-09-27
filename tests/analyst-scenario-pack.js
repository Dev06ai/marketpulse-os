const assert=require("assert");
const {getActiveAnalystPack}=require("../analyst-scenario-pack");

const asOf=Date.parse("2026-09-25T20:30:00Z");
const current=Date.parse("2026-09-27T17:12:00Z");
const active=getActiveAnalystPack(current);
assert(active.active===true,"Analyst scenario pack should be active within validity window.");
assert(active.zones.some(z=>z.id==="VIDEO_R1"&&z.low===85700&&z.high===85900),"85.7–85.9K resistance zone missing.");
assert(active.zones.find(z=>z.id==="VIDEO_R1").primaryAction==="SHORT","Primary resistance reaction should be SHORT.");
assert(active.zones.some(z=>z.id==="VIDEO_S1"&&z.low===81000&&z.high===82000),"81–82K support zone missing.");
assert(active.scenarios.some(x=>x.id==="BULLISH_BREAKOUT"&&x.confirmation.some(y=>/volume/i.test(y))),"Bullish breakout scenario missing.");
assert(active.structureModifiers.some(x=>x.id==="WAVE2_TIME_EXTENSION"),"Wave-duration modifier missing.");
assert(active.zones.some(z=>z.id==="VISUAL_R1_85224"&&z.low===85150&&z.high===85275),"Current visual 85,224 resistance anchor missing.");
assert(active.zones.some(z=>z.id==="VISUAL_S1_82792"&&Math.abs(z.low-82750)<1),"0.618 reaction level missing.");
assert(active.zones.some(z=>z.id==="VISUAL_S3_81289"&&Math.abs(z.low-81245)<1),"1.0 structural level missing.");
assert(active.zones.some(z=>z.id==="VISUAL_BEAR_75K"&&z.low===74450&&z.high===75350),"75K bearish support zone missing.");
assert(active.scenarios.some(x=>x.id==="VISUAL_HTF_BULL_WAVE5"),"HTF bullish wave-5 scenario missing.");
assert(active.scenarios.some(x=>x.id==="VISUAL_1H_WXY_BEARISH"),"1H WXY bearish scenario missing.");
assert(active.sources.some(x=>/Dewald Thiart/i.test(x)),"Current chart source missing.");

const expired=getActiveAnalystPack(asOf+73*3600000);
assert(expired.active===false,"Analyst scenario pack should expire automatically.");

console.log("Analyst scenario pack checks passed:",{
  active:active.status,
  zones:active.zones.length,
  scenarios:active.scenarios.length,
  expiresAt:new Date(active.expiresAt).toISOString()
});
