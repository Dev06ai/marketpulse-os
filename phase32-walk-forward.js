/**
 * Phase 32 — Walk-forward evaluation
 */
const VERSION="32.0.0";
function evaluate(rows=[],{train=100,test=50,step=50,fn}={}){
  const out=[];for(let start=0;start+train+test<=rows.length;start+=Math.max(1,step)){
    const trainRows=rows.slice(start,start+train),testRows=rows.slice(start+train,start+train+test);
    const model=typeof fn==="function"?fn(trainRows):null;
    const result=typeof fn==="function"?fn(testRows,model,true):{sample:testRows.length};
    out.push({start,train:testRows.length?trainRows.length:0,test:testRows.length,result});
  }
  return {version:VERSION,windows:out};
}
function selfTest(){const x=evaluate([1,2,3,4,5,6],{train:2,test:2,step:2,fn:r=>({mean:r.reduce((a,b)=>a+b,0)/r.length})});return {ok:x.windows.length===2,version:VERSION};}
module.exports={VERSION,evaluate,selfTest};
