/**
 * Phase 26 — Market Regime Engine 2.0
 */
const VERSION="26.0.0";
const n=(x,d=0)=>Number.isFinite(Number(x))?Number(x):d;
function classify(x={}){
  const trend=String(x.trend||"NEUTRAL").toUpperCase(), vol=String(x.volatility||"NORMAL").toUpperCase();
  const liquidity=n(x.liquidityScore,50), crowd=n(x.crowdingScore,50);
  let regime=trend==="UP"||trend==="UPTREND"?"TREND_UP":trend==="DOWN"||trend==="DOWNTREND"?"TREND_DOWN":"RANGE";
  if(vol==="HIGH"||vol==="EXTREME")regime+="_HIGH_VOL";
  if(liquidity<30)regime+="_THIN_LIQUIDITY";
  if(crowd>80)regime+="_CROWDED";
  const confidence=Math.round(Math.max(0,Math.min(100,50+Math.abs(liquidity-50)*.4+Math.abs(crowd-50)*.2)));
  return {version:VERSION,regime,confidence};
}
function selfTest(){
  const x=classify({trend:"UP",volatility:"HIGH",liquidityScore:20,crowdingScore:90});
  return {ok:x.regime==="TREND_UP_HIGH_VOL_THIN_LIQUIDITY_CROWDED"&&x.confidence>50,version:VERSION};
}
module.exports={VERSION,classify,selfTest};
