/*
  Strategy-aware price-action layer:
  - Daily / weekly SFP and breakout-retests live in market-structure.js.
  - This module adds D-Line trendline breakouts and naked POC SFP detection.

  Naked POC is calculated from candle-volume profiles. Because OHLCV candles do not
  contain trade-at-price distribution, POC uses a deterministic typical-price volume
  allocation proxy rather than pretending to have tick-level volume.
*/

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const n=(x,d=null)=>Number.isFinite(Number(x))?Number(x):d;

function keyDay(t){
  const d=new Date(Number(t));
  return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());
}
function keyWeek(t){
  const d=new Date(Number(t)),day=d.getUTCDay(),delta=day===0?-6:1-day;
  return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+delta);
}

function atr(c,p=14){
  const out=Array(c.length).fill(NaN); if(c.length<p)return out;
  const tr=c.map((x,i)=>i===0?Math.max(0,x.h-x.l):Math.max(x.h-x.l,Math.abs(x.h-c[i-1].c),Math.abs(x.l-c[i-1].c)));
  let a=tr.slice(0,p).reduce((s,v)=>s+v,0)/p; out[p-1]=a;
  for(let i=p;i<c.length;i++){a=((p-1)*a+tr[i])/p;out[i]=a}
  return out;
}

function grouped(c,keyFn){
  const m=new Map();
  for(const x of c){
    const k=keyFn(x.t);
    let g=m.get(k); if(!g)m.set(k,g={key:k,high:-Infinity,low:Infinity,candles:[]});
    g.high=Math.max(g.high,x.h); g.low=Math.min(g.low,x.l); g.candles.push(x);
  }
  return [...m.values()].sort((a,b)=>a.key-b.key);
}

function profile(group,bins=32){
  const lo=group.low,hi=group.high,span=Math.max(hi-lo,1e-9),step=span/bins;
  const vol=new Array(bins).fill(0);
  for(const x of group.candles){
    const tp=(x.h+x.l+x.c)/3;
    const idx=Math.max(0,Math.min(bins-1,Math.floor((tp-lo)/step)));
    vol[idx]+=Math.max(0,Number(x.v)||0);
  }
  let best=0; for(let i=1;i<bins;i++)if(vol[i]>vol[best])best=i;
  return {poc:lo+(best+.5)*step,bins,low:lo,high:hi,totalVolume:vol.reduce((s,v)=>s+v,0)};
}

function wasTouched(c,fromIndex,toIndex,price,tolerance){
  for(let i=fromIndex;i<=toIndex&&i<c.length;i++){
    const x=c[i];
    if(x.l<=price+tolerance&&x.h>=price-tolerance)return true;
  }
  return false;
}

function nakedPocs(c,keyFn,label,bins=32){
  const groups=grouped(c,keyFn); if(groups.length<2)return [];
  const out=[];
  for(let g=0;g<groups.length-1;g++){
    const prof=profile(groups[g],bins);
    const nextStart=c.findIndex(x=>keyFn(x.t)===groups[g+1].key);
    if(nextStart<0)continue;
    const touchedLater=wasTouched(c,nextStart,Math.max(nextStart,c.length-2),prof.poc,Math.max((groups[g].high-groups[g].low)/bins,1)*.35);
    if(!touchedLater){
      out.push({
        id:label+"_NPOC_"+String(groups[g].key),
        kind:"NPOC",
        timeframe:label,
        price:prof.poc,
        sourceKey:groups[g].key,
        sourceHigh:groups[g].high,
        sourceLow:groups[g].low
      });
    }
  }
  return out;
}

function detectNpocSfp(c,level,atrNow){
  const i=c.length-1,x=c[i],a=Math.max(atrNow,Math.max(x.c*.005,1));
  const tol=Math.max(a*.04,x.c*.00025),range=Math.max(x.h-x.l,1e-9),body=Math.abs(x.c-x.o);
  const upper=x.h-Math.max(x.o,x.c),lower=Math.min(x.o,x.c)-x.l;
  if(x.h>level.price+tol&&x.c<level.price-tol*.05&&upper>=Math.max(body*1.15,a*.18)){
    return {...level,side:"SHORT",direction:"BEARISH",score:clamp(80+(level.timeframe==="WEEKLY"?8:4)+(upper/range>=.35?6:0),0,97),
      sweepPrice:x.h,reason:"Naked "+level.timeframe+" POC was swept and price closed back below it with bearish rejection."};
  }
  if(x.l<level.price-tol&&x.c>level.price+tol*.05&&lower>=Math.max(body*1.15,a*.18)){
    return {...level,side:"LONG",direction:"BULLISH",score:clamp(80+(level.timeframe==="WEEKLY"?8:4)+(lower/range>=.35?6:0),0,97),
      sweepPrice:x.l,reason:"Naked "+level.timeframe+" POC was swept and price closed back above it with bullish rejection."};
  }
  return null;
}

function pivotHigh(c,i,left=2,right=2){
  if(i<left||i+right>=c.length)return false;
  for(let j=i-left;j<=i+right;j++)if(j!==i&&c[j].h>c[i].h)return false;
  return true;
}
function pivotLow(c,i,left=2,right=2){
  if(i<left||i+right>=c.length)return false;
  for(let j=i-left;j<=i+right;j++)if(j!==i&&c[j].l<c[i].l)return false;
  return true;
}
function lineAt(a,b,x){
  if(!a||!b||b.i===a.i)return null;
  return a.p+(b.p-a.p)*(x-a.i)/(b.i-a.i);
}

function trendlineAngleDeg(p1,p2,atrNow){
  const bars=Math.max(1,Math.abs(p2.i-p1.i));
  const slope=Math.abs((p2.p-p1.p)/bars);
  const normalized=slope/Math.max(Number(atrNow)||1,1e-9);
  return Math.atan(normalized)*180/Math.PI;
}

function chooseTrendLine(points,direction,c,i,atrNow){
  if(!Array.isArray(points)||points.length<2)return null;
  const pool=points.slice(-8);
  const tol=Math.max(atrNow*.28,c[i].c*.0009);
  let best=null;
  for(let a=0;a<pool.length-1;a++){
    for(let b=a+1;b<pool.length;b++){
      const p1=pool[a],p2=pool[b];
      if(p2.i<=p1.i)continue;
      if(direction==="DOWN"&&!(p2.p<p1.p))continue;
      if(direction==="UP"&&!(p2.p>p1.p))continue;
      const touches=pool.filter(p=>{
        const line=lineAt(p1,p2,p.i);
        return Number.isFinite(line)&&Math.abs(p.p-line)<=tol;
      });
      if(touches.length<2)continue;
      const angle=trendlineAngleDeg(p1,p2,atrNow);
      const angleScore=Math.max(0,1-Math.abs(angle-45)/45);
      const recency=p2.i/Math.max(i,1);
      const value=touches.length*20+angleScore*15+recency*10;
      if(!best||value>best.value){
        best={p1,p2,touches,angle,tolerance:tol,value};
      }
    }
  }
  return best;
}

function dLineChecklist(interval,trend,entryMode,biggerTrend,bodyClose,rangeState){
  return {
    timeframe:interval,
    allowedTimeframes:["15m","1h"],
    timeframePass:interval==="15m"||interval==="1h",
    trendLineTouches:trend?.touches?.length||0,
    preferredTouches:3,
    touchesPass:(trend?.touches?.length||0)>=2,
    touchesPreferred:(trend?.touches?.length||0)>=3,
    angleProxyDeg:trend?.angle??null,
    targetAngleDeg:45,
    anglePass:Number.isFinite(Number(trend?.angle))&&Number(trend.angle)>=22.5&&Number(trend.angle)<=67.5,
    biggerTrend:String(biggerTrend||"UNKNOWN").toUpperCase(),
    biggerTrendAligned:Boolean(biggerTrend),
    bodyCloseConfirmed:Boolean(bodyClose),
    entryMode:entryMode||null,
    entryRule:"Break-out Entry or Re-test",
    rangingMarket:String(rangeState||"UNKNOWN").toUpperCase()==="RANGE",
    rangingManagement:"Aggressive profit taking",
    minimumRR:2,
    stopRule:"Stop Loss below recent low",
    riskChecklistSource:"Risk to Reward Ratio 2:1 or more; source checklist also contains the wording 'Risking more than 3% of Capital Place' and this source wording is preserved without changing the existing stricter risk controls.",
    emotionalChecklist:[
      "Did you take losses today",
      "Are you over-excited",
      "Did you consume alcohol or are under the influence of any drugs",
      "Am I ok with the loss"
    ],
    execution:{
      entry:"Break-out Entry or Re-test",
      takeProfit1:"0.618 Fib Retracement (Protect Position)",
      takeProfit2:"Local high from start of trend"
    }
  };
}

function detectDLine(c,interval,higher){
  if(!["15m","1h"].includes(interval)||c.length<80||!higher)return null;
  const i=c.length-1, x=c[i], prev=c[i-1]||x;
  const atrNow=Math.max(atr(c)[i]||x.c*.005,1),buf=Math.max(atrNow*.08,x.c*.00025);
  const hReg=String(higher.regime||"UNKNOWN").toUpperCase();
  const highs=[],lows=[];
  for(let j=Math.max(3,i-60);j<i-2;j++){
    if(pivotHigh(c,j))highs.push({i:j,p:c[j].h});
    if(pivotLow(c,j))lows.push({i:j,p:c[j].l});
  }
  const volumeWindow=c.slice(Math.max(0,i-30),i);
  const avgV=volumeWindow.length?volumeWindow.reduce((s,z)=>s+(Number(z.v)||0),0)/volumeWindow.length:0;

  const resistance=chooseTrendLine(highs,"DOWN",c,i,atrNow);
  if(resistance){
    const linePrev=lineAt(resistance.p1,resistance.p2,i-1);
    const lineNow=lineAt(resistance.p1,resistance.p2,i);
    const breakout=Number.isFinite(linePrev)&&Number.isFinite(lineNow)&&prev.c<=linePrev+buf&&x.c>lineNow+buf&&x.c>x.o;
    const retest=Number.isFinite(linePrev)&&Number.isFinite(lineNow)&&prev.c>linePrev+buf&&x.l<=lineNow+buf&&x.c>lineNow&&x.c>=x.o;
    const mode=breakout?"BREAKOUT":retest?"RETEST":null;
    if(mode&&hReg==="UPTREND"){
      const bodyClose=x.c>lineNow;
      const check=dLineChecklist(interval,resistance,mode,hReg,bodyClose,null);
      const score=clamp(74+
        (check.touchesPreferred?8:check.touchesPass?4:0)+
        (check.anglePass?6:0)+
        (bodyClose?4:0)+
        (mode==="RETEST"?4:0),0,97);
      return {
        kind:"D_LINE_BREAKOUT",side:"LONG",direction:"BULLISH",score,timeframe:interval.toUpperCase(),
        lineType:"DESCENDING_RESISTANCE",entryMode:mode,linePrev,lineNow,pivot1:resistance.p1,pivot2:resistance.p2,
        trendTouches:resistance.touches,angleDeg:resistance.angle,checklist:check,
        recentLow:Math.min(...c.slice(Math.max(0,i-20),i).map(z=>z.l)),
        reason:"D-Line bullish breakout/retest: body closed above descending resistance with the bigger trend aligned bullish."
      };
    }
  }

  const support=chooseTrendLine(lows,"UP",c,i,atrNow);
  if(support){
    const linePrev=lineAt(support.p1,support.p2,i-1);
    const lineNow=lineAt(support.p1,support.p2,i);
    const breakdown=Number.isFinite(linePrev)&&Number.isFinite(lineNow)&&prev.c>=linePrev-buf&&x.c<lineNow-buf&&x.c<x.o;
    const retest=Number.isFinite(linePrev)&&Number.isFinite(lineNow)&&prev.c<linePrev-buf&&x.h>=lineNow-buf&&x.c<lineNow&&x.c<=x.o;
    const mode=breakdown?"BREAKOUT":retest?"RETEST":null;
    if(mode&&hReg==="DOWNTREND"){
      const bodyClose=x.c<lineNow;
      const check=dLineChecklist(interval,support,mode,hReg,bodyClose,null);
      const score=clamp(74+
        (check.touchesPreferred?8:check.touchesPass?4:0)+
        (check.anglePass?6:0)+
        (bodyClose?4:0)+
        (mode==="RETEST"?4:0),0,97);
      return {
        kind:"D_LINE_BREAKOUT",side:"SHORT",direction:"BEARISH",score,timeframe:interval.toUpperCase(),
        lineType:"ASCENDING_SUPPORT_BREAK",entryMode:mode,linePrev,lineNow,pivot1:support.p1,pivot2:support.p2,
        trendTouches:support.touches,angleDeg:support.angle,checklist:check,
        recentHigh:Math.max(...c.slice(Math.max(0,i-20),i).map(z=>z.h)),
        reason:"D-Line bearish breakdown/retest: body closed below ascending support with the bigger trend aligned bearish."
      };
    }
  }
  return null;
}
function detectStrategySetups(c,{interval="1h",higher8h=null}={}){
  if(!Array.isArray(c)||c.length<60)return {score:0,setup:null,nakedPocs:[],dLine:null};
  const a=atr(c),i=c.length-1,atrNow=Math.max(a[i]||c[i].c*.005,1);
  const dayNpocs=nakedPocs(c,keyDay,"DAILY",32);
  const weekNpocs=nakedPocs(c,keyWeek,"WEEKLY",32);
  const npocCandidates=[];
  for(const level of [...dayNpocs.slice(-8),...weekNpocs.slice(-8)]){
    const hit=detectNpocSfp(c,level,atrNow);if(hit)npocCandidates.push(hit);
  }
  const dLine=detectDLine(c,interval,higher8h);
  const candidates=dLine?[...npocCandidates,dLine]:npocCandidates;
  candidates.sort((u,v)=>Number(v.score)-Number(u.score));
  return {
    score:candidates.length?Number(candidates[0].score):0,
    setup:candidates[0]||null,
    nakedPocs:[...dayNpocs.slice(-6),...weekNpocs.slice(-6)],
    dLine:dLine?{...dLine,higherRegime:String(higher8h?.regime||"UNKNOWN").toUpperCase()}:null,
    dLineChecklist:dLine?.checklist||dLineChecklist(interval,null,String(higher8h?.regime||"UNKNOWN").toUpperCase(),null,null,null),
    detected:{npocSfps:npocCandidates.length,dLine:Boolean(dLine)}
  };
}

module.exports={detectStrategySetups,nakedPocs,detectDLine};
