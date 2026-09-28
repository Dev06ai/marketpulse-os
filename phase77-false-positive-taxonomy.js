/** Phase 77 */
const V="77.0.0";function classify(i={}){if(i.dataStale)return "DATA";if(i.triggerLate)return "LATE_TRIGGER";if(i.regimeWrong)return "REGIME";if(i.flowConflict)return "FLOW_CONFLICT";if(i.levelsPoor)return "LEVELS";return "UNKNOWN";
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,classify,selfTest};
