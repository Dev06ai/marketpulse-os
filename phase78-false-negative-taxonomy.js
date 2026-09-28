/** Phase 78 */
const V="78.0.0";function classify(i={}){if(i.blockedByData)return "DATA_BLOCK";if(i.blockedByCooldown)return "COOLDOWN";if(i.mtfConflict)return "MTF_CONFLICT";if(i.signalExpired)return "TTL";return "UNKNOWN";
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,classify,selfTest};
