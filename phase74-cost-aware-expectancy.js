/** Phase 74 */
const V="74.0.0";function evaluate(i={}){const rawP=Number(i.winProbability),p=Number.isFinite(rawP)?(rawP>1?rawP/100:rawP):NaN,win=Number(i.averageWinR),loss=Math.abs(Number(i.averageLossR??1)),costR=Math.max(0,Number(i.costR||0));const expectancy=Number.isFinite(p)&&Number.isFinite(win)?p*win-(1-p)*loss-costR:null;return {version:V,expectancy,pass:Number.isFinite(expectancy)&&expectancy>Number(i.minimumExpectancyR??0)};
}
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,evaluate,selfTest};
