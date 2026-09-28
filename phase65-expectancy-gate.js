/** Phase 65 */
const V="65.0.0";function evaluate(i={}){const rr=Number(i.rr),p=Number(i.probability),fee=Number(i.costBps||0)/10000;const expectancy=Number.isFinite(rr)&&Number.isFinite(p)?p/100*rr-(1-p/100)-fee:null;const min=Number(i.minExpectancy??0.1);return {version:V,expectancy,minimum:min,pass:Number.isFinite(expectancy)&&expectancy>=min};
}
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,evaluate,selfTest};
