/** Phase 84 */
const V="84.0.0";function check(i={}){const change=Math.abs(Number(i.changePct||0)),max=Number(i.maxChangePct??10),frozen=Boolean(i.frozenWindow);return {version:V,allowed:change<=max&&!frozen,reasons:[change>max?"CHANGE_BUDGET":"",frozen?"WINDOW_FROZEN":""].filter(Boolean)};
function selfTest(){return {ok:true,version:V};}
module.exports={VERSION:V,check,selfTest};
