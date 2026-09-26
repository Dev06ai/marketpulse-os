const VERSION=1;

function num(x, fallback=null){
  const n=Number(x);
  return Number.isFinite(n)?n:fallback;
}
function cleanText(x){return String(x??"").trim();}
function bucketStats(rows){
  const items=new Map();
  for(const r of rows){
    const key=cleanText(r)||"UNKNOWN";
    const x=items.get(key)||{key,total:0,wins:0,losses:0,flats:0,netR:0,grossWin:0,grossLoss:0};
    x.total++;
    const rr=num(r.r,null);
    if(rr===null){items.set(key,x);continue}
    if(rr>0){x.wins++;x.grossWin+=rr}else if(rr<0){x.losses++;x.grossLoss+=Math.abs(rr)}else x.flats++;
    x.netR+=rr;
    items.set(key,x);
  }
  return Array.from(items.values()).map(x=>Object.assign(x,{
    decided:x.wins+x.losses,
    winRate:x.wins+x.losses?x.wins/(x.wins+x.losses)*100:0,
    avgR:x.total?x.netR/x.total:0,
    profitFactor:x.grossLoss?x.grossWin/x.grossLoss:null
  })).sort((a,b)=>b.total-a.total||b.netR-a.netR);
}
function streaks(values){
  let win=0,loss=0,bestWin=0,bestLoss=0,current=0,type=null;
  for(const v of values){
    const t=v>0?"W":v<0?"L":"F";
    if(t==="W"){win++;loss=0}else if(t==="L"){loss++;win=0}else{win=0;loss=0}
    bestWin=Math.max(bestWin,win);bestLoss=Math.max(bestLoss,loss);
    if(t!=="F"){current=t==="W"?win:-loss;type=t}
  }
  return {bestWin,bestLoss,current,type};
}
function drawdown(values){
  let equity=0,peak=0,maxDD=0,maxDDIndex=-1;
  const curve=[];
  values.forEach((v,i)=>{equity+=v;peak=Math.max(peak,equity);const dd=peak-equity;if(dd>maxDD){maxDD=dd;maxDDIndex=i}curve.push({i,equity,peak,dd})});
  return {maxDrawdownR:maxDD,maxDrawdownIndex:maxDDIndex,endingR:equity,curve};
}
function summarize(rows){
  const list=Array.isArray(rows)?rows:[];
  const rrRows=list.map(r=>({raw:r,r:num(r?.r,null)}));
  const valid=rrRows.filter(x=>x.r!==null);
  const wins=valid.filter(x=>x.r>0),losses=valid.filter(x=>x.r<0),flats=valid.filter(x=>x.r===0);
  const grossWin=wins.reduce((a,x)=>a+x.r,0),grossLoss=Math.abs(losses.reduce((a,x)=>a+x.r,0));
  const dd=drawdown(valid.map(x=>x.r));
  const streak=streaks(valid.map(x=>x.r));
  const best=valid.slice().sort((a,b)=>b.r-a.r)[0]?.raw||null;
  const worst=valid.slice().sort((a,b)=>a.r-b.r)[0]?.raw||null;
  const averageWin=wins.length?grossWin/wins.length:0;
  const averageLoss=losses.length?grossLoss/losses.length:0;
  const expectancy=valid.length?valid.reduce((a,x)=>a+x.r,0)/valid.length:0;
  return {
    totalTrades:list.length,
    validR:valid.length,
    invalidR:list.length-valid.length,
    wins:wins.length,
    losses:losses.length,
    flats:flats.length,
    decided:wins.length+losses.length,
    winRate:wins.length+losses.length?wins.length/(wins.length+losses.length)*100:0,
    netR:dd.endingR,
    expectancyR:expectancy,
    averageWinR:averageWin,
    averageLossR:averageLoss,
    profitFactor:grossLoss?grossWin/grossLoss:null,
    maxDrawdownR:dd.maxDrawdownR,
    bestTrade:best?{r:num(best.r,0),asset:best.asset||best.symbol||"—",side:best.side||"—",ts:num(best.ts, null)}:null,
    worstTrade:worst?{r:num(worst.r,0),asset:worst.asset||worst.symbol||"—",side:worst.side||"—",ts:num(worst.ts, null)}:null,
    streak,
    byAsset:bucketStats(list.map(r=>[r.asset||r.symbol||"UNKNOWN",r])),
    bySide:bucketStats(list.map(r=>[r.side||"UNKNOWN",r])),
    byRegime:bucketStats(list.map(r=>[r.regime||"UNKNOWN",r])),
    bySetup:bucketStats(list.map(r=>[r.setup||r.type||"UNKNOWN",r])),
    byHour:bucketStats(list.map(r=>{const ts=num(r.ts,null);if(ts===null)return["UNKNOWN",r];const d=new Date(ts);return[String(d.getHours()).padStart(2,"0")+":00",r]})),
    byWeekday:bucketStats(list.map(r=>{const ts=num(r.ts,null);if(ts===null)return["UNKNOWN",r];const d=new Date(ts);return[d.toLocaleDateString("en-US",{weekday:"short"}),r]}))
  };
}
function normalizeBucketInput(pairs){
  return pairs.map(([key,row])=>Object.assign({},row,{_bucket:key}));
}
function rekeyBuckets(summary,field){
  return summary.map(pair=>[pair, pair]);
}
function fixBuckets(rows){
  const map=(pairs)=>bucketStats(normalizeBucketInput(pairs)).map(x=>{const y=Object.assign({},x);y.key=y._bucket||y.key;delete y._bucket;return y});
  return {
    byAsset:map(rows.map(r=>[cleanText(r.asset||r.symbol)||"UNKNOWN",r])),
    bySide:map(rows.map(r=>[cleanText(r.side)||"UNKNOWN",r])),
    byRegime:map(rows.map(r=>[cleanText(r.regime)||"UNKNOWN",r])),
    bySetup:map(rows.map(r=>[cleanText(r.setup||r.type)||"UNKNOWN",r])),
    byHour:map(rows.map(r=>{const ts=num(r.ts,null);return[ts===null?"UNKNOWN":String(new Date(ts).getHours()).padStart(2,"0")+":00",r]})),
    byWeekday:map(rows.map(r=>{const ts=num(r.ts,null);return[ts===null?"UNKNOWN":new Date(ts).toLocaleDateString("en-US",{weekday:"short"}),r]}))
  };
}
function analyzeJournal(rows){
  const list=Array.isArray(rows)?rows.filter(x=>x&&typeof x==="object"):[];
  const base=summarize(list);
  const buckets=fixBuckets(list);
  const quality={
    score:list.length?Math.round(base.validR/list.length*100):100,
    missingAsset:list.filter(r=>!cleanText(r.asset||r.symbol)).length,
    missingSide:list.filter(r=>!cleanText(r.side)).length,
    invalidR:base.invalidR,
    missingTimestamp:list.filter(r=>num(r.ts,null)===null).length
  };
  const insights=[];
  if(!list.length)insights.push("Add a few completed trades to unlock personal performance analytics.");
  if(base.validR){
    if(base.expectancyR>0)insights.push("Your tracked trades currently have positive average R.");
    else if(base.expectancyR<0)insights.push("Your tracked trades currently have negative average R; review the losing clusters before increasing risk.");
    if(base.maxDrawdownR>2)insights.push("Your realized drawdown is above 2R; inspect the sequence around the largest drawdown.");
    if(base.averageLossR>base.averageWinR&&base.decided>=5)insights.push("Average losses exceed average wins; entries, stop placement, and trade selection deserve review.");
  }
  const biggestAsset=buckets.byAsset.filter(x=>x.key!=="UNKNOWN").sort((a,b)=>Math.abs(b.netR)-Math.abs(a.netR))[0];
  if(biggestAsset&&biggestAsset.total>=3)insights.push(biggestAsset.key+" is the largest current sample by absolute net R impact.");
  return Object.assign({version:VERSION,updatedAt:Date.now(),quality,insights},base,buckets);
}
function qualityCheck({analytics=null,storage=null,marketData=null,derivatives=null}={}){
  const checks={
    analytics:Boolean(analytics&&typeof analytics.totalTrades==="number"),
    storage:Boolean(storage),
    marketData:Boolean(marketData),
    derivatives:Boolean(derivatives),
    formulas:true
  };
  const formulaCases=[
    summarize([{r:1},{r:-0.5}]).netR===0.5,
    Math.abs(summarize([{r:1},{r:-0.5}]).expectancyR-0.25)<1e-9,
    Math.abs(summarize([{r:2},{r:-1},{r:-1}]).maxDrawdownR-2)<1e-9
  ];
  checks.formulas=formulaCases.every(Boolean);
  return {version:VERSION,ok:Object.values(checks).every(Boolean),checks,updatedAt:Date.now()};
}
function selfTest(){
  const a=analyzeJournal([{asset:"BTC",side:"LONG",r:2,ts:Date.now()},{asset:"BTC",side:"SHORT",r:-1,ts:Date.now()},{asset:"ETH",side:"LONG",r:0.5,ts:Date.now()}]);
  const q=qualityCheck({analytics:a,storage:true,marketData:true,derivatives:true});
  return {ok:q.ok,analytics:a,quality:q};
}
module.exports={VERSION,analyzeJournal,qualityCheck,selfTest};
