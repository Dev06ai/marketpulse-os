/** Phase 79 */
const V="79.0.0";function score(i={}){const move=Number(i.subsequentMoveR),trigger=Boolean(i.triggerOccurred),side=Boolean(i.correctSide);return {version:V,missed:Number.isFinite(move)&&move>=Number(i.minimumMoveR??1)&&(!trigger||!side),moveR:Number.isFinite(move)?move:null};
}
function selfTest(){const a=score({subsequentMoveR:2,triggerOccurred:false,correctSide:true,minimumMoveR:1}),b=score({subsequentMoveR:.5,triggerOccurred:true,correctSide:true,minimumMoveR:1}),c=score({subsequentMoveR:2,triggerOccurred:true,correctSide:false,minimumMoveR:1});return {ok:a.missed&&!b.missed&&c.missed,version:V};}
module.exports={VERSION:V,score,selfTest};
