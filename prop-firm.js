const VERSION = "1.0.0";

const DEFAULT_CONFIG = Object.freeze({
  accountSize: 5000,
  startingEquity: 5000,
  dailyLossLimitPct: 3,
  maxDrawdownPct: 6,
  riskPerTradePct: 0.5,
  maxOpenRiskPct: 1,
  maxPositions: 2,
  minSignalScore: 78,
  minRR: 1.5,
  minDataQualityPct: 85,
  minConsensusQualityPct: 85,
  maxPriceDispersionBps: 80,
  requireIndependentConsensus: true,
  eventMinSecondsToExpiry: 30,
  eventMinStrikeDistanceBps: 1,
  maxCandleAgeMs: 120000,
  maxFlowAgeMs: 120000,
  maxSpreadBps: 20,
  maxConsecutiveLosses: 3,
  cooldownMinutesAfterLoss: 30,
  maxTradesPerDay: 8,
  requireDerivatives: true,
  requireFlowConfirmation: true,
  blockMixedFlow: true,
  blockHighVolatility: true
});

function finite(x, fallback = null) {
  if (x === null || x === undefined || x === "") return fallback;
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function numPct(x) {
  return finite(x, 0) || 0;
}

function normalizeConfig(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  for (const [k, v] of Object.entries(DEFAULT_CONFIG)) {
    const n = typeof v === "number" ? finite(src[k], v) : src[k] ?? v;
    out[k] = n;
  }
  out.accountSize = Math.max(0, finite(out.accountSize, DEFAULT_CONFIG.accountSize));
  out.startingEquity = Math.max(0, finite(out.startingEquity, out.accountSize));
  out.dailyLossLimitPct = Math.max(0.1, finite(out.dailyLossLimitPct, 3));
  out.maxDrawdownPct = Math.max(0.1, finite(out.maxDrawdownPct, 6));
  out.riskPerTradePct = clamp(finite(out.riskPerTradePct, 0.5), 0.01, 10);
  out.maxOpenRiskPct = clamp(finite(out.maxOpenRiskPct, 1), 0.01, 25);
  out.maxPositions = Math.max(1, Math.floor(finite(out.maxPositions, 2)));
  out.minSignalScore = clamp(finite(out.minSignalScore, 78), 0, 100);
  out.minRR = Math.max(0.1, finite(out.minRR, 1.5));
  out.minDataQualityPct = clamp(finite(out.minDataQualityPct, 85), 0, 100);
  out.minConsensusQualityPct = clamp(finite(out.minConsensusQualityPct, 85), 0, 100);
  out.maxPriceDispersionBps = Math.max(0.1, finite(out.maxPriceDispersionBps, 80));
  out.requireIndependentConsensus = Boolean(out.requireIndependentConsensus);
  out.eventMinSecondsToExpiry = Math.max(1, finite(out.eventMinSecondsToExpiry, 30));
  out.eventMinStrikeDistanceBps = Math.max(0, finite(out.eventMinStrikeDistanceBps, 1));
  out.maxCandleAgeMs = Math.max(1000, finite(out.maxCandleAgeMs, 120000));
  out.maxFlowAgeMs = Math.max(1000, finite(out.maxFlowAgeMs, 120000));
  out.maxSpreadBps = Math.max(0.1, finite(out.maxSpreadBps, 20));
  out.maxConsecutiveLosses = Math.max(0, Math.floor(finite(out.maxConsecutiveLosses, 3)));
  out.cooldownMinutesAfterLoss = Math.max(0, finite(out.cooldownMinutesAfterLoss, 30));
  out.maxTradesPerDay = Math.max(1, Math.floor(finite(out.maxTradesPerDay, 8)));
  out.requireDerivatives = Boolean(out.requireDerivatives);
  out.requireFlowConfirmation = Boolean(out.requireFlowConfirmation);
  out.blockMixedFlow = Boolean(out.blockMixedFlow);
  out.blockHighVolatility = Boolean(out.blockHighVolatility);
  return out;
}

function flowDirection(derivatives = {}) {
  const cvd = String(derivatives.cvdState || "").toUpperCase();
  const positioning = String(derivatives.positioning || "").toUpperCase();
  const liq = String(derivatives.liquidationBias || "").toUpperCase();
  const ob = finite(derivatives.orderBook?.imbalance ?? derivatives.orderBookImbalance, null);
  const taker = finite(derivatives.takerImbalance, null);
  let up = 0, down = 0;
  if (cvd.includes("BUYERS") || cvd.includes("BULLISH")) up += 2;
  if (cvd.includes("SELLERS") || cvd.includes("BEARISH")) down += 2;
  if (positioning.includes("LONG") || positioning.includes("SHORT COVERING") || positioning.includes("OI RISING")) up += 1;
  if (positioning.includes("SHORT") || positioning.includes("LONG LIQUIDATION") || positioning.includes("OI FALLING")) down += 1;
  if (liq.includes("SHORT LIQS")) up += 0.5;
  if (liq.includes("LONG LIQS")) down += 0.5;
  if (Number.isFinite(taker)) {
    if (taker > 0.01) up += 1;
    if (taker < -0.01) down += 1;
  }
  if (Number.isFinite(ob)) {
    if (ob > 0.05) up += 1;
    if (ob < -0.05) down += 1;
  }
  if (up > down + 0.75) return "UP";
  if (down > up + 0.75) return "DOWN";
  return "MIXED";
}

function baseGates({ analysis = {}, derivatives = null, dataQuality = {}, equity, dayStartEquity, peakEquity, openRiskPct = 0, openPositions = 0, consecutiveLosses = 0, lastLossAt = null, tradesToday = 0, config: rawConfig = {} } = {}) {
  const config = normalizeConfig(rawConfig);
  const reasons = [];
  const warnings = [];
  const score = finite(analysis.score, 0);
  const rr = finite(analysis.rr, 0);
  const eq = finite(equity, config.startingEquity);
  const dayStart = finite(dayStartEquity, eq);
  const peak = Math.max(finite(peakEquity, config.startingEquity), dayStart);
  const dailyLossCash = Math.max(0, dayStart - eq);
  const maxDrawdownCash = Math.max(0, peak - eq);
  const dailyLossPct = dayStart > 0 ? dailyLossCash / dayStart * 100 : 100;
  const maxDrawdownPct = peak > 0 ? maxDrawdownCash / peak * 100 : 100;
  const candleAgeMs = finite(dataQuality.candleAgeMs, null);
  const dataQualityPct = finite(dataQuality.qualityPct ?? dataQuality.score, 100);
  const consensusQualityPct = finite(dataQuality.consensusQualityPct, null);
  const priceDispersionBps = finite(dataQuality.priceDispersionBps, null);
  const independentSourceCount = finite(dataQuality.independentSourceCount, null);
  const derivAvailable = Boolean(derivatives?.available);
  const flowAgeMs = finite(derivatives?.updatedAt ? Date.now() - Number(derivatives.updatedAt) : null, null);
  const spreadBps = finite(derivatives?.orderBook?.spreadBps, null);
  const flow = flowDirection(derivatives || {});
  const highVol = String(analysis.regime || "").toUpperCase().includes("HIGH VOL");

  if (!["LONG", "SHORT"].includes(String(analysis.side || "").toUpperCase())) reasons.push("NO_DIRECTIONAL_SETUP");
  if (score < config.minSignalScore) reasons.push("SIGNAL_SCORE_BELOW_THRESHOLD");
  if (rr < config.minRR) reasons.push("R_R_BELOW_THRESHOLD");
  if (config.requireDerivatives && !derivAvailable) reasons.push("DERIVATIVES_UNAVAILABLE");
  if (dataQualityPct < config.minDataQualityPct) reasons.push("DATA_QUALITY_BELOW_THRESHOLD");
  if (config.requireIndependentConsensus && consensusQualityPct === null) reasons.push("MARKET_CONSENSUS_UNAVAILABLE");
  if (config.requireIndependentConsensus && consensusQualityPct !== null && consensusQualityPct < config.minConsensusQualityPct) reasons.push("MARKET_CONSENSUS_WEAK");
  if (priceDispersionBps !== null && priceDispersionBps > config.maxPriceDispersionBps) reasons.push("PRICE_FEEDS_CONFLICT");
  if (config.requireIndependentConsensus && independentSourceCount === null) reasons.push("CONSENSUS_SOURCE_COUNT_UNAVAILABLE");
  if (config.requireIndependentConsensus && independentSourceCount !== null && independentSourceCount < 2) reasons.push("INSUFFICIENT_INDEPENDENT_PRICE_SOURCES");
  if (candleAgeMs !== null && candleAgeMs > config.maxCandleAgeMs) reasons.push("CANDLE_DATA_STALE");
  if (derivAvailable && flowAgeMs !== null && flowAgeMs > config.maxFlowAgeMs) reasons.push("FLOW_DATA_STALE");
  if (spreadBps !== null && spreadBps > config.maxSpreadBps) reasons.push("SPREAD_TOO_WIDE");
  if (dailyLossPct >= config.dailyLossLimitPct) reasons.push("DAILY_LOSS_LIMIT_REACHED");
  if (maxDrawdownPct >= config.maxDrawdownPct) reasons.push("MAX_DRAWDOWN_LIMIT_REACHED");
  if (openRiskPct >= config.maxOpenRiskPct) reasons.push("OPEN_RISK_LIMIT_REACHED");
  if (openPositions >= config.maxPositions) reasons.push("MAX_OPEN_POSITIONS_REACHED");
  if (tradesToday >= config.maxTradesPerDay) reasons.push("DAILY_TRADE_LIMIT_REACHED");
  if (config.maxConsecutiveLosses > 0 && consecutiveLosses >= config.maxConsecutiveLosses) reasons.push("CONSECUTIVE_LOSS_LIMIT_REACHED");
  if (lastLossAt && config.cooldownMinutesAfterLoss > 0) {
    const elapsed = (Date.now() - Number(lastLossAt)) / 60000;
    if (Number.isFinite(elapsed) && elapsed < config.cooldownMinutesAfterLoss) reasons.push("LOSS_COOLDOWN_ACTIVE");
  }
  if (config.blockHighVolatility && highVol) reasons.push("HIGH_VOLATILITY_BLOCKED");

  const requestedSide = String(analysis.side || "").toUpperCase() === "LONG" ? "UP" : "DOWN";
  if (config.requireFlowConfirmation && derivAvailable) {
    if (flow === "MIXED") { if (config.blockMixedFlow) reasons.push("FLOW_MIXED"); else warnings.push("FLOW_MIXED"); }
    else if (flow !== requestedSide) reasons.push("FLOW_CONFLICTS_WITH_DIRECTION");
  } else if (config.requireFlowConfirmation && !derivAvailable) {
    reasons.push("FLOW_CONFIRMATION_UNAVAILABLE");
  }

  const maxLossCash = Math.max(0, eq * config.riskPerTradePct / 100);
  const riskHeadroomCash = Math.max(0, Math.min(
    maxLossCash,
    eq * Math.max(0, config.maxOpenRiskPct - Math.max(0, openRiskPct)) / 100,
    Math.max(0, dayStart * config.dailyLossLimitPct / 100 - dailyLossCash),
    Math.max(0, peak * config.maxDrawdownPct / 100 - maxDrawdownCash)
  ));
  const blocked = reasons.length > 0;
  return {
    version: VERSION,
    decision: blocked ? "BLOCKED" : (warnings.length ? "ELIGIBLE_WITH_WARNINGS" : "ELIGIBLE"),
    reasons,
    warnings,
    signalSide: requestedSide,
    score,
    rr,
    flow,
    dataQualityPct,
    consensusQualityPct,
    priceDispersionBps,
    independentSourceCount,
    candleAgeMs,
    flowAgeMs,
    spreadBps,
    dailyLossPct,
    maxDrawdownPct,
    maxLossCash,
    riskHeadroomCash,
    equity: eq,
    dayStartEquity: dayStart,
    peakEquity: peak,
    openRiskPct,
    openPositions,
    consecutiveLosses,
    tradesToday,
    config
  };
}

function evaluateEventContract({
  analysis = {},
  derivatives = null,
  dataQuality = {},
  equity,
  dayStartEquity,
  peakEquity,
  openRiskPct = 0,
  openPositions = 0,
  consecutiveLosses = 0,
  lastLossAt = null,
  tradesToday = 0,
  side = null,
  premium = null,
  payout = 0,
  fee = 0,
  maxContracts = null,
  venue = "GENERIC",
  strikePrice = null,
  indexPrice = null,
  expirationAt = null,
  strictContractContext = false,
  config: rawConfig = {}
} = {}) {
  const base = baseGates({analysis, derivatives, dataQuality, equity, dayStartEquity, peakEquity, openRiskPct, openPositions, consecutiveLosses, lastLossAt, tradesToday, config: rawConfig});
  const requested = String(side || base.signalSide || "").toUpperCase();
  const allowedSide = requested === "LONG" ? "UP" : requested === "SHORT" ? "DOWN" : requested;
  const premiumCash = finite(premium, null);
  const payoutCash = finite(payout, null);
  const feeCash = Math.max(0, finite(fee, 0));
  const strike=finite(strikePrice,null);
  const index=finite(indexPrice,null);
  const expiry=finite(expirationAt,null);
  const secondsToExpiry=expiry!==null?(expiry-Date.now())/1000:null;
  const strikeDistanceBps=Number.isFinite(strike)&&strike>0&&Number.isFinite(index)?Math.abs(index-strike)/index*10000:null;

  if (!["UP", "DOWN"].includes(allowedSide)) base.reasons.push("EVENT_SIDE_REQUIRED");
  if (!(premiumCash > 0)) base.reasons.push("PREMIUM_REQUIRED");
  if (!(payoutCash > 0)) base.reasons.push("PAYOUT_REQUIRED");
  if (premiumCash !== null && payoutCash !== null && payoutCash <= premiumCash + feeCash) base.reasons.push("PAYOUT_NOT_ABOVE_STAKE");
  if(strictContractContext && strike===null) base.reasons.push("STRIKE_REQUIRED");
  if(strictContractContext && expiry===null) base.reasons.push("EXPIRY_REQUIRED");
  if(secondsToExpiry!==null && secondsToExpiry<=0) base.reasons.push("CONTRACT_EXPIRED");
  if(secondsToExpiry!==null && secondsToExpiry>0 && secondsToExpiry<base.config.eventMinSecondsToExpiry) base.reasons.push("EXPIRY_TOO_CLOSE");
  if(strikeDistanceBps!==null && strikeDistanceBps<base.config.eventMinStrikeDistanceBps) base.reasons.push("STRIKE_TOO_CLOSE_TO_INDEX");

  const stakeRisk = premiumCash > 0 ? premiumCash + feeCash : 0;
  const winProfit = payoutCash > 0 ? Math.max(0, payoutCash - stakeRisk) : 0;
  const rr = stakeRisk > 0 ? winProfit / stakeRisk : 0;
  const riskBudget = base.riskHeadroomCash;
  let units = stakeRisk > 0 ? Math.floor(riskBudget / stakeRisk) : 0;
  if (maxContracts !== null) units = Math.min(units, Math.max(0, Math.floor(Number(maxContracts) || 0)));

  const signalSide = base.signalSide;
  if (["UP","DOWN"].includes(allowedSide) && signalSide && allowedSide !== signalSide) base.reasons.push("EVENT_DIRECTION_CONFLICTS_WITH_SIGNAL");
  if (rr < base.config.minRR) base.reasons.push("EVENT_PAYOFF_BELOW_RISK_REQUIREMENT");
  if (!units) base.reasons.push("NO_CONTRACTS_WITHIN_RISK_BUDGET");

  return {
    ...base,
    decision: base.reasons.length ? "BLOCKED" : (base.warnings.length ? "ELIGIBLE_WITH_WARNINGS" : "ELIGIBLE"),
    mode: "EVENT_UP_DOWN",
    eventSide: allowedSide,
    venue:String(venue||"GENERIC").toUpperCase(),
    strikePrice:strike,
    indexPrice:index,
    expirationAt:expiry,
    secondsToExpiry,
    strikeDistanceBps,
    contractContextComplete:Boolean(strike!==null&&expiry!==null),
    premium: premiumCash,
    payout: payoutCash,
    fee: feeCash,
    stakeRisk,
    winProfit,
    payoffR: rr,
    riskBudget,
    maxContracts: units,
    maxLoss: units * stakeRisk,
    maxProfit: units * winProfit,
    exposure: units * stakeRisk,
    note: "This is a risk/evidence gate, not a prediction guarantee or order executor."
  };
}

function evaluateStandard(args = {}) {
  return baseGates(args);
}

module.exports = {
  VERSION,
  DEFAULT_CONFIG,
  normalizeConfig,
  flowDirection,
  evaluateStandard,
  evaluateEventContract
};
