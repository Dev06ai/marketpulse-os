/*
 Advanced Elliott Wave Bitcoin Knowledge Layer
 Sources:
 - advanced_elliott_wave_bitcoin.pdf (v2.0)
 - advanced_elliott_wave_bitcoin_framework.pdf (v4.2)

 Source-derived rules are kept as separate protocols where the documents differ.
 This layer creates structural context/confluence; it does not guarantee forecasts.
*/

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const n=(x,d=null)=>Number.isFinite(Number(x))?Number(x):d;

function logVector(start,end){
  if(!(start>0)||!(end>0))return null;
  return Math.log(end)-Math.log(start);
}
function absMove(start,end){return Math.abs(logVector(start,end)||0);}

function pivots(c,span=2){
  const hi=[],lo=[];
  for(let i=span;i<c.length-span;i++){
    let ph=true,pl=true;
    for(let j=1;j<=span;j++){
      if(c[i].h<c[i-j].h||c[i].h<c[i+j].h)ph=false;
      if(c[i].l>c[i-j].l||c[i].l>c[i+j].l)pl=false;
    }
    if(ph)hi.push({i,p:c[i].h,type:"HIGH"});
    if(pl)lo.push({i,p:c[i].l,type:"LOW"});
  }
  return {hi,lo};
}

function alternatingCandidates(c){
  const p=pivots(c,2),out=[];
  const all=[...p.hi,...p.lo].sort((a,b)=>a.i-b.i);
  for(let s=0;s<=all.length-5;s++){
    const seq=all.slice(s,s+5);
    if(seq.length<5)continue;
    let ok=true;
    for(let j=1;j<seq.length;j++)if(seq[j].type===seq[j-1].type)ok=false;
    if(!ok)continue;
    const direction=seq[1].p>seq[0].p?"BULLISH":"BEARISH";
    const impulse=direction==="BULLISH"
      ?seq[4].p>seq[2].p&&seq[2].p>seq[0].p
      :seq[4].p<seq[2].p&&seq[2].p<seq[0].p;
    if(!impulse)continue;

    const w1=absMove(seq[0].p,seq[1].p);
    const w2=absMove(seq[1].p,seq[2].p);
    const w3=absMove(seq[2].p,seq[3].p);
    const w4=absMove(seq[3].p,seq[4].p);
    const ratios={
      wave2Of1:w1?w2/w1:null,
      wave3Of1:w1?w3/w1:null,
      wave4Of3:w3?w4/w3:null
    };
    const wave2Invalid=direction==="BULLISH"
      ?seq[2].p<=seq[0].p*0.999
      :seq[2].p>=seq[0].p*1.001;
    const wave3Shortest=w3<=Math.min(w1,w4);
    const wave4OverlapSpot=direction==="BULLISH"
      ?seq[4].p<seq[1].p
      :seq[4].p>seq[1].p;
    const score=clamp(
      55+
      (ratios.wave3Of1>=1.618&&ratios.wave3Of1<=4.236?15:0)+
      (ratios.wave2Of1>=.5&&ratios.wave2Of1<=.99?8:0)+
      (!wave2Invalid?8:-28)+
      (!wave3Shortest?8:-35)+
      (!wave4OverlapSpot?6:-12),
      0,97
    );
    out.push({
      direction,
      points:seq,
      ratios,
      wave2Invalid,
      wave3Shortest,
      wave4OverlapSpot,
      score
    });
  }
  return out.sort((a,b)=>b.score-a.score).slice(0,8);
}

function goldenPocketFromWave1(w1Start,w1End,direction){
  const lo=Math.min(w1Start,w1End),hi=Math.max(w1Start,w1End),span=hi-lo;
  if(!(span>0))return null;
  if(direction==="BULLISH"){
    return {
      protocolA:{low:hi-span*.65,high:hi-span*.618,label:"0.618–0.65 Golden Pocket"},
      protocolB:{low:hi-span*.618,high:hi-span*.5,label:"0.500–0.618 Wave-2 institutional zone"},
      invalidation:w1Start*.999
    };
  }
  return {
    protocolA:{low:lo+span*.618,high:lo+span*.65,label:"0.618–0.65 bearish retracement"},
    protocolB:{low:lo+span*.5,high:lo+span*.618,label:"0.500–0.618 bearish retracement"},
    invalidation:w1Start*1.001
  };
}

function fibonacciTargets(candidate){
  if(!candidate?.points?.length)return null;
  const p=candidate.points,w1=Math.abs(p[1].p-p[0].p);
  const dir=candidate.direction==="BULLISH"?1:-1;
  return {
    wave3:[p[2].p+dir*w1*1.618,p[2].p+dir*w1*2.618],
    wave4:[p[3].p-dir*w1*.382,p[3].p-dir*w1*.236],
    wave5:[p[1].p+dir*w1*.618,p[1].p+dir*w1]
  };
}

function overlapRule(marketType){
  const type=String(marketType||"PERPETUAL").toUpperCase();
  return type.includes("PERP")
    ?{mode:"PERPETUAL",maxOverlapPct:4.5,sourceRule:"4.5% overlap tolerance only during high-volatility liquidation cascades"}
    :{mode:"SPOT",maxOverlapPct:0,sourceRule:"Wave 4 may not overlap Wave 1 price territory"};
}

function buildElliottContext(c,opts={}){
  if(!Array.isArray(c)||c.length<70)return {version:"2.0+4.2",candidates:[],active:null,protocols:{}};
  const candidates=alternatingCandidates(c);
  const active=candidates[0]||null;
  let goldenPocket=null;
  if(active?.points?.length>=2)goldenPocket=goldenPocketFromWave1(active.points[0].p,active.points[1].p,active.direction);

  const targets=fibonacciTargets(active);
  const marketType=opts.marketType||"PERPETUAL";
  const overlap=overlapRule(marketType);
  const oi=n(opts.oiChangePct),funding=n(opts.fundingRate),rsi4h=n(opts.rsi4h),volumeRatio=n(opts.wave2VolumeVs20d);
  const filters={
    wave1DailyRsi: rsi4h===null?"UNKNOWN":rsi4h,
    wave2VolumeDrop: volumeRatio===null?"UNKNOWN":volumeRatio<.65,
    wave3OiExpansion: oi===null?"UNKNOWN":oi>25,
    wave4FundingReset: funding===null?"UNKNOWN":funding<=0,
    wave5Divergence: opts.wave5Divergence===true
  };

  return {
    version:"2.0+4.2",
    active,
    candidates,
    goldenPocket,
    targets,
    overlapRule:overlap,
    filters,
    protocols:{
      fractal:"Bitcoin-specific fractal context with logarithmic wave measurement.",
      extendedWave3:{min:2.618,max:4.236},
      wave2Correction:{preferredMin:.5,preferredMax:.618,deepAllowed:true},
      wave2GoldenPocketA:{low:.618,high:.65},
      wave2InstitutionalB:{low:.5,high:.618},
      wave3:{min:1.618,max:2.618},
      wave4:{min:.236,max:.382},
      wave5:{reference:.618},
      buyProtocolA:"After verified 5-wave Wave 1, wait for correction; 0.618–0.65 region.",
      buyProtocolB:"Three tranches in 0.500–0.618 region; source specifies 100.1% retracement stop.",
      wave4Protocol:"Only after Wave 3 reaches 1.618; 0.382 Wave-3 retracement.",
      pyramidingReference:{maxSourceRisk:1.5,initial:1.0,add:0.5,rsi4hStopAdding:82}
    },
    invalidations:{
      wave2:active?.wave2Invalid||false,
      wave3Shortest:active?.wave3Shortest||false,
      wave4OverlapSpot:overlap.mode==="SPOT"?(active?.wave4OverlapSpot||false):false
    },
    note:"Source-derived Elliott context. Candidate wave counts remain hypotheses and require live market confirmation."
  };
}

function elliottConfluence({side,context,derivatives,candles}={}){
  if(!context?.active)return {score:0,reasons:[],flags:[]};
  const c=context.active;
  let score=0;const reasons=[],flags=[];
  const candidateSide=c.direction==="BULLISH"?"LONG":"SHORT";
  if(candidateSide===side){score+=12;reasons.push("Active Elliott candidate agrees with direction.");}
  else {score-=10;flags.push("Elliott candidate is counter-directional");}
  if(!c.wave2Invalid&&!c.wave3Shortest&&!c.wave4OverlapSpot){score+=12;reasons.push("Core Elliott invalidation rules remain intact.");}
  else flags.push("One or more core Elliott invalidation checks failed");
  if(c.ratios.wave3Of1>=2.618&&c.ratios.wave3Of1<=4.236){score+=6;reasons.push("Wave-3 extension is inside the Bitcoin-specific source range.");}
  if(context.goldenPocket&&(side==="LONG"||side==="SHORT")){
    const price=candles?.at(-1)?.c;
    const z=context.goldenPocket.protocolA;
    const inA=Number.isFinite(price)&&price>=z.low&&price<=z.high;
    if(inA){score+=12;reasons.push("Price is in the 0.618–0.65 Golden Pocket.");}
  }
  if(Number(context.filters.wave3OiExpansion)===true && context.active.ratios.wave3Of1>=1.618){score+=5;reasons.push("OI expansion filter supports Wave-3 context.");}
  const cvd=String(derivatives?.cvdState||"").toUpperCase();
  if((side==="LONG"&&cvd==="BUYERS CONFIRM")||(side==="SHORT"&&cvd==="SELLERS CONFIRM")){score+=5;reasons.push("CVD confirms Elliott direction.");}
  return {score:clamp(score,-20,45),reasons,flags};
}

module.exports={buildElliottContext,elliottConfluence,goldenPocketFromWave1};
