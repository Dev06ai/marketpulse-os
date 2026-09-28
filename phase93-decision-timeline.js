/** Phase 93 */
const V="93.0.0";function build(events=[]){return {version:V,events:(Array.isArray(events)?events:[]).slice(-20).sort((a,b)=>Number(a.ts||0)-Number(b.ts||0))};
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,build,selfTest};
