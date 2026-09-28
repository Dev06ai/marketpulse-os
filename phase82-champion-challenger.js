/** Phase 82 */
const V="82.0.0";function compare(i={}){const c=Number(i.championExpectancy),n=Number(i.challengerExpectancy),min=Number(i.minimumImprovementR??.1),sample=Number(i.challengerSamples||0),need=Number(i.minimumSamples??200);const promote=Number.isFinite(c)&&Number.isFinite(n)&&n>=c+min&&sample>=need;return {version:V,promote,champion:c,challenger:n,sample};
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,compare,selfTest};
