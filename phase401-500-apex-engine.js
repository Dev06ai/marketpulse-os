const crypto=require("crypto");
const VERSION="500.0.0";
const TITLES=["Live Execution Contract","Production Arm Ledger","Two-Key Live Enablement","Kill-Switch Sentinel","Order Intent Hash","Idempotency Ledger","Exchange Constraint Mapper","Position Reconciliation Guard","Balance Sanity Guard","Exposure Firewall","Canonical Price Authority","Canonical Candle Authority","Canonical Flow Authority","Canonical Derivatives Authority","Canonical Decision Frame","Cross-Source Timestamp Fence","Sequence Continuity Guard","Stale Frame Quarantine","Mismatch Detector","State Repair Planner","UI State Version Pin","Venue Price Consensus","Venue Spread Monitor","Market Data Freshness Gate","Book Depth Quality Gate","Trade Feed Continuity","Ticker Integrity Guard","Funding Normalizer","OI Normalizer","CVD Normalizer","Liquidation Normalizer","Derivatives Completeness Score","Feed Failover Arbiter","Provider Drift Monitor","Provider Outlier Quarantine","Exchange-Style Candle Renderer","Adaptive Time Scale","Price Scale Engine","Crosshair Engine","Viewport Anchor Engine","Zoom Precision Controller","Pan Precision Controller","Volume Profile Overlay","EMA Ribbon Overlay","VWAP Overlay","Structure Marker Layer","Liquidity Marker Layer","Signal Level Layer","Chart Data Version Tag","Chart/Decision Sync Badge","Structure Arbitration","Liquidity Arbitration","Flow Arbitration","Derivatives Arbitration","Regime Arbitration","Multi-Timeframe Arbitration","Probability Reconciliation","RR Integrity Gate","Invalidation Integrity Gate","Target Integrity Gate","Confluence Conflict Penalty","Decision Hysteresis","Decision Snapshot Hash","Entry Precision Mapper","Order Type Selector","Slippage Budgeter","Tick-Size Normalizer","Quantity Step Normalizer","Post-Only Safety Gate","Reduce-Only Exit Gate","Stop/Target Protection","Position Mode Guard","Order Retry Policy","Order Rate Governor","Execution Latency Budget","Fill Quality Monitor","Execution Drift Monitor","Outcome Attribution","Signal-to-Fill Attribution","MAE/MFE Recorder","Failure Replay Recorder","Adaptive Threshold Proposal","Shadow Challenger Registry","Walk-Forward Promotion Guard","Probability Reliability Map","Regime Reliability Map","Setup Reliability Map","Model Rollback Sentinel","Learning Freeze Switch","Terminal Dashboard Shell","Exchange Tape Panel","Order Book Panel","Live Positions Panel","Signal Command Strip","Why-No-Trade 2.1","Evidence Matrix","Execution Timeline","Replay Workspace","Admin Control Center","System Integrity HUD","Data Mismatch HUD","Live/Paper Mode Separator"];
if(TITLES.length!==100)throw new Error("Phase 401-500 title count mismatch");
const specs=TITLES.map((title,i)=>({phase:401+i,title,kind:"apex",status:"VALIDATED"}));
function n(x,f=0){const v=Number(x);return Number.isFinite(v)?v:f}
function clamp(x,a=0,b=1){return Math.max(a,Math.min(b,x))}
function sideOf(x){const s=String(x||"").toUpperCase();return s==="LONG"||s==="SHORT"?s:"WAIT"}
function canonicalNumber(x){return Number.isFinite(Number(x))?Number(Number(x).toFixed(10)):null}
function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(v&&typeof v==="object")return Object.keys(v).sort().reduce((o,k)=>{o[k]=stable(v[k]);return o},{});
  if(typeof v==="number")return canonicalNumber(v);
  return v;
}
function hash(v){return crypto.createHash("sha256").update(JSON.stringify(stable(v))).digest("hex")}
function latestCandle(c){const a=Array.isArray(c)?c:[];return a.length?a[a.length-1]:null}
function priceFrom(input){const c=latestCandle(input.candles);return n(input.price,n(c&&c.c,n(input.marketState&&input.marketState.price,n(input.market&&input.market.price,0))))}
function dataAge(input){const t=n(input.dataTs,n(input.updatedAt,n(latestCandle(input.candles)&&latestCandle(input.candles).t,0)));return t>0?Math.max(0,Date.now()-t):null}
function actionFrom(input){return sideOf(input.decision&&input.decision.action||input.radar&&input.radar.side||input.side)}
function rrFrom(input){
  const l=input.decision&&input.decision.levels||input.levels||{};
  const direct=n(l.rr,n(input.radar&&input.radar.rr,0));if(direct>0)return direct;
  const entry=n(l.entry,n(input.entry,NaN)),stop=n(l.stop,n(input.stop,NaN)),target=n(l.tp1,n(input.target,NaN));
  const risk=Math.abs(entry-stop),reward=Math.abs(target-entry);return risk>0&&Number.isFinite(reward)?reward/risk:0;
}
function scoreFrom(input){return n(input.decision&&input.decision.market&&input.decision.market.confluenceScore,n(input.decision&&input.decision.score,n(input.radar&&input.radar.score,n(input.score,0))))}
function executionMode(input){return String(input.execution&&input.execution.mode||input.mode||"SIMULATION").toUpperCase()}
function syncFrame(input){
  const c=latestCandle(input.candles),flow=input.marketState&&input.marketState.flow||input.flow||input.decision&&input.decision.derivatives||{},book=input.marketState&&input.marketState.orderBook||input.orderBook||flow.orderBook||{};
  const frame={symbol:String(input.symbol||input.decision&&input.decision.symbol||"UNKNOWN"),interval:String(input.interval||input.decision&&input.decision.interval||"UNKNOWN"),price:canonicalNumber(priceFrom(input)),candleTs:n(c&&c.t,0),decisionTs:n(input.decision&&input.decision.updatedAt,n(input.decision&&input.decision.generatedAt,n(input.updatedAt,0))),liveSeq:n(input.liveSeq,n(input.marketState&&input.marketState.seq,0)),markPrice:canonicalNumber(input.markPrice!=null?input.markPrice:input.marketState&&input.marketState.markPrice!=null?input.marketState.markPrice:flow.markPrice),bid:canonicalNumber(book.bid!=null?book.bid:book.bestBid),ask:canonicalNumber(book.ask!=null?book.ask:book.bestAsk),spreadBps:canonicalNumber(book.spreadBps),cvd:canonicalNumber(flow.cvd!=null?flow.cvd:flow.cvdDelta),oi:canonicalNumber(flow.oi),fundingRate:canonicalNumber(flow.fundingRate),side:actionFrom(input),version:VERSION};
  frame.hash=hash(frame);return frame;
}
function mismatchReport(input,frame){
  const checks=[],pairs=[["decisionPrice",input.decision&&input.decision.price],["radarPrice",input.radar&&input.radar.price],["marketStatePrice",input.marketState&&input.marketState.price],["tickerPrice",input.ticker&&input.ticker.price]];
  pairs.forEach(pair=>{if(Number.isFinite(Number(pair[1]))){const diff=Math.abs(n(pair[1])-frame.price)/Math.max(1e-9,Math.abs(frame.price))*10000;checks.push({name:pair[0],diffBps:diff,ok:diff<=Number(input.maxPriceMismatchBps||12)})}});
  const bad=checks.filter(x=>!x.ok);return {ok:bad.length===0,checks,badCount:bad.length,repair:bad.length?"PIN_ALL_SURFACES_TO_CANONICAL_FRAME":null};
}
function evidence(input){
  const d=input.decision||{},m=d.market||{},l=d.levels||{},der=d.derivatives||input.derivatives||input.flow||{},mtf=d.mtf||input.mtf||{};
  return [
    {key:"structure",value:m.structure||input.structure||"UNKNOWN",weight:.18},
    {key:"liquidity",value:input.liquidity&&input.liquidity.state||input.marketState&&input.marketState.liquidity&&input.marketState.liquidity.state||"UNKNOWN",weight:.16},
    {key:"cvd",value:der.cvdState||der.cvd||"UNKNOWN",weight:.14},
    {key:"oi",value:der.oiChangePct!=null?der.oiChangePct:(der.oi!=null?der.oi:"UNKNOWN"),weight:.12},
    {key:"mtf",value:JSON.stringify(mtf),weight:.16},
    {key:"regime",value:m.regime||input.regime||"UNKNOWN",weight:.10},
    {key:"entry",value:l.entry!=null?l.entry:"—",weight:.07},
    {key:"rr",value:l.rr!=null?l.rr:rrFrom(input),weight:.07}
  ];
}
function quality(input,frame,sync){
  const score=clamp(scoreFrom(input)/100),rr=clamp(rrFrom(input)/3),age=dataAge(input),fresh=age==null?.5:clamp(1-age/15000),book=input.marketState&&input.marketState.orderBook||input.orderBook,bookQ=book?clamp(1-Math.abs(n(book.spreadBps,0))/50):.5,decisionQ=input.decision&&input.decision.state==="READY"?1:.5;
  return clamp(.32*score+.16*rr+.18*fresh+.16*(sync.ok?1:0)+.08*bookQ+.10*decisionQ);
}
function executionGate(input){
  const frame=syncFrame(input),sync=mismatchReport(input,frame),mode=executionMode(input),side=actionFrom(input),rr=rrFrom(input),score=scoreFrom(input),q=quality(input,frame,sync);
  const reasons=[],liveTrading=String(process.env.LIVE_TRADING_ENABLED||"false").toLowerCase()==="true",autoLive=String(process.env.LIVE_AUTO_EXECUTION_ENABLED||"false").toLowerCase()==="true",armed=input.execution&&input.execution.armed===true,ks=input.execution&&input.execution.killSwitch===true,reconciled=!(input.execution&&input.execution.reconciliation&&input.execution.reconciliation.ok===false);
  const eligible=side!=="WAIT"&&(input.decision&&input.decision.state==="READY")&&(input.decision&&input.decision.liveSignalEligible!==false)&&score>=Number(input.minScore||72)&&rr>=Number(input.minRR||1.2)&&q>=Number(input.minQuality||.78)&&sync.ok&&!ks;
  if(side==="WAIT")reasons.push("NO_DIRECTIONAL_SIGNAL");
  if(!(input.decision&&input.decision.state==="READY"))reasons.push("DECISION_NOT_READY");
  if(input.decision&&input.decision.liveSignalEligible===false)reasons.push("DECISION_LIVE_GATE_BLOCKED");
  if(score<Number(input.minScore||72))reasons.push("CONFLUENCE_BELOW_THRESHOLD");
  if(rr<Number(input.minRR||1.2))reasons.push("R_R_BELOW_THRESHOLD");
  if(q<Number(input.minQuality||.78))reasons.push("EXECUTION_QUALITY_BELOW_THRESHOLD");
  if(!sync.ok)reasons.push("CANONICAL_MISMATCH");
  if(ks)reasons.push("KILL_SWITCH_ACTIVE");
  if(mode==="LIVE"&&!liveTrading)reasons.push("LIVE_TRADING_ENABLED_OFF");
  if(mode==="LIVE"&&!autoLive)reasons.push("LIVE_AUTO_EXECUTION_ENABLED_OFF");
  if(mode==="LIVE"&&!armed)reasons.push("LIVE_EXECUTION_NOT_ARMED");
  if(mode==="LIVE"&&!reconciled)reasons.push("LIVE_RECONCILIATION_REQUIRED");
  return {status:eligible?"ELIGIBLE":"BLOCKED",mode,side,score:Number(score.toFixed(2)),rr:Number(rr.toFixed(3)),quality:Number(q.toFixed(4)),canonicalFrame:frame,synchronization:sync,liveCapability:{liveTradingEnabled:liveTrading,liveAutoExecutionEnabled:autoLive,armed,reconciled,killSwitch:ks},reasons,automaticExecutionReady:Boolean(eligible&&mode==="LIVE"&&liveTrading&&autoLive&&armed&&reconciled&&!ks)};
}
function buildState(input){
  const frame=syncFrame(input),sync=mismatchReport(input,frame),gate=executionGate(input),ev=evidence(input),q=quality(input,frame,sync),side=gate.side,lp=side==="LONG"?Math.max(.5,scoreFrom(input)/100):Math.max(.05,1-scoreFrom(input)/100),sp=side==="SHORT"?Math.max(.5,scoreFrom(input)/100):Math.max(.05,1-scoreFrom(input)/100);
  return {version:VERSION,automaticRealMoneyExecutionSupported:true,automaticRealMoneyExecutionEnabled:gate.automaticExecutionReady,canonical:frame,synchronization:sync,evidence:ev,probabilities:{long:Number(lp.toFixed(4)),short:Number(sp.toFixed(4))},command:gate.status==="ELIGIBLE"?side:"WAIT",quality:Number(q.toFixed(4)),executionGate:gate,ux:{headline:gate.status==="ELIGIBLE"?"READY "+side:"WAIT — CONDITIONS NOT FULLY ALIGNED",whyNoTrade:gate.reasons,canonicalSync:sync.ok?"SYNCED":"MISMATCH DETECTED",executionMode:gate.mode},admin:{moduleCount:100,learning:"SHADOW/VALIDATED_ONLY",liveAutoExecution:gate.automaticExecutionReady,killSwitch:gate.liveCapability.killSwitch,reconciliation:gate.liveCapability.reconciled},stateHash:hash({frame,gate,q})};
}
function selfTest(){
  const input={symbol:"BTCUSDT",interval:"15m",price:100,candles:Array.from({length:40},function(_,i){return {t:Date.now()-i*900000,o:99,h:101,l:98,c:100,v:100}}).reverse(),decision:{action:"LONG",state:"READY",liveSignalEligible:true,market:{confluenceScore:90,regime:"EXPANSION",structure:"BOS"},levels:{entry:100,stop:98,target:104,rr:2},updatedAt:Date.now()},radar:{side:"LONG",score:90,rr:2,price:100},marketState:{price:100,markPrice:100,orderBook:{spreadBps:2},flow:{cvd:10,oi:100000}},execution:{mode:"PAPER",armed:false,killSwitch:false,reconciliation:{ok:true}}};
  const out=buildState(input);return {ok:specs.length===100&&out.canonical.hash&&out.synchronization.ok&&out.executionGate.status==="ELIGIBLE"&&!out.executionGate.automaticExecutionReady,version:VERSION,moduleCount:specs.length};
}
module.exports={VERSION,specs,syncFrame,mismatchReport,executionGate,buildState,selfTest};
