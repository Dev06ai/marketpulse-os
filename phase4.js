const storage=require("./storage");

const STATE_VERSION=1;
const HORIZON_BARS={"15m":16,"1h":12,"4h":6,"1d":3};
const MAX_SIGNALS=220;
const MAX_EVENTS=120;
const MAX_JOURNAL=500;
const MAX_PAPER_TRADES=300;

function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function finite(x,fallback=null){return Number.isFinite(Number(x))?Number(x):fallback}
function validDevice(id){return typeof id==="string"&&/^[a-f0-9-]{16,128}$/i.test(id)}
function defaultState(){
  return {
    version:STATE_VERSION,
    config:{account:100000,riskPct:1,minRR:1.5,maxOpenRiskPct:2.5},
    signals:[],
    events:[],
    journal:[],
    paper:{startingEquity:100000,realizedPnl:0,realizedR:0,open:[],trades:[],peakEquity:100000,maxDrawdown:0},
    lastUpdatedAt:Date.now()
  };
}
function ensureState(raw){
  const s=raw&&typeof raw==="object"?raw:defaultState(),d=defaultState();
  s.version=STATE_VERSION;
  s.config=Object.assign({},d.config,s.config||{});
  s.config.account=Math.max(0,finite(s.config.account,d.config.account));
  s.config.riskPct=clamp(finite(s.config.riskPct,d.config.riskPct),0.05,5);
  s.config.minRR=clamp(finite(s.config.minRR,d.config.minRR),0.5,10);
  s.config.maxOpenRiskPct=clamp(finite(s.config.maxOpenRiskPct,d.config.maxOpenRiskPct),0.5,10);
  s.signals=Array.isArray(s.signals)?s.signals.slice(-MAX_SIGNALS):[];
  s.events=Array.isArray(s.events)?s.events.slice(-MAX_EVENTS):[];
  s.journal=Array.isArray(s.journal)?s.journal.slice(-MAX_JOURNAL):[];
  s.paper=s.paper&&typeof s.paper==="object"?s.paper:d.paper;
  s.paper.startingEquity=finite(s.paper.startingEquity,s.config.account);
  s.paper.realizedPnl=finite(s.paper.realizedPnl,0);
  s.paper.realizedR=finite(s.paper.realizedR,0);
  s.paper.open=Array.isArray(s.paper.open)?s.paper.open.slice(-50):[];
  s.paper.trades=Array.isArray(s.paper.trades)?s.paper.trades.slice(-MAX_PAPER_TRADES):[];
  s.paper.peakEquity=finite(s.paper.peakEquity,s.paper.startingEquity);
  s.paper.maxDrawdown=finite(s.paper.maxDrawdown,0);
  s.lastUpdatedAt=Date.now();
  return s;
}
async function load(deviceId){
  const id=validDevice(deviceId)?deviceId:"00000000-0000-0000-0000-000000000000";
  const r=await storage.getPhase4State(id);
  return {id,state:ensureState(r.payload||defaultState()),storage:r.storage};
}
async function save(deviceId,state){
  const id=validDevice(deviceId)?deviceId:"00000000-0000-0000-0000-000000000000";
  state=ensureState(state);state.lastUpdatedAt=Date.now();
  return storage.savePhase4State(id,state);
}
function barsFor(interval){return HORIZON_BARS[interval]||12}
function intervalMs(interval){return ({"15m":15,"1h":60,"4h":240,"1d":1440}[interval]||60)*60000}
function band(score){const s=finite(score,0);return s<40?"0-39":s<55?"40-54":s<70?"55-69":s<80?"70-79":"80-100"}
function eventId(type,signalId,ts){return [type,signalId,ts].join("|")}
function pushEvent(state,type,message,signalId,meta={}){
  const ts=Date.now(),id=eventId(type,signalId||"system",ts);
  state.events.push({id,ts,type,message,signalId:signalId||null,meta});
  state.events=state.events.slice(-MAX_EVENTS);
}
function componentMax(name){
  return ({Regime:16,"Trend strength":11,Momentum:11,Volume:9,Structure:9,"4H alignment":9,"15M alignment":7,"CVD pressure":10,"OI context":8,"Liquidation context":6})[name]||10;
}
function signalQuality(analysis,evidence){
  const comps=(Array.isArray(analysis?.components)?analysis.components:[]).map(c=>{
    const max=componentMax(c.name),value=finite(c.value,0);
    return {name:c.name,value,max,pct:clamp(max?value/max*100:0,0,100)};
  });
  return {
    marketScore:finite(analysis?.score,0),
    status:analysis?.status||"WAITING",
    components:comps,
    evidenceSample:finite(evidence?.sample,0),
    evidenceMatch:finite(evidence?.matchScore,0)
  };
}
function similarityScore(current,record){
  const s=record?.snapshot||{},r=record?.outcome||{};
  let score=0;
  if(record?.side&&record.side===current.side)score+=28;
  if(record?.type&&record.type===current.type)score+=20;
  if(record?.regime&&record.regime===current.regime)score+=18;
  if(band(record?.score)===band(current.score))score+=12;
  const rsiA=finite(current.rsi),rsiB=finite(s.rsi);if(rsiA!==null&&rsiB!==null)score+=Math.max(0,10-Math.abs(rsiA-rsiB)/4);
  const adxA=finite(current.adx),adxB=finite(s.adx);if(adxA!==null&&adxB!==null)score+=Math.max(0,7-Math.abs(adxA-adxB)/3);
  if(current.structure&&s.structure===current.structure)score+=5;
  const hasOutcome=["TARGET_1","STOP","AMBIGUOUS","NOT_TRIGGERED"].includes(r.status);
  return {score:clamp(Math.round(score),0,100),resolved:["TARGET_1","STOP","AMBIGUOUS"].includes(r.status),triggered:["TARGET_1","STOP","AMBIGUOUS"].includes(r.status),outcome:r.status||"UNKNOWN",resultR:finite(r.resultR,0)};
}
async function historicalEvidence(symbol,interval,analysis){
  try{
    const rows=await storage.getSignalDNA({symbol,interval,limit:600});
    const candidates=rows.map(r=>Object.assign({r},similarityScore(analysis,r))).filter(x=>x.score>=55).sort((a,b)=>b.score-a.score||Number(b.r.candleTs||0)-Number(a.r.candleTs||0));
    const matched=candidates.slice(0,60);
    const resolved=matched.filter(x=>x.resolved),triggered=matched.filter(x=>x.triggered),targets=resolved.filter(x=>x.outcome==="TARGET_1"),stops=resolved.filter(x=>x.outcome==="STOP");
    const netR=resolved.reduce((a,x)=>a+(finite(x.resultR,0)||0),0);
    const sample=matched.length,matchScore=sample?Math.round(matched.reduce((a,x)=>a+x.score,0)/sample):0;
    return {
      available:sample>0,
      sample,
      resolved:resolved.length,
      triggered:triggered.length,
      targets:targets.length,
      stops:stops.length,
      ambiguous:resolved.filter(x=>x.outcome==="AMBIGUOUS").length,
      triggerRate:sample?triggered.length/sample:null,
      targetRate:resolved.length?targets.length/resolved.length:null,
      avgR:resolved.length?netR/resolved.length:null,
      netR,
      matchScore,
      top:matched.slice(0,6).map(x=>({score:x.score,signalKey:x.r.signalKey,symbol:x.r.symbol,interval:x.r.interval,candleTs:x.r.candleTs,outcome:x.outcome,resultR:x.resultR}))
    };
  }catch(e){
    return {available:false,sample:0,resolved:0,triggered:0,targets:0,stops:0,ambiguous:0,triggerRate:null,targetRate:null,avgR:null,netR:0,matchScore:0,top:[],error:e.message};
  }
}
function riskCheck(plan,config,openRiskPct=0){
  const c=config||defaultState().config,entry=finite(plan?.entry),stop=finite(plan?.stop),target=finite(plan?.target),rr=finite(plan?.rr);
  const riskPerUnit=entry!==null&&stop!==null?Math.abs(entry-stop):NaN;
  const rewardPerUnit=entry!==null&&target!==null?Math.abs(target-entry):NaN;
  const computedRR=Number.isFinite(riskPerUnit)&&riskPerUnit?rewardPerUnit/riskPerUnit:null;
  const useRR=rr!==null?rr:computedRR;
  const riskPct=clamp(finite(c.riskPct,1),0.05,5);
  const riskCash=Math.max(0,finite(c.account,100000))*riskPct/100;
  const allowed=Boolean(entry!==null&&stop!==null&&target!==null&&riskPerUnit>0&&useRR!==null&&useRR>=finite(c.minRR,1.5)&&openRiskPct+riskPct<=finite(c.maxOpenRiskPct,2.5)+1e-9);
  return {
    allowed,
    entry,stop,target,rr:useRR,riskPerUnit,rewardPerUnit,riskCash,riskPct,
    riskWithinLimit:openRiskPct+riskPct<=finite(c.maxOpenRiskPct,2.5)+1e-9,
    rrWithinLimit:useRR!==null&&useRR>=finite(c.minRR,1.5),
    reason:allowed?"PASS":(!Number.isFinite(riskPerUnit)||riskPerUnit<=0?"INVALID STOP":useRR===null||useRR<finite(c.minRR,1.5)?"RR BELOW MINIMUM":"OPEN RISK LIMIT")
  };
}
function makeSignalId(symbol,interval,candleTs){return "MP4-"+symbol+"-"+interval+"-"+candleTs}
function currentSignal(state,symbol,interval){
  return state.signals.slice().reverse().find(s=>s.symbol===symbol&&s.interval===interval&&s.lifecycle!=="CLOSED")||null;
}
function openRiskPct(state){
  const account=Math.max(1,finite(state.config.account,100000));
  return state.paper.open.reduce((a,p)=>a+(finite(p.riskPct,0)||0),0);
}
function closePaper(state,signal,position,status,resultR,reason,exitPrice,ts){
  const posIndex=state.paper.open.findIndex(x=>x.id===position.id);
  if(posIndex<0)return;
  const qty=finite(position.qty,0)||0,entry=finite(position.entry,0)||0,exit=finite(exitPrice,entry)||entry;
  const pnl=signal.side==="LONG"?(exit-entry)*qty:(entry-exit)*qty;
  const riskCash=finite(position.riskCash,0)||0;
  const normalizedR=Number.isFinite(resultR)?resultR:(riskCash?pnl/riskCash:0);
  state.paper.realizedPnl+=pnl;
  state.paper.realizedR+=normalizedR;
  state.paper.open.splice(posIndex,1);
  const equity=state.paper.startingEquity+state.paper.realizedPnl;
  state.paper.peakEquity=Math.max(finite(state.paper.peakEquity,state.paper.startingEquity),equity);
  state.paper.maxDrawdown=Math.max(finite(state.paper.maxDrawdown,0),state.paper.peakEquity-equity);
  const trade={id:"P4T-"+position.id,signalId:signal.id,symbol:signal.symbol,interval:signal.interval,side:signal.side,type:signal.type,regime:signal.regime,score:signal.score,entry,stop:signal.stop,target:signal.target,exitPrice:exit,resultR:normalizedR,pnl,status,reason,openedAt:position.openedAt,closedAt:ts,evidenceAvgR:finite(signal.evidence?.avgR)};
  state.paper.trades.push(trade);state.paper.trades=state.paper.trades.slice(-MAX_PAPER_TRADES);
  const journalEntry={id:"P4J-"+trade.id,source:"PAPER",ts,status:"CLOSED",asset:signal.symbol,side:signal.side,entry,stop:signal.stop,target:signal.target,r:normalizedR,note:reason,regime:signal.regime,type:signal.type,score:signal.score,tradeId:trade.id};
  state.journal.push(journalEntry);state.journal=state.journal.slice(-MAX_JOURNAL);
  signal.lifecycle="CLOSED";signal.outcome=status;signal.resultR=normalizedR;signal.closedAt=ts;signal.exitPrice=exit;signal.updatedAt=ts;
  pushEvent(state,"TRADE_CLOSED",signal.symbol+" "+signal.side+" closed · "+status+" · "+normalizedR.toFixed(2)+"R",signal.id,{resultR:normalizedR});
}
function maybeOpenPaper(state,signal,ts){
  const existing=state.paper.open.find(x=>x.signalId===signal.id);if(existing)return {opened:false,reason:"ALREADY_OPEN"};
  const risk=riskCheck({entry:signal.entry,stop:signal.stop,target:signal.target,rr:signal.rr},state.config,openRiskPct(state));
  signal.risk=risk;
  if(!risk.allowed){pushEvent(state,"PAPER_BLOCKED",signal.symbol+" "+signal.side+" triggered but paper risk gate blocked the simulated trade",signal.id,{reason:risk.reason});return {opened:false,reason:risk.reason}}
  const qty=risk.riskPerUnit?risk.riskCash/risk.riskPerUnit:0;
  const p={id:"P4P-"+signal.id,signalId:signal.id,symbol:signal.symbol,interval:signal.interval,side:signal.side,entry:signal.entry,stop:signal.stop,target:signal.target,qty,riskCash:risk.riskCash,riskPct:risk.riskPct,openedAt:ts,triggeredAt:ts};
  state.paper.open.push(p);signal.lifecycle="ACTIVE";signal.triggeredAt=ts;signal.paperPositionId=p.id;
  pushEvent(state,"SIGNAL_TRIGGERED",signal.symbol+" "+signal.side+" triggered · paper position opened",signal.id,{entry:signal.entry,qty});
  return {opened:true,position:p};
}
function advanceSignal(state,signal,candle,ts){
  if(!candle||signal.lifecycle==="CLOSED"||Number(candle.t)<=Number(signal.candleTs))return;
  const lo=Number(candle.l),hi=Number(candle.h);
  if(!Number.isFinite(lo)||!Number.isFinite(hi))return;
  if(signal.lifecycle==="WATCHING"||signal.lifecycle==="ARMED"){
    const hitEntry=lo<=signal.entryHigh&&hi>=signal.entryLow;
    if(hitEntry){
      signal.entry=finite(signal.entry,(signal.entryLow+signal.entryHigh)/2);
      const r=maybeOpenPaper(state,signal,ts);
      if(!r.opened){signal.lifecycle="CLOSED";signal.outcome="PAPER_BLOCKED";signal.resultR=0;signal.closedAt=ts;signal.updatedAt=ts;}
      signal.updatedAt=ts;
    }
  }
  if(signal.lifecycle==="ACTIVE"){
    const stopHit=signal.side==="LONG"?lo<=signal.stop:hi>=signal.stop;
    const targetHit=signal.side==="LONG"?hi>=signal.target:lo<=signal.target;
    const pos=state.paper.open.find(x=>x.signalId===signal.id);
    if(stopHit&&targetHit){
      if(pos)closePaper(state,signal,pos,"AMBIGUOUS",0,"Both stop and target were touched in the same candle; order is unknown",finite(candle.c,signal.entry),ts);
      else {signal.lifecycle="CLOSED";signal.outcome="AMBIGUOUS";signal.resultR=0;signal.closedAt=ts;pushEvent(state,"AMBIGUOUS",signal.symbol+" "+signal.side+" ambiguous: stop and target touched in one candle",signal.id)}
    }else if(stopHit||targetHit){
      const target=targetHit&& !stopHit;
      const resultR=target?Math.abs(signal.target-signal.entry)/Math.abs(signal.entry-signal.stop):-1;
      if(pos)closePaper(state,signal,pos,target?"TARGET_1":"STOP",resultR,target?"TP1 reached":"Stop invalidated",target?signal.target:signal.stop,ts);
      else {signal.lifecycle="CLOSED";signal.outcome=target?"TARGET_1":"STOP";signal.resultR=resultR;signal.closedAt=ts;pushEvent(state,"SIGNAL_CLOSED",signal.symbol+" "+signal.side+" "+signal.outcome+" · "+resultR.toFixed(2)+"R",signal.id)}
    }else{
      const maxMs=barsFor(signal.interval)*intervalMs(signal.interval);
      if(ts-Number(signal.triggeredAt||ts)>=maxMs){
        if(pos)closePaper(state,signal,pos,"TIMEOUT",0,"Signal expired at the research horizon",Number(candle.c),ts);
        else {signal.lifecycle="CLOSED";signal.outcome="TIMEOUT";signal.resultR=0;signal.closedAt=ts;pushEvent(state,"TIMEOUT",signal.symbol+" "+signal.side+" timed out at the tracking horizon",signal.id)}
      }
    }
  }
  signal.updatedAt=ts;
}
function addSignal(state,symbol,interval,analysis,candle,evidence){
  const candleTs=Number(candle?.t)||Date.now(),id=makeSignalId(symbol,interval,candleTs);
  const existing=state.signals.find(s=>s.id===id);
  if(existing)return existing;
  const entryLow=finite(analysis.entryLow),entryHigh=finite(analysis.entryHigh),entry=entryLow!==null&&entryHigh!==null?(entryLow+entryHigh)/2:finite(analysis.price);
  if(entry===null||finite(analysis.stop)===null||finite(analysis.tp1)===null||analysis.side==="WAIT")return null;
  const signal={
    id,symbol,interval,candleTs,createdAt:Date.now(),type:analysis.type,side:analysis.side,regime:analysis.regime,status:analysis.status,score:finite(analysis.score,0),
    price:finite(analysis.price),entryLow:entryLow??entry,entryHigh:entryHigh??entry,entry,stop:finite(analysis.stop),target:finite(analysis.tp1),tp2:finite(analysis.tp2),
    rr:finite(analysis.rr),lifecycle:analysis.status==="READY"?"ARMED":"WATCHING",reasons:(analysis.reasons||[]).slice(0,6),
    evidence,evidenceTop:evidence?.top||[],risk:null,outcome:null,resultR:null,updatedAt:Date.now()
  };
  state.signals.push(signal);state.signals=state.signals.slice(-MAX_SIGNALS);
  pushEvent(state,"SIGNAL_NEW",symbol+" "+analysis.side+" "+signal.lifecycle+" · "+signal.score+"/100",signal.id,{score:signal.score,type:signal.type});
  return signal;
}
function summarizeTrades(trades){
  const rows=Array.isArray(trades)?trades:[],wins=rows.filter(x=>Number(x.resultR)>0),losses=rows.filter(x=>Number(x.resultR)<0),netR=rows.reduce((a,x)=>a+(finite(x.resultR,0)||0),0),pnl=rows.reduce((a,x)=>a+(finite(x.pnl,0)||0),0);
  return {trades:rows.length,wins:wins.length,losses:losses.length,winRate:rows.length?wins.length/rows.length*100:0,netR,avgR:rows.length?netR/rows.length:0,realizedPnl:pnl};
}
function personalEdge(state){
  const rows=state.journal||[];
  const groups={};
  const add=(key,x)=>{const k=x[key]||"UNKNOWN",g=groups[key]||(groups[key]={});const b=g[k]||(g[k]={n:0,r:0});b.n++;b.r+=finite(x.r,0)||0};
  rows.forEach(x=>{add("regime",x);add("side",x);add("type",x)});
  const normalize=g=>Object.entries(g).map(([key,v])=>({key,n:v.n,avgR:v.n?v.r/v.n:0,netR:v.r})).sort((a,b)=>b.n-a.n);
  return {trades:rows.length,byRegime:normalize(groups.regime||{}),bySide:normalize(groups.side||{}),byType:normalize(groups.type||{})};
}
function strategyHealth(state){
  const trades=state.paper.trades||[],recent=trades.slice(-20),s=summarizeTrades(trades),rs=summarizeTrades(recent),div=recent.filter(x=>Number.isFinite(x.evidenceAvgR)).map(x=>(finite(x.resultR,0)||0)-(finite(x.evidenceAvgR,0)||0));
  return {
    sample:s.trades,recentSample:rs.trades,winRate:s.winRate,netR:s.netR,avgR:s.avgR,drawdownR:(finite(state.paper.maxDrawdown,0)||0)/(Math.max(1,finite(state.paper.startingEquity,1))),recentNetR:rs.netR,
    evidenceDivergence:div.length?div.reduce((a,b)=>a+b,0)/div.length:null,
    state:trades.length<12?"INSUFFICIENT LIVE SAMPLE":rs.netR<0&&trades.length>=12?"UNDER REVIEW":"TRACKING",
    note:trades.length<12?"Collecting live paper outcomes before treating recent behaviour as stable.":"Live paper results are descriptive of the stored sample and are not a forecast."
  };
}
async function updateLive(deviceId,symbol,interval,analysis,candles){
  const loaded=await load(deviceId),state=loaded.state,ts=Date.now(),candle=(candles||[])[(candles||[]).length-1];
  let sig=currentSignal(state,symbol,interval);
  if(sig&&candle)advanceSignal(state,sig,candle,ts);
  if(sig&&["WATCHING","ARMED"].includes(sig.lifecycle)&&analysis?.side==="WAIT"){
    sig.lifecycle="CLOSED";sig.outcome="INVALIDATED";sig.resultR=0;sig.closedAt=ts;sig.updatedAt=ts;
    pushEvent(state,"SIGNAL_INVALIDATED",symbol+" "+sig.side+" invalidated before trigger",sig.id);
    sig=null;
  }
  if(!sig&&candle&&analysis&&analysis.side!=="WAIT"&&["READY","WATCH"].includes(analysis.status)){
    const evidence=await historicalEvidence(symbol,interval,analysis);
    sig=addSignal(state,symbol,interval,analysis,candle,evidence);
  }else if(sig&&analysis&&sig.lifecycle!=="CLOSED"){
    sig.score=finite(analysis.score,sig.score);sig.status=analysis.status;sig.price=finite(analysis.price,sig.price);sig.updatedAt=ts;
    sig.reasons=(analysis.reasons||sig.reasons||[]).slice(0,6);
  }
  if(sig&&candle)advanceSignal(state,sig,candle,ts);
  state.paper.open.forEach(pos=>pos.updatedAt=ts);
  await save(loaded.id,state);
  return snapshotFromState(state,symbol,interval,analysis);
}
function latestSignal(state,symbol,interval){
  return state.signals.slice().reverse().find(s=>s.symbol===symbol&&s.interval===interval)||null;
}
function snapshotFromState(state,symbol,interval,analysis){
  const sig=currentSignal(state,symbol,interval)||latestSignal(state,symbol,interval);
  const risk=sig?riskCheck({entry:sig.entry,stop:sig.stop,target:sig.target,rr:sig.rr},state.config,openRiskPct(state)):riskCheck({},state.config,openRiskPct(state));
  const paper=Object.assign({},summarizeTrades(state.paper.trades),{
    startingEquity:state.paper.startingEquity,equity:state.paper.startingEquity+state.paper.realizedPnl,open:state.paper.open,
    openRiskPct:openRiskPct(state),maxDrawdown:state.paper.maxDrawdown,realizedPnl:state.paper.realizedPnl,realizedR:state.paper.realizedR
  });
  const health=strategyHealth(state);
  return {
    version:4,config:state.config,current:{symbol,interval,analysis:analysis||null},
    signal:sig,quality:signalQuality(analysis||{},sig?.evidence||{}),evidence:sig?.evidence||{available:false,sample:0,resolved:0,triggered:0,targets:0,stops:0,ambiguous:0,triggerRate:null,targetRate:null,avgR:null,netR:0,matchScore:0,top:[]},
    risk:{config:state.config,check:risk},paper,health,events:state.events.slice(-20).reverse(),journal:state.journal.slice(-20).reverse(),personalEdge:personalEdge(state),updatedAt:Date.now()
  };
}
async function snapshot(deviceId,symbol,interval,analysis){
  const loaded=await load(deviceId);
  return snapshotFromState(loaded.state,symbol,interval,analysis);
}
async function setConfig(deviceId,config){
  const loaded=await load(deviceId),s=loaded.state;
  s.config=Object.assign({},s.config,config||{});
  s.paper.startingEquity=finite(s.paper.startingEquity,s.config.account);
  if(s.paper.startingEquity<=0)s.paper.startingEquity=s.config.account;
  if(!s.paper.trades.length&&!s.paper.open.length){s.paper.startingEquity=s.config.account;s.paper.realizedPnl=0;s.paper.realizedR=0;s.paper.peakEquity=s.config.account;s.paper.maxDrawdown=0;}
  pushEvent(s,"RISK_CONFIG","Risk configuration updated","risk");
  await save(loaded.id,s);return snapshotFromState(s,null,null,null);
}
async function addJournal(deviceId,entry){
  const loaded=await load(deviceId),s=loaded.state,x=entry&&typeof entry==="object"?entry:{};
  const row={id:"P4J-M-"+Date.now()+"-"+Math.random().toString(16).slice(2),source:"MANUAL",ts:Date.now(),asset:x.asset||"BTCUSDT",side:x.side||"Long",entry:finite(x.entry,0),stop:finite(x.stop,0),target:finite(x.target,0),r:finite(x.r,0),note:String(x.note||"").slice(0,800),regime:x.regime||"UNKNOWN",type:x.type||"MANUAL",score:finite(x.score,0)};
  s.journal.push(row);s.journal=s.journal.slice(-MAX_JOURNAL);await save(loaded.id,s);return row;
}
module.exports={
  createState:defaultState,
  ensureState,
  riskCheck,
  signalQuality,
  similarityScore,
  summarizeTrades,
  updateLive,
  snapshot,
  setConfig,
  addJournal,
  historicalEvidence,
  strategyHealth,
  personalEdge
};
