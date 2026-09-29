/** Phase 66 */
const V="66.0.0";function translate(i={}){const type=String(i.contractType||"PERPETUAL").toUpperCase(),mult=Number(i.contractMultiplier||1),tick=Number(i.tickSize||.01);return {version:V,exchange:String(i.exchange||"GENERIC"),contractType:type,contractMultiplier:mult,tickSize:tick,quantityUnit:type==="INVERSE"?"BASE_ASSET":"CONTRACTS"};
}
function selfTest(){const a=translate({exchange:"Bybit",contractType:"INVERSE",contractMultiplier:100,tickSize:.5}),b=translate({exchange:"Binance"});return {ok:a.quantityUnit==="BASE_ASSET"&&a.contractMultiplier===100&&b.quantityUnit==="CONTRACTS",version:V};}
module.exports={VERSION:V,translate,selfTest};
