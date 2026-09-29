/** Phase 65 */
const V="65.0.0";function evaluate(i={}){const rr=Number(i.rr),rawP=Number(i.probability),p=Number.isFinite(rawP)?(rawP>1?rawP/100:rawP):NaN;const explicitCostR=Number(i.costR);const entry=Number(i.entry),stop=Number(i.stop),costBps=Number(i.costBps||0);const riskDistance=Math.abs(entry-stop);const fee=Number.isFinite(explicitCostR)&&explicitCostR>=0?explicitCostR:(Number.isFinite(costBps)&&costBps>0&&riskDistance>0&&entry>0?(costBps/10000)*(2*entry/riskDistance):0);const expectancy=Number.isFinite(rr)&&Number.isFinite(p)?p*rr-(1-p)-fee:null;const min=Number(i.minExpectancy??0.1);return {version:V,expectancy,minimum:min,pass:Number.isFinite(expectancy)&&expectancy>=min};
}
function selfTest(){const a=evaluate({rr:2,probability:.6,costBps:0}),b=evaluate({rr:1,probability:.4,costBps:0});return {ok:a.pass&&!b.pass,version:V};}
module.exports={VERSION:V,evaluate,selfTest};
