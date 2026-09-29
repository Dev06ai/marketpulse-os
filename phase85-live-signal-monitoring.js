/** Phase 85 */
const V="85.0.0";function observe(i={}){const age=Number(i.ageMs||0),lat=Number(i.latencyMs||0),maxAge=Number(i.maxAgeMs??900000),maxLat=Number(i.maxLatencyMs??3000);const alerts=[];if(age>maxAge)alerts.push("AGED_SIGNAL");if(lat>maxLat)alerts.push("HIGH_LATENCY");return {version:V,healthy:alerts.length===0,alerts};
}
function selfTest(){const a=observe({ageMs:1000,latencyMs:100}),b=observe({ageMs:1000000,latencyMs:100}),c=observe({ageMs:1000,latencyMs:4000});return {ok:a.healthy&&!b.healthy&&b.alerts.includes("AGED_SIGNAL")&&!c.healthy&&c.alerts.includes("HIGH_LATENCY"),version:V};}
module.exports={VERSION:V,observe,selfTest};
