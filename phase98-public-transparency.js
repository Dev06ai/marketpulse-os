/** Phase 98 */
const V="98.0.0";function manifest(i={}){return {version:V,modelVersion:String(i.modelVersion||"UNKNOWN"),calibrationWindow:i.calibrationWindow||null,validationWindow:i.validationWindow||null,knownLimitations:Array.isArray(i.knownLimitations)?i.knownLimitations:[],profitGuarantee:false};
}
function selfTest(){const a=manifest({modelVersion:"m1",knownLimitations:["x"]}),b=manifest({});return {ok:a.modelVersion==="m1"&&a.knownLimitations.length===1&&!a.profitGuarantee&&b.modelVersion==="UNKNOWN",version:V};}
module.exports={VERSION:V,manifest,selfTest};
