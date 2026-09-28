/** Phase 95 */
const V="95.0.0";function summarize(rows=[]){const out=(Array.isArray(rows)?rows:[]).map(x=>({id:x.id||null,ts:x.ts||null,symbol:x.symbol||null,interval:x.interval||null,side:x.side||"WAIT",confidence:x.confidence??null,outcome:x.outcome??null,version:x.version||null}));return {version:V,count:out.length,rows:out};
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,summarize,selfTest};
