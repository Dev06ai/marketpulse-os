/** Phase 87 */
const V="87.0.0";function evaluate(i={}){const risks=(Array.isArray(i.positions)?i.positions:[]).map(x=>Number(x.riskPct)).filter(Number.isFinite);const total=risks.reduce((a,b)=>a+b,0),max=Number(i.maxTotalRiskPct??3);return {version:V,totalRiskPct:total,blocked:total>max,maxTotalRiskPct:max};
}
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,evaluate,selfTest};
