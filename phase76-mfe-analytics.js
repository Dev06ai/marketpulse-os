/** Phase 76 */
const V="76.0.0";function analyze(rows=[]){const vals=rows.map(x=>Number(x.mfeR)).filter(Number.isFinite).sort((a,b)=>a-b);const q=p=>vals.length?vals[Math.min(vals.length-1,Math.floor((vals.length-1)*p))]:null;return {version:V,sample:vals.length,p50:q(.5),p75:q(.75),p90:q(.9)};
}
function selfTest(){const x=analyze([{mfeR:1},{mfeR:2},{mfeR:3},{mfeR:"x"}]);return {ok:x.sample===3&&x.p50===2&&x.p75===2.5&&x.p90===2.8,version:V};}
module.exports={VERSION:V,analyze,selfTest};
