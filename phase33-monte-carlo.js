/**
 * Phase 33 — Monte Carlo robustness
 */
const VERSION="33.0.0";
function rng(seed){let x=seed>>>0;return()=>{x=(x*1664525+1013904223)>>>0;return x/4294967296}}
function simulate(returns=[],{runs=1000,seed=42}={}){
  const r=rng(seed),path=[],base=Array.isArray(returns)?returns.slice():[];
  for(let i=0;i<runs;i++){let eq=0,peak=0,dd=0,order=base.slice();for(let j=order.length-1;j>0;j--){const k=Math.floor(r()*(j+1)),tmp=order[j];order[j]=order[k];order[k]=tmp}for(const v of order){eq+=Number(v)||0;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq)}path.push({pnl:eq,maxDrawdown:dd})}
  const sorted=path.map(x=>x.pnl).sort((a,b)=>a-b);
  return {version:VERSION,runs,path,p05:sorted[Math.max(0,Math.floor(runs*.05)-1)]??null,p50:sorted[Math.floor(runs*.5)]??null};
}
function selfTest(){const x=simulate([1,-.5,1,-.2],{runs:50});return {ok:x.runs===50&&x.path.length===50,version:VERSION};}
module.exports={VERSION,simulate,selfTest};
