/**
 * Phase 40 — Anomaly & Market Shock Detection
 */
const VERSION="40.0.0";
function detect(x={}){
  const blockers=[];
  if(Number(x.priceGapPct||0)>=Number(x.maxGapPct||3))blockers.push("PRICE_GAP");
  if(Number(x.dispersionBps||0)>=Number(x.maxDispersionBps||25))blockers.push("VENUE_DISPERSION");
  if(Number(x.freshnessMs||0)>=Number(x.maxFreshnessMs||30000))blockers.push("STALE_FEED");
  if(Number(x.volatilityShock||0)>=Number(x.maxVolShock||4))blockers.push("VOL_SHOCK");
  return {version:VERSION,anomalous:blockers.length>0,blockers};
}
function selfTest(){const x=detect({priceGapPct:5});return {ok:x.anomalous&&x.blockers.includes("PRICE_GAP"),version:VERSION};}
module.exports={VERSION,detect,selfTest};
