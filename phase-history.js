/**
 * MarketPulse phase registry.
 * Historical phases 1-20 are documented from the current repository's README/code.
 * Phases 21-50 are the controlled engineering roadmap; a phase becomes COMPLETE
 * only after its implementation and validation gates pass.
 */
const phases = [
  {phase:1,status:"COMPLETE",title:"Core MarketPulse Foundation",description:"Initial market analytics application, supported assets/timeframes, dashboard shell and educational decision-support foundation."},
  {phase:2,status:"COMPLETE",title:"Market Analysis Layer",description:"Expanded price-action and indicator analysis, regime detection, setup classification and core market-engine plumbing."},
  {phase:3,status:"COMPLETE",title:"Trade Levels & Risk Context",description:"Entry zones, invalidation, targets and conservative trade-level geometry were added to the analysis stack."},
  {phase:4,status:"COMPLETE",title:"Learning & Signal Memory",description:"Signal/trade observations and learning hooks were introduced so resolved decisions could inform bounded historical calibration."},
  {phase:5,status:"COMPLETE",title:"Market Data & Derivatives Context",description:"Additional derivatives, order-flow and market-data context was wired into the analysis pipeline."},
  {phase:6,status:"COMPLETE",title:"Persistence & Research Foundations",description:"Durable memory, journal/state persistence and research-oriented data plumbing were established."},
  {phase:7,status:"COMPLETE",title:"Trader Analytics",description:"Journal analytics added win rate, expectancy, profit factor, average win/loss, net R, drawdown, streaks and multi-dimensional breakdowns."},
  {phase:8,status:"COMPLETE",title:"Accounts & Security",description:"Optional user accounts, secure password hashing, HTTP-only sessions, account-backed memory, rate limiting and hardened response security were added."},
  {phase:9,status:"COMPLETE",title:"Deterministic Decision Engine",description:"A single final Decision Engine combined market, multi-timeframe, derivatives/order-flow, data-quality, validation and prop-firm safety context."},
  {phase:10,status:"COMPLETE",title:"Decision Center Integration",description:"The final decision layer became the authoritative dashboard state with short caching and last-known-good fail-safe behavior."},
  {phase:11,status:"COMPLETE",title:"Live Validation Gates",description:"Current freshness, risk state, fail-safe state and historical evidence checks were placed before any live-reliance indication."},
  {phase:12,status:"COMPLETE",title:"Walk-Forward Validation",description:"Rolling historical replay of deterministic decision logic was added without future-candle lookahead and with conservative same-bar conflict handling."},
  {phase:13,status:"COMPLETE",title:"Adaptive Safety",description:"Observed out-of-sample performance can tighten confluence requirements; insufficient evidence keeps decisions PAPER_ONLY."},
  {phase:14,status:"COMPLETE",title:"Signal Intelligence",description:"Setup-specific knowledge profiles, conflict resolution, regime-aware calibration and bounded historical evidence were added for SFP, NPOC, D-Line and related setups."},
  {phase:15,status:"COMPLETE",title:"Operational Intelligence",description:"The system was extended with stronger operational/learning integrations and persistent runtime diagnostics around the decision stack."},
  {phase:16,status:"COMPLETE",title:"Watchdog & Self-Healing",description:"Continuous health checks, self-tests, load-aware behavior, incident recording and guarded remediation were introduced."},
  {phase:17,status:"COMPLETE",title:"Autotrader Safety Router",description:"Execution planning and interval/strategy routing were separated from signal logic while keeping execution behind explicit safety controls."},
  {phase:18,status:"COMPLETE",title:"Market State & Execution Routing",description:"Cross-venue market-state snapshots and a planning-only smart execution router were added, with no automatic live execution enablement."},
  {phase:19,status:"COMPLETE",title:"State Synchronization & Stability",description:"Authoritative decision/state synchronization, live-price consistency and stabilized directional presentation were strengthened across Decision Center surfaces."},
  {phase:20,status:"COMPLETE",title:"Scenario Matrix & Decision Forensics",description:"LONG, SHORT and WAIT scenarios are evaluated from one canonical snapshot with evidence, next confirmations, invalidation logic and snapshot integrity."},

  {phase:21,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Canonical State Contract",description:"Create one versioned server-side contract for price, structure, derivatives, liquidity, CVD, OI, risk, validation and decision state so every surface consumes the same normalized object."},
  {phase:22,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Authoritative State Bus",description:"Introduce a single state publication pipeline with monotonic sequence numbers, timestamps, source lineage and stale-snapshot protection across charts, Decision Center and workers."},
  {phase:23,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Directional Hysteresis Engine",description:"Make LONG/SHORT/WAIT transitions deterministic with minimum hold, confirmation count, invalidation triggers and anti-flip protection enforced server-side."},
  {phase:24,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Data Quality & Provenance Layer",description:"Score every input for freshness, completeness, venue agreement, timestamp integrity and source provenance; block downstream decisions when required evidence is unreliable."},
  {phase:25,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Cross-Exchange Flow Normalization",description:"Normalize order books, trades, funding, open interest, taker flow and CVD across venues with unit-aware transformations and missing-data rules."},
  {phase:26,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Market Regime Engine 2.0",description:"Upgrade regime detection to combine trend, volatility, liquidity, derivatives crowding and structural context with explicit transition confidence and regime history."},
  {phase:27,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Liquidity & Structure Intelligence",description:"Unify liquidity pools, sweeps, SFP, D-Line, FVG, breaker, NPOC, golden-pocket and market-structure evidence into one explainable structural graph."},
  {phase:28,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Confluence Scoring 2.0",description:"Replace loosely combined signals with bounded evidence weights, conflict penalties, regime-aware thresholds and transparent reason codes."},
  {phase:29,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Signal Calibration",description:"Calibrate historical signal probabilities/confidence against resolved outcomes while preventing future leakage and separating training, calibration and evaluation windows."},
  {phase:30,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Risk Engine 2.0",description:"Centralize risk sizing, liquidation distance, max loss, correlated exposure, daily drawdown and portfolio headroom so every decision uses the same risk contract."},
  {phase:31,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Backtest Engine 2.0",description:"Build reproducible event-driven backtesting with realistic order sequencing, fees, spread, stop/target precedence and full audit trails."},
  {phase:32,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Walk-Forward Evaluation 2.0",description:"Automate rolling train/calibrate/test windows with parameter freeze rules and out-of-sample reports by asset, regime, setup and timeframe."},
  {phase:33,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Monte Carlo & Robustness Lab",description:"Stress strategy outcomes with trade-order reshuffles, slippage shocks, gap assumptions and parameter perturbations to expose fragile edges."},
  {phase:34,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Paper Execution Simulator",description:"Create a realistic paper broker with fills, partial fills, rejected orders, order lifecycle, position state and simulated exchange responses."},
  {phase:35,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Latency & Slippage Model",description:"Measure and model signal-to-order latency, spread, market impact and adverse movement so paper results are not unrealistically optimistic."},
  {phase:36,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Signal Journal & Forensics 2.0",description:"Persist every decision snapshot, evidence set, gate result, price path and outcome so any signal can be reconstructed exactly after the fact."},
  {phase:37,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Adaptive Learning Guardrails",description:"Constrain online learning with versioned models, minimum sample sizes, rollback checkpoints, holdout protection and automatic disable-on-drift behavior."},
  {phase:38,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Drift Detection",description:"Detect changes in market behavior, feature distributions, setup frequency, hit rate and execution quality before allowing stale assumptions to propagate."},
  {phase:39,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Confidence Calibration & Scoring Audit",description:"Audit confidence against realized frequencies and expose calibration error, coverage and uncertainty instead of treating scores as certainty."},
  {phase:40,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Anomaly & Market Shock Detection",description:"Detect exchange divergences, abnormal volatility, liquidity vacuum, feed freezes, sudden OI/CVD dislocations and other conditions that should force WAIT."},
  {phase:41,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Fail-Safe & Kill-Switch Framework",description:"Add layered trading locks for bad data, model drift, loss limits, infrastructure faults and operator emergency controls with explicit recovery rules."},
  {phase:42,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Observability & SLOs",description:"Add structured telemetry for data latency, decision latency, signal stability, error rates, worker health, database health and service-level objectives."},
  {phase:43,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Admin Phase History",description:"Add a permanent owner-only evolution ledger showing Phase 1 through the current phase, what changed, validation status, commit/deploy reference and known limitations."},
  {phase:44,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Decision Explainability 2.0",description:"Make every final decision explainable from the canonical snapshot with evidence, conflicts, missing confirmations, invalidation and gate outcomes."},
  {phase:45,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Security & Secrets Review",description:"Perform a full application-security pass covering authentication, MFA, authorization boundaries, CSRF, headers, secret handling, dependency risk and admin-surface isolation."},
  {phase:46,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Deployment Safety & Canary",description:"Introduce staged deployment, health-gated rollout, rollback checkpoints and production verification so a bad release does not silently alter live decision behavior."},
  {phase:47,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Backup & Disaster Recovery",description:"Strengthen database backup verification, configuration recovery, migration safety, restore drills and lossless audit preservation."},
  {phase:48,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Performance & Scale",description:"Profile hot paths, reduce redundant market calls, optimize caches and database access, bound worker concurrency and test sustained multi-symbol load."},
  {phase:49,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Live-Readiness Gate",description:"Combine data integrity, validation, robustness, paper execution, risk, security, observability and operational evidence into one hard readiness gate."},
  {phase:50,status:"IMPLEMENTED_PENDING_VALIDATION",title:"Controlled Live-Readiness / Shadow-to-Live",description:"Run a final shadow-mode period, verify zero critical blockers, preserve rollback controls and only then expose a separately gated live-execution capability if the evidence supports it; no profitability guarantee is implied."}
];

function getPhaseHistory(){
  return phases.map(p=>({...p}));
}
function getCurrentPhase(){
  const complete=phases.filter(p=>p.status==="COMPLETE");
  return complete.length?Math.max(...complete.map(p=>p.phase)):0;
}
module.exports={phases,getPhaseHistory,getCurrentPhase};
