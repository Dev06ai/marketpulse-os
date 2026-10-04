# Dev Trader free-host migration

The Render workspace exhausted its monthly outbound transfer allowance. Deleting
old files or suspended services cannot refund that transfer. This migration keeps
the engine on a free service without adding a payment card.

## Prepared configuration

Deployed: [Deplexo Free](https://deplexo.com/plans), currently one app, 0.25 CPU,
128 MB RAM, 250 MB disk and 100 GB monthly transfer (sent plus received).
Signup advertises no payment details. The tier has no uptime guarantee.
The public host passed the native-client staging checks on 4 October 2026.
Trading credentials and final cutover remain pending.

The running source is commit `a213518675b7f96770f374cd080015ddd2570dc0` from the
public repository `https://github.com/Dev06ai/marketpulse-os`. The host's public-Git
form had no branch selector, so the exact tested backend was uploaded as a ZIP:
`git archive --format=zip --output=backend.zip HEAD:dev-trader/backend`.
Use `.` as Root directory and `Dockerfile` as Dockerfile path. Avoid enclosing
the backend in wrapper folders. Listen on port 3000 and mount the named volume at
`/data`. [Deployment docs](https://docs.deplexo.com/getting-started/quickstart/)
and [storage docs](https://docs.deplexo.com/operations/storage/) describe the setup.

The image runs one backend process with core dependencies. Firebase is omitted;
the existing Android foreground service supplies WebSocket notifications.
FCM requires the full requirements file and Firebase configuration if added later.
The Docker image starts with demo trading selected and **new entries paused**.

Persistent files:

| File | Purpose |
| --- | --- |
| `/data/dev_trader_execution.json` | Execution and reconciliation state |
| `/data/dev_trader_learning.json` | Adaptive learning state |
| `/data/dev_trader_decisions.sqlite3` | Decision journal and price samples |

The free profile keeps seven days of price samples, at most 750 decision records
(maintenance every five minutes), and at most 64 MiB of compressed decision blobs.
Older research records are evicted; the execution and learning files are separate.
Deplexo's volume survives replacement on the same worker. It is not a backup and
is not guaranteed to follow an app to another worker. Do not delete the app/volume
as a way of restarting it.

## Lower mobile traffic

`/ws?profile=dashboard` sends small price/health updates every second and a compact
account/strategy snapshot every five seconds. Signal lifecycle, stop/target changes,
trade events and opportunity alerts trigger a snapshot on the next broadcast tick.
`/ws?profile=alerts` sends changed events only, with normal keepalive acknowledgements.
Unprofiled clients keep the original full-state protocol.

Android stops the dashboard socket while the activity is in the background. It
uses HTTP bootstrap for recovery rather than downloading the full state repeatedly
while its socket is working. Chart history refreshes every 30 seconds, plus explicit
timeframe changes; live prices still update each second. Exchange timestamps stay
unchanged, so a live connection never makes stale exchange data appear fresh.
HTTP responses larger than 700 bytes support gzip.

Both Android services now use one HTTPS origin supplied at build time:
`-PdevTraderBackendUrl=https://THE-VERIFIED-HOST`.
The default is now `https://dev-trader-engine.de.deplexo.com`, verified by the
same OkHttp 4.12.0 client used by Android. Version 0.14.1 / build 99 is prepared;
no APK update has yet been published by this migration branch.

## Cutover procedure

1. Complete Deplexo's account signup and any email verification in the browser.
   Account creation and acceptance of the site's terms require the account owner.
2. Deploy the public branch without exchange credentials; keep entries paused.
   Verify HTTP, TLS, both mobile socket profiles, chart history and Bitget's public
   demo feed with `tools/smoke_host.py --url https://THE-HOST --require-feed`.
3. Restore execution and learning files if recoverable. Render's free ephemeral
   filesystem may be inaccessible while suspended. If files cannot be recovered,
   report the missing local history explicitly; exchange history reconciliation
   is not a recovery of every learning observation or research record.
4. Copy only needed demo exchange credentials through the host's secure settings.
   Preserve the existing session start, baseline equity and risk settings; never
   copy keys into the repository, build arguments, PR or console output. Leave
   the retired MarketPulse bridge disabled unless it is restored deliberately.
5. Verify `/system-check` reports the demo client ready, reconcile positions/orders,
   confirm protective stops and risk limits, and observe memory, CPU and total
   transfer. Keep entries paused if any of these checks fail. Measure total
   sent/received transfer because the live exchange feed also consumes quota.
6. Pause demo entries on the old Render service before allowing new entries here.
   Render can resume after the monthly reset: there must never be two engines
   opening orders for the same account. Do not delete exchange positions or the
   old backend as a substitute for reconciliation.
7. Build the next signed Android version against the verified host, run the normal
   CI and visual checks, then publish its update manifest. The owner installs the
   update once. Recheck dashboard, background alerts and reconnect behavior.
8. Unpause new demo entries only after cutover verification. Profitability is not
   established by migration tests; the strategy and execution risk policy stay
   unchanged.

## Validation

Backend baseline: 153 tests passed. Updated suite: 160 tests passed with both the
full dependencies and the core-only dependencies. Tests cover quiet background
delivery, changed trade events, retry after failed delivery, compact payload
integrity, bootstrap/keepalive routes, gzip, stale timestamps and journal budgets.
Local process smoke checks passed HTTP, both WebSocket profiles, bootstrap and
keepalive. They did not verify a live host's Bitget connection.

An offline synthetic benchmark with 720 hourly candles, 240 candles each for 5m
and 15m, and 5,000 flow observations measured about 42 MiB peak process RSS.
Two unchanged socket sessions used approximately 152 KB/min versus 8.17 MB/min
for the legacy protocol, about 98% less. These figures exclude HTTP, protocol
overhead, incoming exchange traffic and live events. They are not an uptime,
profitability or total monthly transfer guarantee.

Live staging passed HTTPS, both socket profiles, keepalive acknowledgements,
chart history and journal readiness using the native HTTP client. The one-minute
feed observation recorded 15 HEALTHY and 6 DEGRADED samples, with exchange packet
age 84 ms at completion and maximum order-book age 13,762 ms. The demo order book
has update gaps; entry freshness thresholds remain unchanged. The host dashboard
reported about 48–50 MiB memory and 0.03–0.05 vCPU during staging, below its limits.
These observations do not establish uninterrupted availability.

The host's Cloudflare edge rejects the default Python urllib client with error
1010. The deployed-host gate therefore uses `dev-trader/tools/host-probe`, with
OkHttp's normal defaults and TLS validation; no browser impersonation or security
setting changes are used. Run it with:
`gradle -p dev-trader/tools/host-probe run --args='https://dev-trader-engine.de.deplexo.com'`.

CI also builds and probes the Docker image under a 128 MB / 0.25 CPU limit with
a read-only root, verifies mounted data across a restart, and builds Android with
its existing visual validation gate. Final demo-account migration and Android
publication remain pending. The old Render pause request was rejected because
the service is suspended; verify and save that setting in its dashboard before
unpausing the replacement.
