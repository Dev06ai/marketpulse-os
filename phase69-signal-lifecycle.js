/** Phase 69 */
const V="69.0.0";function transition(prev="WAIT",event="NONE"){const p=String(prev).toUpperCase(),e=String(event).toUpperCase();const map={WAIT:{TRIGGER_CONFIRMED:"CONFIRMING"},CONFIRMING:{TRIGGER_STABLE:"ACTIVE",INVALIDATED:"INVALIDATED"},ACTIVE:{INVALIDATED:"INVALIDATED",EXPIRED:"EXPIRED",RESOLVED:"RESOLVED"},INVALIDATED:{NEW_SETUP:"WAIT"},EXPIRED:{NEW_SETUP:"WAIT"},RESOLVED:{NEW_SETUP:"WAIT"}};return {version:V,from:p,event:e,to:map[p]?.[e]||p};
}
function selfTest(){const a=transition("WAIT","TRIGGER_CONFIRMED"),b=transition("CONFIRMING","TRIGGER_STABLE"),c=transition("ACTIVE","INVALIDATED");return {ok:a.to==="CONFIRMING"&&b.to==="ACTIVE"&&c.to==="INVALIDATED",version:V};}
module.exports={VERSION:V,transition,selfTest};
