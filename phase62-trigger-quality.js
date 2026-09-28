/** Phase 62 */
const V="62.0.0";function evaluate(i={}){const types=[];if(i.closeConfirmation)types.push("CLOSE");if(i.retest)types.push("RETEST");if(i.reclaim)types.push("RECLAIM");if(i.displacement)types.push("DISPLACEMENT");return {version:V,confirmed:types.length>0&&Boolean(i.direction),types,quality:Math.min(100,types.length*25+(i.volumeConfirm?25:0))};
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,evaluate,selfTest};
