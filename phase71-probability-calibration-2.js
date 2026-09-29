/** Phase 71 */
const V="71.0.0";function calibrate(rows=[]){const bins=Array.from({length:10},()=>({n:0,p:0,o:0}));for(const r of rows){const raw=Number(r.probability),p=Math.max(0,Math.min(1,raw>1?raw/100:raw));const o=Number(r.outcome);if(!Number.isFinite(p)||(o!==0&&o!==1))continue;const b=Math.min(9,Math.floor(p*10));bins[b].n++;bins[b].p+=p;bins[b].o+=o;}return {version:V,bins:bins.map(x=>({n:x.n,predicted:x.n?x.p/x.n:null,observed:x.n?x.o/x.n:null})),sample:bins.reduce((a,x)=>a+x.n,0)};
}
function selfTest(){const x=calibrate([{probability:.8,outcome:1},{probability:80,outcome:0},{probability:.2,outcome:0}]);return {ok:x.sample===3&&x.bins[8].n===2&&x.bins[2].n===1,version:V};}
module.exports={VERSION:V,calibrate,selfTest};
