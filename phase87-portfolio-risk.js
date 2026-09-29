/** Phase 87 */
const V="87.0.0";function evaluate(i={}){const positions=Array.isArray(i.positions)?i.positions:[],orders=Array.isArray(i.orders)?i.orders:[];const risks=positions.concat(orders).map(x=>Number(x.riskPct??x.riskPctPlanned)).filter(Number.isFinite);const total=risks.reduce((a,b)=>a+b,0),max=Number(i.maxTotalRiskPct??3);return {version:V,totalRiskPct:total,blocked:total>max,maxTotalRiskPct:max,positionCount:positions.length,activeOrderCount:orders.length};
}
function selfTest(){const x=evaluate({positions:[{riskPct:1}],orders:[{riskPct:1.5}],maxTotalRiskPct:3});const y=evaluate({positions:[{riskPct:2}],orders:[{riskPct:1.5}],maxTotalRiskPct:3});return {ok:x.totalRiskPct===2.5&&!x.blocked&&y.blocked,version:V};}
module.exports={VERSION:V,evaluate,selfTest};
