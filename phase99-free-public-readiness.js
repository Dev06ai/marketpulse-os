/** Phase 99 */
const V="99.0.0";function gate(i={}){const required=["data","validation","calibration","risk","security","observability","operations"];const missing=required.filter(k=>i[k]!==true);return {version:V,ready:missing.length===0,missing};
}
function selfTest(){const a=gate({data:true,validation:true,calibration:true,risk:true,security:true,observability:true,operations:true}),b=gate({data:true,risk:false});return {ok:a.ready&&!b.ready&&b.missing.includes("VALIDATION")&&b.missing.includes("CALIBRATION"),version:V};}
module.exports={VERSION:V,gate,selfTest};
