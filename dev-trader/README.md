# Dev Trader

Personal Android trading workspace with a FastAPI market engine and **Bitget UTA v3 demo-only** BTCUSDT execution. The app receives Bitget market data and exchange execution snapshots; financial values are never substituted with sample values in a release build.

## Published version 0.14.1 / build 99

Android now uses the verified Deplexo free host. The signed build 99 and its
checksum-verified update manifest are published. Use the app's Update button to
install it; that check works independently of the suspended Render backend.
Demo credentials and session/risk settings have been migrated, and exchange
reconciliation passed. See `FREE_MIGRATION.md` for the cutover and storage limits.

- **Trade:** live quote, interactive multi-timeframe candles, compact decision center, complete setup details and a P&L calculator.
- **Positions:** exchange equity and available collateral shown separately, aggregate positions, fill-based realized P&L curve, fees and risk controls.
- **Insights:** market context, entry admission reasons, flow and structure, connection status, diagnostics and signed self-update.

## Execution policy

Hosted engine **0.13.0 / refined-demo-v2** includes confirmed breakout/retest candidates alongside SFP, D-Line, MSS and early momentum. Opposing major levels can veto cramped entries; higher-timeframe structure supplies independent confirmation. Elliott and harmonic classifications remain heuristic context. Candle-derived POC/VWAP estimates are labeled explicitly and do not claim exact trade-level NPOC.

Demo entries use confidence-sized isolated margin at 20x leverage. Medium-confidence Grade-A signals target 50–75 USDT margin; high-confidence signals target 76–100 USDT, scaled within each band by confidence. Estimated entry/exit taker fees and stop distance still pass a separate planned-loss guard. The guard is capped by the remaining UTC daily-loss budget, so confidence sizing cannot plan a stop that would knowingly exceed the session's daily loss limit; an observed equity drawdown above 2% tightens the per-trade guard further. Exchange minimum quantities, quantity increments, price increments and notional rules can block a trade rather than silently falling below its confidence band.

Only fresh Grade-A candidates with configured quality thresholds can reach execution. The executor checks Bitget bid/ask, rejects wide/crossed quotes, excessive entry drift and net reward/risk below 1.5 after estimated fees. Rising open interest alone does not establish directional momentum. A historical setup veto is checked again at admission.

One unresolved position is allowed at a time. New entries pause after two consecutive daily losses, the realized daily loss cap, a 1% fall from the first observed equity of the UTC day, the three-entry daily cap, or degraded exposure reconciliation. Stable client IDs and SUBMISSION_UNKNOWN recovery prevent treating a timeout as proof that no order was accepted. The market callback schedules execution asynchronously; slow private exchange calls do not hold up incoming market messages.

Filled positions require verified exchange stop coverage. Missing coverage is repaired with a full-position market stop; uncertainty halts entries and permits one close only after verifying remaining quantity. Pending orders, incomplete fill/fee accounting and decisions that expire during sizing block new exposure. Bitget UTA leverage is explicitly set per symbol before submission; if 20x cannot be confirmed, the demo entry is skipped.

## Accounting and evidence

GET /performance and the mobile snapshot expose a paginated 30-day BTC fill ledger. It deduplicates execution IDs, includes reported realized P&L and USDT fees/rebates, and distinguishes incomplete history or fee accounting. Funding and transfers are explicitly excluded. The curve is **realized fill P&L**, not total equity or a profitability forecast. FIFO lots are estimates; ambiguous historic per-entry outcomes remain marked pending rather than silently becoming verified.

Confidence is a heuristic evidence score, not a calibrated probability. Candle-only replay cannot validate the live order-flow strategy; no fabricated win rate is presented. Forward demo results are required to assess expectancy, net P&L and drawdown.

The Deplexo deployment mounts execution, learning and journal files at `/data`.
This survives replacement on the same worker, but is not a backup or a guarantee
across worker moves. Render's old local files could not be recovered. Exchange
fills were reconciled; original signal context and learning observations may be
missing. No paid storage is provisioned by this release.

Versioned exchange IDs preserve strategy family, timeframe, regime and approximate planned risk within the engine's 30-day recovery window. An operator test session can persist its cutoff and initial equity in deployment configuration; GET /performance exposes session results separately from historical fill losses. Prior losses still count toward UTC daily risk limits.

The current measured demo session began after verified flat exposure at 1791076124654 ms UTC with 975.29249645 USDT equity. See [the execution audit](AUDIT-2026-10-04.md) for closure evidence, regression coverage and limits.

## Validation and release

Run python -m pytest -q in dev-trader/backend. CI compiles Python, runs regression tests, builds debug and signed release APKs, and launches all three native workspaces on compact and tall Android emulator viewports. Debug preview fixtures live only under src/debug/assets; CI rejects a release containing them. Release publication and the SHA-256 update manifest require all backend, Android and native visual checks to pass.

Android uses AGP 9.4.0, Gradle 9.6.0, Kotlin 2.4.10, compile/target SDK 37 and minimum SDK 26. Native views render the main workspace. Backend strategy changes deploy separately from Android UI changes.
