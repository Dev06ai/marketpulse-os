/**
 * Phase 30 — Central Risk Engine 2.0
 */
const VERSION="30.0.0";
const n=(x,d=null)=>Number.isFinite(Number(x))?Number(x):d;
function evaluate(input={}){
  const rawRisk=Number(input.riskPct);
  const riskPct=Number.isFinite(rawRisk)?rawRisk:null;
  const maxRiskPct=n(input.maxRiskPct,1),dailyDd=n(input.dailyDrawdownPct,0),maxDd=n(input.maxDailyDrawdownPct,3);
  const liqDistancePct=n(input.liquidationDistancePct),minLiq=n(input.minLiquidationDistancePct,0.5);
  const positions=n(input.openPositions,0),maxPositions=n(input.maxPositions,3);
  const requireDefinedRisk=Boolean(input.requireDefinedRisk);
  const reasons=[];
  if(requireDefinedRisk&&riskPct===null)reasons.push("NO_DEFINED_RISK");
  if(riskPct!==null&&riskPct>maxRiskPct)reasons.push("RISK_LIMIT");
  if(dailyDd>=maxDd)reasons.push("DAILY_DRAWDOWN");
  if(Number.isFinite(liqDistancePct)&&liqDistancePct<minLiq)reasons.push("LIQUIDATION_PROXIMITY");
  if(positions>=maxPositions)reasons.push("POSITION_LIMIT");
  return {version:VERSION,defined:riskPct!==null,riskPct,blocked:reasons.length>0,reasons,headroomPct:Math.max(0,maxDd-dailyDd)};
}
function selfTest(){const a=evaluate({riskPct:.5,maxRiskPct:1,dailyDrawdownPct:1,maxDailyDrawdownPct:3,openPositions:1});const b=evaluate({riskPct:2,maxRiskPct:1});const c=evaluate({});const d=evaluate({requireDefinedRisk:true});return {ok:!a.blocked&&b.blocked&&b.reasons.includes("RISK_LIMIT")&&!c.blocked&&!c.defined&&d.blocked&&d.reasons.includes("NO_DEFINED_RISK"),version:VERSION};}
module.exports={VERSION,evaluate,selfTest};
