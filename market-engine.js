const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const last=v=>v[v.length-1];
const finiteOr=(v,fallback)=>Number.isFinite(v)?v:fallback;

function sma(v,p){const o=[];let s=0;for(let i=0;i<v.length;i++){s+=v[i];if(i>=p)s-=v[i-p];o.push(i+1>=p?s/p:NaN)}return o}
function rma(v,p){const o=Array(v.length).fill(NaN);if(v.length<p)return o;let s=0;for(let i=0;i<p;i++)s+=v[i];let a=s/p;o[p-1]=a;for(let i=p;i<v.length;i++){a=((p-1)*a+v[i])/p;o[i]=a}return o}
function ema(v,p){const o=[],k=2/(p+1);let e=v[0];for(let i=0;i<v.length;i++){e=i===0?v[i]:v[i]*k+e*(1-k);o.push(e)}return o}
function stdev(v,p){const o=[];for(let i=0;i<v.length;i++){if(i+1<p){o.push(NaN);continue}const w=v.slice(i-p+1,i+1),m=w.reduce((a,b)=>a+b,0)/p;o.push(Math.sqrt(w.reduce((a,b)=>a+(b-m)**2,0)/p))}return o}

function rsi(v,p=14){
  const o=Array(v.length).fill(NaN);let gains=[],losses=[];
  for(let i=1;i<v.length;i++){const d=v[i]-v[i-1];gains.push(Math.max(d,0));losses.push(Math.max(-d,0))}
  const ag=rma(gains,p),al=rma(losses,p);
  for(let i=p;i<v.length;i++){const g=ag[i-1],l=al[i-1];o[i]=l===0?100:100-100/(1+g/l)}
  return o;
}

function atr(c,p=14){
  const tr=[];for(let i=0;i<c.length;i++){
    if(i===0)tr.push(c[i].h-c[i].l);
    else tr.push(Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c)));
  }
  return rma(tr,p);
}

function rmaFinite(v,p){
  const out=Array(v.length).fill(NaN);
  let start=-1,count=0;
  for(let i=0;i<v.length;i++){if(Number.isFinite(v[i])){count++;if(count===p){start=i;break}}}
  if(start<0)return out;
  let a=0;for(let i=start-p+1;i<=start;i++)a+=v[i];a/=p;out[start]=a;
  for(let i=start+1;i<v.length;i++){if(Number.isFinite(v[i]))a=((p-1)*a+v[i])/p;out[i]=a}
  return out;
}

function adx(c,p=14){
  const tr=[],plus=[],minus=[];
  for(let i=1;i<c.length;i++){
    const x=c[i],q=c[i-1];
    tr.push(Math.max(x.h-x.l,Math.abs(x.h-q.c),Math.abs(x.l-q.c)));
    const up=x.h-q.h,down=q.l-x.l;
    plus.push(up>down&&up>0?up:0);
    minus.push(down>up&&down>0?down:0);
  }
  const atrR=rma(tr,p),pR=rma(plus,p),mR=rma(minus,p),dx=[];
  for(let i=0;i<tr.length;i++){
    if(!Number.isFinite(atrR[i])||atrR[i]===0){dx.push(NaN);continue}
    const pdi=100*pR[i]/atrR[i],mdi=100*mR[i]/atrR[i],sum=pdi+mdi;
    dx.push(sum===0?0:100*Math.abs(pdi-mdi)/sum);
  }
  const ax=rmaFinite(dx,p),out=Array(c.length).fill(NaN);
  for(let i=0;i<ax.length;i++)if(Number.isFinite(ax[i]))out[i+1]=ax[i];
  return out;
}

function volumeZ(v,p=30){const m=sma(v,p),s=stdev(v,p),i=v.length-1;return Number.isFinite(m[i])&&s[i]?((v[i]-m[i])/s[i]):0}

function structure(c){
  const i=c.length-1, recent=c.slice(Math.max(0,i-30),i+1);
  const mid=Math.max(3,Math.floor(recent.length/4));
  const left=recent.slice(0,Math.max(1,recent.length-mid)), right=recent.slice(Math.max(1,recent.length-mid));
  const priorHigh=Math.max(...left.map(x=>x.h)), priorLow=Math.min(...left.map(x=>x.l));
  const recentHigh=Math.max(...right.map(x=>x.h)), recentLow=Math.min(...right.map(x=>x.l));
  let state="NEUTRAL";
  if(recentHigh>priorHigh&&recentLow>priorLow)state="HIGHER HIGHS";
  else if(recentHigh<priorHigh&&recentLow<priorLow)state="LOWER LOWS";
  else if(recentHigh>priorHigh)state="BULLISH BREAK";
  else if(recentLow<priorLow)state="BEARISH BREAK";
  return {priorHigh,priorLow,recentHigh,recentLow,state};
}

function analyze(c,ctx={}){
  if(!Array.isArray(c)||c.length<220)throw new Error("At least 220 candles are required.");
  const closes=c.map(x=>x.c),volumes=c.map(x=>x.v),i=c.length-1,price=closes[i];
  const E20=ema(closes,20),E50=ema(closes,50),E200=ema(closes,200),R=rsi(closes),A=atr(c),D=adx(c),vz=volumeZ(volumes);
  const atrNow=finiteOr(A[i],Math.max(price*.01,1)),adxNow=finiteOr(D[i],0),rsiNow=finiteOr(R[i],50),st=structure(c);

  const look=c.slice(Math.max(0,i-30),i); // exclude the live candle from structural ranges
  const rangeHigh=Math.max(...look.map(x=>x.h)),rangeLow=Math.min(...look.map(x=>x.l));
  const rangeSize=Math.max(rangeHigh-rangeLow,atrNow);
  const rangePos=rangeSize===0?.5:(price-rangeLow)/rangeSize;

  const prior20=c.slice(Math.max(0,i-20),i);
  const priorHigh=Math.max(...prior20.map(x=>x.h)),priorLow=Math.min(...prior20.map(x=>x.l));
  const breakoutLong=price>priorHigh&&vz>0.8&&rsiNow>52&&adxNow>=20;
  const breakoutShort=price<priorLow&&vz>0.8&&rsiNow<48&&adxNow>=20;

  let regime="RANGE";
  if(price>E50[i]&&E50[i]>E200[i]&&adxNow>=18)regime="UPTREND";
  else if(price<E50[i]&&E50[i]<E200[i]&&adxNow>=18)regime="DOWNTREND";
  if(atrNow/price*100>4)regime="HIGH VOLATILITY";

  const mtf4=ctx.higher?.regime||"UNKNOWN",mtf15=ctx.lower?.regime||"UNKNOWN";
  const momentum=rsiNow>=58?"POSITIVE":rsiNow<=42?"NEGATIVE":"MIXED";
  const volState=Math.abs(vz)>=1.2?"EXPANSION":Math.abs(vz)>=.5?"ELEVATED":"NORMAL";
  const deriv=ctx.deriv&&typeof ctx.deriv==="object"&&!ctx.deriv.error?ctx.deriv:null;
  const oiChangePct=Number.isFinite(deriv?.oiChangePct)?deriv.oiChangePct:null;
  const flowBars=({"15m":24,"1h":24,"4h":18,"1d":7})[ctx.interval]||24;
  const flowStart=closes[Math.max(0,i-flowBars)],flowPriceChangePct=Number.isFinite(flowStart)&&flowStart?((price-flowStart)/flowStart)*100:null;
  let cvdState=deriv?.cvdState||"UNKNOWN";
  const cvdDelta=Number.isFinite(deriv?.cvdDelta)?deriv.cvdDelta:null;
  if(cvdDelta!==null&&flowPriceChangePct!==null){
    const pThreshold=ctx.interval==="15m"?0.15:ctx.interval==="1h"?0.35:ctx.interval==="4h"?0.8:1.5;
    if(flowPriceChangePct>pThreshold&&cvdDelta<0)cvdState="BEARISH DIVERGENCE";
    else if(flowPriceChangePct<-pThreshold&&cvdDelta>0)cvdState="BULLISH DIVERGENCE";
    else if(flowPriceChangePct>pThreshold&&cvdDelta>0)cvdState="BUYERS CONFIRM";
    else if(flowPriceChangePct<-pThreshold&&cvdDelta<0)cvdState="SELLERS CONFIRM";
  }
  const currentOi=Number.isFinite(deriv?.oi)?deriv.oi:null;
  const liquidationBias=deriv?.liquidationBias||"UNKNOWN";
  const liquidationTotal=Number.isFinite(deriv?.liquidationTotal)?deriv.liquidationTotal:null;
  const longPercent=Number.isFinite(deriv?.longPercent)?deriv.longPercent:null;
  const shortPercent=Number.isFinite(deriv?.shortPercent)?deriv.shortPercent:null;
  const longShortRatio=Number.isFinite(deriv?.longShortRatio)?deriv.longShortRatio:null;
  let positioning=deriv?.positioning||"UNKNOWN";
  if(oiChangePct!==null&&flowPriceChangePct!==null){
    if(flowPriceChangePct>0.15&&oiChangePct>1)positioning="PRICE + OI: LONG PARTICIPATION";
    else if(flowPriceChangePct>0.15&&oiChangePct<-1)positioning="PRICE UP + OI DOWN: SHORT COVERING";
    else if(flowPriceChangePct<-0.15&&oiChangePct>1)positioning="PRICE DOWN + OI UP: SHORT PARTICIPATION";
    else if(flowPriceChangePct<-0.15&&oiChangePct<-1)positioning="PRICE DOWN + OI DOWN: LONG LIQUIDATION";
    else positioning="OI / PRICE MIXED";
  }else if(currentOi!==null){
    positioning="OI SNAPSHOT";
  }

  let type="NO TRADE",side="WAIT",bias="Neutral";
  const reasons=[];
  const contributors=[];

  const trendLong=regime==="UPTREND"&&price>=E20[i]*.985&&price<=E20[i]*1.02&&rsiNow>=50&&rsiNow<=70;
  const trendShort=regime==="DOWNTREND"&&price<=E20[i]*1.015&&price>=E20[i]*.98&&rsiNow>=30&&rsiNow<=50;
  const rangeLong=regime==="RANGE"&&rsiNow<34&&rangePos<.32;
  const rangeShort=regime==="RANGE"&&rsiNow>66&&rangePos>.68;

  if(breakoutLong){type="BREAKOUT LONG";side="LONG";bias="Bullish";reasons.push("Price has cleared the prior range high","Volume is expanding with the move","Momentum and trend strength confirm the break");}
  else if(breakoutShort){type="BREAKOUT SHORT";side="SHORT";bias="Bearish";reasons.push("Price has cleared the prior range low","Volume is expanding with the move","Momentum and trend strength confirm the break");}
  else if(trendLong){type="LONG SETUP";side="LONG";bias="Bullish";reasons.push("EMA structure is bullish","Price is interacting with the continuation zone","Momentum supports continuation");}
  else if(trendShort){type="SHORT SETUP";side="SHORT";bias="Bearish";reasons.push("EMA structure is bearish","Price is interacting with the continuation zone","Momentum supports continuation");}
  else if(rangeLong){type="RANGE LONG WATCH";side="LONG";bias="Mean reversion";reasons.push("Trend strength is muted","Downside momentum is stretched","Price is near the lower range");}
  else if(rangeShort){type="RANGE SHORT WATCH";side="SHORT";bias="Mean reversion";reasons.push("Trend strength is muted","Upside momentum is stretched","Price is near the upper range");}
  else reasons.push("The current evidence is mixed; no clean trigger has formed");

  // Confluence model — deliberately transparent rather than pretending to be a win probability.
  const components=[
    {name:"Regime",value:(regime==="UPTREND"||regime==="DOWNTREND")?16:6},
    {name:"Trend strength",value:adxNow>=25?11:adxNow>=18?7:2},
    {name:"Momentum",value:(side==="LONG"&&rsiNow>=50&&rsiNow<=68)||(side==="SHORT"&&rsiNow>=32&&rsiNow<=50)?11:4},
    {name:"Volume",value:Math.abs(vz)>=1.2?9:Math.abs(vz)>=.5?6:2},
    {name:"Structure",value:(side==="LONG"&&st.state.includes("BULLISH"))||(side==="SHORT"&&st.state.includes("BEARISH"))?9:4},
    {name:"4H alignment",value:(side==="LONG"&&mtf4==="UPTREND")||(side==="SHORT"&&mtf4==="DOWNTREND")?9:(side==="WAIT"||mtf4==="UNKNOWN"?4:0)},
    {name:"15M alignment",value:(side==="LONG"&&mtf15==="UPTREND")||(side==="SHORT"&&mtf15==="DOWNTREND")?7:(side==="WAIT"||mtf15==="UNKNOWN"?3:0)},
    {name:"CVD pressure",value:side==="WAIT"||cvdState==="UNKNOWN"?3:
      ((side==="LONG"&&cvdState==="BUYERS CONFIRM")||(side==="SHORT"&&cvdState==="SELLERS CONFIRM"))?10:
      ((side==="LONG"&&cvdState==="BEARISH DIVERGENCE")||(side==="SHORT"&&cvdState==="BULLISH DIVERGENCE"))?0:5},
    {name:"OI context",value:side==="WAIT"||oiChangePct===null?3:
      ((side==="LONG"&&(positioning.includes("LONG PARTICIPATION")||positioning.includes("SHORT COVERING")))||
       (side==="SHORT"&&(positioning.includes("SHORT PARTICIPATION")||positioning.includes("LONG LIQUIDATION"))))?8:4},
    {name:"Liquidation context",value:side==="WAIT"||!liquidationBias||liquidationBias==="UNKNOWN"?2:
      ((side==="LONG"&&liquidationBias==="SHORT LIQS DOMINANT")||(side==="SHORT"&&liquidationBias==="LONG LIQS DOMINANT"))?6:3}
  ];  let score=components.reduce((sum,x)=>sum+x.value,0);
  if((side==="LONG"&&mtf4==="DOWNTREND")||(side==="SHORT"&&mtf4==="UPTREND")){score-=20;contributors.push("4H conflict");reasons.push("The 4H trend directly conflicts with this direction");}
  if((side==="LONG"&&mtf15==="DOWNTREND")||(side==="SHORT"&&mtf15==="UPTREND")){score-=10;contributors.push("15M conflict");reasons.push("The 15M trend is working against this direction");}
  if((side==="LONG"&&cvdState==="BEARISH DIVERGENCE")||(side==="SHORT"&&cvdState==="BULLISH DIVERGENCE")){score-=8;contributors.push("CVD divergence");reasons.push("Aggressive flow is diverging from price");}
  if((side==="LONG"&&cvdState==="BUYERS CONFIRM")||(side==="SHORT"&&cvdState==="SELLERS CONFIRM")){score+=4;contributors.push("CVD confirmation");}
  if((side==="LONG"&&positioning.includes("SHORT PARTICIPATION"))||(side==="SHORT"&&positioning.includes("LONG PARTICIPATION"))){score-=6;contributors.push("OI conflict");}
  if((side==="LONG"&&liquidationBias==="LONG LIQS DOMINANT")||(side==="SHORT"&&liquidationBias==="SHORT LIQS DOMINANT")){score-=5;contributors.push("liquidation conflict");reasons.push("Recent liquidation pressure is working against this direction");}
  if((side==="LONG"&&liquidationBias==="SHORT LIQS DOMINANT")||(side==="SHORT"&&liquidationBias==="LONG LIQS DOMINANT")){score+=3;contributors.push("liquidation tailwind");}
  if(regime==="HIGH VOLATILITY"){score-=14;contributors.push("volatility penalty");reasons.push("Volatility is elevated enough to reduce setup quality");}
  if(side==="WAIT")score=Math.min(score,54);
  score=clamp(Math.round(score),0,92);

  let el=null,eh=null,stop=null,tp1=null,tp2=null,rr=null;
  if(side!=="WAIT"){
    const risk=1.15*atrNow;
    if(side==="LONG"){el=price-.25*atrNow;eh=price+.10*atrNow;stop=Math.min(price-risk,rangeLow-.15*atrNow);tp1=price+1.15*atrNow;tp2=price+2.15*atrNow;}
    else {el=price-.10*atrNow;eh=price+.25*atrNow;stop=Math.max(price+risk,rangeHigh+.15*atrNow);tp1=price-1.15*atrNow;tp2=price-2.15*atrNow;}
    rr=Math.abs(tp1-price)/Math.abs(price-stop);
  }

  let status="WAITING";
  if(side!=="WAIT"){
    if(score>=72&&rr>=1.5&&!(mtf4==="DOWNTREND"&&side==="LONG")&&!(mtf4==="UPTREND"&&side==="SHORT"))status="READY";
    else if(score>=55)status="WATCH";
  }

  let mood="CALM";
  if(regime==="HIGH VOLATILITY")mood="HEATED";
  else if(regime==="UPTREND"||regime==="DOWNTREND")mood=adxNow>=25?"TRENDING":"BUILDING";
  else mood="CHOPPY";

  let directionalLean="NEUTRAL";
  if(score>=70&&side==="LONG")directionalLean="BULLISH BIAS";
  else if(score>=70&&side==="SHORT")directionalLean="BEARISH BIAS";
  else if(side==="LONG")directionalLean="LEAN LONG";
  else if(side==="SHORT")directionalLean="LEAN SHORT";

  const thesis=[];
  if(status==="READY"){
    thesis.push(directionalLean+" — multiple timeframes and core momentum/structure inputs are aligned.");
  }else if(status==="WATCH"){
    thesis.push(directionalLean+" — the setup is developing, but at least one confirmation is still missing.");
  }else{
    thesis.push("NEUTRAL / WAIT — the evidence is not aligned enough to justify a high-conviction directional call.");
  }

  if(mtf4!=="UNKNOWN"&&mtf15!=="UNKNOWN"&&mtf4!==mtf15){
    thesis.push("Timeframes are split: the 4H reads "+mtf4+" while 15M reads "+mtf15+".");
  }else if(mtf4!=="UNKNOWN"){
    thesis.push("Higher-timeframe context: "+mtf4+".");
  }
  if(volState==="EXPANSION")thesis.push("Volume is in expansion, so the next candle sequence matters more than a static indicator reading.");
  if(regime==="RANGE")thesis.push("Price is behaving like a range; breakout confirmation or range-edge rejection matters more than chasing the middle.");
  if(regime==="HIGH VOLATILITY")thesis.push("Volatility is elevated; wider noise and faster invalidations lower the quality of marginal setups.");
  if(deriv){
    thesis.push("Derivatives flow: "+cvdState.toLowerCase()+"; positioning: "+positioning.toLowerCase()+".");
    if(liquidationBias&&liquidationBias!=="UNKNOWN")thesis.push("Liquidations: "+liquidationBias.toLowerCase()+".");
    if(longPercent!==null&&shortPercent!==null)thesis.push("Futures positioning split is approximately "+longPercent.toFixed(1)+"% long / "+shortPercent.toFixed(1)+"% short.");
    if(Math.abs(oiChangePct||0)>=3)thesis.push("Open interest has moved "+(oiChangePct>0?"higher":"lower")+" by "+Math.abs(oiChangePct).toFixed(1)+"% over the recent futures window.");
    if(cvdState.includes("DIVERGENCE"))thesis.push("CVD divergence is a warning that price and aggressive futures flow are not fully agreeing.");
  }

  const primaryScenario=side==="LONG"
    ?"Continuation higher while price holds the invalidation zone and momentum stays constructive."
    :side==="SHORT"
    ?"Continuation lower while price stays beneath the trigger zone and bearish momentum persists."
    :"Rotation/range behavior until price breaks a meaningful boundary with volume.";

  const alternateScenario=side==="LONG"
    ?"Bullish thesis weakens if the 15M/4H structure loses alignment or the invalidation level fails."
    :side==="SHORT"
    ?"Bearish thesis weakens if the 15M/4H structure flips and price reclaims the trigger zone."
    :"A directional thesis becomes more credible after a range break plus volume confirmation.";

  const probabilityLabel=score>=80?"HIGH CONFLUENCE":score>=68?"MODERATE-HIGH CONFLUENCE":score>=55?"EARLY / WATCH":"LOW CONFLUENCE";

  const dayBars=Math.max(1,Math.round(1440/(({"15m":15,"1h":60,"4h":240,"1d":1440})[ctx.interval]||60)));
  const lookback=Math.min(i,dayBars);
  const change24h=lookback?((price-closes[i-lookback])/closes[i-lookback])*100:0;

  return {
    price,change24h,ema20:E20[i],ema50:E50[i],ema200:E200[i],rsi:rsiNow,adx:adxNow,atrPct:atrNow/price*100,volumeZ:vz,
    regime,mood,momentum,volState,structure:st.state,type,side,bias,directionalLean,probabilityLabel,
    score,status,reasons,contributors,components,
    derivatives:{available:!!deriv,oi:currentOi,cvdState,positioning,oiChangePct,cvdDelta,cvdRatio:deriv?.cvdRatio??null,flowPriceChangePct,tradeCount:deriv?.tradeCount??0,fundingRate:deriv?.fundingRate??null,longPercent,shortPercent,longShortRatio,liquidationBias:liquidationBias&&liquidationBias!=="UNKNOWN"?liquidationBias:"NOT AVAILABLE",liquidationTotal,provider:deriv?.provider??null,errors:deriv?.errors??[]},
    thesis:thesis.join(" "),thesisParts:thesis,
    primaryScenario,alternateScenario,
    mtf:{lower:mtf15,higher:mtf4},stop,tp1,tp2,entryLow:el,entryHigh:eh,rr,
    rangeHigh,rangeLow,rangePosition:rangePos,priorHigh,priorLow,updatedAt:Date.now()
  };
}

function summarize(results){
  const trades=results.length,wins=results.filter(x=>x.r>0).length,losses=results.filter(x=>x.r<0).length;
  const netR=results.reduce((s,x)=>s+x.r,0),grossWin=results.filter(x=>x.r>0).reduce((s,x)=>s+x.r,0),grossLoss=Math.abs(results.filter(x=>x.r<0).reduce((s,x)=>s+x.r,0));
  let equity=0,peak=0,maxDD=0; for(const x of results){equity+=x.r;peak=Math.max(peak,equity);maxDD=Math.max(maxDD,peak-equity)}
  return {trades,wins,losses,winRate:trades?wins/trades*100:0,netR,avgR:trades?netR/trades:0,profitFactor:grossLoss?grossWin/grossLoss:null,maxDrawdownR:maxDD,expectancyR:trades?netR/trades:0};
}
function backtest(c){
  const results=[];
  for(let i=220;i<c.length-18;i++){
    const a=analyze(c.slice(0,i+1),{interval:"1h"});if(a.side==="WAIT"||!a.stop||!a.tp1||a.status==="WAITING")continue;
    let r=0,exitIndex=null;
    for(let j=i+1;j<=Math.min(i+18,c.length-1);j++){
      const x=c[j];
      if(a.side==="LONG"){if(x.l<=a.stop){r=-1;exitIndex=j;break}if(x.h>=a.tp1){r=1;exitIndex=j;break}}
      else {if(x.h>=a.stop){r=-1;exitIndex=j;break}if(x.l<=a.tp1){r=1;exitIndex=j;break}}
    }
    if(exitIndex!==null)results.push({i,r,side:a.side,type:a.type,score:a.score});
  }
  return summarize(results);
}
function backtestBySetup(c){
  const buckets={};
  const add=(key,r)=>{(buckets[key]||(buckets[key]=[])).push(r)};
  for(let i=220;i<c.length-18;i++){
    const a=analyze(c.slice(0,i+1),{interval:"1h"});if(a.side==="WAIT"||!a.stop||!a.tp1||a.status==="WAITING")continue;
    let r=0,exitIndex=null;
    for(let j=i+1;j<=Math.min(i+18,c.length-1);j++){
      const x=c[j];
      if(a.side==="LONG"){if(x.l<=a.stop){r=-1;exitIndex=j;break}if(x.h>=a.tp1){r=1;exitIndex=j;break}}
      else {if(x.h>=a.stop){r=-1;exitIndex=j;break}if(x.l<=a.tp1){r=1;exitIndex=j;break}}
    }
    if(exitIndex!==null){add("ALL",{r});add(a.type,{r});add(a.side,{r});add(a.regime,{r})}
  }
  return Object.fromEntries(Object.entries(buckets).map(([k,v])=>[k,summarize(v)]));
}

module.exports={analyze,backtest,backtestBySetup};