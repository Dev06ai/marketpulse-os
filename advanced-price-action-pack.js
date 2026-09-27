/*
  Advanced Bitcoin Price Action + Order Flow Knowledge Pack
  Source-derived from:
  - advanced_bitcoin_price_action_guide.pdf
  - bitcoin_price_action_trading_guide.pdf

  This module encodes documented concepts as structured context and optional
  confluence. It does not claim the source's institutional-causality language
  is independently verified.
*/

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const n=(x,d=null)=>Number.isFinite(Number(x))?Number(x):d;

function wick(x){
  const range=Math.max(1e-9,x.h-x.l),body=Math.abs(x.c-x.o);
  return {
    range,body,
    upper:x.h-Math.max(x.o,x.c),
    lower:Math.min(x.o,x.c)-x.l,
    closePos:(x.c-x.l)/range
  };
}

function dealingRange(c,lookback=96){
  const w=c.slice(Math.max(0,c.length-lookback));
  if(!w.length)return null;
  const high=Math.max(...w.map(x=>x.h)),low=Math.min(...w.map(x=>x.l));
  const mid=low+(high-low)*.5;
  return {high,low,mid,positionLabel: n(c.at(-1)?.c)===null?"UNKNOWN":c.at(-1).c>mid?"PREMIUM":"DISCOUNT"};
}

function detectLiquidityPools(c,lookback=96){
  const w=c.slice(Math.max(0,c.length-lookback));
  if(w.length<5)return {bsl:[],ssl:[]};
  const pivHigh=[],pivLow=[];
  for(let i=2;i<w.length-2;i++){
    if(w[i].h>=w[i-1].h&&w[i].h>=w[i+1].h&&w[i].h>=w[i-2].h&&w[i].h>=w[i+2].h)pivHigh.push(w[i].h);
    if(w[i].l<=w[i-1].l&&w[i].l<=w[i+1].l&&w[i].l<=w[i-2].l&&w[i].l<=w[i+2].l)pivLow.push(w[i].l);
  }
  const cluster=(arr)=>{
    const out=[];
    for(const p of arr){
      const near=out.find(z=>Math.abs(z.price-p)<=Math.max(p*.0008,1));
      if(near){near.count++;near.prices.push(p);near.price=near.prices.reduce((a,b)=>a+b,0)/near.prices.length}
      else out.push({price:p,count:1,prices:[p]});
    }
    return out.filter(x=>x.count>=1).sort((a,b)=>b.count-a.count).slice(0,8);
  };
  return {bsl:cluster(pivHigh),ssl:cluster(pivLow)};
}

function detectFvg(c){
  const out=[];
  for(let i=2;i<c.length;i++){
    const a=c[i-2],b=c[i-1],x=c[i];
    if(a.h<x.l){
      out.push({
        kind:"FVG",side:"LONG",low:a.h,high:x.l,mid:(a.h+x.l)/2,createdIndex:i,
        reason:"Bullish 3-candle displacement gap; source framework uses 50% mitigation."
      });
    }else if(a.l>x.h){
      out.push({
        kind:"FVG",side:"SHORT",low:x.h,high:a.l,mid:(x.h+a.l)/2,createdIndex:i,
        reason:"Bearish 3-candle displacement gap; source framework uses 50% mitigation."
      });
    }
  }
  return out;
}

function activeFvg(c){
  const fvgs=detectFvg(c),i=c.length-1,x=c[i];
  const live=[];
  for(const z of fvgs.slice(-30)){
    if(z.side==="LONG"&&x.l<=z.high&&x.h>=z.low&&x.c>=z.mid)live.push({...z,state:"MITIGATION_50"});
    if(z.side==="SHORT"&&x.h>=z.low&&x.l<=z.high&&x.c<=z.mid)live.push({...z,state:"MITIGATION_50"});
  }
  return live.slice(-6);
}

function detectBreakers(c){
  const out=[];
  for(let i=3;i<c.length;i++){
    const b=c[i-1],x=c[i],p=c[i-2];
    const bullishSweep=p.l<b.l&&x.c>x.h;
    const bearishSweep=p.h>b.h&&x.c<x.l;
    if(bullishSweep){
      out.push({kind:"BREAKER_BLOCK",side:"LONG",low:Math.min(p.l,b.l),high:Math.max(p.h,b.h),createdIndex:i,
        reason:"Failed bearish structure converted into a bullish support shelf after structural breakout."});
    }
    if(bearishSweep){
      out.push({kind:"BREAKER_BLOCK",side:"SHORT",low:Math.min(p.l,b.l),high:Math.max(p.h,b.h),createdIndex:i,
        reason:"Failed bullish structure converted into a bearish resistance shelf after structural breakout."});
    }
  }
  return out.slice(-12);
}

function breakoutQuality(c,side,level){
  const x=c.at(-1); if(!x||!n(level))return {bodyClose:false,volumeExpansion:false};
  const prior=c.slice(-21,-1);
  const avg=prior.length?prior.reduce((s,z)=>s+(Number(z.v)||0),0)/prior.length:null;
  const bodyClose=side==="LONG"?x.c>level:x.c<level;
  const volumeExpansion=avg!==null&&Number(x.v)>=avg*1.15;
  return {bodyClose,volumeExpansion};
}

function sourceRules(){
  return {
    htf:{
      weekly:["WEEKLY_OPEN","PREVIOUS_WEEKLY_HIGH","PREVIOUS_WEEKLY_LOW","UNTESTED_WEEKLY_CLOSE"],
      daily:["CLEAR_SWING_HIGH","CLEAR_SWING_LOW","AGGRESSIVE_TREND_REVERSAL"],
      refine:"Prefer recent candle-body context over repeatedly-chopped legacy levels."
    },
    sfp:{
      sweepRequired:true,
      closeBackInsideRequired:true,
      ifCloseRemainsOutside:"BREAKOUT_NOT_SFP",
      entry:"Exact signal-candle close",
      stop:"Beyond sweep wick apex",
      targets:["MID_RANGE_LIQUIDITY","POLAR_STRUCTURAL_LEVEL"]
    },
    breakout:{
      msb:"Decisive candle close beyond primary swing high/low",
      choch:"Bias preparation, do not chase initial move",
      retest:"Low-velocity return to recently broken structure",
      volumeExpansionRequired:true,
      bodyCloseRequired:true
    },
    advancedExecution:{
      entryTimeframes:["15m","5m"],
      advancedRRFloor:3,
      invalidation:"Structural close beyond the defined invalidation boundary"
    },
    liquidity:{
      buySide:"Above swing highs, equal highs, round numbers",
      sellSide:"Below swing lows, double bottoms, compression ranges",
      premium:"Above 50% of dealing range",
      discount:"Below 50% of dealing range"
    },
    fvg:{definition:"3-candle non-overlap imbalance",entry:"50% mitigation with HTF alignment"},
    orderBlock:{entry:"After complete market structure shift, low-volume pullback to open/mean"},
    breakerBlock:{entry:"Retest of failed order-block shelf after aggressive structural breakout"},
    oi:{
      rapidOIExpansionWithFlatPrice:"Position-build-up context",
      liquidityHuntFollowedByOIExpansion:"Liquidation/reversal context",
      useWith:"CVD + price structure"
    }
  };
}

function buildAdvancedContext(c,opts={}){
  const price=c.at(-1)?.c;
  const range=dealingRange(c,opts.lookback||96);
  const liquidity=detectLiquidityPools(c,opts.lookback||96);
  const fvg=activeFvg(c);
  const breakers=detectBreakers(c).filter(z=>price>=z.low-((range?.high-range?.low)||price)*.01&&price<=z.high+((range?.high-range?.low)||price)*.01);
  return {
    source:"advanced_bitcoin_price_action_guide.pdf + bitcoin_price_action_trading_guide.pdf",
    rules:sourceRules(),
    dealingRange:range,
    liquidity,
    activeFvg:fvg,
    nearbyBreakers:breakers,
    oiContext:opts.oiContext||null
  };
}

function advancedConfluence({side,setup,context,derivatives,candles}={}){
  if(!context)return {score:0,reasons:[],flags:[]};
  let score=0;const reasons=[],flags=[];
  const pos=context.dealingRange?.positionLabel;
  if((side==="SHORT"&&pos==="PREMIUM")||(side==="LONG"&&pos==="DISCOUNT")){score+=12;reasons.push("Price is in the source framework's preferred premium/discount side.");}
  else if((side==="LONG"&&pos==="PREMIUM")||(side==="SHORT"&&pos==="DISCOUNT")){score-=8;flags.push("premium/discount counter-location");}
  if(context.activeFvg?.some(z=>z.side===side)){score+=10;reasons.push("50% FVG mitigation context agrees with direction.");}
  if(context.nearbyBreakers?.some(z=>z.side===side)){score+=10;reasons.push("Nearby breaker shelf agrees with direction.");}
  if(setup?.kind==="SFP"){
    const inside=side==="LONG"?setup.sweepPrice>setup.levelPrice&&setup.reason?.includes("closed back above"):setup.sweepPrice<setup.levelPrice&&setup.reason?.includes("closed back below");
    if(inside){score+=14;reasons.push("SFP close-back-inside condition is satisfied.");}
  }
  const q=breakoutQuality(candles||[],side,setup?.levelPrice);
  if(["BREAKOUT_RETEST","D_LINE_BREAKOUT"].includes(setup?.kind)){
    if(q.bodyClose){score+=7;reasons.push("Breakout body-close confirmation.");}else flags.push("breakout body close not confirmed");
    if(q.volumeExpansion){score+=7;reasons.push("Breakout volume expansion.");}else flags.push("breakout volume expansion not confirmed");
  }
  const cvd=String(derivatives?.cvdState||"").toUpperCase();
  if((side==="LONG"&&cvd==="BUYERS CONFIRM")||(side==="SHORT"&&cvd==="SELLERS CONFIRM")){score+=7;reasons.push("CVD direction confirms.");}
  if(String(cvd).includes("DIVERGENCE")){score-=12;flags.push("CVD divergence");}
  return {score:clamp(score,-20,50),reasons,flags};
}

module.exports={buildAdvancedContext,advancedConfluence,detectFvg,detectBreakers};
