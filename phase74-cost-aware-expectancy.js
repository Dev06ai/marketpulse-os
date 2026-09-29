/** Phase 74 */
const V="74.0.0";function evaluate(i={}){const rawP=Number(i.winProbability),p=Number.isFinite(rawP)?(rawP>1?rawP/100:rawP):NaN,win=Number(i.averageWinR),loss=Math.abs(Number(i.averageLossR??1)),costR=Math.max(0,Number(i.costR||0));const expectancy=Number.isFinite(p)&&Number.isFinite(win)?p*win-(1-p)*loss-costR:null;return {version:V,expectancy,pass:Number.isFinite(expectancy)&&expectancy>Number(i.minimumExpectancyR??0)};
}
function selfTest(){const a=evaluate({winProbability:.6,averageWinR:2,averageLossR:1,costR:.05,minimumExpectancyR:.1}),b=evaluate({winProbability:.4,averageWinR:1,averageLossR:1,costR:0,minimumExpectancyR:.1});return {ok:a.pass&&!b.pass&&a.expectancy>b.expectancy,version:V};}
module.exports={VERSION:V,evaluate,selfTest};
