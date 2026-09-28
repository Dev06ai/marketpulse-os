/**
 * Phase 29 — Signal Calibration
 * Reliability bins for historical score/probability alignment.
 */
const VERSION="29.0.0";
function calibrate(rows=[]){
  const bins=Array.from({length:10},()=>({n:0,pSum:0,oSum:0}));
  for(const r of Array.isArray(rows)?rows:[]){
    const p=Math.max(0,Math.min(1,Number(r.probability)));
    const o=Number(r.outcome);
    if(!Number.isFinite(p)||!(o===0||o===1))continue;
    const b=Math.min(9,Math.floor(p*10));bins[b].n++;bins[b].pSum+=p;bins[b].oSum+=o;
  }
  const reliability=bins.map((b,i)=>({bin:i,n:b.n,predicted:b.n?b.pSum/b.n:null,observed:b.n?b.oSum/b.n:null,error:b.n?Math.abs(b.pSum/b.n-b.oSum/b.n):null}));
  const used=reliability.filter(x=>x.n>0);
  const ece=used.reduce((sum,x)=>sum+x.error*(x.n/(rows.length||1)),0);
  return {version:VERSION,reliability,ece};
}
function selfTest(){const x=calibrate([{probability:.8,outcome:1},{probability:.8,outcome:0},{probability:.2,outcome:0},{probability:.2,outcome:0}]);return {ok=x.ece>0&&x.reliability[8].n===2,version:VERSION};}
module.exports={VERSION,calibrate,selfTest};
