/** Phase 68 */
const V="68.0.0";function evaluate(i={}){const rawAge=Number(i.ageMs),ttl=Math.max(60000,Number(i.ttlMs||900000)),strict=i.strict===true;const age=Number.isFinite(rawAge)&&rawAge>=0?rawAge:null;const expired=age===null?strict:age>ttl;return {version:V,ageMs:age,ttlMs:ttl,expired,remainingMs:age===null?0:Math.max(0,ttl-age),validAge:age!==null};
}
function selfTest(){const a=evaluate({ageMs:1000,ttlMs:60000}),b=evaluate({ageMs:61000,ttlMs:60000});return {ok:!a.expired&&a.remainingMs===59000&&b.expired,version:V};}
module.exports={VERSION:V,evaluate,selfTest};
