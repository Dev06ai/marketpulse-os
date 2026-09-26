const VERSION="9.10.0";
const n=(x,f=null)=>Number.isFinite(Number(x))?Number(x):f;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const sideOf=a=>["LONG","SHORT"].includes(String(a?.side||"").toUpperCase())?String(a.side).toUpperCase():"WAIT";
function evaluate(x={}){
 const a=x.analysis||{},side=sideOf(a),base=clamp(Math.round(n(a.score,50)),0,100);
 const h=String(x.higher?.regime||"UNKNOWN").toUpperCase(),l=String(x.lower?.regime||"UNKNOWN").toUpperCase();
 let mtf=50;
 if(side==="LONG"){mtf+=(h==="UPTREND"?25:h==="DOWNTREND"?-25:0);mtf+=(l==="UPTREND"?15:l==="DOWNTREND"?-15:0)}
 if(side==="SHORT"){mtf+=(h==="DOWNTREND"?25:h==="UPTREND"?-25:0);mtf+=(l==="DOWNTREND"?15:l==="UPTREND"?-15:0)}
 mtf=clamp(mtf,0,100);
 let data=100;if(n(x.dataQuality?.candleAgeMs,0)>900000)data-=18;if(!x.derivatives||x.derivatives.available===false)data-=12;
 const q=n(x.consensus?.consensusQualityPct);if(q!==null&&q<70)data-=15;if(n(x.consensus?.priceDispersionBps,0)>80)data-=12;data=clamp(data,0,100);
 const conf=clamp(Math.round(base*.7+mtf*.15+data*.15),0,100);
 const blocked=data<60?"DATA_BLOCKED":x.propGate?.decision==="BLOCKED"?"RISK_BLOCKED":side==="WAIT"||a.status==="WAITING"?"NO_TRADE":a.status==="READY"&&conf>=72?"READY":conf>=55?"WATCH":"NO_TRADE";
 const lo=n(a.entryLow),hi=n(a.entryHigh),entry=lo!==null&&hi!==null?(lo+hi)/2:n(a.price),stop=n(a.stop),tp1=n(a.tp1),tp2=n(a.tp2);
 return {version:VERSION,phase9:"9.0.0",phase10:"10.0.0",symbol:x.symbol||"BTCUSDT",interval:x.interval||"1h",generatedAt:Date.now(),state:blocked,action:blockAction(blocked,side),market:{side,score:base,confluenceScore:conf,price:n(a.price),regime:a.regime||"RANGE",status:a.status||"WAITING",type:a.type||"NO TRADE",structure:a.structure||"UNKNOWN",momentum:a.momentum||"UNKNOWN"},levels:{side,entryLow:lo,entryHigh:hi,entry,stop,tp1,tp2,rr:entry!==null&&stop!==null&&tp1!==null?Math.abs(tp1-entry)/Math.abs(entry-stop):n(a.rr)},data:{score:data,candleAgeMs:n(x.dataQuality?.candleAgeMs),derivativesAvailable:Boolean(x.derivatives&&x.derivatives.available!==false),consensusQualityPct:q,priceDispersionBps:n(x.consensus?.priceDispersionBps),liveConnected:Boolean(x.liveFlow?.liveConnected||x.liveFlow?.wsConnected),livePointCount:n(x.liveFlow?.livePointCount)},evidence:{mtfScore:mtf,warnings:data<75?["Data quality is limiting confidence."]:[],thesis:side==="LONG"?"Bullish setup under the current structure and momentum model.":side==="SHORT"?"Bearish setup under the current structure and momentum model.":"Neutral conditions: waiting for clearer structure."},propGate:x.propGate||{decision:"NOT_EVALUATED"},operational:{failSafe:true,executionEnabled:false}};
}
function blockAction(state,side){return state==="READY"?side:"WAIT"}
function selfTest(){const r=evaluate({analysis:{side:"LONG",status:"READY",score:80,price:100,entryLow:99,entryHigh:100,stop:97,tp1:105},higher:{regime:"UPTREND"},lower:{regime:"UPTREND"},derivatives:{available:true},consensus:{consensusQualityPct:95,priceDispersionBps:10},dataQuality:{candleAgeMs:1000},propGate:{decision:"ELIGIBLE"}});return {ok:r.state==="READY"&&r.levels.stop===97,result:r}}
module.exports={VERSION,evaluate,selfTest};
