/** Phase 91 */
const V="91.0.0";function resolve(i={}){return {version:V,experience:["BEGINNER","INTERMEDIATE","ADVANCED"].includes(i.experience)?i.experience:"BEGINNER",riskPct:Number.isFinite(Number(i.riskPct))?Number(i.riskPct):null,accountSize:Number.isFinite(Number(i.accountSize))?Number(i.accountSize):null,presentationOnly:true};
}
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,resolve,selfTest};
