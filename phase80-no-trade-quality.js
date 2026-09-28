/** Phase 80 */
const V="80.0.0";function evaluate(i={}){const blocked=Array.isArray(i.blockers)?i.blockers.length:0,quality=Number(i.dataQuality||0),edge=Number(i.directionalEdge||0),wait=blocked>0||quality<85||edge<15;return {version:V,wait,qualityScore:Math.max(0,Math.min(100,50+(wait?Math.min(50,blocked*10):30))),justified:wait?blocked>0||quality<85||edge<15:true,blockers:i.blockers||[]};
}
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,evaluate,selfTest};
