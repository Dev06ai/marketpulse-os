/** Phase 70 */
const V="70.0.0";function evaluate(i={}){const range=Number(i.rangeEfficiency),flips=Number(i.directionFlips||0),threshold=Number(i.minEfficiency??.25),maxFlips=Number(i.maxFlips??3);const blocked=(Number.isFinite(range)&&range<threshold)||(Number.isFinite(flips)&&flips>maxFlips);return {version:V,blocked,reasons:[Number.isFinite(range)&&range<threshold?"LOW_RANGE_EFFICIENCY":"",Number.isFinite(flips)&&flips>maxFlips?"EXCESSIVE_FLIPS":""].filter(Boolean)};
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,evaluate,selfTest};
