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
