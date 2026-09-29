/*
 * MarketPulse Phase 18 — Opportunity Engine / Trade Radar
 * Lifecycle: FORMING -> ARMED -> TRIGGERED -> ENTERED -> MANAGED -> CLOSED
 * Hard invalidation and data-integrity blocks remain in force.
 */

const VERSION="18.0.1";
const TWIN_CACHE=new Map();
const TWIN_INFLIGHT=new Map();
const TWIN_TTL=60000;

function n(x,d=null){const v=Number(x);return Number.isFinite(v)?v:d}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function isWeekdayIndia(ts=Date.now()){
  const d=new Date(new Date(Number(ts)).toLocaleString("en-US",{timeZone:"Asia/Kolkata"})).getDay();
  return d>=1&&d<=5;
}
function sideOf(decision){
  const a=String(decision?.action||"").toUpperCase();
  if(a==="LONG"||a==="SHORT")return a;
  const c=String(decision?.candidateEvidence?.action||"").toUpperCase();
  return ["LONG","SHORT"].includes(c)?c:"WAIT";
}
function effectiveDecision(decision={}){
  const side=sideOf(decision);
  const direct=String(decision?.action||"").toUpperCase();
  const c=decision?.candidateEvidence||{};
  if(["LONG","SHORT"].includes(direct))return {decision,fromCandidate:false,side};
  if(["LONG","SHORT"].includes(String(c.action||"").toUpperCase())){
    return {decision:{...decision,action:String(c.action).toUpperCase(),market:c.market||decision.market||{},levels:c.levels||decision.levels||{}},fromCandidate:true,side};
  }
  return {decision,fromCandidate:false,side:"WAIT"};
}
function dataQuality(decision){
  const value=decision?.data?.score??decision?.dataQuality?.score??decision?.analysis?.dataQualityScore??decision?.market?.dataScore;
  if(Number.isFinite(Number(value)))return Number(value);
  const fresh=Number(decision?.dataQuality?.candleAgeMs);
  return Number.isFinite(fresh)&&fresh<90000?88:85;
}
function score(decision){return n(decision?.market?.confluenceScore??decision?.score,0)}
function rr(decision){return n(decision?.levels?.rr,0)}
function priceNow(state,decision){
  return n(state?.summary?.medianPerpPrice??decision?.market?.price??decision?.price);
}
function entryBand(decision){
  const l=decision?.levels||{},entry=n(l.entry);
  const low=n(l.entryLow,entry),high=n(l.entryHigh,entry);
  if(!Number.isFinite(low)&&!Number.isFinite(high))return null;
  return {low:Math.min(low,high),high:Math.max(low,high),entry};
}
function triggerDistancePct(px,band){
  if(!Number.isFinite(px)||!band)return null;
  const target=Number.isFinite(band.entry)?band.entry:(band.low+band.high)/2;
  return target>0?Math.abs(px-target)/target*100:null;
}
function normalizedImbalance(state){
  return n(state?.summary?.avgOrderbookImbalance,0);
}
function directionalFlowAligned(side,state,decision){
  const imb=normalizedImbalance(state);
  const cvd=String(decision?.derivatives?.cvdState||decision?.analysis?.derivatives?.cvdState||decision?.derivatives?.cvd||"").toUpperCase();
  const ob=side==="LONG"?imb>0.05:side==="SHORT"?imb<-0.05:false;
  const cvdOk=side==="LONG"?/BUYERS|BULLISH/.test(cvd):side==="SHORT"?/SELLERS|BEARISH/.test(cvd):false;
  return {orderbook:ob,cvd:cvdOk,aligned:ob||cvdOk};
}
async function digitalTwin(storage,decision,marketState){
  const symbol=decision?.symbol||"BTCUSDT",interval=decision?.interval||"15m",cacheKey=symbol+"|"+interval,ts=Date.now(),hit=TWIN_CACHE.get(cacheKey);
  if(hit&&ts-hit.ts<TWIN_TTL)return {...hit.payload,cache:"memory",cacheAgeMs:ts-hit.ts};
  if(TWIN_INFLIGHT.has(cacheKey)&&hit)return {...hit.payload,cache:"stale-inflight",stale:true,cacheAgeMs:ts-hit.ts};
  const job=(async()=>{
    const rows=await storage.getLearningPredictions({symbol,interval,limit:900,resolvedOnly:true});
    const side=sideOf(decision),regime=String(decision?.market?.regime||decision?.candidateEvidence?.market?.regime||"UNKNOWN"),type=String(decision?.market?.type||decision?.candidateEvidence?.market?.type||"UNKNOWN");
    const targetScore=score(decision);
    const candidates=(Array.isArray(rows)?rows:[]).map(p=>{
      const pRegime=String(p?.regime||p?.features?.regime||"UNKNOWN");
      const pSide=String(p?.side||"WAIT");
      const pType=String(p?.type||p?.features?.type||"UNKNOWN");
      const pScore=n(p?.score??p?.features?.score,0);
      let sim=0;
      if(pSide===side)sim+=0.35;
      if(pRegime===regime)sim+=0.25;
      if(pType===type)sim+=0.2;
      sim+=0.2*Math.max(0,1-Math.abs(pScore-targetScore)/40);
      return {...p,similarity:sim};
    }).filter(x=>x.similarity>=0.5).sort((a,b)=>b.similarity-a.similarity).slice(0,50);
    let wins=0,losses=0,netR=0;
    for(const p of candidates){
      const o=String(p.outcome||"").toUpperCase();
      if(o==="WIN")wins++;
      if(o==="LOSS")losses++;
      netR+=n(p.resultR,0);
    }
    const resolved=wins+losses;
    return {
      matchedStates:candidates.length,
      wins,losses,
      winRate:resolved?Number((wins/resolved*100).toFixed(1)):null,
      expectancyR:resolved?Number((netR/resolved).toFixed(3)):null,
      similarityTop:Number(candidates[0]?.similarity||0),
      ready:resolved>=8,
      examples:candidates.slice(0,5).map(x=>({candleTs:x.candleTs,side:x.side,score:x.score,regime:x.regime,type:x.type,outcome:x.outcome,resultR:x.resultR,similarity:Number(x.similarity.toFixed(3))}))
    };
  })();
  TWIN_INFLIGHT.set(cacheKey,job);
  try{
    const payload=await job;
    TWIN_CACHE.set(cacheKey,{ts:Date.now(),payload});
    return payload;
  }catch{
    if(hit)return {...hit.payload,cache:"last-good",stale:true,cacheAgeMs:Date.now()-hit.ts};
    return {matchedStates:0,wins:0,losses:0,winRate:null,expectancyR:null,similarityTop:0,ready:false,examples:[]};
  }finally{TWIN_INFLIGHT.delete(cacheKey)}
}

function evaluate(decision,marketState,{weekdayOnly=true,easyMode=true}={}){
  const e=effectiveDecision(decision),d=e.decision,side=e.side;
  const s=score(d),r=rr(d),dq=dataQuality(d),px=priceNow(marketState,d),band=entryBand(d);
  const gate=String(d?.deploymentGate?.state||"PAPER_ONLY").toUpperCase();
  const reasons=[];
  if(weekdayOnly&&!isWeekdayIndia())reasons.push("WEEKEND_PAUSE");
  if(side==="WAIT")reasons.push("NO_DIRECTION");
  if(d?.stale===true)reasons.push("STALE_DECISION");
  if(gate==="BLOCKED")reasons.push("HARD_GATE_BLOCK");
  if(dq<80)reasons.push("DATA_QUALITY");
  if(easyMode){if(s<72)reasons.push("SCORE_LOW");if(r<1.2)reasons.push("RR_LOW");}
  else{if(s<78)reasons.push("SCORE_LOW");if(r<1.5)reasons.push("RR_LOW");if(d?.liveSignalEligible!==true)reasons.push("FINAL_GATE_NOT_READY");}
  const flow=directionalFlowAligned(side,marketState,d);
  if(!flow.aligned&&s>=78)reasons.push("FLOW_NOT_ALIGNED");
  const q=n(marketState?.summary?.consensusQuality,0);
  if(q<60)reasons.push("CROSS_VENUE_QUALITY");
  const dispersion=n(marketState?.summary?.dispersionBps,0);
  if(Number.isFinite(dispersion)&&dispersion>80)reasons.push("VENUE_CONFLICT");
  const dist=triggerDistancePct(px,band);
  const nearBand=Number.isFinite(dist)&&dist<=0.35;
  let status="FORMING";
  if(reasons.length===0)status=nearBand&&flow.aligned?"TRIGGERED":"ARMED";
  if(side==="WAIT"||s<65)status="FORMING";
  const stop=n(d?.levels?.stop),target=n(d?.levels?.tp1);
  const invalidated=Number.isFinite(px)&&Number.isFinite(stop)&&((side==="LONG"&&px<=stop)||(side==="SHORT"&&px>=stop));
  if(invalidated)status="INVALIDATED";
  return {
    ok:true,version:VERSION,status,side,fromCandidate:e.fromCandidate,symbol:d?.symbol||"BTCUSDT",interval:d?.interval||"15m",
    score:s,rr:r,dataQuality:dq,currentPrice:px,entryBand:band,stop,target,tp2:n(d?.levels?.tp2),
    trigger:{nearEntry:nearBand,distancePct:dist,orderbookAligned:flow.orderbook,cvdAligned:flow.cvd,flowAligned:flow.aligned,marketConsensus:q},
    state:{regime:d?.market?.regime||"UNKNOWN",marketType:d?.market?.type||"UNKNOWN",crossVenue:marketState?.regime||null},
    reasons,hardBlocks:reasons.filter(x=>["STALE_DECISION","HARD_GATE_BLOCK","DATA_QUALITY","VENUE_CONFLICT"].includes(x)),
    nextAction:status==="TRIGGERED"?"EXECUTE_CHECK":status==="ARMED"?"WAIT_FOR_TRIGGER":status==="INVALIDATED"?"ABANDON":"WATCH",
    generatedAt:Date.now()
  };
}
function selfTest(){const d={action:"LONG",symbol:"BTCUSDT",interval:"15m",market:{confluenceScore:85,price:100,regime:"UPTREND",type:"SFP"},levels:{entry:100,entryLow:99.8,entryHigh:100.2,stop:98,tp1:104,rr:2},deploymentGate:{state:"READY"},liveSignalEligible:true,derivatives:{cvdState:"BUYERS CONFIRM",orderBookImbalance:.1}};const m={summary:{medianPerpPrice:100,avgOrderbookImbalance:.1,consensusQuality:95,dispersionBps:5},regime:"BUYER_PRESSURE"};const x=evaluate(d,m,{weekdayOnly:false,easyMode:true});return {ok:x.ok&&x.side==="LONG"&&["FORMING","ARMED","TRIGGERED"].includes(x.status),version:VERSION};}
module.exports={VERSION,evaluate,digitalTwin,effectiveDecision,selfTest};
