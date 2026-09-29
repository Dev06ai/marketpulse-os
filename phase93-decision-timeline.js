/** Phase 93 */
const V="93.0.0";function build(events=[]){return {version:V,events:(Array.isArray(events)?events:[]).slice(-20).sort((a,b)=>Number(a.ts||0)-Number(b.ts||0))};
}
function selfTest(){const x=build([{ts:3},{ts:1},{ts:2}].concat(Array.from({length:25},(_,i)=>({ts:10+i}))));return {ok:x.events.length===20&&x.events[0].ts===15&&x.events.at(-1).ts===34,version:V};}
module.exports={VERSION:V,build,selfTest};
