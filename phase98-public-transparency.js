/** Phase 98 */
const V="98.0.0";function manifest(i={}){return {version:V,modelVersion:String(i.modelVersion||"UNKNOWN"),calibrationWindow:i.calibrationWindow||null,validationWindow:i.validationWindow||null,knownLimitations:Array.isArray(i.knownLimitations)?i.knownLimitations:[],profitGuarantee:false};
}
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,manifest,selfTest};
