/** Phase 79 */
const V="79.0.0";function score(i={}){const move=Number(i.subsequentMoveR),trigger=Boolean(i.triggerOccurred),side=Boolean(i.correctSide);return {version:V,missed:Number.isFinite(move)&&move>=Number(i.minimumMoveR??1)&&(!trigger||!side),moveR:Number.isFinite(move)?move:null};
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,score,selfTest};
