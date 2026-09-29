/** Phase 72 */
const V="72.0.0";function combine(rows=[]){const valid=(Array.isArray(rows)?rows:[]).map(x=>({...x,probability:Number(x.probability)>1?Number(x.probability)/100:Number(x.probability)})).filter(x=>Number.isFinite(x.probability)&&x.probability>=0&&x.probability<=1&&Number(x.weight||0)>0);let sum=0,w=0;for(const x of valid){sum+=Number(x.probability)*Number(x.weight);w+=Number(x.weight)}const p=w?sum/w:null;return {version:V,probability:p,sources:valid.length,disagreement:valid.length?Math.max(...valid.map(x=>Number(x.probability)))-Math.min(...valid.map(x=>Number(x.probability))):null};
}
function selfTest(){const a=combine([{probability:.8,weight:2},{probability:.6,weight:1}]),b=combine([{probability:120,weight:1},{probability:.2,weight:1}]);return {ok:a.sources===2&&Math.abs(a.probability-(11.0/15.0))<1e-9&&b.probability!==null&&b.probability<1,version:V};}
module.exports={VERSION:V,combine,selfTest};
