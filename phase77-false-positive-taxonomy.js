/** Phase 77 */
const V="77.0.0";function classify(i={}){if(i.dataStale)return "DATA";if(i.triggerLate)return "LATE_TRIGGER";if(i.regimeWrong)return "REGIME";if(i.flowConflict)return "FLOW_CONFLICT";if(i.levelsPoor)return "LEVELS";return "UNKNOWN";
}
function selfTest(){const a=classify({dataStale:true,triggerLate:true}),b=classify({flowConflict:true}),c=classify({});return {ok:a==="DATA"&&b==="FLOW_CONFLICT"&&c==="UNKNOWN",version:V};}
module.exports={VERSION:V,classify,selfTest};
