/**
 * Phase 24 — Data Quality & Provenance
 */
const VERSION="24.0.0";
const n=(x,d=0)=>Number.isFinite(Number(x))?Number(x):d;
function score(input={}){
  const venue=n(input.venueCount), required=n(input.requiredVenues||2,2);
  const freshness=Math.max(0,Math.min(100,n(input.freshnessPct,0)));
  const completeness=Math.max(0,Math.min(100,n(input.completenessPct,0)));
  const consensus=Math.max(0,Math.min(100,n(input.consensusPct,0)));
  const timestamp=Math.max(0,Math.min(100,n(input.timestampIntegrityPct,0)));
  const venueCoverage=Math.max(0,Math.min(100,venue/required*100));
  const total=Math.round(freshness*.30+completeness*.25+consensus*.25+timestamp*.10+venueCoverage*.10);
  const blockers=[];
  if(freshness<70)blockers.push("STALE_DATA");
  if(completeness<70)blockers.push("INCOMPLETE_DATA");
  if(consensus<60)blockers.push("LOW_CONSENSUS");
  if(timestamp<90)blockers.push("TIMESTAMP_INTEGRITY");
  if(venue<required)blockers.push("INSUFFICIENT_VENUE_COVERAGE");
  return {score:total,quality:total>=85?"GOOD":total>=70?"DEGRADED":"POOR",blockers,liveEligible:total>=85&&blockers.length===0};
}
function selfTest(){
  const good=score({venueCount:3,freshnessPct:100,completenessPct:100,consensusPct:95,timestampIntegrityPct:100});
  const bad=score({venueCount:1,freshnessPct:40,completenessPct:70,consensusPct:50,timestampIntegrityPct:80});
  return {ok:good.liveEligible&&!bad.liveEligible&&bad.blockers.includes("STALE_DATA"),version:VERSION};
}
module.exports={VERSION,score,selfTest};
