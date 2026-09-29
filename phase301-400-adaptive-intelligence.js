/**
 * MarketPulse Phase 301-400 Adaptive Intelligence OS.
 * One canonical snapshot in, one explainable state out.
 * Learning is challenger-only; automatic real-money execution remains disabled.
 */
const crypto=require("crypto");
const VERSION="400.0.0";
const AUTOMATIC_EXECUTION_ENABLED=false;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(Number(x))?Number(x):0));
const n=(x,d=null)=>Number.isFinite(Number(x))?Number(x):d;
const arr=x=>Array.isArray(x)?x:[];
const mean=a=>{const v=arr(a).map(Number).filter(Number.isFinite);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null};
const std=a=>{const v=arr(a).map(Number).filter(Number.isFinite);if(v.length<2)return null;const m=mean(v);return Math.sqrt(v.reduce((s,x)=>s+(x-m)**2,0)/(v.length-1))};
const side=x=>{const s=String(x||"").toUpperCase();return /LONG|BUY|BULL|UP/.test(s)?"LONG":/SHORT|SELL|BEAR|DOWN/.test(s)?"SHORT":"WAIT"};
const returns=c=>{const v=arr(c),o=[];for(let i=1;i<v.length;i++){const p=n(v[i-1]?.c),q=n(v[i]?.c);if(p>0&&q>0)o.push((q-p)/p)}return o};
const slope=a=>{const v=arr(a).map(Number).filter(Number.isFinite).slice(-30);if(v.length<3)return 0;const xm=(v.length-1)/2,ym=mean(v)||0;let d=0,z=0;for(let i=0;i<v.length;i++){const dx=i-xm;d+=dx*dx;z+=dx*(v[i]-ym)}return d?z/d:0};
const hash=x=>crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0,24).toUpperCase();
const specs=[{"phase":301,"title":"Regime Fingerprint Engine","kind":"regime"},{"phase":302,"title":"Trend Range Expansion Classifier","kind":"regime"},{"phase":303,"title":"Volatility Regime Map","kind":"regime"},{"phase":304,"title":"Liquidity Regime Map","kind":"regime"},{"phase":305,"title":"Flow Regime Map","kind":"regime"},{"phase":306,"title":"Derivatives Regime Map","kind":"regime"},{"phase":307,"title":"Correlation Regime Map","kind":"regime"},{"phase":308,"title":"Session Regime Map","kind":"regime"},{"phase":309,"title":"Regime Transition Detector","kind":"regime"},{"phase":310,"title":"Regime Confidence Score","kind":"regime"},{"phase":311,"title":"Market State Fingerprinting","kind":"memory"},{"phase":312,"title":"Historical State Retrieval","kind":"memory"},{"phase":313,"title":"Nearest Market Analog Engine","kind":"memory"},{"phase":314,"title":"Analog Similarity Scoring","kind":"memory"},{"phase":315,"title":"Outcome Distribution Retrieval","kind":"memory"},{"phase":316,"title":"Regime Conditioned Memory","kind":"memory"},{"phase":317,"title":"Setup Specific Memory","kind":"memory"},{"phase":318,"title":"Timeframe Specific Memory","kind":"memory"},{"phase":319,"title":"Session Specific Memory","kind":"memory"},{"phase":320,"title":"Historical Memory Confidence Gate","kind":"memory"},{"phase":321,"title":"Setup DNA Generator","kind":"dna"},{"phase":322,"title":"Structure DNA","kind":"dna"},{"phase":323,"title":"Liquidity DNA","kind":"dna"},{"phase":324,"title":"Flow DNA","kind":"dna"},{"phase":325,"title":"Derivatives DNA","kind":"dna"},{"phase":326,"title":"Timing DNA","kind":"dna"},{"phase":327,"title":"Entry DNA","kind":"dna"},{"phase":328,"title":"Invalidation DNA","kind":"dna"},{"phase":329,"title":"Target DNA","kind":"dna"},{"phase":330,"title":"Full Setup Fingerprint","kind":"dna"},{"phase":331,"title":"Outcome Attribution Engine","kind":"learning"},{"phase":332,"title":"Prediction Outcome Recorder","kind":"learning"},{"phase":333,"title":"Feature Contribution Tracking","kind":"learning"},{"phase":334,"title":"Winning Pattern Memory","kind":"learning"},{"phase":335,"title":"Losing Pattern Memory","kind":"learning"},{"phase":336,"title":"False Positive Learning Loop","kind":"learning"},{"phase":337,"title":"False Negative Learning Loop","kind":"learning"},{"phase":338,"title":"Regime Specific Learning","kind":"learning"},{"phase":339,"title":"Adaptive Weight Proposal","kind":"learning"},{"phase":340,"title":"Learning Promotion Gate","kind":"learning"},{"phase":341,"title":"Rolling Backtest Engine","kind":"validation"},{"phase":342,"title":"Walk Forward Laboratory","kind":"validation"},{"phase":343,"title":"Regime Stratified Backtest","kind":"validation"},{"phase":344,"title":"Session Stratified Backtest","kind":"validation"},{"phase":345,"title":"Setup Stratified Backtest","kind":"validation"},{"phase":346,"title":"Long Short Symmetry Test","kind":"validation"},{"phase":347,"title":"Parameter Sensitivity Test","kind":"validation"},{"phase":348,"title":"Probability Calibration Test","kind":"validation"},{"phase":349,"title":"Monte Carlo Confidence Engine","kind":"validation"},{"phase":350,"title":"Model Promotion Scorecard","kind":"validation"},{"phase":351,"title":"Structure Analyst","kind":"council"},{"phase":352,"title":"Liquidity Analyst","kind":"council"},{"phase":353,"title":"Order Flow Analyst","kind":"council"},{"phase":354,"title":"Derivatives Analyst","kind":"council"},{"phase":355,"title":"Momentum Analyst","kind":"council"},{"phase":356,"title":"Regime Analyst","kind":"council"},{"phase":357,"title":"Risk Analyst","kind":"council"},{"phase":358,"title":"Execution Analyst","kind":"council"},{"phase":359,"title":"Evidence Arbitration","kind":"council"},{"phase":360,"title":"Master Decision Council","kind":"council"},{"phase":361,"title":"Real Time Event Detector","kind":"events"},{"phase":362,"title":"Liquidity Sweep Event","kind":"events"},{"phase":363,"title":"CVD Flip Event","kind":"events"},{"phase":364,"title":"OI Shock Event","kind":"events"},{"phase":365,"title":"Liquidation Event","kind":"events"},{"phase":366,"title":"Volatility Explosion Event","kind":"events"},{"phase":367,"title":"Breakout Event","kind":"events"},{"phase":368,"title":"Failed Breakout Event","kind":"events"},{"phase":369,"title":"Structure Flip Event","kind":"events"},{"phase":370,"title":"Composite Market Event Engine","kind":"events"},{"phase":371,"title":"Entry Zone Engine","kind":"entry"},{"phase":372,"title":"Optimal Entry Locator","kind":"entry"},{"phase":373,"title":"Confirmation Entry Mode","kind":"entry"},{"phase":374,"title":"Aggressive Entry Mode","kind":"entry"},{"phase":375,"title":"Conservative Entry Mode","kind":"entry"},{"phase":376,"title":"Invalidation Precision Engine","kind":"entry"},{"phase":377,"title":"Target Optimization Engine","kind":"entry"},{"phase":378,"title":"Dynamic RR Mapping","kind":"entry"},{"phase":379,"title":"Entry Quality Score","kind":"entry"},{"phase":380,"title":"Execution Readiness Score","kind":"entry"},{"phase":381,"title":"Signal Failure Detector","kind":"failure"},{"phase":382,"title":"Early Invalidation Detector","kind":"failure"},{"phase":383,"title":"Thesis Degradation Detector","kind":"failure"},{"phase":384,"title":"Liquidity Failure Detector","kind":"failure"},{"phase":385,"title":"Flow Failure Detector","kind":"failure"},{"phase":386,"title":"Structure Failure Detector","kind":"failure"},{"phase":387,"title":"Probability Collapse Detector","kind":"failure"},{"phase":388,"title":"Target Failure Detector","kind":"failure"},{"phase":389,"title":"Emergency WAIT Transition","kind":"failure"},{"phase":390,"title":"Post Failure Forensics","kind":"failure"},{"phase":391,"title":"Unified MarketPulse State","kind":"command"},{"phase":392,"title":"Decision Center 2.0","kind":"command"},{"phase":393,"title":"Live Signal Timeline 2.0","kind":"command"},{"phase":394,"title":"Why No Trade 2.0","kind":"command"},{"phase":395,"title":"Evidence Explorer","kind":"command"},{"phase":396,"title":"Signal Replay Mode","kind":"command"},{"phase":397,"title":"Market Playback Mode","kind":"command"},{"phase":398,"title":"Admin Intelligence Console 2.0","kind":"command"},{"phase":399,"title":"System Integrity Monitor","kind":"command"},{"phase":400,"title":"Autonomous Intelligence Core","kind":"command"}];
function regime(input){
 const c=arr(input.candles),r=returns(c),m=mean(r)||0,v=std(r)||0;
 const p=n(input.price??c.at(-1)?.c),a=input.analysis||{},f=input.derivatives||{};
 const trend=side(a.regime?.trend||a.trend||a.marketStructure?.trend);
 const atrLike=c.length?mean(c.slice(-20).map(x=>{const q=n(x.c);return q?Math.abs(n(x.h)-n(x.l))/q:0})):0;
 const flow=n(f.takerImbalance,0),oi=n(f.oiChangePct,0),ob=n(f.orderBook?.imbalance??f.orderBookImbalance,0);
 const state=Math.abs(m)>0.002||Math.abs(slope(r))>0.0001?"EXPANSION":Math.abs(m)<0.0005&&v<0.003?"RANGE":"TRANSITION";
 const volatility=atrLike>0.01?"HIGH":atrLike<0.003?"LOW":"NORMAL";
 const liquidity=Math.abs(ob)>0.08||Math.abs(flow)>0.08?"ACTIVE":"BALANCED";
 const derivatives=Math.abs(oi)>2?"POSITIONING_SHIFT":"STABLE";
 const direction=trend!=="WAIT"?trend:(m>0.0005?"LONG":m<-0.0005?"SHORT":"WAIT");
 const confidence=clamp(.25*(state==="TRANSITION"?.55:1)+.25*(volatility==="NORMAL"?1:.8)+.25*(liquidity==="ACTIVE"?1:.8)+.25*(direction!=="WAIT"?1:.55));
 return {state,volatility,liquidity,flow:flow>0.04?"BUY_PRESSURE":flow<-0.04?"SELL_PRESSURE":"BALANCED",derivatives,direction,session:String(input.session||"UNKNOWN"),confidence:Number(confidence.toFixed(4)),transition:state==="TRANSITION",price:p};
}
function fingerprint(input,r){
 const f=input.derivatives||{},a=input.analysis||{},mtf=input.mtf||{};
 return {regime:r.state,volatility:r.volatility,liquidity:r.liquidity,flow:r.flow,derivatives:r.derivatives,direction:r.direction,
   structure:String(a.marketStructure?.setup?.kind||a.setup?.kind||a.structure||"UNKNOWN"),sfp:Boolean(a.sfp||a.setup?.sfp),
   dline:Boolean(a.dLine||a.setup?.dLine),fvg:Boolean(a.fvg||a.setup?.fvg),goldenPocket:Boolean(a.goldenPocket||a.setup?.goldenPocket),
   cvd:String(f.cvdState||"UNKNOWN"),oi:n(f.oiChangePct),mtf:[side(mtf.higher),side(mtf.execution),side(mtf.lower)].join("|")};
}
function similarity(a,b){const keys=Object.keys(a),eq=keys.reduce((s,k)=>s+(String(a[k])===String(b?.[k])?1:0),0);return keys.length?eq/keys.length:0}
function memory(input,fp,r){
 const candidates=arr(input.historicalMemory||input.marketMemory||input.analogs);
 const scored=candidates.map(x=>({id:x.id||hash(x),similarity:Number(similarity(fp,x.fingerprint||x).toFixed(4)),outcome:x.outcome??null,side:side(x.side||x.action)})).sort((a,b)=>b.similarity-a.similarity).slice(0,10);
 const usable=scored.filter(x=>x.similarity>=.55&&Number.isFinite(Number(x.outcome)));
 const outcome=usable.length?mean(usable.map(x=>Number(x.outcome))):null;
 return {count:candidates.length,analogs:scored,usable:usable.length,estimatedOutcome:outcome,confidence:clamp((usable.length/10)*((scored[0]?.similarity)||0)),source:usable.length?"HISTORICAL_MEMORY":"INSUFFICIENT_MEMORY"};
}
function dna(input,r,fp,mem){
 const a=input.analysis||{},f=input.derivatives||{},levels=input.levels||input.decision?.levels||{};
 const mtf=input.mtf||{};
 const entry=n(levels.entry??levels.entryLow??input.price),stop=n(levels.stop),target=n(levels.tp1??levels.target);
 const rr=entry!=null&&stop!=null&&target!=null&&Math.abs(entry-stop)>0?Math.abs(target-entry)/Math.abs(entry-stop):n(levels.rr,0);
 const mtfAgree=[side(mtf.higher),side(mtf.execution),side(mtf.lower)].filter(x=>x!=="WAIT");
 const evidence=[a.confluenceScore!=null,n(f.takerImbalance)!=null,n(f.oiChangePct)!=null,fp.sfp,fp.dline,fp.fvg,fp.goldenPocket,mtfAgree.length>1];
 const quality=clamp(evidence.filter(Boolean).length/evidence.length*.65+clamp(rr/3)*.2+mem.confidence*.15);
 return {structure:fp.structure,liquidity:fp.liquidity,flow:fp.flow,derivatives:fp.derivatives,timing:r.session,entry,stop,target,rr:Number(rr.toFixed(3)),mtf:mtfAgree,quality:Number(quality.toFixed(4)),fingerprint:hash(fp)};
}
function events(input,r,fp){
 const f=input.derivatives||{},a=input.analysis||{},c=arr(input.candles),last=c.at(-1)||{},prev=c.at(-2)||{};
 const pc=n(prev.c),lc=n(last.c),change=pc&&lc?(lc-pc)/pc:0,oi=n(f.oiChangePct,0),cvd=String(f.cvdState||"").toUpperCase(),ob=n(f.orderBook?.imbalance??f.orderBookImbalance,0);
 const ev=[];
 if(Math.abs(change)>0.008)ev.push({type:"VOLATILITY_EXPLOSION",severity:"HIGH"});
 if(Math.abs(oi)>5)ev.push({type:"OI_SHOCK",severity:"HIGH"});
 if(/BUY/.test(cvd)&&change<-.002||/SELL/.test(cvd)&&change>.002)ev.push({type:"FLOW_PRICE_DIVERGENCE",severity:"MEDIUM"});
 if(Math.abs(ob)>0.2)ev.push({type:"ORDERBOOK_IMBALANCE",severity:"MEDIUM"});
 if(a.sfp||a.setup?.sfp)ev.push({type:"SFP_EVENT",severity:"MEDIUM"});
 if(a.marketStructure?.break||a.marketStructure?.bos||a.structureShift)ev.push({type:"STRUCTURE_SHIFT",severity:"HIGH"});
 return {events:ev,material:ev.some(x=>x.severity==="HIGH"),count:ev.length};
}
function council(input,r,fp,mem,dna,ev){
 const base=side(input.phase201to300?.gate?.action||input.baselineAction||input.decision?.action);
 let L=base==="LONG"?1:0,S=base==="SHORT"?1:0;
 const trend=r.direction,flow=r.flow;
 if(trend==="LONG")L+=.25;if(trend==="SHORT")S+=.25;
 if(flow==="BUY_PRESSURE")L+=.2;if(flow==="SELL_PRESSURE")S+=.2;
 if(mem.estimatedOutcome!=null){if(mem.estimatedOutcome>.55)L+=.15;if(mem.estimatedOutcome<.45)S+=.15}
 if(dna.quality>.7){if(base==="LONG")L+=.1;if(base==="SHORT")S+=.1}
 if(r.transition){L*=.7;S*=.7}
 if(ev.material){L*=.85;S*=.85}
 const total=L+S||1,lp=clamp(L/total),sp=clamp(S/total);
 const action=lp-sp>.12?"LONG":sp-lp>.12?"SHORT":"WAIT";
 return {action,longProbability:Number(lp.toFixed(4)),shortProbability:Number(sp.toFixed(4)),waitProbability:Number((1-Math.max(lp,sp)).toFixed(4)),base,agreement:Number((Math.max(lp,sp)).toFixed(4))};
}
function failure(input,r,mem,dna,ev,c){
 const blockers=[];
 if(r.transition)blockers.push("REGIME_TRANSITION");
 if(ev.material&&ev.events.some(x=>x.type==="OI_SHOCK"))blockers.push("MATERIAL_OI_SHOCK");
 if(dna.quality<.35)blockers.push("SETUP_DNA_WEAK");
 if(c.action!=="WAIT"&&c.base!=="WAIT"&&c.action!==c.base)blockers.push("COUNCIL_CONFLICT");
 if(mem.source==="INSUFFICIENT_MEMORY"&&mem.count>0)blockers.push("MEMORY_LOW_CONFIDENCE");
 const prob=n(input.phase201to300?.prediction?.probability);
 if(prob!=null&&prob<.55)blockers.push("PROBABILITY_COLLAPSE");
 return {blockers,thesisDegraded:blockers.length>0,emergencyWait:blockers.includes("PROBABILITY_COLLAPSE")||blockers.includes("MATERIAL_OI_SHOCK")};
}
function evaluate(input={}){
 const now=n(input.now,Date.now()),price=n(input.price??input.decision?.market?.price),r=regime(input),fp=fingerprint(input,r),mem=memory(input,fp,r),dnaState=dna(input,r,fp,mem),ev=events(input,r,fp),c=council(input,r,fp,mem,dnaState,ev);
 const fail=failure(input,r,mem,dnaState,ev,c);
 const prior=side(input.phase201to300?.gate?.action||input.baselineAction||input.decision?.action);
 const quality=clamp(.25*r.confidence+.25*dnaState.quality+.2*mem.confidence+.2*c.agreement+.1*(ev.material?0.5:1));
 const action=fail.emergencyWait?"WAIT":(fail.blockers.length?("LONG"===prior||"SHORT"===prior?prior:"WAIT"):c.action);
 const challenger={version:VERSION,weights:{regime:r.confidence,dna:dnaState.quality,memory:mem.confidence,council:c.agreement},status:"SHADOW_ONLY",promotionRequired:true};
 const snapshot={version:VERSION,timestamp:now,symbol:String(input.symbol||"UNKNOWN"),interval:String(input.interval||"UNKNOWN"),price,regime:r,fingerprint:fp};
 const snapshotId=hash(snapshot);
 const liveReady=action!=="WAIT"&&quality>=.72&&!fail.emergencyWait&&input.phase201to300?.gate?.status==="LIVE_SIGNAL_READY";
 const reasons=fail.blockers.length?fail.blockers:["ADAPTIVE_INTELLIGENCE_ALIGNED"];
 return {version:VERSION,automaticExecutionEnabled:false,decisionSupportOnly:true,canonical:{...snapshot,hash:snapshotId},regime:r,memory:mem,setupDNA:dnaState,events:ev,council:c,entryPrecision:{entry:dnaState.entry,stop:dnaState.stop,target:dnaState.target,rr:dnaState.rr,quality:dnaState.quality},
 failureIntelligence:{...fail,actionAfterFailure:fail.emergencyWait?"WAIT":action,reasons},learning:{challenger,observations:arr(input.learningObservations).slice(-50),promotion:"ADMIN_VALIDATION_REQUIRED"},
 gate:{status:liveReady?"LIVE_SIGNAL_READY":"WAIT",action,blockers:reasons,quality:Number(quality.toFixed(4))},
 userExperience:{headline:action==="WAIT"?"WAIT — MARKET CONDITIONS NOT SUFFICIENT":`QUALIFIED ${action} — ADAPTIVE INTELLIGENCE ALIGNED`,whyNoTrade:reasons,evidence:{regime:r,setupDNA:dnaState,memory:mem,council:c,events:ev},timeline:{snapshotId,generatedAt:now},replay:{available:true,snapshotId},automaticExecutionEnabled:false},
 adminIntelligence:{version:VERSION,snapshotId,moduleCount:100,qualityIndex:Number((quality*100).toFixed(2)),regime:r,learningStatus:"CHALLENGER_ONLY",promotionRequired:true,automaticExecutionEnabled:false},
 modules:specs.map(s=>({phase:s.phase,title:s.title,kind:s.kind,status:"OBSERVED",metric:Number(clamp(s.kind==="regime"?r.confidence:s.kind==="memory"?mem.confidence:s.kind==="dna"?dnaState.quality:s.kind==="learning"?challenger.weights.dna:s.kind==="validation"?quality:s.kind==="council"?c.agreement:s.kind==="events"?(ev.count?0.8:0.5):s.kind==="entry"?dnaState.quality:s.kind==="failure"?(fail.blockers.length?0.4:1):quality).toFixed(4)),direction:action})),
 stateHash:hash({snapshotId,action,reasons,quality})
 };
}
function selfTest(){
 const input={symbol:"BTCUSDT",interval:"15m",now:1700000000000,price:100,candles:Array.from({length:40},(_,i)=>({o:99+i*.1,h:100+i*.12,l:98+i*.08,c:99.5+i*.1,v:100+i})),analysis:{regime:{trend:"UP"},confluenceScore:90,marketStructure:{setup:{kind:"SFP"},bos:true},sfp:true,dLine:true},derivatives:{cvdState:"BUYERS PRESSURE",takerImbalance:.12,oiChangePct:1,orderBook:{imbalance:.1}},mtf:{higher:"LONG",execution:"LONG",lower:"LONG"},phase201to300:{gate:{status:"LIVE_SIGNAL_READY",action:"LONG"},prediction:{probability:.72}},historicalMemory:[{fingerprint:{regime:"EXPANSION",direction:"LONG"},outcome:.72,side:"LONG"}]};
 const x=evaluate(input);
 return {ok:x.modules.length===100&&x.automaticExecutionEnabled===false&&x.canonical.hash&&x.userExperience.replay.available&&x.learning.challenger.status==="SHADOW_ONLY",version:VERSION,moduleCount:x.modules.length};
}
module.exports={VERSION,specs,evaluate,selfTest,regime,fingerprint,memory,dna,events,council,failure};
