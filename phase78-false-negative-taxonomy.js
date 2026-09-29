/** Phase 78 */
const V="78.0.0";function classify(i={}){if(i.blockedByData)return "DATA_BLOCK";if(i.blockedByCooldown)return "COOLDOWN";if(i.mtfConflict)return "MTF_CONFLICT";if(i.signalExpired)return "TTL";return "UNKNOWN";
}
function selfTest(){const a=classify({blockedByData:true,blockedByCooldown:true}),b=classify({signalExpired:true}),c=classify({});return {ok:a==="DATA_BLOCK"&&b==="TTL"&&c==="UNKNOWN",version:V};}
module.exports={VERSION:V,classify,selfTest};
