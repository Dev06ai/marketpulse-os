# KYVORIQ LangGraph v3 — operator notes

This rollout is deterministic Python with no paid LLMs, no new credentials, and no new cloud database.

## Capabilities

1. Early Opportunity Router: watches already-detected SFP, breakout, level-reaction and other setups BEFORE the final quality gate. It also reviews existing developing radar watches. A radar watch never receives a fabricated entry/stop/target and cannot become an order.
2. Adaptive Supervisor: distinguishes reversals, continuations, breakouts, and momentum. Countertrend disagreement is an advisory caution, not an automatic rejection of a confirmed SFP. There is no simulated win probability.
3. Data Quality Sentinel: verifies quote freshness. Separately labels book, trades, OI, liquidations and funding as FRESH / STALE / UNKNOWN, instead of inventing a squeeze. Funding freshness remains unverified until timestamped feed support exists.
4. Independent Risk Guardian: checks direction, plan geometry, ≥2.5 gross and known net R:R, ≤20x leverage, and ≤2% per-trade equity risk ceiling. Rechecks immediately before an exchange demo order; existing strategy HTF stop checks and executor sizing remain authoritative.
5. Agent journal: bounded SQLite evidence lives at /data only when the host mounts a persistent volume. Writable container disk is not evidence of restart durability. The storage endpoint reports mount detection and clearly says when restart survival has not been verified.
6. Performance Calibration: fee-accounted exchange-confirmed closes matched by exact signal ID; a chronological split is reported only when enough samples are available. Never autotunes risk or routes based on retrospective outcomes.

## Endpoints

GET /agents — role inventory, sentinel, guardian and router status.
GET /agents/router — pre-gate observations, bounded history (no orders).
GET /agents/storage — SQLite durability and mount status.
GET /agents/learning — verified demo-outcome analysis and calibration.
GET /decision/signal — only the preexisting execution-qualified signal, else HOLD/WAIT.
GET /config — maximum leverage, risk and mode.

## Rollout restrictions

Keep KYVORIQ_LANGGRAPH_MODE=shadow and KYVORIQ_EARLY_ROUTER_MODE=shadow.
No early-routing decision may bypass the existing quality gate or Bitget demo execution safeguards. The four parallel LangGraph workers run in a bounded single-process service within the existing 128 MiB container profile; actual deployment memory must still be checked.

If Deplexo offers no persistent writable volume, journal history may be lost after redeploy. Do not claim learning continuity until records have been checked across an actual restart. Never enable real-money futures execution based solely on software tests or observational metrics.
