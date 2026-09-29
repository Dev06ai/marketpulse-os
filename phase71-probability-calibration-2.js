/** Phase 71 */
const V="71.0.0";function calibrate(rows=[]){const bins=Array.from({length:10},()=>({n:0,p:0,o:0}));for(const r of rows){const raw=Number(r.probability),p=Math.max(0,Math.min(1,raw>1?raw/100:raw));const o=Number(r.outcome);if(!Number.isFinite(p)||(o!==0&&o!==1))continue;const b=Math.min(9,Math.floor(p*10));bins[b].n++;bins[b].p+=p;bins[b].o+=o;}return {version:V,bins:bins.map(x=>({n:x.n,predicted:x.n?x.p/x.n:null,observed:x.n?x.o/x.n:null})),sample:bins.reduce((a,x)=>a+x.n,0)};
}
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,calibrate,selfTest};
