/** Phase 92 */
const V="92.0.0";function simplify(i={}){return {version:V,side:i.side||"WAIT",headline:i.side==="WAIT"?"WAIT — no confirmed setup":"A "+i.side+" setup is forming",why:Array.isArray(i.reasons)?i.reasons.slice(0,3):[],doNotTrade:Array.isArray(i.blockers)?i.blockers.slice(0,4):[]};
}
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,simplify,selfTest};
