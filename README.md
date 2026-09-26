# MarketPulse OS

Crypto market analytics and educational decision support.

Features:
- BTC, ETH, SOL, BNB, XRP, DOGE and ADA
- 15m, 1h, 4h and 1d
- EMA 20/50/200, RSI, ATR, ADX and volume z-score
- Regime detection and setup classification
- Entry zone, invalidation and targets
- Simple historical sanity-check backtest
- Multi-asset scanner
- Risk calculator

No automatic order execution. No performance guarantee.

Run locally with Node 20+:
npm start

Then open http://localhost:3000


## Phase 7
- Personal trader analytics from the journal: win rate, expectancy, profit factor, average win/loss, net R, drawdown and streaks.
- Breakdowns by asset, side, regime, setup, hour and weekday.
- Journal data-quality checks and CSV export from the dashboard.
- Phase 7 analytics and health endpoints integrated into the system check.


## Phase 8
- Optional user accounts with secure password hashing and 30-day HTTP-only sessions.
- Account-backed memory for journal, signals, watchlist and UI/trading preferences when Postgres is configured.
- Anonymous/device mode remains available as a fallback.
- Journal trade edit/delete controls and cross-device account sync.
- Auth rate limiting and hardened JSON response headers.
- Product version: 2.1.0.
