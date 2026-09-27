const {getActiveAnalystPack}=require("./analyst-scenario-pack");
/*
  Reaction Map layer
  -------------------
  Converts discretionary "price reaches a confluence zone, then reacts" ideas
  into deterministic conditional scenarios.

  The layer does NOT issue a live trade by itself. It produces:
  - WATCH_ZONE: price has not confirmed a reaction yet.
  - CONFIRM_LONG / CONFIRM_SHORT: the latest candle has confirmed a reaction.
  - BREAKOUT_LONG / BREAKDOWN_SHORT: the zone has been decisively broken and the
    preferred entry is the retest/hold, not the first impulse candle.

  Inputs are candle-only plus already-computed structure/derivatives context.
  This keeps historical replay deterministic and avoids pretending OHLCV contains
  hidden tick-level information.
*/

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const num=(x,d=null)=>Number.isFinite(Number(x))?Number(x):d;

function atrSeries(c,p=14){
  const out=Array(c.length).fill(NaN);
  if(c.length<p)return out;
  const tr=[];
  for(let i=0;i<c.length;i++){
    if(i===0)tr.push(Math.max(0,c[i].h-c[i].l));
    else tr.push(Math.max(
      c[i].h-c[i].l,
      Math.abs(c[i].h-c[i-1].c),
      Math.abs(c[i].l-c[i-1].c)
    ));
  }
  let a=tr.slice(0,p).reduce((s,v)=>s+v,0)/p;
  out[p-1]=a;
  for(let i=p;i<c.length;i++){a=((p-1)*a+tr[i])/p;out[i]=a}
  return out;
}

function volumeZ(c,i,p=30){
  const start=Math.max(0,i-p),w=c.slice(start,i);
  if(w.length<10)return 0;
  const m=w.reduce((s,x)=>s+(Number(x.v)||0),0)/w.length;
  const variance=w.reduce((s,x)=>s+((Number(x.v)||0)-m)**2,0)/w.length;
  const sd=Math.sqrt(variance);
  return sd>0?((Number(c[i]?.v)||0)-m)/sd:0;
}

function wick(candle){
  const range=Math.max(1e-9,candle.h-candle.l);
  const body=Math.abs(candle.c-candle.o);
  const upper=candle.h-Math.max(candle.o,candle.c);
  const lower=Math.min(candle.o,candle.c)-candle.l;
  return {
    range,body,upper,lower,
    upperRatio:upper/range,lowerRatio:lower/range,
    closePos:(candle.c-candle.l)/range
  };
}

function intervalLookback(interval){
  const tf=String(interval||"1h").toLowerCase();
  if(tf==="15m")return 96;
  if(tf==="30m")return 48;
  if(tf==="1h")return 24;
  if(tf==="4h")return 18;
  if(tf==="1d")return 14;
  return 24;
}

function localSwing(c,lookback){
  const end=c.length-1,start=Math.max(0,end-lookback+1);
  let hi=-Infinity,lo=Infinity,hiIndex=start,loIndex=start;
  for(let i=start;i<=end;i++){
    if(c[i].h>hi){hi=c[i].h;hiIndex=i}
    if(c[i].l<lo){lo=c[i].l;loIndex=i}
  }
  return {high:hi,low:lo,highIndex:hiIndex,lowIndex:loIndex,start,end};
}

function rangePoc(c,start,end,bins=32){
  const from=Math.max(0,start),to=Math.min(c.length-1,end);
  if(to-from<8)return null;
  let lo=Infinity,hi=-Infinity,total=0;
  for(let i=from;i<=to;i++){lo=Math.min(lo,c[i].l);hi=Math.max(hi,c[i].h);total+=Math.max(0,Number(c[i].v)||0)}
  if(!Number.isFinite(lo)||!Number.isFinite(hi)||hi<=lo)return null;
  const step=(hi-lo)/bins,vol=new Array(bins).fill(0);
  for(let i=from;i<=to;i++){
    const tp=(c[i].h+c[i].l+c[i].c)/3;
    const idx=Math.max(0,Math.min(bins-1,Math.floor((tp-lo)/step)));
    vol[idx]+=Math.max(0,Number(c[i].v)||0);
  }
  let best=0;
  for(let i=1;i<bins;i++)if(vol[i]>vol[best])best=i;
  const poc=lo+(best+.5)*step;
  return {poc,totalVolume:total,low:lo,high:hi};
}

function fibZones(swing,atrNow){
  const span=Math.max(swing.high-swing.low,atrNow);
  const zonePad=Math.max(atrNow*.08,swing.high*.00018);
  const extPad=Math.max(atrNow*.10,swing.high*.00025);
  const out=[];
  if(swing.lowIndex<swing.highIndex){
    const gpTop=swing.high-span*.618;
    const gpBottom=swing.high-span*.65;
    out.push({
      id:"GOLDEN_POCKET_SUPPORT",
      label:"0.618–0.650 golden-pocket support",
      kind:"SUPPORT",
      low:Math.min(gpBottom,gpTop)-zonePad,
      high:Math.max(gpBottom,gpTop)+zonePad,
      center:(gpBottom+gpTop)/2,
      evidence:"Recent upswing retracement"
    });
    out.push({
      id:"EXT_1_1_UP",
      label:"1.1 upside extension",
      kind:"RESISTANCE",
      low:swing.high+extPad*.35,
      high:swing.high+extPad,
      center:swing.high+extPad*.65,
      evidence:"Recent upswing extension"
    });
  }else if(swing.highIndex<swing.lowIndex){
    const gpBottom=swing.low+span*.618;
    const gpTop=swing.low+span*.65;
    out.push({
      id:"GOLDEN_POCKET_RESISTANCE",
      label:"0.618–0.650 golden-pocket resistance",
      kind:"RESISTANCE",
      low:Math.min(gpBottom,gpTop)-zonePad,
      high:Math.max(gpBottom,gpTop)+zonePad,
      center:(gpBottom+gpTop)/2,
      evidence:"Recent downswing retracement"
    });
    out.push({
      id:"EXT_1_1_DOWN",
      label:"1.1 downside extension",
      kind:"SUPPORT",
      low:swing.low-extPad,
      high:swing.low-extPad*.35,
      center:swing.low-extPad*.65,
      evidence:"Recent downswing extension"
    });
  }
  return out;
}

function levelEvidence(marketStructure,strategySetups,analystPack=null){
  const out=[];
  for(const l of marketStructure?.levels||[]){
    if(Number.isFinite(Number(l.price))){
      out.push({
        id:l.id,label:l.label||l.id,kind:l.kind==="RESISTANCE"?"RESISTANCE":"SUPPORT",
        low:Number(l.price),high:Number(l.price),center:Number(l.price),evidence:l.timeframe||"KEY LEVEL"
      });
    }
  }
  for(const z of marketStructure?.orderBlocks||[]){
    if(Number.isFinite(Number(z.low))&&Number.isFinite(Number(z.high))){
      out.push({
        id:"OB_"+String(z.createdIndex??z.time??out.length),
        label:z.type==="BEARISH_OB"?"Bearish 2H-style order block":"Bullish 2H-style order block",
        kind:z.side==="SHORT"?"RESISTANCE":"SUPPORT",
        low:Number(z.low),high:Number(z.high),center:(Number(z.low)+Number(z.high))/2,
        evidence:"Order block"
      });
    }
  }
  for(const p of strategySetups?.nakedPocs||[]){
    if(Number.isFinite(Number(p.price))){
      out.push({
        id:p.id,label:"Naked "+String(p.timeframe||"")+" POC",
        kind:Number(p.price)>0?"LEVEL":"LEVEL",
        low:Number(p.price),high:Number(p.price),center:Number(p.price),
        evidence:"Naked POC"
      });
    }
  }
  if(analystPack?.active){
    for(const z of analystPack.zones||[]){
      if(!Number.isFinite(Number(z.low))||!Number.isFinite(Number(z.high)))continue;
      out.push({
        id:z.id,label:"Analyst · "+z.label,kind:z.kind,low:Number(z.low),high:Number(z.high),
        center:(Number(z.low)+Number(z.high))/2,evidence:"Analyst scenario pack",
        analyst:{
          source:analystPack.source,
          primaryAction:z.primaryAction||"WAIT",
          primaryTrigger:z.primaryTrigger||null,
          alternateAction:z.alternateAction||"WAIT",
          alternateTrigger:z.alternateTrigger||null,
          invalidationText:z.invalidationText||null,
          sources:Array.isArray(z.sources)?z.sources.slice(0,8):[]
        }
      });
    }
  }
  return out;
}
function clusterLevels(levels,atrNow){
  const tolerance=Math.max(atrNow*.42,0.0035*Math.max(...levels.map(x=>x.center).filter(Number.isFinite),1));
  const sorted=[...levels].filter(x=>Number.isFinite(Number(x.center))).sort((a,b)=>a.center-b.center);
  const clusters=[];
  for(const item of sorted){
    let target=clusters[clusters.length-1];
    if(!target||Math.abs(item.center-target.center)>tolerance){
      target={items:[item],center:item.center};
      clusters.push(target);
    }else{
      target.items.push(item);
      target.center=target.items.reduce((s,x)=>s+x.center,0)/target.items.length;
    }
  }
  return clusters.map((g,idx)=>{
    const low=Math.min(...g.items.map(x=>Number(x.low))),high=Math.max(...g.items.map(x=>Number(x.high)));
    const kinds=new Set(g.items.map(x=>x.kind).filter(Boolean));
    const analystItem=g.items.find(x=>x.analyst);
    const support=analystItem
      ?analystItem.kind==="SUPPORT"
      :(Number.isFinite(low)&&Number.isFinite(high)?(g.items.filter(x=>x.kind==="SUPPORT").length>=g.items.filter(x=>x.kind==="RESISTANCE").length):false);
    return {
      id:"REACTION_ZONE_"+idx,
      low,high,center:(low+high)/2,
      side:support?"SUPPORT":"RESISTANCE",
      confluence:g.items.length,
      evidence:g.items.map(x=>x.label).slice(0,8),
      evidenceSources:[...new Set(g.items.map(x=>x.evidence).filter(Boolean))],
      analyst:g.items.find(x=>x.analyst)?.analyst||null,
      mixed:kinds.size>1
    };
  });
}

function sideZoneDistance(zone,price){
  if(price<zone.low)return zone.low-price;
  if(price>zone.high)return price-zone.high;
  return 0;
}

function reactionForZone(c,zone,atrNow,ctx={}){
  const i=c.length-1,x=c[i],prev=c[i-1]||x,w=wick(x);
  const buf=Math.max(atrNow*.10,Math.abs(x.c)*.0003);
  const inside=x.h>=zone.low-buf&&x.l<=zone.high+buf;
  const vz=Number(ctx.volumeZ)||0;
  const cvd=String(ctx.cvdState||"").toUpperCase();
  const oi=num(ctx.oiChangePct);
  const positioning=String(ctx.positioning||"").toUpperCase();
  const flowLong=(cvd==="BUYERS CONFIRM"||cvd.includes("BUYERS"))&&(oi===null||oi>-1);
  const flowShort=(cvd==="SELLERS CONFIRM"||cvd.includes("SELLERS"))&&(oi===null||oi>-1);
  const bullishSweep=zone.side==="SUPPORT"&&inside&&x.l<zone.low-buf*.25&&x.c>zone.center+buf*.05&&x.c>x.o&&w.lower>=Math.max(w.body*1.15,atrNow*.16);
  const bearishSweep=zone.side==="RESISTANCE"&&inside&&x.h>zone.high+buf*.25&&x.c<zone.low+buf*.35&&x.c<x.o&&w.upper>=Math.max(w.body*1.15,atrNow*.16);
  const bullishBreak=zone.side==="RESISTANCE"&&prev.c<=zone.high+buf&&x.c>zone.high+buf&&x.c>x.o&&(vz>=.8||flowLong);
  const bearishBreak=zone.side==="SUPPORT"&&prev.c>=zone.low-buf&&x.c<zone.low-buf&&x.c<x.o&&(vz>=.8||flowShort);
  const bullishRetest=zone.side==="RESISTANCE"&&x.l<=zone.high+buf&&x.c>zone.high+buf*.10&&x.c>=x.o;
  const bearishRetest=zone.side==="SUPPORT"&&x.h>=zone.low-buf&&x.c<zone.low-buf*.10&&x.c<=x.o;

  let state="WATCH_ZONE",action="WAIT",confidence=0,trigger="Wait for price to enter and react inside the zone.";
  if(bullishSweep){
    state="CONFIRM_LONG";action="LONG";confidence=84+(flowLong?6:0)+(vz>=.8?4:0);
    trigger="Sweep below support + bullish reclaim close.";
  }else if(bearishSweep){
    state="CONFIRM_SHORT";action="SHORT";confidence=84+(flowShort?6:0)+(vz>=.8?4:0);
    trigger="Sweep above resistance + bearish rejection close.";
  }else if(bullishRetest){
    state="CONFIRM_LONG";action="LONG";confidence=82+(flowLong?5:0);
    trigger="Breakout retest holds above resistance.";
  }else if(bearishRetest){
    state="CONFIRM_SHORT";action="SHORT";confidence=82+(flowShort?5:0);
    trigger="Breakdown retest rejects below support.";
  }else if(bullishBreak){
    state="BREAKOUT_LONG";action="LONG";confidence=76+(flowLong?5:0)+(vz>=1.2?5:0);
    trigger="Close above the confluence zone with participation; prefer the retest.";
  }else if(bearishBreak){
    state="BREAKDOWN_SHORT";action="SHORT";confidence=76+(flowShort?5:0)+(vz>=1.2?5:0);
    trigger="Close below the confluence zone with participation; prefer the retest.";
  }else if(inside){
    confidence=62;
    trigger=zone.side==="SUPPORT"
      ?"Price is inside support; wait for a clean sweep/reclaim or bullish displacement."
      :"Price is inside resistance; wait for a clean sweep/rejection or bullish breakout.";
  }

  const distance=sideZoneDistance(zone,x.c);
  const near=distance<=Math.max(atrNow*.9,Math.abs(x.c)*.006);
  if(state==="WATCH_ZONE"&&!near)confidence=Math.max(0,confidence-18);

  const invalidation=zone.side==="SUPPORT"?zone.low-atrNow*.22:zone.high+atrNow*.22;
  const analystPrimary=zone.analyst?.primaryAction||"WAIT";
  const analystMatch=action!=="WAIT"&&analystPrimary===action;
  return {
    ...zone,state,action,confidence:clamp(Math.round(confidence),0,97),trigger,
    analystMatch,analystPrimaryTrigger:zone.analyst?.primaryTrigger||null,analystAlternateAction:zone.analyst?.alternateAction||"WAIT",analystAlternateTrigger:zone.analyst?.alternateTrigger||null,
    invalidation,price:x.c,distance,near,
    confirmation:{
      volumeZ:vz,
      cvdState:cvd,
      oiChangePct:oi,
      positioning,
      wickUpperRatio:w.upperRatio,
      wickLowerRatio:w.lowerRatio
    }
  };
}

function buildReactionMap(c,{interval="1h",marketStructure=null,strategySetups=null,derivatives=null}={}){
  if(!Array.isArray(c)||c.length<80)return {version:"1.0.0",zones:[],opportunities:[],active:null,note:"Insufficient candles for reaction mapping."};
  const i=c.length-1,atr=Math.max(num(atrSeries(c)[i],Math.max(c[i].c*.005,1)),1);
  const lookback=intervalLookback(interval),swing=localSwing(c,lookback);
  const fib=fibZones(swing,atr);
  const rangeProfile=rangePoc(c,Math.max(0,c.length-lookback),c.length-1,32);
  const rangePocEvidence=rangeProfile?[
    {id:"RANGE_POC",label:"Range POC",kind:"SUPPORT",low:rangeProfile.poc,high:rangeProfile.poc,center:rangeProfile.poc,evidence:"Range POC"}
  ]:[];
  const analystPack=getActiveAnalystPack();
  const evidence=levelEvidence(marketStructure,strategySetups,analystPack);
  const raw=[...evidence,...rangePocEvidence,...fib];
  const clusters=clusterLevels(raw,atr);
  const zones=clusters
    .filter(z=>Number.isFinite(z.low)&&Number.isFinite(z.high))
    .filter(z=>Math.abs(z.center-c[i].c)<=Math.max(atr*8,c[i].c*.045))
    .sort((a,b)=>Math.abs(a.center-c[i].c)-Math.abs(b.center-c[i].c))
    .slice(0,6);
  const volumeZNow=volumeZ(c,i);
  const ctx={...derivatives,volumeZ:volumeZNow};
  const opportunities=zones.map(z=>reactionForZone(c,z,atr,ctx))
    .sort((a,b)=>(b.state!=="WATCH_ZONE"?1:0)-(a.state!=="WATCH_ZONE"?1:0) || b.confidence-a.confidence || a.distance-b.distance)
    .slice(0,4);
  const active=opportunities.find(x=>x.action!=="WAIT")||opportunities.find(x=>x.near)||null;
  return {
    version:"1.0.0",
    interval,
    price:c[i].c,
    atr,
    analystPack:{id:analystPack.id,source:analystPack.source,asOf:analystPack.asOf,status:analystPack.status,expiresAt:analystPack.expiresAt},
    analystScenarios:analystPack.scenarios,
    swing:{high:swing.high,low:swing.low,highIndex:swing.highIndex,lowIndex:swing.lowIndex},
    zones:opportunities,
    opportunities:opportunities.filter(x=>x.action!=="WAIT"),
    active,
    playbook:{
      bullishReaction:"Support sweep + reclaim with constructive flow.",
      bullishContinuation:"Resistance breakout + retest hold with participation.",
      bearishReaction:"Resistance sweep + rejection with seller confirmation.",
      bearishContinuation:"Support breakdown + retest rejection with participation."
    },
    note:"Conditional scenarios only. A zone is not a trade until its reaction criteria are met."
  };
}

module.exports={buildReactionMap};
