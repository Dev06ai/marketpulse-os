# KYVORIQ — 16-workstream acceptance ledger (2026-10-10)

This is a conservative implementation/acceptance map reconstructed from the existing
`docs/KYVORIQ_PROGRESS.md` recovery checkpoint. It does **not** replace an original
unavailable 16-phase prompt or assert that all workstreams are complete.

Source baseline: `codex/kyvoriq-upgrade-20261009` at `32ea6ca`.
Current verified production: secured earlier source `5aacf5b`; updated
selection/book release has CI approval but production identity was **not**
verified at the time of this checkpoint.

**Do not interpret unit-test passes, healthy HTTP, chart movement or two closed demo
trades as proof of trading expectancy.** This project remains private and demo-only;
do not change `live_money_execution=false`, owner authorization, hard risk limits,
daily trade quotas, exchange reconciliation, or protective order behavior.

| Workstream | Existing implementation/evidence | Required to claim accepted |
| --- | --- | --- |
| 1. Baseline and observability | Backend unit tests; CI; build/source hash | Time-stamped frozen baseline of rejected setups, trade latency, feed health, fee-aware fills |
| 2. Market structure | `strategy.py`, `structure.py`, higher-timeframe policy; causal confirmed-bar replay filtering under PR #122 | Independent replay scenarios with confirmed market structure and no future candles |
| 3. Trading concepts | SFP, breakout, D-Line, liquidity context detectors | Detector-level precision/recall on pre-registered event data; no synthetic fill claims |
| 4. Anticipatory lifecycle | Radar and developing/confirmed opportunities | Transitions WAIT→ARMED→CONFIRMED→CANCELLED with dedup/cooldown tests under reconnect |
| 5. Missed opportunities | Candidate fallback fix + 8 regressions in `32ea6ca` | Chronological old/new replay and missed-vs-false-positive measurements |
| 6. Latency | Immediate closed-candle evaluation; local synthetic benchmark; new no-identifier strategy evaluation duration histogram (pending production) | Logged exchange event→decision→submission→ack→fill percentiles from natural demo fills |
| 7. Multi-agent orchestration | Existing LangGraph/agent code with veto protections | Veto/timeout/failure-path tests and measured cost, with no bypass of baseline risk |
| 8. Signal quality | Quality and minimum-R:R gates; no flip guard | Fee-aware signal precision and calibration on a predeclared forward holdout |
| 9. Demo lifecycle | Bitget demo bridge, reconciliation and protective order tests | Naturally observed ack/fill/stop/TP/close; distinguish all states and prove recovery |
| 10. Risk preservation | 0.5% default, 1% ceiling, daily limits, stop/reconcile | No unprotected or oversized fill in verified forward demo; account-based DD/ruin checks |
| 11. Regime logic | Trend/volatility regime selector | Frozen regime labels, stability under choppy conditions and controlled false-positive audit |
| 12. Chronological evaluation | Read-only `tools/forward_evidence.py` introduced in this branch | Precommitted cutoff, complete exchange fill/fees/risk records, sufficient new demo sample |
| 13. Android experience | Build 131, secure pairing, notification test verified by user | Long background/reconnect soak, visual tests, expiry and renewal, no duplicate alerts |
| 14. Security/reliability | Private HTTP/WS pairing and GitHub security CI | Threat model, restart and persistence soak, rotation, provider-side verification, no leaks |
| 15. End-to-end scenarios | Offline regression suites; new evidence rejection/latency tests | Actual representative market/fill/stop/timeout/restart cases with verified source identity |
| 16. Final integration | Verified release ZIP and preserved Android build | CI + production SHA/hash parity + soak + mobile + audited demo lifecycle + review signoff |

No row currently has enough evidence to be marked completely accepted.

## Offline, fee-aware forward-demo evidence — new implementation

Run from `dev-trader/backend`:

```bash
python -m pytest -q test_forward_evidence.py
python -m tools.forward_evidence --input private-evidence/closed-demo.jsonl --as-of-ms 1900000000000 --split-ms 1899900000000 --output private-evidence/report.json
```

**Only use real, reconciled Bitget demo fill records**, with no credentials or
personally identifying fields. Records must have: `venue="BITGET_DEMO"`,
`source="EXCHANGE_CONFIRMED"`, unique `signal_id`, positive UTC millisecond
`signaled_ms <= entered_ms < exited_ms <= as_of_ms`, genuine verified
`entry_confirmed/exit_confirmed/protective_stop_confirmed`, `gross_pnl_usdt`,
nonnegative `entry_fee_usdt/exit_fee_usdt`, signed `funding_usdt`,
`exchange_net_pnl_usdt`, and positive `risk_usdt`.

The tool verifies basic internal consistency but **cannot authenticate claims in a
user-supplied JSONL file**; source labels/booleans must be backed by an independent
read-only exchange reconciliation and stop-order audit. Keep that underlying
exchange evidence offline. Do not commit trade histories or account data to Git.

Metrics include net-after-fees realized P&L, total net R, maximum closed-trade
drawdown in R and USD, losing streak, median/P95 signal-to-entry latency,
 and the 95% Wilson win-rate interval when the minimum sample threshold is met. Win rate,
expectancy and profit factor are suppressed by default until **at least 30**
complete closed samples; 30 is a minimum reporting threshold, **not** sufficient
proof of durable profitability.

The `--split-ms` cutoff must be frozen *before* reviewing holdout outcomes for
a legitimate out-of-sample claim. Trades straddling the boundary are omitted
from both partitions and reported separately. This tool never models execution
fills from future candle highs/lows, never adjusts strategy thresholds and never
sends orders. A strong evaluation also needs chronological historical replay,
multiple regimes, forward demo evidence, and eventual statistical uncertainty
estimates.

## Deployment sequencing

1. Keep original verified Deplexo instance, owner token, /data and Android pairing.
2. Confirm official CI release archive identity before activating it. The upload
   filename/count alone is not an integrity check.
3. Deploy the candidate-selection/book fix only after verifying release hash,
   memory headroom, required checks and rollback path.
4. Monitor production identity/freshness with read-only PR #120 observer; never
   relabel stale order books as fresh or relax the 5-second hard admission.
5. Observe natural demo trades and reconcile complete broker history before feeding
   any outcomes to the offline evidence evaluator.
6. Re-run full 16-workstream acceptance. Do not release real-money execution or
   public subscriptions based on these early tests.

**Latest work branch:** `codex/kyvoriq-phase-evidence-20261010`.
This branch adds an independent evaluator and acceptance record; it does not
change order entry rules or active server deployment.

## Causal-replay safety milestone (PR #122)

Review of `app/evaluation.py::replay_decisions` found an unconditional inclusion of historical unconfirmed candles, even when their recorded `end` timestamp was in the future. This created retrospective look-ahead contamination. The inspector now strictly accepts only geometrically valid confirmed candles with `end < decision_timestamp` for each timeframe and excludes malformed/noncausal rows. Regression tests cover future/open bars, malformed data, invalid decision timestamps and corrected duplicate bars. This is **not** an independent trading performance test; it is a necessary prerequisite for chronological review. Do not use its historical displayed setup outcomes to promote a strategy without broker-reconciled forward evidence.
