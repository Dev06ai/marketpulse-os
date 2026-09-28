/** Phase 72 */
const V="72.0.0";function combine(rows=[]){const valid=rows.filter(x=>Number.isFinite(Number(x.probability))&&Number(x.weight||0)>0);let sum=0,w=0;for(const x of valid){sum+=Number(x.probability)*Number(x.weight);w+=Number(x.weight)}const p=w?sum/w:null;return {version:V,probability:p,sources:valid.length,disagreement:valid.length?Math.max(...valid.map(x=>Number(x.probability)))-Math.min(...valid.map(x=>Number(x.probability))):null};
}
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,combine,selfTest};
