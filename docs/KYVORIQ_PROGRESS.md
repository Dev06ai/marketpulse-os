# KYVORIQ recovery checkpoint — 2026-10-10 (Asia/Calcutta)

## Resume here

The secured backend release is deployed to the existing Deplexo service. No full phase of the original 16-phase mandate is claimed complete. Current work: selection and order-book timestamp fixes locally verified; required CI and deployment pending. Read this file and KYVORIQ_RESUME_STATE.json before edits; inspect actual Git and health identity.

- Repository: Dev06ai/marketpulse-os; KYVORIQ source branch dev-trader-v1 (a92bea883902e1702d9da9fe2447c422e5012a12), work branch codex/kyvoriq-upgrade-20261009. Main contains separate MarketPulse/NOVA work; do not replace it or merge unrelated audits wholesale.
- Deployed application commit: 5aacf5bc136b67509670eef46b09fec102153984. GitHub snapshot ee60c755f907e9d44ad82c777e48a88998336940 has the identical tree db09aa1460932802de63c5db831c12d2005075f1. PR https://github.com/Dev06ai/marketpulse-os/pull/119 remains draft.
- Local application tree was clean before this documentation milestone. Local multi-commit history is preserved in outputs/KYVORIQ-recovery.bundle. GitHub connector preserves the remote snapshot; sandboxed Git credential-manager push failed. Never force-push to resolve this history difference.
- Full backend suite: 395 tests plus 3 subtests passed locally and in CI. All required CI jobs passed, including Android debug build and the 128 MiB / 0.25 CPU container. Signed APK/visual jobs skipped because Android is unchanged.

## Deployed evidence

Existing app: 5a86072f-c595-4200-80ba-0bd3be2ba352, https://dev-trader-engine.de.deplexo.com. Google-linked owner access is resolved. Production uses uploaded ZIPs, not a Git deployment branch. Uploaded KYVORIQ-verified-backend.zip (51 files); provider reports RUNNING and exact source name. New container 3f98caa984cbe8e23d1982c20c75ccf72a517c9c7032e2ddcba04f59a3eecf8e. Root '.', Dockerfile, /data mount and existing settings retained. No exchange credential was changed.

Archive SHA256: 8467b15b9f2673c7cbb8765aef3aa66808868fdd5f4e36419e130d7d2a2032fc. Public health reports source 5aacf5b and content digest 35b6100ae68cd9ac1ca10e0557d243f14e9321133c3abbb2702be442511e5147, matching the verified archive. Owner token was entered/saved by the user; only its masked name was inspected. Private HTTP returns 401 (not unprovisioned 503), invalid pairing is refused, unauthenticated dashboard/alerts WebSockets reject connections.

Health HTTP 200, connected BTC WebSocket and changing price. 5m/15m/1h/4h charts each provide 120 candles. The app configuration reports demo_auto_execution true and live_money_execution false. Intermittent DEGRADED freshness must not be called fully healthy: observed demo book age 10–15 seconds. An independent public demo-book observation also had only three packets over 18 seconds. This supports sparse upstream updates; it does not prove all network causes. Keep the existing 5-second book freshness guard unchanged. Provider measurement roughly 80 MiB / 128 MiB and 0.04 / 0.25 CPU after startup is one observation, not a steady-state guarantee.

Immediately before rollout: demo ready/enabled, zero open exchange positions/trades/unknown submissions/unreconciled entries, accounting complete, daily cap 3. Historical records previously showed two closed fills and protection; these are not fresh post-deployment execution validation. Persistent /data was retained, but authenticated history/reconciliation after restart is still pending. No order was forced, cancelled or closed. Real-money trading was never enabled. Startup caused a short provider transition; the old process logged a shutdown PermissionError after application shutdown completed, while the new process started successfully.

## Phone and remaining acceptance

User confirms Android 0.21.6/build 131 installed. Existing Insights > PAIR DEVICE supports this release and stores only a seven-day encrypted device token. User confirms DEVICE PAIRED and dashboard connected; server heartbeat shows one authenticated WebSocket client. Never ask for the owner secret in chat. Android source unchanged and debug build passed; no replacement APK is required for this backend-only release. User confirms System Check passed, notification test works, demo information loads and previous trade history is preserved. These are phone-side observations; no fresh trade was forced. Natural entry/fill/protective orders and measurable strategy expectancy remain unverified.

## Preserved milestones

1. 6660f98: persistent continuity docs.
2. 146ff22: six isolated execution filesystem fixtures; 333 tests passed.
3. b4f45be: backend HTTP/WS authentication, bounded requests/pairing, session revocation; 350 tests passed.
4. 1478d01: 0.5% default / 1% immutable hard risk, downward-only sizing below margin preferences and final reserve check; 381 tests passed.
5. a0b605e: newly confirmed 5m/15m/1H candles and corrections evaluated immediately despite delayed callback; open bars bounded to 1s; 388 tests passed.
6. 5aacf5b: validated release identity, reproducible committed ZIP, CI-gated packaging; 395 tests passed. This release is now deployed.

Previously rejected broad risk edit removed daily caps and was never applied. Narrow approved risk work preserved daily trade/signal caps, daily loss/consecutive-loss gates, reconciliation and stop protections. Do not bypass review. No pending rejected code remains in the working tree.

## Next exact work and remaining mandate

Run required CI for the locally tested selection/book fixes, package committed source and deploy after the gates pass. Preserve deployed 5aacf5b until that succeeds. Cold graph latency, event-to-fill measurements and comparable chronological strategy evaluation remain outstanding.

All 16 phases retain outstanding acceptance: baseline completeness; structure; trading concepts; anticipatory lifecycle; missed opportunities; latency; orchestration; signal quality; demo lifecycle; risk; regimes; comparable chronological out-of-sample evaluation; Android visual/notification checks; security/reliability; requested end-to-end scenarios; final integration. Existing features are preserved, not all reimplemented or declared complete. No profitability claim follows from unit tests.

## Recovery and rollback

After each meaningful milestone, update docs, secret-scan staged changes and commit. Preserve the verified archive, release manifest and Git bundle under outputs. Local application history and remote snapshot differ in commit ancestry but match content; never reset or force-push either. Retain /data during any redeploy. Previous runtime was KYVORIQ-Deplexo-Integrations-v4.zip with unverified SHA; do not blindly roll back to its unauthenticated API. Prefer a tested corrective release. Render remains billing-suspended and unchanged. Use existing free infrastructure, Bitget demo only, no paid dependencies.

## Milestone 7: selection and order-book provenance

Reproduced the selection failure before editing: an unsafe top score hid a valid lower score, and HTF-rejected candidates were logged as admitted. Structural/cost policy now checks each candidate before ranking. Journal/shadow decisions record actual eligibility, and guard review receives only eligible candidates. Eight regressions exercise the real HTF policy, best eligible rank, caps, pause, stale book and graph veto/failure. No gate threshold or risk limit was relaxed.

Nine depth regressions cover exchange generation vs push time, missing/invalid/future timestamps, explicit legacy envelope time, duplicate sequence and regressing generation time. Bitget data.ts is now preferred; arrival time cannot manufacture freshness. The five-second book freshness guard is unchanged. Official protocol: https://www.bitget.com/docs/uta/websocket/public/Order-Book-Channel . Bitget states unchanged books may have no new snapshot: https://www.bitget.com/docs/uta/best-practices-guide . Sparse demo depth must remain degraded until genuine fresh depth arrives; no REST substitution/reconnect trick. Production later returned HEALTHY with book age2410ms.

412 tests + 3 subtests passed in 13.00s, one upstream warning (work/selection-book-final.log). Synthetic local benchmark: 20 evaluations, median19.61ms/P9534.67ms/worst2480.90ms, including cold import. Variable local machine load; not a controlled speed comparison or live latency/profitability claim.

The next documentation/scan/commit command was blocked by automatic review usage exhaustion before execution. Recovery confirmed the four application/test files were saved but uncommitted; old release archive still contains 5aacf5b. The user resumed, and normal reviewed tool calls work again. No review bypass. Local recovery checkpoint before these edits: c581c99; matching remote ce9f0b2, tree3592863.
