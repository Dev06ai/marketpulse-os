/** Phase 67 */
const V="67.0.0";function evaluate(i={}){const lev=Number(i.leverage),liq=Number(i.liquidationDistancePct),max=Number(i.maxLeverage??10),minLiq=Number(i.minLiqDistancePct??1);const blockers=[];if(!Number.isFinite(lev)||lev<=0)blockers.push("LEVERAGE_UNDEFINED");if(lev>max)blockers.push("LEVERAGE_TOO_HIGH");if(Number.isFinite(liq)&&liq<minLiq)blockers.push("LIQUIDATION_TOO_CLOSE");return {version:V,blocked:blockers.length>0,blockers,leverage:lev||null};
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,evaluate,selfTest};
