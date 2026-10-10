# KYVORIQ — ORIGINAL sixteen-phase master specification, implementation/acceptance audit

**Authority:** User-supplied "KYVORIQ — ELITE TRADING INTELLIGENCE & PRECISION EXECUTION UPGRADE" (2026-10-10). This document supersedes the phase numbering reconstructed in \`KYVORIQ_16_PHASE_ACCEPTANCE.md\`. Do not treat the older **workstream** numbers as the actual original phase numbers.

**Interpretation:** "Implemented" means a code path is present; "tested" means a named automated test or CI job passed; "accepted" requires the phase's specified evidence, including real deployment or verified demo events where necessary. Tests and source inspections cannot guarantee zero bugs or prove a positive expected return. Until exchange-reconciled forward results exist, no phase can be represented as fully accepted.

**Source baseline:** old running Deplexo secured backend's build identity last reported separately; GitHub candidate PR #122 at \`a3ed7cd498d21972cb661e698335754525226212\` passes automated CI (474 backend tests + 3 subtests, Android build and emulator visual check). Original-spec follow-up PR #123 is **DRAFT**; current CI result is distinct and must be checked before claiming any new patch is tested. **Do not mix PR #122's verified ZIP with PR #123's changes**. GitHub repository is public; publishing an APK from workflow has public distribution implications. Private-first / demo-only intent remains unchanged.

## Master specification traceability

| Original phase | Existing implementation inspected | Missing evidence / next acceptance work | Status |
|---|---|---|---|
| **1. Complete system intelligence audit** | Backend market stream, HTF policy, strategy, execution, journaling, Android, security CI inspected; actual repo identified | Inspect deployed runtime, config without leaking secrets, Android foreground/background, exchange reconciliations, persistence/memory, notification dedupe and full end-to-end logs | **PARTIAL — audit not complete** |
| **2. Professional market intelligence** | 5m/15m/1h/4h indicators, structure, SFP, MSS, D-line, breakout, daily/weekly/order-block context, HTF derivative context | Independently labeled examples for BOS/CHoCH/breaker/NPOC validity, level freshness/causality and volume profile integrity; test detector accuracy by regime, compare baseline | **PARTIAL** |
| **3. Anticipatory opportunity detection** | \`strategy.py\` radar, level reactions, intrabar SFP; \`opportunity_scout.py\` advisory watches and outcome snapshots | Assert complete DISCOVER→WATCH→ARMED→TRIGGERED→VALIDATED→EXECUTED→MANAGED→CLOSED path and interruption transitions, with same signal ID across runtime and exchange; verify actual entry timing | **PARTIAL** |
| **4. Fix missed trades and late signals** | Eligible-candidate fallback fixed under #119, early-router, independent rejected/setup watch observations; in #123 corrupt price paths now fail closed | Categorize and reconcile **never detected / late / confirmation / risk / exchange / infrastructure / invalidated** with actual market/exchange timelines, predeclared false-positive comparison | **PARTIAL** |
| **5. Elite multi-agent intelligence** | LangGraph shadow/guard, deterministic risk/structure agents, early observer that cannot place trades | Simulate all veto/timeout/reconnect/conflict paths, quantify graph runtime and compare signal decisions/latency against deterministic baseline on unseen data | **PARTIAL** |
| **6. Advanced signal engine** | \`Signal\` model, setup-specific playbook, candidate ranking after individual eligibility, quality/structure/estimated-cost admission | Confirm EVERY actionable plan has executable/conditional price, coherent SL/TP, provenance, clock/expiration, confidence meaning, lifecycle and fee-aware R:R; calibrate against exchange fills | **PARTIAL** |
| **7. Precision execution engine** | Bitget **demo-only** client, 1–20× checks, sizing, stops, intent persistence/idempotent OID, order/position reconciliation, stop coverage, no POST retries | Real **demo** acknowledgement→partial/full fill→protected exposure→TP/SL→closed, restarts, timeout unknowns, precision/quantity on supported live demo API; verify no duplicate/unprotected positions | **PARTIAL — high-priority external gate** |
| **8. Intelligent trade management** | Position-management logic and shadow exit variants; protective-stop synchronization | Compare management variants after realistic fees, verify no stop widening or unprotected exposure, partial TP, trailing and invalidation changes with actual exchange reconciliation | **PARTIAL** |
| **9. Adaptive market regime engine** | Regime selector and profile-specific playbooks; high-vol/range cautions | Freeze labels before outcomes, measure trade precision/latency and false positives across trend/range/high-vol/compression; failure-recovery on regime flips | **PARTIAL** |
| **10. Measurable performance optimization** | Causal replay, fee/funding reconciled offline demo evidence, chronological split, shadow evaluator, latency histogram; #123 rejects contaminated calibration samples | Full synchronized trades/depth/OI historical replay with conservative fills, train/validation/test fixed pre-outcomes, baseline comparison, meaningful sample and uncertainty | **PARTIAL — profit improvement not established** |
| **11. Strict but intelligent risk control** | Conservative risk caps, no blind market orders, leverage checks, protection halts, reconciled balance and stop-loss checks | Run loss/day drawdown and aggregate-exposure scenarios against actual exchange-protection states including outages, restart, fills; confirm no bypass in every workflow | **PARTIAL** |
| **12. Professional KYVORIQ UI/UX** | Charcoal/gold Android design, selectable levels, widget, charts and signed Build 132 candidate; emulator visual test pass | Verify actual phone gestures/default zoom/label axis/chart fullscreen, notification dedupe, legible source/provenance, strong signal vs order/fill distinction, long-running user sessions | **PARTIAL** |
| **13. Security, stability and 24/7 reliability** | Keystore device session, server owner auth, GitHub secret-history checks, private HTTP/WS, container restart/persistence smoke, Bitget origin/redirect hardening | Deplexo runtime memory & /data durability, operator token rotation, app long-run reconnection/network faults and migration/rollback; free hosting uptime is not guaranteed | **PARTIAL** |
| **14. Comprehensive verification** | Automated backend tests, mocked execution integration tests, bounded container and Android emulator CI, scenarios for SFP/stale data and order risk | Verify all 15 exact user scenarios (SFP/retest/OB no entry/bull trap/NPOC/armed flip/disconnect/restart/duplicates/timeframe conflict/range/alerts/partial fill/margin/stale feed) in a scenario matrix; exchange calls only with authorized demo test | **PARTIAL** |
| **15. Continuous learning without unsafe self-modification** | Bounded journal, scout/agent evidence collector, \`calibration_observer.py\` descriptive-only, offline forward evaluator; #123 rejects invalid outcomes | Freeze strategy before holdout, independent ledger quality & attribution, test suggested changes in shadow then demo with no self-editing or auto-promotion of risk gates | **PARTIAL** |
| **16. Execute upgrades autonomously** | GitHub tools allow source edits, draft PR, CI, verified backend ZIP and signed APK candidate; rollback paths preserved | Privately controlled **existing Deplexo service** requires approved deployment, hash/source check, /data persistence, Android signed install/pairing, natural Bitget fills, documented final audit; cannot bypass host/UI permission limitations | **PARTIAL — deployment/acceptance pending** |

## Hard invariants and release boundaries

1. **Demo only**: \`live_money_execution=false\` and Bitget demo flag. Never create a real-money order without separate explicit authorization.
2. Keep existing \`dev-trader-engine\`, original /data volume, owner token, Android encrypted pairing, historical trades, original risk policy (0.5% default, 1% hard ceiling), protection halts and daily loss controls. Do not force trades to satisfy testing.
3. Repo/CI availability does not grant Deplexo console access. An already staged ZIP may contain previous source; compare SHA **and** \`app/build-manifest.json\` before activation. Check immutable running \`/health.build\` identity after deployment and memory headroom; keep rollback.
4. Original 16-phase success includes measurable **positive fee-aware risk-adjusted expectancy**, not a count of tests or a few profitable trades. No statement of profitability until sufficient genuine exchange-reconciled forward demo performance on a predeclared period.
5. Never auto-merge PR #123 or push a release publicly merely because CI is green; the Android release action can publish to the public GitHub repo. The user's private-first intent must be preserved.
6. Test provenance: ordinary backend tests use mock/synthetic data, not verified exchange order execution. Explicitly label every verification result's scope.
7. Next acceptance priorities: **(a)** validate PR #123 CI, **(b)** controlled verified source release to Deplexo (with owner action where unavoidable), **(c)** Android Build 132 actual phone/notifications, **(d)** natural demo trade lifecycle and evidence collection, **(e)** scheduled repeat regression plus evidence-based performance analysis.

## Phase 14 explicit scenario accountability

| Required scenario | Minimum acceptance evidence |
|---|---|
| 1 Daily low sweep/reclaim bullish SFP | Preexisting swing and sweep proven from causal candles; signal after reclaim; risk and fill correct |
| 2 Breakout + momentum + successful retest | Genuine displacement, retest, clear invalidation; no premature entry |
| 3 OB touch without reaction | WAIT; no exchange order |
| 4 Bull trap | Breakout invalidates; no unjustified late long/flip |
| 5 NPOC reaction | Actual validated NPOC level & correct reaction confirmation |
| 6 Armed opportunity regime flip | Opportunity invalidated/reevaluated without stale entry |
| 7 Disconnect mid-submission | Stable idempotent OID, UNKNOWN status, reconcile before new entry |
| 8 Restart with open position | /data persistence, exchange sync, stop protection, no duplicate |
| 9 Duplicate signal | One admissible order only |
| 10 HTF/LTF disagreement | Legitimate reversal allowed with corroboration; structural risk never waived |
| 11 Sideways regime | Range logic contextual, no churn |
| 12 Repeated notifications | Deduplicated developing vs confirmed notifications |
| 13 Partial fills | Correct remaining quantity, stops, status & fees |
| 14 Insufficient available margin | Safe skip, no order |
| 15 Stale market data | No new executable order, feeds marked stale, reconnect gracefully |

A corresponding named regression/integration test plus, where required, a natural exchange demo observation must be linked before marking each row accepted. This checklist is **not** itself evidence that those scenarios passed.
