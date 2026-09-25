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
  let regime="RANGE";
  if(price>E50[i]&&E50[i]>E200[i]&&adxNow>=18)regime="UPTREND";
  else if(price<E50[i]&&E50[i]<E200[i]&&adxNow>=18)regime="DOWNTREND";
  if(atrNow/price*100>4.0)regime="HIGH VOLATILITY";

  const recent=c.slice(Math.max(0,i-19),i+1),rangeHigh=Math.max(...recent.map(x=>x.h)),rangeLow=Math.min(...recent.map(x=>x.l));
  const rangePos=rangeHigh===rangeLow?.5:(price-rangeLow)/(rangeHigh-rangeLow);
  const body=Math.abs(c[i].c-c[i].o),wick=(c[i].h-c[i].l)-body;
  const momentum=rsiNow>=55?"POSITIVE":rsiNow<=45?"NEGATIVE":"MIXED";
  const mtf4=ctx.higher?.regime||"UNKNOWN", mtf15=ctx.lower?.regime||"UNKNOWN";

  let type="NO TRADE",side="WAIT",bias="Neutral";
  const reasons=[],contributors=[];
  const trendLong=regime==="UPTREND"&&price>=E20[i]*.985&&price<=E20[i]*1.02&&rsiNow>=50&&rsiNow<=70;
  const trendShort=regime==="DOWNTREND"&&price<=E20[i]*1.015&&price>=E20[i]*.98&&rsiNow>=30&&rsiNow<=50;
  const breakoutLong=price>rangeHigh&&vz>0.8&&rsiNow>52&&adxNow>=20;
  const breakoutShort=price<rangeLow&&vz>0.8&&rsiNow<48&&adxNow>=20;
  const rangeLong=regime==="RANGE"&&rsiNow<34&&rangePos<.3;
  const rangeShort=regime==="RANGE"&&rsiNow>66&&rangePos>.7;

  if(breakoutLong){type="BREAKOUT LONG";side="LONG";bias="Bullish";reasons.push("Price is expanding above the recent range","Volume is supporting the move","Trend strength is sufficient for a breakout");}
  else if(breakoutShort){type="BREAKOUT SHORT";side="SHORT";bias="Bearish";reasons.push("Price is expanding below the recent range","Volume is supporting the move","Trend strength is sufficient for a breakout");}
  else if(trendLong){type="LONG SETUP";side="LONG";bias="Bullish";reasons.push("Bullish EMA stack is intact","Price is near a continuation zone","Momentum is compatible with trend continuation");}
  else if(trendShort){type="SHORT SETUP";side="SHORT";bias="Bearish";reasons.push("Bearish EMA stack is intact","Price is near a continuation zone","Momentum is compatible with trend continuation");}
  else if(rangeLong){type="RANGE LONG WATCH";side="LONG";bias="Mean reversion";reasons.push("Trend strength is muted","Momentum is stretched to the downside","Price sits near the lower range");}
  else if(rangeShort){type="RANGE SHORT WATCH";side="SHORT";bias="Mean reversion";reasons.push("Trend strength is muted","Momentum is stretched to the upside","Price sits near the upper range");}
  else reasons.push("The setup does not have enough alignment yet");

  let score=36;
  if(regime==="UPTREND"||regime==="DOWNTREND"){score+=18;contributors.push("trend")}
  if(adxNow>=25){score+=12;contributors.push("trend strength")} else if(adxNow>=18)score+=6;
  if((side==="LONG"&&rsiNow>=50&&rsiNow<=68)||(side==="SHORT"&&rsiNow>=32&&rsiNow<=50)){score+=12;contributors.push("momentum")}
  if(Math.abs(vz)>=.5){score+=8;contributors.push("volume")}
  if((side==="LONG"&&st.state.includes("BULLISH"))||(side==="SHORT"&&st.state.includes("BEARISH"))){score+=8;contributors.push("structure")}
  if((side==="LONG"&&mtf4==="UPTREND")||(side==="SHORT"&&mtf4==="DOWNTREND")){score+=10;contributors.push("4h alignment")}
  if((side==="LONG"&&mtf4==="DOWNTREND")||(side==="SHORT"&&mtf4==="UPTREND")){score-=20;contributors.push("4h conflict");reasons.push("The 4H trend is opposing this setup")}
  if((side==="LONG"&&mtf15==="DOWNTREND")||(side==="SHORT"&&mtf15==="UPTREND")){score-=10;contributors.push("15m conflict");reasons.push("The 15M trend is opposing this setup")}
  if((side==="LONG"&&mtf4==="DOWNTREND")||(side==="SHORT"&&mtf4==="UPTREND")) score=Math.min(score,62);
  if(regime==="HIGH VOLATILITY"){score-=14;contributors.push("volatility penalty")}
  if(side==="WAIT")score=Math.min(score,54);
  score=clamp(Math.round(score),0,92);

  let mood="CALM";
  if(regime==="HIGH VOLATILITY")mood="HEATED";
  else if(regime==="UPTREND"||regime==="DOWNTREND")mood=adxNow>=25?"TRENDING":"BUILDING";
  else mood="CHOPPY";

  let el=null,eh=null,stop=null,tp1=null,tp2=null,rr=null;
  if(side!=="WAIT"){
    const risk=1.15*atrNow;
    if(side==="LONG"){el=price-.25*atrNow;eh=price+.10*atrNow;stop=Math.min(price-risk,rangeLow-.15*atrNow);tp1=price+1.15*atrNow;tp2=price+2.15*atrNow;}
    else {el=price-.10*atrNow;eh=price+.25*atrNow;stop=Math.max(price+risk,rangeHigh+.15*atrNow);tp1=price-1.15*atrNow;tp2=price-2.15*atrNow;}
    rr=Math.abs(tp1-price)/Math.abs(price-stop);
  }

  const dayBars=Math.max(1,Math.round(1440/(({ "15m":15, "1h":60, "4h":240, "1d":1440 })[ctx.interval]||60)));
  const lookback=Math.min(i,dayBars);
  const change24h=lookback?((price-closes[i-lookback])/closes[i-lookback])*100:0;

  return {
    price,change24h,ema20:E20[i],ema50:E50[i],ema200:E200[i],rsi:rsiNow,adx:adxNow,atrPct:atrNow/price*100,volumeZ:vz,
    regime,mood,momentum,structure:st.state,type,side,bias,score,reasons,contributors,
    mtf:{lower:mtf15,higher:mtf4},stop,tp1,tp2,entryLow:el,entryHigh:eh,rr,rangeHigh,rangeLow,rangePosition:rangePos,updatedAt:Date.now()
  };
}

function backtest(c){
  let trades=0,wins=0,losses=0,netR=0;
  for(let i=220;i<c.length-18;i++){
    const a=analyze(c.slice(0,i+1),{});if(a.side==="WAIT"||!a.stop||!a.tp1)continue;
    trades++;let result=0;
    for(let j=i+1;j<=Math.min(i+18,c.length-1);j++){
      const x=c[j];
      if(a.side==="LONG"){if(x.l<=a.stop){result=-1;break}if(x.h>=a.tp1){result=1;break}}
      else {if(x.h>=a.stop){result=-1;break}if(x.l<=a.tp1){result=1;break}}
    }
    netR+=result;if(result>0)wins++;if(result<0)losses++;
  }
  return {trades,wins,losses,winRate:trades?wins/trades*100:0,netR};
}

module.exports={analyze,backtest};