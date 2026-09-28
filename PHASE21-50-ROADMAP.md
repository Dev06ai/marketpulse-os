# MarketPulse Phase 21–50 Engineering Roadmap

## Operating rule
A phase is complete only after implementation, regression validation, data-integrity checks and the appropriate deployment gate pass. A failed gate leaves the feature disabled or rolls the change back.

## Phase plan

### Phase 21 — Canonical State Contract
**Status:** PLANNED
Create one versioned server-side contract for price, structure, derivatives, liquidity, CVD, OI, risk, validation and decision state so every surface consumes the same normalized object.

### Phase 22 — Authoritative State Bus
**Status:** PLANNED
Introduce a single state publication pipeline with monotonic sequence numbers, timestamps, source lineage and stale-snapshot protection across charts, Decision Center and workers.

### Phase 23 — Directional Hysteresis Engine
**Status:** PLANNED
Make LONG/SHORT/WAIT transitions deterministic with minimum hold, confirmation count, invalidation triggers and anti-flip protection enforced server-side.

### Phase 24 — Data Quality & Provenance Layer
**Status:** PLANNED
Score every input for freshness, completeness, venue agreement, timestamp integrity and source provenance; block downstream decisions when required evidence is unreliable.

### Phase 25 — Cross-Exchange Flow Normalization
**Status:** PLANNED
Normalize order books, trades, funding, open interest, taker flow and CVD across venues with unit-aware transformations and missing-data rules.

### Phase 26 — Market Regime Engine 2.0
**Status:** PLANNED
Upgrade regime detection to combine trend, volatility, liquidity, derivatives crowding and structural context with explicit transition confidence and regime history.

### Phase 27 — Liquidity & Structure Intelligence
**Status:** PLANNED
Unify liquidity pools, sweeps, SFP, D-Line, FVG, breaker, NPOC, golden-pocket and market-structure evidence into one explainable structural graph.

### Phase 28 — Confluence Scoring 2.0
**Status:** PLANNED
Replace loosely combined signals with bounded evidence weights, conflict penalties, regime-aware thresholds and transparent reason codes.

### Phase 29 — Signal Calibration
**Status:** PLANNED
Calibrate historical signal probabilities/confidence against resolved outcomes while preventing future leakage and separating training, calibration and evaluation windows.

### Phase 30 — Risk Engine 2.0
**Status:** PLANNED
Centralize risk sizing, liquidation distance, max loss, correlated exposure, daily drawdown and portfolio headroom so every decision uses the same risk contract.

### Phase 31 — Backtest Engine 2.0
**Status:** PLANNED
Build reproducible event-driven backtesting with realistic order sequencing, fees, spread, stop/target precedence and full audit trails.

### Phase 32 — Walk-Forward Evaluation 2.0
**Status:** PLANNED
Automate rolling train/calibrate/test windows with parameter freeze rules and out-of-sample reports by asset, regime, setup and timeframe.

### Phase 33 — Monte Carlo & Robustness Lab
**Status:** PLANNED
Stress strategy outcomes with trade-order reshuffles, slippage shocks, gap assumptions and parameter perturbations to expose fragile edges.

### Phase 34 — Paper Execution Simulator
**Status:** PLANNED
Create a realistic paper broker with fills, partial fills, rejected orders, order lifecycle, position state and simulated exchange responses.

### Phase 35 — Latency & Slippage Model
**Status:** PLANNED
Measure and model signal-to-order latency, spread, market impact and adverse movement so paper results are not unrealistically optimistic.

### Phase 36 — Signal Journal & Forensics 2.0
**Status:** PLANNED
Persist every decision snapshot, evidence set, gate result, price path and outcome so any signal can be reconstructed exactly after the fact.

### Phase 37 — Adaptive Learning Guardrails
**Status:** PLANNED
Constrain online learning with versioned models, minimum sample sizes, rollback checkpoints, holdout protection and automatic disable-on-drift behavior.

### Phase 38 — Drift Detection
**Status:** PLANNED
Detect changes in market behavior, feature distributions, setup frequency, hit rate and execution quality before allowing stale assumptions to propagate.

### Phase 39 — Confidence Calibration & Scoring Audit
**Status:** PLANNED
Audit confidence against realized frequencies and expose calibration error, coverage and uncertainty instead of treating scores as certainty.

### Phase 40 — Anomaly & Market Shock Detection
**Status:** PLANNED
Detect exchange divergences, abnormal volatility, liquidity vacuum, feed freezes, sudden OI/CVD dislocations and other conditions that should force WAIT.

### Phase 41 — Fail-Safe & Kill-Switch Framework
**Status:** PLANNED
Add layered trading locks for bad data, model drift, loss limits, infrastructure faults and operator emergency controls with explicit recovery rules.

### Phase 42 — Observability & SLOs
**Status:** PLANNED
Add structured telemetry for data latency, decision latency, signal stability, error rates, worker health, database health and service-level objectives.

### Phase 43 — Admin Phase History
**Status:** PLANNED
Add a permanent owner-only evolution ledger showing Phase 1 through the current phase, what changed, validation status, commit/deploy reference and known limitations.

### Phase 44 — Decision Explainability 2.0
**Status:** PLANNED
Make every final decision explainable from the canonical snapshot with evidence, conflicts, missing confirmations, invalidation and gate outcomes.

### Phase 45 — Security & Secrets Review
**Status:** PLANNED
Perform a full application-security pass covering authentication, MFA, authorization boundaries, CSRF, headers, secret handling, dependency risk and admin-surface isolation.

### Phase 46 — Deployment Safety & Canary
**Status:** PLANNED
Introduce staged deployment, health-gated rollout, rollback checkpoints and production verification so a bad release does not silently alter live decision behavior.

### Phase 47 — Backup & Disaster Recovery
**Status:** PLANNED
Strengthen database backup verification, configuration recovery, migration safety, restore drills and lossless audit preservation.

### Phase 48 — Performance & Scale
**Status:** PLANNED
Profile hot paths, reduce redundant market calls, optimize caches and database access, bound worker concurrency and test sustained multi-symbol load.

### Phase 49 — Live-Readiness Gate
**Status:** PLANNED
Combine data integrity, validation, robustness, paper execution, risk, security, observability and operational evidence into one hard readiness gate.

### Phase 50 — Controlled Live-Readiness / Shadow-to-Live
**Status:** PLANNED
Run a final shadow-mode period, verify zero critical blockers, preserve rollback controls and only then expose a separately gated live-execution capability if the evidence supports it; no profitability guarantee is implied.

## Completion ledger

The in-product Admin Console uses `phase-history.js` as the canonical Phase 1–50 registry. Future phase completions should update the registry in the same commit as the feature and its validation evidence.
