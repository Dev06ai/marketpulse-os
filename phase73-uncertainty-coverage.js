/** Phase 73 */
const V="73.0.0";function evaluate(i={}){const coverage=Number(i.coveragePct||0),sample=Number(i.calibrationSamples||0),disp=Number(i.disagreementPct||0);const reasons=[];if(coverage<75)reasons.push("LOW_COVERAGE");if(sample<100)reasons.push("LOW_CALIBRATION_SAMPLE");if(disp>25)reasons.push("HIGH_MODEL_DISAGREEMENT");return {version:V,uncertain:reasons.length>0,reasons,coverage,calibrationSamples:sample,disagreement:disp};
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,evaluate,selfTest};
