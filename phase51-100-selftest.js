/**
 * Phase 51–100 regression and safety self-test.
 * Requires every module, runs every module self-test, and exercises
 * critical public-signal gate edge cases.
 */
const assert=(x,m)=>{if(!x)throw new Error(m)};
  const p51=require("./phase51-trader-signal-contract");
  const p52=require("./phase52-signal-qualification-gate");
  const p53=require("./phase53-setup-ensemble");
  const p54=require("./phase54-multi-timeframe-alignment");
  const p55=require("./phase55-liquidity-reaction");
  const p56=require("./phase56-structure-shift");
  const p57=require("./phase57-imbalance-context");
  const p58=require("./phase58-cvd-oi-divergence");
  const p59=require("./phase59-derivatives-crowding");
  const p60=require("./phase60-cross-venue-consensus");
  const p61=require("./phase61-session-volatility-context");
  const p62=require("./phase62-trigger-quality");
  const p63=require("./phase63-invalidation-engine");
  const p64=require("./phase64-adaptive-levels");
  const p65=require("./phase65-expectancy-gate");
  const p66=require("./phase66-exchange-risk-translator");
  const p67=require("./phase67-leverage-safety");
  const p68=require("./phase68-signal-ttl");
  const p69=require("./phase69-signal-lifecycle");
  const p70=require("./phase70-anti-chop-cooldown");
  const p71=require("./phase71-probability-calibration-2");
  const p72=require("./phase72-ensemble-confidence");
  const p73=require("./phase73-uncertainty-coverage");
  const p74=require("./phase74-cost-aware-expectancy");
  const p75=require("./phase75-mae-analytics");
  const p76=require("./phase76-mfe-analytics");
  const p77=require("./phase77-false-positive-taxonomy");
  const p78=require("./phase78-false-negative-taxonomy");
  const p79=require("./phase79-missed-signal-analytics");
  const p80=require("./phase80-no-trade-quality");
  const p81=require("./phase81-shadow-learning");
  const p82=require("./phase82-champion-challenger");
  const p83=require("./phase83-drift-recovery");
  const p84=require("./phase84-parameter-guardrails");
  const p85=require("./phase85-live-signal-monitoring");
  const p86=require("./phase86-symbol-correlation");
  const p87=require("./phase87-portfolio-risk");
  const p88=require("./phase88-event-risk");
  const p89=require("./phase89-exchange-health");
  const p90=require("./phase90-trader-checklist");
  const p91=require("./phase91-user-context");
  const p92=require("./phase92-beginner-mode");
  const p93=require("./phase93-decision-timeline");
  const p94=require("./phase94-notification-tiers");
  const p95=require("./phase95-public-signal-history");
  const p96=require("./phase96-live-scorecard");
  const p97=require("./phase97-outcome-feedback");
  const p98=require("./phase98-public-transparency");
  const p99=require("./phase99-free-public-readiness");
  const p100=require("./phase100-public-signal-gate");
const stack=require("./phase51-100-stack");

  assert(typeof p51.selfTest==="function","phase51 selfTest missing");
  const t51=p51.selfTest(); assert(t51&&t51.ok===true,"phase51 selfTest failed");
  assert(typeof p52.selfTest==="function","phase52 selfTest missing");
  const t52=p52.selfTest(); assert(t52&&t52.ok===true,"phase52 selfTest failed");
  assert(typeof p53.selfTest==="function","phase53 selfTest missing");
  const t53=p53.selfTest(); assert(t53&&t53.ok===true,"phase53 selfTest failed");
  assert(typeof p54.selfTest==="function","phase54 selfTest missing");
  const t54=p54.selfTest(); assert(t54&&t54.ok===true,"phase54 selfTest failed");
  assert(typeof p55.selfTest==="function","phase55 selfTest missing");
  const t55=p55.selfTest(); assert(t55&&t55.ok===true,"phase55 selfTest failed");
  assert(typeof p56.selfTest==="function","phase56 selfTest missing");
  const t56=p56.selfTest(); assert(t56&&t56.ok===true,"phase56 selfTest failed");
  assert(typeof p57.selfTest==="function","phase57 selfTest missing");
  const t57=p57.selfTest(); assert(t57&&t57.ok===true,"phase57 selfTest failed");
  assert(typeof p58.selfTest==="function","phase58 selfTest missing");
  const t58=p58.selfTest(); assert(t58&&t58.ok===true,"phase58 selfTest failed");
  assert(typeof p59.selfTest==="function","phase59 selfTest missing");
  const t59=p59.selfTest(); assert(t59&&t59.ok===true,"phase59 selfTest failed");
  assert(typeof p60.selfTest==="function","phase60 selfTest missing");
  const t60=p60.selfTest(); assert(t60&&t60.ok===true,"phase60 selfTest failed");
  assert(typeof p61.selfTest==="function","phase61 selfTest missing");
  const t61=p61.selfTest(); assert(t61&&t61.ok===true,"phase61 selfTest failed");
  assert(typeof p62.selfTest==="function","phase62 selfTest missing");
  const t62=p62.selfTest(); assert(t62&&t62.ok===true,"phase62 selfTest failed");
  assert(typeof p63.selfTest==="function","phase63 selfTest missing");
  const t63=p63.selfTest(); assert(t63&&t63.ok===true,"phase63 selfTest failed");
  assert(typeof p64.selfTest==="function","phase64 selfTest missing");
  const t64=p64.selfTest(); assert(t64&&t64.ok===true,"phase64 selfTest failed");
  assert(typeof p65.selfTest==="function","phase65 selfTest missing");
  const t65=p65.selfTest(); assert(t65&&t65.ok===true,"phase65 selfTest failed");
  assert(typeof p66.selfTest==="function","phase66 selfTest missing");
  const t66=p66.selfTest(); assert(t66&&t66.ok===true,"phase66 selfTest failed");
  assert(typeof p67.selfTest==="function","phase67 selfTest missing");
  const t67=p67.selfTest(); assert(t67&&t67.ok===true,"phase67 selfTest failed");
  assert(typeof p68.selfTest==="function","phase68 selfTest missing");
  const t68=p68.selfTest(); assert(t68&&t68.ok===true,"phase68 selfTest failed");
  assert(typeof p69.selfTest==="function","phase69 selfTest missing");
  const t69=p69.selfTest(); assert(t69&&t69.ok===true,"phase69 selfTest failed");
  assert(typeof p70.selfTest==="function","phase70 selfTest missing");
  const t70=p70.selfTest(); assert(t70&&t70.ok===true,"phase70 selfTest failed");
  assert(typeof p71.selfTest==="function","phase71 selfTest missing");
  const t71=p71.selfTest(); assert(t71&&t71.ok===true,"phase71 selfTest failed");
  assert(typeof p72.selfTest==="function","phase72 selfTest missing");
  const t72=p72.selfTest(); assert(t72&&t72.ok===true,"phase72 selfTest failed");
  assert(typeof p73.selfTest==="function","phase73 selfTest missing");
  const t73=p73.selfTest(); assert(t73&&t73.ok===true,"phase73 selfTest failed");
  assert(typeof p74.selfTest==="function","phase74 selfTest missing");
  const t74=p74.selfTest(); assert(t74&&t74.ok===true,"phase74 selfTest failed");
  assert(typeof p75.selfTest==="function","phase75 selfTest missing");
  const t75=p75.selfTest(); assert(t75&&t75.ok===true,"phase75 selfTest failed");
  assert(typeof p76.selfTest==="function","phase76 selfTest missing");
  const t76=p76.selfTest(); assert(t76&&t76.ok===true,"phase76 selfTest failed");
  assert(typeof p77.selfTest==="function","phase77 selfTest missing");
  const t77=p77.selfTest(); assert(t77&&t77.ok===true,"phase77 selfTest failed");
  assert(typeof p78.selfTest==="function","phase78 selfTest missing");
  const t78=p78.selfTest(); assert(t78&&t78.ok===true,"phase78 selfTest failed");
  assert(typeof p79.selfTest==="function","phase79 selfTest missing");
  const t79=p79.selfTest(); assert(t79&&t79.ok===true,"phase79 selfTest failed");
  assert(typeof p80.selfTest==="function","phase80 selfTest missing");
  const t80=p80.selfTest(); assert(t80&&t80.ok===true,"phase80 selfTest failed");
  assert(typeof p81.selfTest==="function","phase81 selfTest missing");
  const t81=p81.selfTest(); assert(t81&&t81.ok===true,"phase81 selfTest failed");
  assert(typeof p82.selfTest==="function","phase82 selfTest missing");
  const t82=p82.selfTest(); assert(t82&&t82.ok===true,"phase82 selfTest failed");
  assert(typeof p83.selfTest==="function","phase83 selfTest missing");
  const t83=p83.selfTest(); assert(t83&&t83.ok===true,"phase83 selfTest failed");
  assert(typeof p84.selfTest==="function","phase84 selfTest missing");
  const t84=p84.selfTest(); assert(t84&&t84.ok===true,"phase84 selfTest failed");
  assert(typeof p85.selfTest==="function","phase85 selfTest missing");
  const t85=p85.selfTest(); assert(t85&&t85.ok===true,"phase85 selfTest failed");
  assert(typeof p86.selfTest==="function","phase86 selfTest missing");
  const t86=p86.selfTest(); assert(t86&&t86.ok===true,"phase86 selfTest failed");
  assert(typeof p87.selfTest==="function","phase87 selfTest missing");
  const t87=p87.selfTest(); assert(t87&&t87.ok===true,"phase87 selfTest failed");
  assert(typeof p88.selfTest==="function","phase88 selfTest missing");
  const t88=p88.selfTest(); assert(t88&&t88.ok===true,"phase88 selfTest failed");
  assert(typeof p89.selfTest==="function","phase89 selfTest missing");
  const t89=p89.selfTest(); assert(t89&&t89.ok===true,"phase89 selfTest failed");
  assert(typeof p90.selfTest==="function","phase90 selfTest missing");
  const t90=p90.selfTest(); assert(t90&&t90.ok===true,"phase90 selfTest failed");
  assert(typeof p91.selfTest==="function","phase91 selfTest missing");
  const t91=p91.selfTest(); assert(t91&&t91.ok===true,"phase91 selfTest failed");
  assert(typeof p92.selfTest==="function","phase92 selfTest missing");
  const t92=p92.selfTest(); assert(t92&&t92.ok===true,"phase92 selfTest failed");
  assert(typeof p93.selfTest==="function","phase93 selfTest missing");
  const t93=p93.selfTest(); assert(t93&&t93.ok===true,"phase93 selfTest failed");
  assert(typeof p94.selfTest==="function","phase94 selfTest missing");
  const t94=p94.selfTest(); assert(t94&&t94.ok===true,"phase94 selfTest failed");
  assert(typeof p95.selfTest==="function","phase95 selfTest missing");
  const t95=p95.selfTest(); assert(t95&&t95.ok===true,"phase95 selfTest failed");
  assert(typeof p96.selfTest==="function","phase96 selfTest missing");
  const t96=p96.selfTest(); assert(t96&&t96.ok===true,"phase96 selfTest failed");
  assert(typeof p97.selfTest==="function","phase97 selfTest missing");
  const t97=p97.selfTest(); assert(t97&&t97.ok===true,"phase97 selfTest failed");
  assert(typeof p98.selfTest==="function","phase98 selfTest missing");
  const t98=p98.selfTest(); assert(t98&&t98.ok===true,"phase98 selfTest failed");
  assert(typeof p99.selfTest==="function","phase99 selfTest missing");
  const t99=p99.selfTest(); assert(t99&&t99.ok===true,"phase99 selfTest failed");
  assert(typeof p100.selfTest==="function","phase100 selfTest missing");
  const t100=p100.selfTest(); assert(t100&&t100.ok===true,"phase100 selfTest failed");

const base={
  symbol:"BTCUSDT",interval:"15m",price:100,
  decision:{action:"LONG",market:{side:"LONG",confluenceScore:85},levels:{entry:100,stop:98,tp1:103,tp2:105,rr:1.5}},
  analysis:{side:"LONG",regime:{trend:"UP"},confluenceScore:85,marketStructure:{setup:{side:"LONG"}}},
  derivatives:{cvdState:"BUYERS CONFIRM",takerImbalance:.12,oiChangePct:2,orderBook:{imbalance:.1}},
  phaseStack:{data:{quality:{liveEligible:true}},risk:{blocked:false},anomaly:{anomalous:false}},
  triggerConfirmed:true,mtfAligned:true,setupEvidence:true,flowEvidence:true,invalidation:true,levelsValid:true,
  calibration:{probability:.72},
  uncertainty:{coveragePct:95,calibrationSamples:500,disagreementPct:5},
  publicReadiness:{data:true,validation:true,calibration:true,risk:true,security:true,observability:true,operations:true},
  expectancy:{winProbability:.72,averageWinR:2,averageLossR:1,costR:.05},
  exchangeHealth:{reliabilityPct:100},portfolio:{positions:[]},
  leverage:{leverage:2,liquidationDistancePct:10}
};
const good=stack.evaluate(base);
assert(good.signal.action==="LONG","qualified synchronized setup must produce LONG");
assert(good.gate.qualified===true,"qualified setup must open public signal gate");
assert(good.signal.automaticExecutionEnabled===false,"automatic execution must remain disabled");

const stale=stack.evaluate({...base,signalAgeMs:999999});
assert(stale.signal.action==="WAIT"&&stale.gate.qualified===false,"expired signal must become WAIT");

const noData=stack.evaluate({...base,phaseStack:{data:{quality:{liveEligible:false}},risk:{blocked:false},anomaly:{anomalous:false}}});
assert(noData.signal.action==="WAIT","bad data must force WAIT");

const noLeverage=stack.evaluate({...base,leverage:{}});
assert(noLeverage.signal.action==="WAIT"&&noLeverage.gate.qualified===false,"undefined leverage safety must block public signal");

const mtfConflict=stack.evaluate({...base,mtf:{higher:"LONG",execution:"SHORT",lower:"LONG"},mtfAligned:false});
assert(mtfConflict.signal.action==="WAIT","multi-timeframe conflict must force WAIT");

const riskBlocked=stack.evaluate({...base,phaseStack:{data:{quality:{liveEligible:true}},risk:{blocked:true},anomaly:{anomalous:false}}});
assert(riskBlocked.signal.action==="WAIT","risk blocker must force WAIT");

console.log(JSON.stringify({ok:true,phases:50,version:stack.VERSION}));
