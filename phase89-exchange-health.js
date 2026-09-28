/** Phase 89 */
const V="89.0.0";function evaluate(i={}){const spread=Number(i.spreadBps||0),lag=Number(i.dataLagMs||0),outage=Boolean(i.outage),reliability=Number(i.reliabilityPct??100);const blockers=[];if(outage)blockers.push("OUTAGE");if(spread>Number(i.maxSpreadBps??30))blockers.push("SPREAD");if(lag>Number(i.maxLagMs??5000))blockers.push("LAG");if(reliability<Number(i.minReliabilityPct??95))blockers.push("RELIABILITY");return {version:V,healthy:blockers.length===0,blockers,reliability};
}
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,evaluate,selfTest};
