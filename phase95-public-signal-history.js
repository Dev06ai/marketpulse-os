/** Phase 95 */
const V="95.0.0";function summarize(rows=[]){const out=(Array.isArray(rows)?rows:[]).map(x=>({id:x.id||null,ts:x.ts||null,symbol:x.symbol||null,interval:x.interval||null,side:x.side||"WAIT",confidence:x.confidence??null,outcome:x.outcome??null,version:x.version||null}));return {version:V,count:out.length,rows:out};
}
function selfTest(){const x=summarize([{id:"1",symbol:"BTCUSDT",interval:"15m",side:"LONG",confidence:.8},{id:"2",symbol:"ETHUSDT"}]);return {ok:x.count===2&&x.rows[0].id==="1"&&x.rows[1].side==="WAIT",version:V};}
module.exports={VERSION:V,summarize,selfTest};
