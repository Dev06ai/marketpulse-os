/** Phase 81 */
const V="81.0.0";function evaluate(i={}){const sample=Number(i.samples||0),min=Number(i.minSamples??200),drift=Number(i.drift||0),maxDrift=Number(i.maxDrift??.2);return {version:V,learn:sample>=min&&drift<=maxDrift,shadowOnly:true,reason:sample<min?"INSUFFICIENT_SAMPLE":drift>maxDrift?"DRIFT":"ELIGIBLE"};
}
function selfTest(){const a=evaluate({samples:300,minSamples:200,drift:.1,maxDrift:.2}),b=evaluate({samples:100,minSamples:200,drift:.1,maxDrift:.2}),c=evaluate({samples:300,minSamples:200,drift:.3,maxDrift:.2});return {ok:a.learn&&a.shadowOnly&&!b.learn&&!c.learn&&b.reason==="INSUFFICIENT_SAMPLE"&&c.reason==="DRIFT",version:V};}
module.exports={VERSION:V,evaluate,selfTest};
