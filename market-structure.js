/*
  Market structure / level engine.
  Candle-only by design so the pattern definitions can be replayed historically.
  Levels use UTC day/week boundaries for deterministic exchange-agnostic behavior.
*/

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const finite=(x)=>Number.isFinite(Number(x));
const n=(x,d=null)=>finite(x)?Number(x):d;

function atrSeries(c,p=14){
  const out=Array(c.length).fill(NaN);
  if(c.length<p)return out;
  let tr=[];
  for(let i=0;i<c.length;i++){
    if(i===0)tr.push(c[i].h-c[i].l);
    else tr.push(Math.max(c[i].h-c[i-1].c,c[i].h-c[i-1].c===0?0:Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c)));
  }
  let a=0;
  for(let i=0;i<p;i++)a+=tr[i];
  a/=p;out[p-1]=a;
  for(let i=p;i<c.length;i++){a=((p-1)*a+tr[i])/p;out[i]=a}
  return out;
}

function utcDayKey(t){
  const d=new Date(Number(t));
  return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());
}

function utcWeekKey(t){
  const d=new Date(Number(t));
  const day=d.getUTCDay();
  const delta=day===0?-6:1-day;
  return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+delta);
}

function groupedPreviousLevel(c,keyFn){
  const groups=new Map();
  for(const x of c){
    const k=keyFn(x.t);
    let g=groups.get(k);
    if(!g)groups.set(k,g={k,h:-Infinity,l:Infinity});
    g.h=Math.max(g.h,x.h);g.l=Math.min(g.l,x.l);
  }
  const keys=[...groups.keys()].sort((a,b)=>a-b);
  if(keys.length<2)return null;
  return groups.get(keys[keys.length-2])||null;
}

function levelCatalog(c){
  const day=groupedPreviousLevel(c,utcDayKey);
  const week=groupedPreviousLevel(c,utcWeekKey);
  const latest=c[c.length-1];
  const levels=[];
  if(day){
    levels.push({id:"DAILY_HIGH",label:"Previous Daily High",price:day.h,timeframe:"DAILY",kind:"RESISTANCE"});
    levels.push({id:"DAILY_LOW",label:"Previous Daily Low",price:day.l,timeframe:"DAILY",kind:"SUPPORT"});
  }
  if(week){
    levels.push({id:"WEEKLY_HIGH",label:"Previous Weekly High",price:week.h,timeframe:"WEEKLY",kind:"RESISTANCE"});
    levels.push({id:"WEEKLY_LOW",label:"Previous Weekly Low",price:week.l,timeframe:"WEEKLY",kind:"SUPPORT"});
  }

  const supports=levels.filter(x=>x.kind==="SUPPORT"&&x.price<latest.c).map(x=>x.price);
  const resistances=levels.filter(x=>x.kind==="RESISTANCE"&&x.price>latest.c).map(x=>x.price);
  return {
    levels,
    previousDay:day?{high:day.h,low:day.l}:null,
    previousWeek:week?{high:week.h,low:week.l}:null,
    nearestSupport:supports.length?Math.max(...supports):null,
    nearestResistance:resistances.length?Math.min(...resistances):null
  };
}

function wickMetrics(x){
  const range=Math.max(1e-12,x.h-x.l),body=Math.abs(x.c-x.o);
  const upper=x.h-Math.max(x.o,x.c),lower=Math.min(x.o,x.c)-x.l;
  const closePos=(x.c-x.l)/range;
  return {range,body,upper,lower,upperRatio:upper/range,lowerRatio:lower/range,closePos};
}

function localVolumeZ(c,i,p=30){
  const start=Math.max(0,i-p),w=c.slice(start,i);
  if(w.length<10)return 0;
  const m=w.reduce((s,x)=>s+x.v,0)/w.length;
  const variance=w.reduce((s,x)=>s+(x.v-m)**2,0)/w.length;
  const sd=Math.sqrt(variance);
  return sd>0?(c[i].v-m)/sd:0;
}

function detectSfp(c,levels,atr,i){
  const x=c[i],a=Math.max(n(atr[i],Math.max(x.c*.005,1)),1);
  const m=wickMetrics(x),touch=Math.max(a*.035,x.c*.00025);
  const candidates=[];
  for(const level of levels){
    if(!finite(level.price))continue;
    if(level.kind==="RESISTANCE"){
      const swept=x.h>level.price+touch;
      const reclaimed=x.c<level.price-touch*.05;
      const rejection=m.upper>=Math.max(m.body*1.25,a*.22)&&m.closePos<=.48;
      if(swept&&reclaimed&&rejection){
        const depth=clamp((x.h-level.price)/a,0,1.5);
        const score=clamp(72+(level.timeframe==="WEEKLY"?9:6)+clamp(m.upperRatio*18,0,8)+clamp(depth*5,0,7)+(localVolumeZ(c,i)>=1?4:0),0,98);
        candidates.push({kind:"SFP",side:"SHORT",direction:"BEARISH",levelId:level.id,levelLabel:level.label,timeframe:level.timeframe,levelPrice:level.price,sweepPrice:x.h,score,warnCounterTrend:true,reason:"Price swept the "+level.label.toLowerCase()+" and closed back below it with a rejection wick."});
      }
    }else{
      const swept=x.l<level.price-touch;
      const reclaimed=x.c>level.price+touch*.05;
      const rejection=m.lower>=Math.max(m.body*1.25,a*.22)&&m.closePos>=.52;
      if(swept&&reclaimed&&rejection){
        const depth=clamp((level.price-x.l)/a,0,1.5);
        const score=clamp(72+(level.timeframe==="WEEKLY"?9:6)+clamp(m.lowerRatio*18,0,8)+clamp(depth*5,0,7)+(localVolumeZ(c,i)>=1?4:0),0,98);
        candidates.push({kind:"SFP",side:"LONG",direction:"BULLISH",levelId:level.id,levelLabel:level.label,timeframe:level.timeframe,levelPrice:level.price,sweepPrice:x.l,score,warnCounterTrend:true,reason:"Price swept the "+level.label.toLowerCase()+" and closed back above it with a rejection wick."});
      }
    }
  }
  return candidates;
}

function findOrderBlocks(c,atr,i){
  const zones=[];
  const start=Math.max(20,i-60);
  for(let j=start;j<=i-2;j++){
    const x=c[j],a=Math.max(n(atr[j],Math.max(x.c*.005,1)),1);
    const lookEnd=Math.min(i,j+5);
    const post=c.slice(j+1,lookEnd+1);
    if(!post.length)continue;

    const high=Math.max(...post.map(v=>v.h)),low=Math.min(...post.map(v=>v.l));
    const last=post[post.length-1];
    const bullDisplace= x.c<x.o && last.c>x.h+a*.55 && high>x.h+a*.7;
    const bearDisplace= x.c>x.o && last.c<x.l-a*.55 && low<x.l-a*.7;
    if(bullDisplace){
      zones.push({side:"LONG",kind:"ORDER_BLOCK",type:"BULLISH_OB",time:i,createdIndex:j,low:x.l,high:x.h,score:76,reason:"Bullish displacement left a prior bearish candle as a demand/order-block zone."});
    }
    if(bearDisplace){
      zones.push({side:"SHORT",kind:"ORDER_BLOCK",type:"BEARISH_OB",time:i,createdIndex:j,low:x.l,high:x.h,score:76,reason:"Bearish displacement left a prior bullish candle as a supply/order-block zone."});
    }
  }
  return zones;
}

function orderBlockRejection(c,zones,atr,i){
  const x=c[i],a=Math.max(n(atr[i],Math.max(x.c*.005,1)),1),out=[];
  for(const z of zones){
    const near=(x.h>=z.low-a*.12&&x.l<=z.high+a*.12);
    if(!near)continue;
    const m=wickMetrics(x);
    if(z.side==="SHORT"){
      const reject=x.c<z.high && x.c<=z.openClose?true:x.c<z.high&&m.closePos<.55;
      if(reject&&m.upper>=a*.18){
        out.push({...z,score:clamp(z.score+10+(m.upperRatio>=.35?5:0),0,95),warnCounterTrend:true,reason:"Price returned into a bearish order-block zone and printed rejection."});
      }
    }else{
      const reject=x.c>z.low && x.c>=z.openClose?true:x.c>z.low&&m.closePos>.45;
      if(reject&&m.lower>=a*.18){
        out.push({...z,score:clamp(z.score+10+(m.lowerRatio>=.35?5:0),0,95),warnCounterTrend:true,reason:"Price returned into a bullish order-block zone and printed rejection."});
      }
    }
  }
  return out;
}

function annotateOrderBlocks(zones,c){
  return zones.map(z=>{
    const source=c[z.createdIndex];
    return {...z,openClose:source?Math.min(source.o,source.c):null,sourceOpen:source?.o??null,sourceClose:source?.c??null};
  });
}

function detectBreakoutRetest(c,levels,atr,i){
  const x=c[i],a=Math.max(n(atr[i],Math.max(x.c*.005,1)),1),out=[];
  for(const level of levels){
    const buf=Math.max(a*.10,x.c*.00035);
    const tol=Math.max(a*.14,x.c*.0005);
    const start=Math.max(0,i-5);
    for(let j=i-1;j>=start;j--){
      const b=c[j];
      if(i-j>4)break;
      if(level.kind==="RESISTANCE"){
        if(b.c<=level.price+buf)continue;
        const retest=x.l<=level.price+tol && x.c>level.price+tol*.1 && x.c>=x.o;
        if(retest){
          const volBoost=localVolumeZ(c,j)>=.5?4:0;
          const score=clamp(80+(level.timeframe==="WEEKLY"?7:4)+volBoost,0,96);
          out.push({kind:"BREAKOUT_RETEST",side:"LONG",direction:"BULLISH",levelId:level.id,levelLabel:level.label,timeframe:level.timeframe,levelPrice:level.price,breakoutIndex:j,score,warnCounterTrend:false,reason:"Price broke above the "+level.label.toLowerCase()+" and retested it while holding above the level."});
        }
      }else{
        if(b.c>=level.price-buf)continue;
        const retest=x.h>=level.price-tol && x.c<level.price-tol*.1 && x.c<=x.o;
        if(retest){
          const volBoost=localVolumeZ(c,j)>=.5?4:0;
          const score=clamp(80+(level.timeframe==="WEEKLY"?7:4)+volBoost,0,96);
          out.push({kind:"BREAKOUT_RETEST",side:"SHORT",direction:"BEARISH",levelId:level.id,levelLabel:level.label,timeframe:level.timeframe,levelPrice:level.price,breakoutIndex:j,score,warnCounterTrend:false,reason:"Price broke below the "+level.label.toLowerCase()+" and retested it while holding below the level."});
        }
      }
    }
  }
  return out;
}

function chooseSetup(candidates,price){
  const usable=candidates.filter(Boolean).filter(x=>["LONG","SHORT"].includes(x.side));
  if(!usable.length)return null;
  usable.sort((a,b)=>(Number(b.score)-Number(a.score)) || (a.timeframe==="WEEKLY"?1:0)-(b.timeframe==="WEEKLY"?1:0));
  const top=usable[0];
  return {...top,distancePct:Math.abs(price-top.levelPrice)/price*100};
}

function detectMarketStructure(c,{interval}={}){
  if(!Array.isArray(c)||c.length<40)return {score:0,setup:null,levels:[],orderBlocks:[],note:"insufficient candles"};
  const i=c.length-1,price=c[i].c,atr=atrSeries(c),catalog=levelCatalog(c);
  const sfps=detectSfp(c,catalog.levels,atr,i);
  const obs=annotateOrderBlocks(findOrderBlocks(c,atr,i),c).filter(z=>z.createdIndex<i-1);
  const obReject=orderBlockRejection(c,obs,atr,i);
  const retests=detectBreakoutRetest(c,catalog.levels,atr,i);
  const candidates=[...sfps,...obReject,...retests];
  const setup=chooseSetup(candidates,price);
  const levelScore=setup?setup.score:0;
  return {
    interval:interval||"1h",
    score:levelScore,
    setup,
    levels:catalog.levels,
    previousDay:catalog.previousDay,
    previousWeek:catalog.previousWeek,
    nearestSupport:catalog.nearestSupport,
    nearestResistance:catalog.nearestResistance,
    orderBlocks:obs.slice(-12),
    detected:{sfps:sfps.length,orderBlockRejections:obReject.length,breakoutRetests:retests.length},
    note:setup?setup.reason:"No active daily/weekly SFP, order-block rejection, or breakout-retest trigger."
  };
}

module.exports={detectMarketStructure,levelCatalog};
