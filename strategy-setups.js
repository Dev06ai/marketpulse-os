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

function wasTouched(c,fromIndex,price,tolerance){
  for(let i=fromIndex;i<c.length;i++){
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
    const touchedLater=wasTouched(c,nextStart,prof.poc,Math.max((groups[g].high-groups[g].low)/bins,1)*.35);
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

function detectDLine(c,interval,higher){
  if(interval!=="15m"||c.length<80||!higher)return null;
  const i=c.length-1;
  const highs=[],lows=[];
  for(let j=Math.max(3,i-50);j<i-2;j++){
    if(pivotHigh(c,j))highs.push({i:j,p:c[j].h});
    if(pivotLow(c,j))lows.push({i:j,p:c[j].l});
  }
  const a=Math.max(i-50,1);
  const aa=c.slice(Math.max(0,i-30));
  const avgV=aa.length?aa.reduce((s,x)=>s+x.v,0)/aa.length:0;
  const x=c[i],prev=c[i-1],atrNow=Math.max(atr(c)[i]||x.c*.005,1),buf=Math.max(atrNow*.08,x.c*.00025);
  const hReg=String(higher.regime||"UNKNOWN").toUpperCase();

  const rh=highs.slice(-3);
  if(rh.length>=2){
    const p1=rh[rh.length-2],p2=rh[rh.length-1];
    if(p2.p<p1.p&&p2.i>p1.i){
      const linePrev=lineAt(p1,p2,i-1),lineNow=lineAt(p1,p2,i);
      const breakout=Number.isFinite(linePrev)&&Number.isFinite(lineNow)&&prev.c<=linePrev+buf&&x.c>lineNow+buf&&x.c>x.o&&(avgV>0?x.v>=avgV*.85:true);
      if(breakout&&hReg==="UPTREND"){
        return {kind:"D_LINE_BREAKOUT",side:"LONG",direction:"BULLISH",score:92,timeframe:"15M/8H",lineType:"DESCENDING_RESISTANCE",
          linePrev,lineNow,pivot1:p1,pivot2:p2,reason:"D-Line breakout: price broke the descending 15M resistance line with the 8H structure aligned bullish."};
      }
    }
  }
  const rl=lows.slice(-3);
  if(rl.length>=2){
    const p1=rl[rl.length-2],p2=rl[rl.length-1];
    if(p2.p>p1.p&&p2.i>p1.i){
      const linePrev=lineAt(p1,p2,i-1),lineNow=lineAt(p1,p2,i);
      const breakdown=Number.isFinite(linePrev)&&Number.isFinite(lineNow)&&prev.c>=linePrev-buf&&x.c<lineNow-buf&&x.c<x.o&&(avgV>0?x.v>=avgV*.85:true);
      if(breakdown&&hReg==="DOWNTREND"){
        return {kind:"D_LINE_BREAKOUT",side:"SHORT",direction:"BEARISH",score:92,timeframe:"15M/8H",lineType:"ASCENDING_SUPPORT_BREAK",
          linePrev,lineNow,pivot1:p1,pivot2:p2,reason:"D-Line breakdown: price broke the ascending 15M support line with the 8H structure aligned bearish."};
      }
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
    detected:{npocSfps:npocCandidates.length,dLine:Boolean(dLine)}
  };
}

module.exports={detectStrategySetups,nakedPocs,detectDLine};
