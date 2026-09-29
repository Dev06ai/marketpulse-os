/**
 * Phase 101–200 Intelligence OS.
 * 100 explicit upgrade specifications execute against one input snapshot.
 * No phase invents a calibrated probability or enables automatic execution.
 */
const crypto=require("crypto");
const VERSION="101-200.0.0";
const phaseHistory=require("./phase-history");
function kindForPhase(p){
  if([101,102,106,110].includes(p))return "market";
  if([103,104,109].includes(p))return "liquidity";
  if([105].includes(p))return "flow";
  if([107,108].includes(p))return "derivatives";
  if(p>=111&&p<=120)return "structure";
  if(p>=121&&p<=130)return "timeframe";
  if(p>=131&&p<=140)return "signal";
  if(p>=141&&p<=150)return "probability";
  if(p>=151&&p<=160)return "learning";
  if(p>=161&&p<=170)return "adaptive";
  if(p>=171&&p<=180)return "risk";
  if(p>=181&&p<=190)return "ux";
  return "admin";
}
function featureForPhase(p){return "phase_"+p}
const moduleSpecs=phaseHistory.getPhaseHistory().filter(x=>x.phase>=101&&x.phase<=200).map(x=>({phase:x.phase,title:x.title,description:x.description,kind:kindForPhase(x.phase),feature:featureForPhase(x.phase)}));
if(moduleSpecs.length!==100)throw new Error("Phase 101–200 registry must contain exactly 100 phases");


const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,Number(x)));
const n=(x,d=null)=>Number.isFinite(Number(x))?Number(x):d;
const arr=x=>Array.isArray(x)?x:[];
const mean=a=>{const v=arr(a).map(Number).filter(Number.isFinite);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null};
const stdev=a=>{const v=arr(a).map(Number).filter(Number.isFinite);if(v.length<2)return null;const m=mean(v);return Math.sqrt(v.reduce((s,x)=>s+(x-m)**2,0)/(v.length-1))};
const last=a=>arr(a).at(-1);
const returns=c=>{const v=arr(c),o=[];for(let i=1;i<v.length;i++){const p=n(v[i-1]?.c),q=n(v[i]?.c);if(p>0&&q>0)o.push((q-p)/p)}return o};
const momentum=(c,w=18)=>{const v=arr(c);if(v.length<=w)return 0;const p=n(v.at(-1)?.c),q=n(v.at(-1-w)?.c);return p!=null&&q>0?clamp((p/q-1)*20,-1,1):0};
function slope(a){const v=arr(a).map(Number).filter(Number.isFinite).slice(-30);if(v.length<3)return 0;const x=(v.length-1)/2,y=mean(v)||0;let den=0,num=0;for(let i=0;i<v.length;i++){const dx=i-x;den+=dx*dx;num+=dx*(v[i]-y)}return den?num/den:0}
function side(x){const s=String(x??"").toUpperCase();if(/LONG|BUY|BULL|UP|BUYERS/.test(s))return"LONG";if(/SHORT|SELL|BEAR|DOWN|SELLERS/.test(s))return"SHORT";return"WAIT"}
function directional(input){const a=input.analysis||{},f=input.derivatives||{},m=input.market||{};let L=0,S=0;const add=(x,w)=>{const d=side(x);if(d==="LONG")L+=w;if(d==="SHORT")S+=w};add(a.side,10);add(a.regime?.trend||m.trend,7);add(f.cvdState,10);add(f.positioning,5);const t=n(f.takerImbalance);if(t!=null)add(t>0?"LONG":"SHORT",Math.min(8,Math.abs(t)*30));const o=n(f.orderBook?.imbalance??f.orderBookImbalance);if(o!=null)add(o>0?"LONG":"SHORT",Math.min(6,Math.abs(o)*20));const mo=momentum(input.candles);if(mo)add(mo>0?"LONG":"SHORT",Math.abs(mo)*5);return{long:L,short:S,edge:Math.abs(L-S),dominant:L>S?"LONG":S>L?"SHORT":"WAIT"}}
function quality(input){const f=input.derivatives||{},c=input.consensus||{},candles=arr(input.candles);const range=mean(candles.slice(-30).map(x=>{const p=n(x.c);return p?Math.abs(n(x.h)-n(x.l))/p:null}).filter(Number.isFinite));return{freshness:clamp(n(input.freshnessPct,100)/100),venue:clamp(n(c.consensusQualityPct,f.available===false?40:90)/100),rangePct:range}}
function validatedProbability(x,source){const p=n(x),s=String(source||"");if(p==null)return{available:false,probability:null,source:"UNAVAILABLE"};const q=p>1?p/100:p;const ok=q>=0&&q<=1&&["CALIBRATED","WALK_FORWARD_EMPIRICAL"].includes(s);return{available:ok,probability:ok?q:null,source:ok?s:"UNAVAILABLE"}}
function featureMetric(spec,input,dir,q){
  const a=input.analysis||{},f=input.derivatives||{},liq=a.liquidity||f.liquidity||{},mo=momentum(input.candles),r=returns(input.candles),sdv=stdev(r)||1,z=r.length?(r.at(-1)-(mean(r)||0))/sdv:0,oi=Math.abs(n(f.oiChangePct,0)),tak=Math.abs(n(f.takerImbalance,0)),ob=Math.abs(n(f.orderBook?.imbalance??f.orderBookImbalance,0)),conf=clamp(n(a.confluenceScore,0)/100),sw=n(liq.nearestHigh)!=null||n(liq.nearestLow)!=null?1:0;
  const mtf=input.mtf||{},ds=[side(mtf.higher),side(mtf.execution),side(mtf.lower)].filter(x=>x!=="WAIT"),mtfAgree=ds.length?(ds.every(x=>x===ds[0])?1:.35):0;
  const common={
    market:clamp(.35*Math.abs(mo)+.25*Math.min(1,Math.abs(z)/3)+.4*conf),
    liquidity:clamp(.35*sw+.35*Math.min(1,tak*3)+.3*Math.min(1,ob*10)),
    flow:clamp(.5*Math.min(1,tak*3)+.3*Math.min(1,oi/4)+.2*Math.min(1,ob*10)),
    derivatives:clamp(.45*Math.min(1,oi/5)+.3*Math.min(1,tak*3)+.25*Math.min(1,Math.abs(n(f.fundingRate,0))*100)),
    structure:clamp(.35*Math.abs(mo)+.3*conf+.35*(side(a.regime?.trend||a.regime)!=="WAIT"?1:.25)),
    timeframe:mtfAgree,
    signal:clamp(.55*dir.edge/25+.45*(1-Math.min(1,Math.min(dir.long,dir.short)/18))),
    probability:validatedProbability(input.calibration?.probability,input.calibration?.source).probability||0,
    learning:clamp(.5*n(input.validation?.sampleCount??input.validation?.summary?.trades,0)/300+.5*(input.validation?.adaptive?.signalGateReady?1:q.venue)),
    adaptive:clamp(1-Math.abs(n(input.drift?.score??input.driftScore,0))),
    risk:clamp(1-Math.max(Math.min(1,n(input.risk?.riskPct,0)/3),Math.min(1,n(input.risk?.dailyDrawdownPct,0)/4))),
    ux:clamp((q.freshness+q.venue+(1-Math.min(1,Math.min(dir.long,dir.short)/20)))/3),
    admin:clamp((q.freshness+q.venue+(1-Math.min(1,Math.min(dir.long,dir.short)/20)))/3)
  };
  const metric=common[spec.kind]??dir.edge/25,direction=dir.dominant!=="WAIT"?dir.dominant:side(a.marketStructure?.setup?.side||a.setup?.side),conflict=Math.min(dir.long,dir.short),phaseFactor=.9+.1*((spec.phase%10)/9);
  return{phase:spec.phase,title:spec.title,kind:spec.kind,feature:spec.feature,description:spec.description,direction,metric:Number(clamp(metric*phaseFactor).toFixed(6)),strength:Number(clamp(dir.edge/25).toFixed(6)),conflict:Number(conflict.toFixed(6)),status:"OBSERVED",detail:{momentum:Number(mo.toFixed(6)),slope:Number(slope(r).toFixed(6)),takerImbalance:n(f.takerImbalance),oiChangePct:n(f.oiChangePct),orderBookImbalance:n(f.orderBook?.imbalance??f.orderBookImbalance),confluence:n(a.confluenceScore),mtfAgreement:mtfAgree,liquidityContext:Boolean(sw),quality:q}}
}
function evaluateModule(spec,input){return featureMetric(spec,input,directional(input),quality(input))}
function aggregate(rows){let L=0,S=0,w=0,conflict=0;for(const r of rows){const wt=Math.max(.001,r.strength);if(r.direction==="LONG")L+=r.metric*wt;if(r.direction==="SHORT")S+=r.metric*wt;conflict+=r.conflict;w+=wt}return{long:Number(L.toFixed(6)),short:Number(S.toFixed(6)),edge:Number(Math.abs(L-S).toFixed(6)),direction:L>S?"LONG":S>L?"SHORT":"WAIT",conflict:Number(conflict.toFixed(6)),coverage:Number((rows.filter(r=>r.metric>.05).length/Math.max(1,rows.length)*100).toFixed(2)),weight:Number(w.toFixed(6))}}
function canonical(input){const c={version:VERSION,symbol:String(input.symbol||"UNKNOWN"),interval:String(input.interval||"UNKNOWN"),timestamp:n(input.now,Date.now()),price:n(input.price),baselineAction:side(input.phase51to100?.signal?.action||input.decision?.action),state:String(input.decision?.state||"WAIT"),source:String(input.marketSource||input.derivatives?.provider||"UNKNOWN")};c.hash=crypto.createHash("sha256").update(JSON.stringify(c)).digest("hex").slice(0,24).toUpperCase();return c}
function evaluate(input={}){const c=canonical(input),q=quality(input),rows=moduleSpecs.map(s=>evaluateModule(s,{...input,now:c.timestamp})),agg=aggregate(rows),baseAction=side(input.phase51to100?.signal?.action||input.decision?.action),baseEligible=Boolean(input.phase51to100?.gate?.qualified||input.phase51to100?.signal?.liveSignalEligible),baselineBlockers=(input.phase51to100?.signal?.blockers||[]).filter(x=>/DATA|RISK|ANOMALY|INVALID|LEVEL|TRIGGER|MTF|EXPECTANCY|PROBABILITY|EXCHANGE|PORTFOLIO|COOLDOWN|EXPIRED/i.test(String(x))).map(x=>"BASELINE_"+x),severeConflict=agg.conflict>Math.max(8,rows.length*.14),basicQuality=q.freshness>=.65&&q.venue>=.5&&Number.isFinite(c.price),directionConsistent=baseAction!=="WAIT"&&(agg.direction===baseAction||agg.edge<1.5),blockerList=[...new Set([...baselineBlockers,...(input.stale?["STALE_SNAPSHOT"]:[]),...(basicQuality?[]:["ADVANCED_DATA_QUALITY"]),...(severeConflict?["ADVANCED_EVIDENCE_CONFLICT"]:[]),...(rows.length===100?[]:["MODULE_COVERAGE"]),...(rows.filter(r=>r.metric>.05).length>=35?[]:["EVIDENCE_COVERAGE_LOW"]),...(directionConsistent?[]:["ADVANCED_DIRECTION_DISAGREES"])])],allowed=baseEligible&&blockerList.length===0,action=allowed?baseAction:"WAIT",p=validatedProbability(input.calibration?.probability,input.calibration?.source),top=rows.filter(r=>r.direction!=="WAIT").sort((a,b)=>(b.metric*b.strength)-(a.metric*a.strength)).slice(0,10);
 return{version:VERSION,automaticExecutionEnabled:false,realMoneyUse:"DECISION_SUPPORT_ONLY",canonical:c,baseline:{action:baseAction,eligible:baseEligible},aggregation:agg,prediction:{probability:p.probability,source:p.source,validated:p.available,disclaimer:p.available?"Validated historical evidence is preserved; it is not a guarantee.":"No validated probability supplied; MarketPulse will not invent one."},gate:{advancedSignalAllowed:allowed,action,baselineAction:baseAction,blockers:blockerList},evidence:{top:top.map(r=>({phase:r.phase,title:r.title,direction:r.direction,metric:r.metric,feature:r.feature})),conflictIndex:agg.conflict,coveragePct:agg.coverage},userExperience:{mode:"DECISION_SUPPORT",headline:action==="WAIT"?"NO TRADE — ADVANCED EVIDENCE NOT SUFFICIENT":"QUALIFIED — ADVANCED EVIDENCE CONSISTENT",whyNoTrade:blockerList.slice(0,10),nextConfirmation:action==="WAIT"?(blockerList.includes("STALE_SNAPSHOT")?"Wait for a fresh synchronized snapshot.":blockerList.length?"Wait for conflicting or incomplete evidence to resolve.":"Wait for the next validated trigger."):"Verify the execution checklist before acting.",timeline:{snapshotId:c.hash,generatedAt:c.timestamp,baselineAction:baseAction,advancedAction:action},evidenceMap:top.map(r=>({phase:r.phase,label:r.title,direction:r.direction,metric:r.metric})),lifecycle:action==="WAIT"?"WATCHING":"QUALIFIED",mobileSummary:{action,snapshotId:c.hash},automaticExecutionEnabled:false},adminIntelligence:{version:VERSION,snapshotId:c.hash,moduleCount:rows.length,moduleCoverage:agg.coverage,qualityIndex:Number((rows.reduce((s,r)=>s+r.metric,0)/rows.length*100).toFixed(2)),conflictIndex:agg.conflict,baselineAction:baseAction,advancedAction:action,signalSuppression:baseAction!==action&&baseAction!=="WAIT",blockers:blockerList,consistency:{singleCanonicalSnapshot:true},provenance:{moduleCount:rows.length,timestamp:c.timestamp},promotion:{status:"PENDING_VALIDATION",livePromotion:false,automaticExecutionEnabled:false}},rollout:{implemented:true,phaseRange:"101-200",phaseRegistryPendingValidation:true,livePromotion:false},modules:rows,stateHash:crypto.createHash("sha256").update(JSON.stringify({canonical:c,gate:blockerList,agg})).digest("hex").slice(0,24).toUpperCase()}}
function selfTest(){const x=evaluate({symbol:"BTCUSDT",interval:"15m",now:Date.now(),price:100,candles:[{o:99,h:101,l:98,c:100,v:100},{o:100,h:103,l:99,c:102,v:120},{o:102,h:104,l:101,c:103,v:150},{o:103,h:106,l:102,c:105,v:180},{o:105,h:107,l:104,c:106,v:200},{o:106,h:109,l:105,c:108,v:220}],decision:{action:"LONG",state:"READY",market:{price:100,trend:"UP",side:"LONG"}},analysis:{side:"LONG",confluenceScore:90,regime:{trend:"UP"},marketStructure:{setup:{side:"LONG",kind:"TEST"}}},derivatives:{available:true,cvdState:"BUYERS PRESSURE",positioning:"OI RISING",takerImbalance:.12,oiChangePct:2,orderBook:{imbalance:.1}},consensus:{consensusQualityPct:100},mtf:{higher:"LONG",execution:"LONG",lower:"LONG"},phase51to100:{signal:{action:"LONG",liveSignalEligible:true,blockers:[]},gate:{qualified:true}},calibration:{probability:.72,source:"CALIBRATED"},validation:{sampleCount:500,adaptive:{signalGateReady:true}}});return{ok:Boolean(x.modules.length===100&&x.automaticExecutionEnabled===false&&x.canonical.hash&&x.userExperience&&x.adminIntelligence),version:VERSION}}
module.exports={VERSION,moduleSpecs,evaluateModule,evaluate,selfTest,validatedProbability};
