const assert=require("assert");
const {detectMarketStructure}=require("../market-structure");
const {evaluate}=require("../phase9-10");

function baseCandles(){
  const out=[];
  const start=Date.UTC(2026,8,22,0,0,0),hour=3600000;
  for(let i=0;i<72;i++){
    const t=start+i*hour;
    const day=i<24?100:i<48?100:i<71?100:100;
    const c=100+((i%9)-4)*0.08;
    out.push({t,o:c-.1,h:c+1,l:c-1,c,v:1000});
  }
  return out;
}

function shortSfpCandles(){
  const c=baseCandles();
  // Previous day establishes resistance at 110 and support at 90.
  c[30]={t:c[30].t,o:109,c:109.5,h:110,l:108,v:1200};
  c[40]={t:c[40].t,o:100,c:100.2,h:110,l:99,v:1200};
  // Current day SFP: sweep above prior-day high, then close back below with rejection.
  c[71]={t:c[71].t,o:109.8,c:109.6,h:112.0,l:109.2,v:2600};
  return c;
}

function longSfpCandles(){
  const c=baseCandles();
  // Previous day establishes support at 90 and resistance at 110.
  c[30]={t:c[30].t,o:91,c:90.5,h:92,l:90,v:1200};
  c[40]={t:c[40].t,o:100,c:99.8,h:101,l:90,v:1200};
  // Current day SFP: sweep below prior-day low, then reclaim with rejection.
  c[71]={t:c[71].t,o:90.2,c:90.4,h:90.8,l:88.0,v:2600};
  return c;
}

const shortStructure=detectMarketStructure(shortSfpCandles(),{interval:"1h"});
assert(shortStructure.setup?.kind==="SFP","Bearish SFP was not detected.");
assert(shortStructure.setup?.side==="SHORT","Bearish SFP did not map to SHORT.");
assert(shortStructure.setup?.timeframe==="DAILY","Bearish SFP should come from the previous daily high.");
assert(shortStructure.setup?.score>=74,"Bearish SFP score fell below dedicated trigger threshold.");

const longStructure=detectMarketStructure(longSfpCandles(),{interval:"1h"});
assert(longStructure.setup?.kind==="SFP","Bullish SFP was not detected.");
assert(longStructure.setup?.side==="LONG","Bullish SFP did not map to LONG.");
assert(longStructure.setup?.timeframe==="DAILY","Bullish SFP should come from the previous daily low.");
assert(longStructure.setup?.score>=74,"Bullish SFP score fell below dedicated trigger threshold.");

function decision(side){
  const isLong=side==="LONG";
  return evaluate({
    interval:"1h",
    analysis:{
      side,
      status:"READY",
      score:86,
      price:100,
      entryLow:isLong?99.7:100.3,
      entryHigh:isLong?100.2:100.6,
      stop:isLong?97:103,
      tp1:isLong?105:95,
      tp2:isLong?108:92,
      rr:2,
      regime:"RANGE",
      type:"DAILY SFP "+side,
      marketStructure:{
        score:84,
        setup:{kind:"SFP",side,score:84,timeframe:"DAILY",levelPrice:isLong?90:110,sweepPrice:isLong?88.5:111.5}
      },
      reactionMap:{active:null,zones:[],opportunities:[]}
    },
    higher:{regime:isLong?"UPTREND":"DOWNTREND"},
    // Deliberately opposite 15M trend: a strong SFP must not get stuck here.
    lower:{regime:isLong?"DOWNTREND":"UPTREND"},
    derivatives:{
      available:true,
      cvdState:isLong?"BUYERS CONFIRM":"SELLERS CONFIRM",
      oiChangePct:isLong?2:-2,
      orderBook:{imbalance:isLong?.15:-.15},
      takerImbalance:isLong?.10:-.10,
      liquidationBias:isLong?"SHORT LIQS DOMINANT":"LONG LIQS DOMINANT",
      completeness:{cvd:true,oi:true,book:true,liquidations:true},
      livePointCount:12
    },
    consensus:{consensusQualityPct:95,priceDispersionBps:10,sourceCount:3,independentSourceCount:2},
    dataQuality:{candleAgeMs:1000},
    liveFlow:{liveConnected:true,livePointCount:12},
    propGate:{decision:"ELIGIBLE"}
  });
}

const shortDecision=decision("SHORT");
assert(shortDecision.state==="READY","Valid bearish SFP was detected but final SHORT signal was blocked.");
assert(shortDecision.action==="SHORT","Final bearish SFP decision is not SHORT.");
assert(shortDecision.evidence.strictGate?.eligible===true,"Bearish SFP strict gate should be eligible.");

const longDecision=decision("LONG");
assert(longDecision.state==="READY","Valid bullish SFP was detected but final LONG signal was blocked.");
assert(longDecision.action==="LONG","Final bullish SFP decision is not LONG.");
assert(longDecision.evidence.strictGate?.eligible===true,"Bullish SFP strict gate should be eligible.");

console.log("SFP end-to-end checks passed:",{
  shortDetected:shortStructure.setup,
  longDetected:longStructure.setup,
  shortDecision:{state:shortDecision.state,action:shortDecision.action,confluence:shortDecision.market.confluenceScore},
  longDecision:{state:longDecision.state,action:longDecision.action,confluence:longDecision.market.confluenceScore}
});
