# KYVORIQ Decision Engine Deep Audit — 2026-10-07

Backend revision after this audit: `market-decision-v3.3`.

## Scope

This audit reviewed the executable decision path from detector -> signal construction -> playbook admission -> quality governor -> duplicate protection -> Bitget Demo admission -> confidence-margin sizing -> exchange submission/reconciliation. It also reviewed the new reaction-aware chart-level engine and the durable learning/rehydration paths that can influence future entries.

## Findings fixed

### 1. Playbook admission could bypass the configured 3.0R quality floor

Executable playbook candidates were routed through a dedicated admission gate using a hard-coded 2.2R threshold while the quality governor and exchange executor require 3.0R by default. A 2.2R–2.99R signal could therefore be emitted by the strategy, consume a signal slot, then be rejected at exchange admission.

Fix: playbook admission now receives the live decision-confidence and quality-R:R thresholds from the strategy governor. Strategy and execution therefore agree on the executable floor.

### 2. Mapped level reactions were mislabeled as SFPs

Every reaction candidate was named `<level> Level Reaction • SFP`, including order-block, NPOC, daily and weekly-open reactions. That forced non-SFP reactions through SFP-specific location rules and could reject otherwise valid mapped-level opportunities.

Fix: mapped reactions now use a dedicated `LEVEL_REACTION` playbook family. The family validates the reaction evidence itself, requires a fresh mapped-level trigger, and still requires independent directional order-flow confirmation before execution. Order-block reactions additionally remain trend/structure aligned.

### 3. Skipped/unfilled plans consumed scarce daily signal quota

The strategy incremented the daily signal counter before Bitget admission. A conclusively skipped entry was retired locally but the quota was not released, and a restart re-counted persisted `NOT_EXECUTED` records. Several exchange skips could therefore exhaust the day's strategy quota without opening a trade.

Fix: conclusively unexecuted signals release their quota immediately. Local and remote rehydration exclude `NOT_EXECUTED`/skipped/rejected/failed records from the daily executable-signal count.

### 4. A skipped remote prediction could be resurrected after restart

The learning bridge persisted the strategy signal before private exchange admission. If Bitget conclusively skipped it, the local strategy retired the signal but the durable remote prediction remained open. A later memory refresh/restart could restore that never-executed prediction.

Fix: after a conclusive skip, and only after reconciliation proves the signal is no longer active, the backend resolves the durable prediction as `NOT_EXECUTED`. Ambiguous/duplicate submissions are deliberately not closed this way.

### 5. Confidence-margin sizing could plan more loss than the remaining daily budget

The confidence-margin refactor retained the 50–75 / 76–100 USDT margin bands but the sizing helper no longer bounded planned stop risk by the remaining UTC daily-loss budget. The separate daily admission check only blocked after the loss had already occurred.

Fix: planned stop/fee risk is now capped by the minimum of:
- the per-trade planned-loss cap,
- remaining realized daily-loss budget, and
- remaining equity drawdown budget from UTC day-open equity.

If the required confidence margin cannot fit inside that risk budget, the trade is skipped rather than silently weakening the safety rules.

### 6. Pre-submission validation failures could create phantom FAILED trades

Sizing/configuration exceptions before any Bitget order was submitted fell into the same exception path used for uncertain post-submission failures. That could persist a FAILED trade record, leave the strategy signal active, and consume quota even though no exchange exposure existed.

Fix: before a client order id is committed, validation/config/sizing exceptions now return a clean `skipped=true` decision with no trade record. Once an order id has been committed, failures still remain `SUBMISSION_UNKNOWN` and reconciliation stays authoritative.

## Safety invariants retained

- Demo execution only.
- Grade-A gate retained.
- Fresh quote/trade/order-book data required for executable entries.
- Wide/crossed spread and entry-drift guards retained.
- Historical negative-edge veto retained.
- One unresolved Bitget position at a time.
- Three-entry daily execution cap retained.
- Two consecutive daily losses pause new entries.
- Verified exchange stop protection required.
- Reaction proximity alone never creates a trade. A mapped-level reaction plus the normal quality/execution gates is required.
- No thresholds were loosened merely to increase trade frequency.

## Regression coverage added

New regression checks cover:
- quality/playbook R:R threshold parity,
- dedicated mapped-level reaction family + freshness,
- skipped-signal quota release across restart,
- remote skipped-prediction cleanup,
- protection against accidentally resolving ambiguous duplicate submissions, and
- remaining daily-loss-budget enforcement during confidence sizing.

