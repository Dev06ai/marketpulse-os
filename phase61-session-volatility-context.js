/** Phase 61 */
const V="61.0.0";function classify(i={}){const session=String(i.session||"UNKNOWN").toUpperCase(),vol=String(i.volatility||"NORMAL").toUpperCase();const favorable=i.liquidity!=="THIN"&&vol!=="EXTREME";return {version:V,session,volatility:vol,favorable,style:vol==="HIGH"?"ACTIVE":vol==="LOW"?"SELECTIVE":"NORMAL"};
}
function selfTest(){const a=classify({session:"LONDON",volatility:"HIGH",liquidity:"NORMAL"}),b=classify({session:"ASIA",volatility:"EXTREME",liquidity:"THIN"});return {ok:a.favorable&&a.style==="ACTIVE"&&!b.favorable&&b.style==="NORMAL"?true:false,version:V};}
module.exports={VERSION:V,classify,selfTest};
