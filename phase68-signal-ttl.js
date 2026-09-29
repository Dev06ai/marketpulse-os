/** Phase 68 */
const V="68.0.0";function evaluate(i={}){const age=Number(i.ageMs||0),ttl=Math.max(60000,Number(i.ttlMs||900000));return {version:V,ageMs:age,ttlMs:ttl,expired:age>ttl,remainingMs:Math.max(0,ttl-age)};
}
function selfTest(){const a=evaluate({ageMs:1000,ttlMs:60000}),b=evaluate({ageMs:61000,ttlMs:60000});return {ok:!a.expired&&a.remainingMs===59000&&b.expired,version:V};}
module.exports={VERSION:V,evaluate,selfTest};
