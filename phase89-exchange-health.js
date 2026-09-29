/** Phase 89 */
const V="89.0.0";function evaluate(i={}){const spread=Number(i.spreadBps||0),lag=Number(i.dataLagMs||0),outage=Boolean(i.outage),reliability=Number(i.reliabilityPct??100);const blockers=[];if(outage)blockers.push("OUTAGE");if(spread>Number(i.maxSpreadBps??30))blockers.push("SPREAD");if(lag>Number(i.maxLagMs??5000))blockers.push("LAG");if(reliability<Number(i.minReliabilityPct??95))blockers.push("RELIABILITY");return {version:V,healthy:blockers.length===0,blockers,reliability};
}
function selfTest(){const a=evaluate({spreadBps:5,dataLagMs:1000,reliabilityPct:99}),b=evaluate({spreadBps:40,dataLagMs:1000,reliabilityPct:99}),c=evaluate({spreadBps:5,dataLagMs:6000,reliabilityPct:99});return {ok:a.healthy&&!b.healthy&&b.blockers.includes("SPREAD")&&!c.healthy&&c.blockers.includes("LAG"),version:V};}
module.exports={VERSION:V,evaluate,selfTest};
