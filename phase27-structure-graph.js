/**
 * Phase 27 — Liquidity & Structure Graph
 */
const VERSION="27.0.0";
function build(input={}){
  const nodes=[],edges=[];
  const add=(id,type,label,data)=>{if(data?.detected||data?.active||data?.valid||data?.price!=null)nodes.push({id,type,label,data:data||{}})};
  add("sfp","setup","SFP",input.sfp); add("dline","setup","D-Line",input.dLine);
  add("fvg","imbalance","FVG",input.fvg); add("breaker","structure","Breaker",input.breaker);
  add("npoc","liquidity","NPOC",input.npoc); add("golden","retracement","Golden Pocket",input.goldenPocket);
  add("high","liquidity","Buy-side liquidity",input.liquidity?.high); add("low","liquidity","Sell-side liquidity",input.liquidity?.low);
  const ids=nodes.map(n=>n.id);
  if(ids.includes("sfp")&&ids.includes("high"))edges.push(["sfp","high","sweeps"]);
  if(ids.includes("sfp")&&ids.includes("low"))edges.push(["sfp","low","sweeps"]);
  if(ids.includes("fvg")&&ids.includes("dline"))edges.push(["fvg","dline","overlaps"]);
  if(ids.includes("npoc")&&ids.includes("sfp"))edges.push(["npoc","sfp","context"]);
  return {version:VERSION,nodes,edges};
}
function selfTest(){const x=build({sfp:{detected:true},liquidity:{high:{price:100}}});return {ok:x.nodes.length===2&&x.edges.length===1,version:VERSION};}
module.exports={VERSION,build,selfTest};
