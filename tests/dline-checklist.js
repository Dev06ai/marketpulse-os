const assert=require("assert");
const {detectDLine}=require("../strategy-setups");
const {evaluate}=require("../phase9-10");

function lineAt(a,b,x){return a+(b-a)*(x-90)/(110-90)}

function descending15m(){
  const out=[],start=Date.UTC(2026,8,27,0,0,0),m=15*60000;
  for(let i=0;i<120;i++){
    const line=130-2*(i-100);
    const h=line-2,l=h-2,o=h-.7,cl=h-.9;
    out.push({t:start+i*m,o,c:cl,h,l,v:1000});
  }
  out[100]={t:start+100*m,o:129.1,c:129.2,h:130,l:127.8,v:1200};
  out[110]={t:start+110*m,o:109.1,c:109.2,h:110,l:107.8,v:1200};
  out[115]={t:start+115*m,o:99.1,c:99.2,h:100,l:97.8,v:1200};
  out[119]={t:start+119*m,o:92.8,c:95.2,h:97,l:90,v:2800};
  return out;
}
function ascending1h(){
  const out=[],start=Date.UTC(2026,8,27,0,0,0),m=3600000;
  for(let i=0;i<120;i++){
    const line=70+2*(i-100);
    const l=line+2,h=l+2,o=l+.7,cl=l+.9;
    out.push({t:start+i*m,o,c:cl,h,l,v:1000});
  }
  out[100]={t:start+100*m,o:70.9,c:70.8,h:73,l:70,v:1200};
  out[110]={t:start+110*m,o:90.9,c:90.8,h:93,l:90,v:1200};
  out[115]={t:start+115*m,o:100.9,c:100.8,h:103,l:100,v:1200};
  out[119]={t:start+119*m,o:108.8,c:105.0,h:110,l:102.0,v:2800};
  return out;
}

const long=detectDLine(descending15m(),"15m",{regime:"UPTREND"});
assert(long?.kind==="D_LINE_BREAKOUT","15m bullish D-Line not detected");
assert(long.side==="LONG","15m D-Line direction should be LONG");
assert(long.checklist.timeframePass===true,"15m timeframe rule failed");
assert(long.checklist.touchesPreferred===true,"D-Line should recognize 3 preferred touches");
assert(long.checklist.anglePass===true,"45-degree angle proxy should pass");
assert(long.checklist.bodyCloseConfirmed===true,"Body-close confirmation should pass");
assert(["BREAKOUT","RETEST"].includes(long.entryMode),"D-Line entry mode missing");
assert(long.checklist.minimumRR===2,"D-Line checklist minimum R:R should be 2:1");

const short=detectDLine(ascending1h(),"1h",{regime:"DOWNTREND"});
assert(short?.kind==="D_LINE_BREAKOUT","1H bearish D-Line not detected");
assert(short.side==="SHORT","1H D-Line direction should be SHORT");
assert(short.checklist.timeframePass===true,"1H timeframe rule failed");
assert(short.checklist.touchesPreferred===true,"1H D-Line should recognize 3 preferred touches");

function decisionWithRR(rr,setup){
  return evaluate({
    interval:setup.timeframe==="15M"?"15m":"1h",
    analysis:{
      side:setup.side,status:"READY",score:90,price:100,entryLow:99.8,entryHigh:100.2,
      stop:setup.side==="LONG"?97:103,tp1:setup.side==="LONG"?100+3*rr:100-3*rr,tp2:setup.side==="LONG"?110:90,
      rr,
      marketStructure:{score:90,setup:{kind:"D_LINE_BREAKOUT",side:setup.side,score:90,timeframe:setup.timeframe}},
      reactionMap:{zones:[],opportunities:[],active:null}
    },
    higher:{regime:setup.side==="LONG"?"UPTREND":"DOWNTREND"},
    lower:{regime:setup.side==="LONG"?"UPTREND":"DOWNTREND"},
    derivatives:{available:true,cvdState:setup.side==="LONG"?"BUYERS CONFIRM":"SELLERS CONFIRM",oiChangePct:2,orderBook:{imbalance:setup.side==="LONG"?.15:-.15},takerImbalance:setup.side==="LONG"?.1:-.1,liquidationBias:setup.side==="LONG"?"SHORT LIQS DOMINANT":"LONG LIQS DOMINANT",completeness:{cvd:true,oi:true,book:true,liquidations:true},livePointCount:10},
    consensus:{consensusQualityPct:95,priceDispersionBps:10},
    dataQuality:{candleAgeMs:1000},
    liveFlow:{liveConnected:true,livePointCount:10},
    propGate:{decision:"ELIGIBLE"}
  });
}

const ready=decisionWithRR(2.1,long);
assert(ready.state==="READY"&&ready.action==="LONG","Qualified D-Line LONG should reach READY");

const blocked=decisionWithRR(1.8,long);
assert(blocked.state==="NO_TRADE"&&blocked.action==="WAIT","D-Line below 2:1 R:R must remain blocked");

console.log("D-Line checklist checks passed:",{
  long:{score:long.score,touches:long.checklist.trendLineTouches,angle:long.checklist.angleProxyDeg,entryMode:long.entryMode},
  short:{score:short.score,touches:short.checklist.trendLineTouches,angle:short.checklist.angleProxyDeg,entryMode:short.entryMode},
  ready:{state:ready.state,action:ready.action},
  rrBlocked:{state:blocked.state,action:blocked.action}
});
