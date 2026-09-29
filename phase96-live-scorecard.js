/** Phase 96 */
const V="96.0.0";function score(i={}){const parts=[Number(i.dataQuality||0),Number(i.calibration||0),Number(i.stability||0),Number(i.expectancy||0),Number(i.observability||0)].filter(Number.isFinite);const total=parts.length?Math.round(parts.reduce((a,b)=>a+b,0)/parts.length):0;return {version:V,score:total,components:parts};
}
function selfTest(){const a=score({dataQuality:100,calibration:80,stability:90,expectancy:70,observability:60}),b=score({});return {ok:a.score===80&&b.score===0,version:V};}
module.exports={VERSION:V,score,selfTest};
