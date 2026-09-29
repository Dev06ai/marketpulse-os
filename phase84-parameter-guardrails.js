/** Phase 84 */
const V="84.0.0";function check(i={}){const change=Math.abs(Number(i.changePct||0)),max=Number(i.maxChangePct??10),frozen=Boolean(i.frozenWindow);return {version:V,allowed:change<=max&&!frozen,reasons:[change>max?"CHANGE_BUDGET":"",frozen?"WINDOW_FROZEN":""].filter(Boolean)};
}
function selfTest(){const a=check({changePct:5,maxChangePct:10}),b=check({changePct:12,maxChangePct:10}),c=check({changePct:5,maxChangePct:10,frozenWindow:true});return {ok:a.allowed&&!b.allowed&&b.reasons.includes("CHANGE_BUDGET")&&!c.allowed&&c.reasons.includes("WINDOW_FROZEN"),version:V};}
module.exports={VERSION:V,check,selfTest};
