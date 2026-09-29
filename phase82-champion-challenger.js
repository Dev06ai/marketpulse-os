/** Phase 82 */
const V="82.0.0";function compare(i={}){const c=Number(i.championExpectancy),n=Number(i.challengerExpectancy),min=Number(i.minimumImprovementR??.1),sample=Number(i.challengerSamples||0),need=Number(i.minimumSamples??200);const promote=Number.isFinite(c)&&Number.isFinite(n)&&n>=c+min&&sample>=need;return {version:V,promote,champion:c,challenger:n,sample};
}
function selfTest(){const a=compare({championExpectancy:.2,challengerExpectancy:.35,minimumImprovementR:.1,challengerSamples:300,minimumSamples:200}),b=compare({championExpectancy:.2,challengerExpectancy:.25,minimumImprovementR:.1,challengerSamples:300,minimumSamples:200});return {ok:a.promote&&!b.promote&&a.sample===300,version:V};}
module.exports={VERSION:V,compare,selfTest};
