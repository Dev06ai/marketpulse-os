# Dev Trader audit — 5 October 2026

Backend revision: `market-decision-v3.2`. Android remains `0.14.2 (100)`; these changes are delivered by the backend.

## Confirmed defects fixed

- Slow account/sizing requests could leave the executable quote, quantity, fee-adjusted risk and notional stale. Recheck the rounded stop/target geometry and current quote after sizing; quantity can only decrease. Check primary feed health and quote/trade/book age immediately before submission, retaining the original signal expiry.
- A restart during order submission could lose its planned protection details. Persist the stable client order ID, exact request quantity, stop, target and setup before POST; refuse entry if persistence fails. On restart, reconcile an uncertain submission before admitting another entry.
- Recovery could replace saved protection with empty exchange fields or mark a `filled` label as a confirmed position without a positive executed quantity and average price. Preserve positive saved values and require actual fill evidence.
- A failed positions request could be treated as a flat account, close local trades against historical data, or report verified empty stop coverage. Preserve unresolved trade state and explicitly leave coverage unverified until positions are available.
- Reconnects could retain pre-disconnect order-book depth. Clear depth, sequence and trade/quote freshness before resubscription; require new valid book data.
- Malformed/nonfinite quotes, trades, depth or candles could contaminate indicators and health. Reject invalid inputs before state mutation, invalidate malformed/crossed/one-sided books, and prevent rejected candles from refreshing their heartbeat.
- Delayed candles could be appended as the latest bar. Merge replayed bars by timestamp and preserve chronological order.

## Review scope and validation

Reviewed admission and duplicate prevention, sizing and fee-aware reward/risk, partial fills and stop protection, exchange reconciliation, restart persistence, market-data normalization and reconnects, causal swing/closed-candle structure, momentum extension guards, bounded learning, dashboard/alert payloads, Android signal/execution presentation and release checks, demo-only client behavior, public API mutation boundaries, and credential scanning.

- Full backend and core dependency configurations: 198 tests pass each.
- Python compilation and Git diff whitespace check pass.
- Credential scanner passes across tracked files and Git history. It is a signature-based guard, not a proof that every possible secret is absent.
- Offline free-host benchmark: 20 samples, average evaluation 11.38 ms, peak RSS 41.75 MiB; dashboard payload 10,832 bytes and market tick 442 bytes. Synthetic measurements exclude network/protocol overhead and exchange traffic.
- Hosted CI additionally checks the 128 MiB / 0.25 CPU container, persistent-volume restart, Android compilation and the live HTTP/WebSocket path with Android's network library.

Risk defaults remain 0.25% per entry, 500 USDT notional and three entries per UTC day, with existing daily-loss/consecutive-loss gates. Reconciliation, stale-data, late-entry and protection failures continue to block entries. Skipped setups are not counted as executed profit or learning outcomes.

Before this update, the live exchange ledger confirmed one demo long opened at 85,468.0 and closed at 86,148.3, quantity 0.0058 BTC, net +3.34851527 USDT, with a recorded target closure. This verifies that the automatic demo execution path operates; one trade does not establish a profitable strategy.

No new defect was confirmed in the current Android execution presentation; the previously published build 100 already scopes entry outcomes to the current setup and labels historical attempts separately. No APK update is needed for this backend release.

Automated tests cannot establish future profitability, perfect market interpretation or the absence of every bug. Demo-only operation, current risk limits and exchange verification remain necessary. Existing public read-only operational endpoints should be access-controlled before sharing the backend beyond its intended personal use; see `SECURITY.md`.
