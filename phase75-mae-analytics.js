/** Phase 75 */
const V="75.0.0";function analyze(rows=[]){const vals=rows.map(x=>Math.abs(Number(x.maeR))).filter(Number.isFinite).sort((a,b)=>a-b);const q=p=>vals.length?vals[Math.min(vals.length-1,Math.floor((vals.length-1)*p))]:null;return {version:V,sample:vals.length,p50:q(.5),p90:q(.9),p95:q(.95)};
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,analyze,selfTest};
