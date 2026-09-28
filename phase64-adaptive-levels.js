/** Phase 64 */
const V="64.0.0";function build(i={}){const side=String(i.side||"WAIT").toUpperCase(),p=Number(i.price),atr=Math.abs(Number(i.atr||0)),low=Number(i.entryLow??p),high=Number(i.entryHigh??p);if(!Number.isFinite(p)||!Number.isFinite(atr)||!["LONG","SHORT"].includes(side))return {version:V,valid:false};const risk=Math.max(atr*Number(i.stopAtr||1.2),p*.001);const entry=(low+high)/2;const stop=side==="LONG"?entry-risk:entry+risk;const tp1=side==="LONG"?entry+risk*1.5:entry-risk*1.5;const tp2=side==="LONG"?entry+risk*2.5:entry-risk*2.5;return {version:V,valid:true,side,entryLow:low,entryHigh:high,entry,stop,tp1,tp2,rr:1.5};
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,build,selfTest};
