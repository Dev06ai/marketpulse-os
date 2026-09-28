/** Phase 63 */
const V="63.0.0";function evaluate(i={}){const side=String(i.side||"WAIT").toUpperCase();const stop=Number(i.stop),entry=Number(i.entry);const valid=side==="LONG"?Number.isFinite(stop)&&Number.isFinite(entry)&&stop<entry:side==="SHORT"?Number.isFinite(stop)&&Number.isFinite(entry)&&stop>entry:false;return {version:V,valid,side,invalidation:valid?stop:null,reason:valid?"STRUCTURAL_STOP_DEFINED":"STOP_UNDEFINED_OR_WRONG_SIDE"};
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,evaluate,selfTest};
