/** Phase 83 */
const V="83.0.0";function recover(i={}){const drift=Boolean(i.drifted),approved=i.approvedVersion||"LAST_APPROVED";return {version:V,action:drift?"ROLLBACK_TO_APPROVED":"HOLD",target:String(approved)};
}
function selfTest(){const a=recover({drifted:true,approvedVersion:"v2"}),b=recover({drifted:false,approvedVersion:"v2"});return {ok:a.action==="ROLLBACK_TO_APPROVED"&&a.target==="v2"&&b.action==="HOLD",version:V};}
module.exports={VERSION:V,recover,selfTest};
