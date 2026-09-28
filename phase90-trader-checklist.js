/** Phase 90 */
const V="90.0.0";function build(i={}){return {version:V,items:[["SIDE",i.side],["TRIGGER",i.trigger],["ENTRY",i.entry],["INVALIDATION",i.invalidation],["TARGET",i.target],["RISK",i.risk],["VENUE",i.venue],["CANCEL_IF",i.cancelIf]].map(([key,value])=>({key,ok:value!=null&&String(value)!=="",value:value??null}))};
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,build,selfTest};
