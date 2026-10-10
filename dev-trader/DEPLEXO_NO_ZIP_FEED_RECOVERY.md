# KYVORIQ: repair DEGRADED market data without another ZIP upload

**Scope:** Bitget USDT futures **public market data only**. Trade execution
continues to use the authenticated **Bitget Demo/PAP** REST API. Never set
`BITGET_DEMO_TRADING=false`, and do not remove fee, freshness, spread,
reconciliation, 0.5% default/1% maximum-risk or order-protection checks.

## Fastest existing-ZIP service trial (NO NEW ZIP)

The previously deployed backend already honors `BITGET_PUBLIC_WS_URL` as an
environment override. Bitget's **demo** public WS
(`wss://wspap.bitget.com/v3/ws/public`) may send ticker events while the
`books5` and `publicTrade` channels become quiet, which correctly makes
new-entry admission `DEGRADED`. Bitget's regular public futures WS is the same
official market-data venue used by the existing REST execution-price
cross-check, and is distinct from the **private demo order API**.

In the **existing** `dev-trader-engine` app on Deplexo, preserve all old
settings, environment values, owner pairing, persistent `/data` and domain.

1. Add or change only `BITGET_PUBLIC_WS_URL` to
   `wss://ws.bitget.com/v3/ws/public`.
2. Apply the env change and perform a controlled restart/redeployment of the
   **existing** service. Deplexo environment changes do not take effect until
   the process restarts. A restart on a ZIP-sourced app reloads its old image:
   it does **not** include later GitHub code. No new ZIP is needed just to test
   this environment override.
3. Verify `/health` on the same app URL for several minutes:
   `ws_connected` and `data_health`, `data_age_ms`, `trade_age_ms`,
   `book_age_ms`, packet counts and subscriptions. The expected healthy
   windows remain quote <=3s, book <=5s, trades <=15s and 15m kline <=120s.
   If the live market endpoint is unreachable or still stale, **do not**
   lower these requirements, force trades, or claim the feed repaired.

Rollback: restore the prior environment value or remove this override and
rebuild/restart the existing service. This does not alter exchange credentials
or the execution journal.

## Long-term ZIP-free GitHub deployments

Deplexo supports connecting the **existing** app to GitHub and automatic
deployments on a selected branch. This repo has a root `deplexo.yaml` with
`build.root_dir: dev-trader/backend` and Dockerfile build context. **A ZIP
deployment does not automatically become a Git deployment because this file was
committed.** Confirm a safe migration path with Deplexo and reuse this exact
existing app, same environment, credentials, domain, and durable `/data`
volume, keeping rollback before switching its source. Choose a controlled
validated branch; don't enable auto-deploy for unreviewed draft PR changes.
Once linked, later pushes can rebuild without any manual ZIP upload.

Related official docs:
- https://docs.deplexo.com/operations/deployments/
- https://docs.deplexo.com/reference/configuration/
- https://docs.deplexo.com/reference/user-api/
- https://www.bitget.com/docs/uta/demo-trading/websocket
- https://www.bitget.com/docs/classic/uta-api-upgrade-guide

## Important evidence boundary

Neither code nor setting changes can guarantee `HEALTHY` continuously.
Market observations and simulated fills are different things: real public
market data does **not** mean real-money trading is enabled. Verify all
order/fill/stop/TP decisions with Bitget Demo and never authorize an actual
live-money order. A HEALTHY market feed alone is not evidence of profitable
trading or Phase 1–16 acceptance.
