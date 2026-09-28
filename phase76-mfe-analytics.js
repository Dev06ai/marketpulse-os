/** Phase 76 */
const V="76.0.0";function analyze(rows=[]){const vals=rows.map(x=>Number(x.mfeR)).filter(Number.isFinite).sort((a,b)=>a-b);const q=p=>vals.length?vals[Math.min(vals.length-1,Math.floor((vals.length-1)*p))]:null;return {version:V,sample:vals.length,p50:q(.5),p75:q(.75),p90:q(.9)};
}
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,analyze,selfTest};
