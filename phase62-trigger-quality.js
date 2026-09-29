/** Phase 62 */
const V="62.0.0";function evaluate(i={}){const direction=["LONG","SHORT"].includes(String(i.direction||"").toUpperCase())?String(i.direction).toUpperCase():"WAIT";const types=[];if(i.closeConfirmation)types.push("CLOSE");if(i.retest)types.push("RETEST");if(i.reclaim)types.push("RECLAIM");if(i.displacement)types.push("DISPLACEMENT");return {version:V,confirmed:types.length>0&&direction!=="WAIT",direction,types,quality:Math.min(100,types.length*25+(i.volumeConfirm?25:0))};
}
function selfTest(){const a=evaluate({direction:"LONG",closeConfirmation:true,volumeConfirm:true}),b=evaluate({direction:"NOT_A_SIDE",closeConfirmation:true}),c=evaluate({direction:"SHORT",retest:true});return {ok:a.confirmed&&a.quality===50&&!b.confirmed&&c.confirmed&&c.direction==="SHORT",version:V};}
module.exports={VERSION:V,evaluate,selfTest};
