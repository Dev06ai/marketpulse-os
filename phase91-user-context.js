/** Phase 91 */
const V="91.0.0";function resolve(i={}){return {version:V,experience:["BEGINNER","INTERMEDIATE","ADVANCED"].includes(i.experience)?i.experience:"BEGINNER",riskPct:Number.isFinite(Number(i.riskPct))?Number(i.riskPct):null,accountSize:Number.isFinite(Number(i.accountSize))?Number(i.accountSize):null,presentationOnly:true};
}
function selfTest(){const a=resolve({experience:"ADVANCED",riskPct:1,accountSize:10000}),b=resolve({experience:"OTHER"});return {ok:a.experience==="ADVANCED"&&a.riskPct===1&&a.accountSize===10000&&b.experience==="BEGINNER"&&b.presentationOnly,version:V};}
module.exports={VERSION:V,resolve,selfTest};
