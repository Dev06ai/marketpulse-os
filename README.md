# MarketPulse OS

Crypto market analytics and educational decision support.

Features:
- BTC, ETH, SOL, BNB, XRP, DOGE and ADA
- 15m, 30m, 1h, 4h and 1d chart intervals
- Price-action chart with optional 50 EMA, volume, crosshair, zoom and pan
- Market analysis uses additional internal indicators such as RSI, ATR, ADX and volume context
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


## Owner / Admin access
Set the Render/server environment variable `MARKETPULSE_ADMIN_EMAIL` to the single email address that should have owner/admin access. Admin access is enforced server-side; hiding the UI is not the security boundary. Trader accounts do not receive system diagnostics, execution controls, internal health endpoints, or protected maintenance actions. ChatGPT continues to manage the codebase through the connected repository tooling rather than using a privileged website account.


## Security hardening
MarketPulse 2.3 adds server-enforced security controls including strict session cookies, stronger scrypt password hashing, durable failed-login lockout, owner TOTP MFA, shorter owner sessions, owner session revocation on login, same-origin checks for state-changing requests, request-size and rate limits, CSP with per-response nonces, HSTS, restrictive Permissions Policy, cross-origin isolation headers, account enumeration reduction, and protected admin endpoints.

For the strongest owner protection, configure these Render secrets:
- `MARKETPULSE_ADMIN_EMAIL`: the single owner email.
- `MARKETPULSE_ADMIN_TOTP_SECRET`: a Base32 TOTP secret stored privately and used by your authenticator app.
- `MARKETPULSE_PASSWORD_PEPPER`: a long random secret kept only in the server environment. Existing legacy password hashes can be transparently upgraded after successful login when this is enabled.
- `MARKETPULSE_ADMIN_SESSION_HOURS`: optional owner session lifetime; default is 8 hours.
- `MARKETPULSE_SESSION_DAYS`: optional regular-user session lifetime; default is 30 days.


## Owner user & access management
The owner-only Admin Console includes registration counts for today, this week, this month and all time; live visitor and live registered-user counts based on a short-lived 2-minute heartbeat; a registered-user directory with join/login/activity timestamps; and server-enforced moderation actions for temporary restriction, restoration and permanent ban. Moderation revokes active sessions. User views intentionally exclude passwords, IP addresses and other unnecessary personal data.


## Admin Command Center
Version 2.5 adds an owner-only command center with private analytics, live activity, security events, server performance telemetry, market-data provider health, feature flags with deterministic rollout percentages, emergency controls, maintenance/read-only modes, broadcasts, support inbox, audit logs, adaptive-learning monitoring, and operational configuration snapshots. Admin-only APIs remain server-enforced behind the existing Owner MFA boundary. Support views intentionally exclude passwords, IP addresses and unnecessary personal data. Operational snapshots cover MarketPulse configuration/flags and do not contain credentials or password hashes; provider-level database backups remain the responsibility of the managed Postgres service.

## Prop Firm Guard + Event Contracts
- A configurable prop-firm decision gate now sits alongside the market engine. It checks signal score, R:R, data freshness/quality, derivative availability, flow alignment, spread, daily-loss headroom, drawdown headroom, open risk, position count, trade count and loss cooldown.
- Defaults are illustrative. Set the PROP_* environment variables to match the exact rules of the evaluation/account you are using.
- /api/propfirm returns the current gate for a symbol/timeframe.
- /api/propfirm/event adds a fixed-risk UP/DOWN event-contract calculator that works from the premium/payout shown by the venue. It does not place orders.
- Toobit Event Contracts use higher/lower settlement with capped stake risk and a displayed payout; Toobit also documents daily caps and open-position limits. XT has an Event Contract product with directional outcomes. Venue rules can change, so MarketPulse treats the exchange contract terms as inputs rather than hard-coding them.

## Provider failover
- Admin provider diagnostics now probe Binance and Bybit across multiple public hosts instead of treating one endpoint as the whole provider.
- The UI can distinguish a provider outage from a single-host failure, while the core engine continues using its existing Binance -> Kraken and Kraken -> Bybit derivatives fallback paths.

## Public-data research pipeline
- research-data.js catalogs Binance Public Data, CCXT and Hummingbot as research/connector sources.
- The research route can build a no-lookahead historical replay from public Binance candles and feed resolved replay examples into the existing adaptive learning model.
- Research runs in a background job with one active job at a time, so training does not block live market requests.
- Historical replay from candle data deliberately does not invent historical CVD/OI/liquidation values that were not present in the dataset.

No claim is made that any signal is safe, certain or guaranteed to pass a prop-firm evaluation. The gate is designed to block trades when required evidence or account headroom is missing.

- On startup, MarketPulse can run a non-blocking historical warm-up for BTC/ETH. It only starts when the persisted online model has fewer than 150 updates, so restarts do not repeatedly retrain the same replay keys. Override or disable with RESEARCH_WARMUP_* environment variables.
- Historical replay now uses public futures candle buy/sell volume as a CVD proxy and Binance historical open-interest data where available. Liquidation history is not fabricated; live liquidation flow remains from the Bybit stream, with Kraken/other fallbacks used where applicable.

## Cross-exchange data fabric
- MarketPulse now cross-checks the engine price against independent public spot feeds from Kraken and Coinbase, with Binance used when reachable and the existing Bybit public WebSocket mark price treated as a supplemental derivatives cross-check.
- A consensus-quality score and price-dispersion measurement are exposed through /api/data-fabric and included in the core payload.
- Prop-firm and event-contract gates can block on weak independent consensus or excessive price dispersion.
- Bybit's official public WebSocket provides linear-market ticker, trade and order-book streams; Kraken's public Futures Analytics API exposes open interest, CVD, liquidation volume, long/short information, funding, liquidity and related analytics. citeturn171906search0turn171906search2turn171906search3turn171906search4turn686664search0
- Coinbase's public Exchange API exposes latest public trades, which MarketPulse uses as an independent spot-price cross-check rather than as a derivatives/OI source. citeturn546334search0
