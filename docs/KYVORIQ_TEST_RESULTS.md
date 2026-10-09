# KYVORIQ verification evidence



Session: 2026-10-09. Baseline source: a92bea883902e1702d9da9fe2447c422e5012a12.



The following milestones were executed locally. Record exact command, source revision, environment, pass/fail/skip counts and limitations for every milestone. Keep offline simulations, historical replay, forward demo and actual exchange fill verification distinct.



Baseline measurements still required: backend suite, security scan, market event-to-signal timing, signal-to-fill timing, rejection reasons, execution recovery, Android build/visual checks, and comparable out-of-sample expectancy after costs. Missing measurements must remain null/unverified rather than zero.



## Baseline reproduced



Python 3.12.14, Windows, core dependencies plus pytest 9.1.1/httpx 0.28.1/Hypothesis 6.168.5, isolated virtual environment. Initial suite: 330 passed, 3 failed in 12.47s. All three failures were execution fixtures writing fixed /tmp paths; no strategy assertions were relaxed. Six execution fixtures now use pytest tmp_path.



Re-run: `python -m pytest -q dev-trader/backend --basetemp=<workspace scratch>`: **333 passed**, one upstream deprecation warning, 10.18s. These are offline mocked tests, not exchange fills.



GitHub historical verification: KYVORIQ CI run 37844304288 and Security Guard run 37844304384 succeeded for 6760c4485a0c916160ba7901630025481281be4f (Android 0.21.6/build 131 source); a92bea8 only publishes its update manifest. Deplexo public health and dashboard returned HTTP 200 and engine market-decision-v3.8/BITGET_DEMO. The unauthenticated dashboard includes an execution object; no private balances or trade contents were saved. Exact deployed SHA remains unverified.



## Private API boundary



Full backend suite after reviewed security integration: **350 passed, 3 subtests passed**, 11.48s, one dependency deprecation warning. Covers every private GET denial, unprovisioned mode, paired access, tampering, token expiry, rotation, quiet-socket revocation, origin restrictions, body limits and malformed-pairing throttling. Existing risk-route validation tests now supply ephemeral test-only authorization. No real credentials, orders or production mutation.


## Interrupted-session recovery

Clean commit b4f45be reproduced on 2026-10-09: `python -m pytest -q dev-trader/backend --basetemp=<workspace scratch> -o faulthandler_timeout=25`: **350 passed, 3 subtests passed**, 11.00s, one upstream anyio/Starlette deprecation warning. Earlier attempts stalled at sandboxed Windows event-loop socket creation and were interrupted; network permission resolved it. Log: work/recovery-verified-pytest.log outside the repository.

`python dev-trader/tools/security_scan.py --history`: passed. Signature scanning does not prove every possible secret is absent. Neither rejected risk edit was present in Git or the working tree. Real demo fills and profitability remain unverified.

## Conservative risk sizing

Full backend suite: **381 passed, 3 subtests passed**, 11.62s, one upstream warning. Command: `python -m pytest -q dev-trader/backend --basetemp=<workspace scratch>`. Log: work/risk-final-pytest.log. New tests cover 24 balance/stop/confidence combinations, five invalid settings, immutable 1% calculator ceiling and final margin-reserve recheck. Existing daily caps and protection/reconciliation tests pass. No real orders or profitability evidence.

## Confirmed-candle cadence recovery (2026-10-10)

Full backend suite: **388 passed, 3 subtests passed**, 12.71s, one upstream warning. `python -m pytest -q dev-trader/backend --basetemp=<scratch> -o faulthandler_timeout=25`. Log: work/resume-oct10-pytest.log. Seven cadence regressions exercise callback delay, 1H support, open/future bars and corrections. Read-only production health returned HTTP 200 and HEALTHY; no current position or signal was available for live lifecycle validation. No deployment or new order.

## Source identity / release gate (2026-10-10)

**395 passed, 3 subtests passed**, 12.03s; one upstream warning. Log work/release-pytest.log. Workflow YAML parsed and archive job dependencies verified. Container/Android CI execution remains pending. Synthetic benchmark: median 10.30ms, nearest-rank P95 13.86ms, maximum 1452.20ms over 20 evaluations including cold start; not production latency. Public read-only Node probes verified dashboard/alerts frames and keepalive, bootstrap and 120 chart candles. No current position exists to test protective orders freshly.
