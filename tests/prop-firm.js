const assert=require("assert");
const {normalizeConfig,flowDirection,evaluateStandard}=require("../prop-firm");

const cfg=normalizeConfig({accountSize:5000,startingEquity:5000,minSignalScore:70,minRR:1.5});
assert(cfg.accountSize===5000,"account size");
assert(flowDirection({cvdState:"BUYERS CONFIRM"})==="UP","buyer flow");
assert(flowDirection({cvdState:"SELLERS PRESSURE"})==="DOWN","seller flow");

const analysis={side:"LONG",score:82,rr:2,regime:"UPTREND"};
const deriv={available:true,updatedAt:Date.now(),cvdState:"BUYERS CONFIRM",positioning:"OI RISING",orderBook:{imbalance:.12,spreadBps:2}};
const good=evaluateStandard({
  analysis,derivatives:deriv,
  dataQuality:{qualityPct:100,consensusQualityPct:98,independentSourceCount:2,priceDispersionBps:5,candleAgeMs:1000},
  equity:5000,dayStartEquity:5000,peakEquity:5000,config:cfg
});
assert(good.decision==="ELIGIBLE"||good.decision==="ELIGIBLE_WITH_WARNINGS","standard gate");

const blocked=evaluateStandard({
  analysis:{side:"LONG",score:50,rr:1},
  derivatives:null,dataQuality:{qualityPct:50,candleAgeMs:999999},
  equity:5000,dayStartEquity:4800,peakEquity:5500,config:cfg
});
assert(blocked.decision==="BLOCKED","blocked gate");
assert(blocked.reasons.includes("SIGNAL_SCORE_BELOW_THRESHOLD"),"score gate");

const noConsensus= evaluateStandard({
  analysis,derivatives:deriv,
  dataQuality:{qualityPct:100,candleAgeMs:1000},
  equity:5000,dayStartEquity:5000,peakEquity:5000,config:cfg
});
assert(noConsensus.decision==="BLOCKED","missing consensus fails closed");
assert(noConsensus.reasons.includes("MARKET_CONSENSUS_UNAVAILABLE"),"consensus availability gate");
