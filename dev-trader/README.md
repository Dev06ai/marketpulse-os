# Dev Trader

Personal Android trading workspace with a FastAPI market engine and **Bitget UTA v3 demo-only** BTCUSDT execution. The app receives Bitget market data and exchange execution snapshots; financial values are never substituted with sample values in a release build.

## Version 0.12.2 / build 98

- **Trade:** live quote, interactive multi-timeframe candles, compact decision center, complete setup details and a P&L calculator.
- **Positions:** exchange equity and available collateral shown separately, aggregate positions, fill-based realized P&L curve, fees and risk controls.
- **Insights:** market context, entry admission reasons, flow and structure, connection status, diagnostics and signed self-update.

## Execution policy

Default risk is 0.25% of available collateral, bounded by observed equity. Estimated entry/exit taker fees count toward stop risk. Observed equity drawdown above 2% halves the configured risk budget. Exchange minimum quantities, quantity increments, price increments and notional rules govern sizing.

Only fresh Grade-A candidates with configured quality thresholds can reach execution. The executor checks Bitget bid/ask, rejects wide/crossed quotes, excessive entry drift and net reward/risk below 1.5 after estimated fees. Rising open interest alone does not establish directional momentum. A historical setup veto is checked again at admission.

One unresolved position is allowed at a time. New entries pause after two consecutive daily losses, the realized daily loss cap, a 1% fall from the first observed equity of the UTC day, the three-entry daily cap, or degraded exposure reconciliation. Stable client IDs and SUBMISSION_UNKNOWN recovery prevent treating a timeout as proof that no order was accepted. The market callback schedules execution asynchronously; slow private exchange calls do not hold up incoming market messages.

## Accounting and evidence

GET /performance and the mobile snapshot expose a paginated 30-day BTC fill ledger. It deduplicates execution IDs, includes reported realized P&L and USDT fees/rebates, and distinguishes incomplete history or fee accounting. Funding and transfers are explicitly excluded. The curve is **realized fill P&L**, not total equity or a profitability forecast. FIFO lots are estimates; ambiguous historic per-entry outcomes remain marked pending rather than silently becoming verified.

Confidence is a heuristic evidence score, not a calibrated probability. Candle-only replay cannot validate the live order-flow strategy; no fabricated win rate is presented. Forward demo results are required to assess expectancy, net P&L and drawdown.

The free Render deployment uses temporary local state. Exchange history reconstructs execution records after restarts, but original signal context and observed equity peaks/day anchors can be lost. This is not durable learning. No paid storage is provisioned by this release.

## Validation and release

Run python -m pytest -q in dev-trader/backend. CI compiles Python, runs regression tests, builds debug and signed release APKs, and launches all three native workspaces on compact and tall Android emulator viewports. Debug preview fixtures live only under src/debug/assets; CI rejects a release containing them. Release publication and the SHA-256 update manifest require all backend, Android and native visual checks to pass.

Android uses AGP 9.4.0, Gradle 9.6.0, Kotlin 2.4.10, compile/target SDK 37 and minimum SDK 26. Native views render the main workspace. Backend strategy changes deploy separately from Android UI changes.
