# KYVORIQ persistent development checkpoint

Updated: 2026-10-10 (Asia/Calcutta). Evidence, not promises of completion.

## Recovery summary

- CURRENT PHASE: Phase 1 audit; partial Phases 9/10 sizing and Phase 14 security.
- LAST VERIFIED TASK: Recovered risk commit 1478d01 and completed its pending candle cadence fix; 388 tests plus 3 subtests pass (12.71s).
- CURRENT UNFINISHED TASK: Verify the release archive/container and coordinate required owner-secret provisioning.
- LAST VERIFIED APPLICATION COMMIT: 1478d01 (risk milestone); source baseline a92bea883902e1702d9da9fe2447c422e5012a12.
- MODIFIED FILES: app/main.py, app/evaluation_cadence.py, test_evaluation_cadence.py and continuity documents.
- TEST FAILURES: None in completed recovery run. Earlier attempts stalled at sandboxed Windows event-loop socket creation; network permission resolved it.
- DEPLOYMENT: Unchanged. Deplexo owner and uploaded ZIP verified; exact source SHA unverified. Render billing-suspended.
- NEXT EXACT ACTION: Package and remotely verify the committed release; provision owner auth with user authorization before rollout.

## Preserved source and milestones

Repository: https://github.com/Dev06ai/marketpulse-os. Source branch: dev-trader-v1. Work branch: codex/kyvoriq-upgrade-20261009. Preserve unrelated MarketPulse/main and NOVA. No applicable AGENTS.md found. Existing engine, LangGraph, HTF, execution and UI work is incorporated, sometimes through squashes; scout branch backend matches baseline. Do not merge MarketPulse-focused security/hardening-audit-20261009 wholesale.

1. 6660f98: Established Git-backed continuity documents before application edits.
2. 146ff22: Isolated six filesystem fixtures; 333 baseline tests passed without relaxing behavioral assertions.
3. b4f45be: Integrated backend-only auth from audit/backend-hardening-review. Added bounded streamed bodies, credential-safe pairing validation, malformed-attempt throttling and active/quiet WebSocket revocation. 350 tests plus 3 subtests passed and now reproduced.

The broad risk edit was rejected by automatic safety review for removing daily caps and was never applied. The later narrowed edit was interrupted by usage exhaustion and never applied. Recovery found a clean working tree. Existing trade cap (default 3/day), signal cap, daily loss limit, consecutive-loss limit, reconciliation, freshness and protective-stop gates remain intact. Do not bypass review or retry cap removal.

## Verified gaps and blockers

- Per-trade risk now defaults to 0.5% with a shared 1% hard ceiling; not deployed.
- Preferred confidence margin now permits smaller risk-sized positions and never rounds exposure upward; exchange minimums still apply.
- Closed 5m/15m/1H bars and latest-bar corrections now trigger one immediate evaluation even with delayed callbacks. Open-bar ticks retain 1s cadence; future bars do not trigger early evaluation.
- CI now builds a source-stamped ZIP only after backend, security and constrained-container gates. It no longer restarts the old uploaded ZIP while claiming to deploy new Git code.
- Deployed dashboard previously returned private execution metadata without authentication; local security changes are not deployed.
- https://dev-trader-engine.de.deplexo.com reported market-decision-v3.8/BITGET_DEMO, which does not establish deployed commit identity.
- After explicit sign-out approval, Google-linked dubeydevbhushan owns the existing app 5a86072f-c595-4200-80ba-0bd3be2ba352. Current source is uploaded KYVORIQ-Deplexo-Integrations-v4.zip, not a connected Git branch. Persistent volume is /data, build root ., Dockerfile Dockerfile. Container 93884dab09bd653079c9c862900a69e7780bf35bff52895aba7fbe19fe93708d. Source commit remains unverified; never infer SHA from version label.
- Render service srv-dau32aad0e5s73e27qrg tracks dev-trader-v1 and is billing-suspended. No hosting settings changed.
- Android source/manifest remain 0.21.6/build 131. User confirms 131 installed; current build, signature and pairing against secured backend remain unverified.
- Local tests used mocks, not real exchange credentials or orders. Real demo fills, strategy expectancy and host persistence remain unverified.

## Remaining mandate and constraints

No complete upgrade phase is claimed. Continue all 16 phases from existing code: baseline; structure; trading concepts; anticipation; missed opportunities; latency; orchestration; signal quality; demo execution; risk; regimes; evaluation; Android; security; end-to-end tests; release.

Use Bitget demo only and existing free infrastructure. Keep deterministic risk/execution gates and alert thresholds separate. Preserve all caps and hard protections. Do not claim profitability from tests or hypothetical trades. Do not deploy untested code.

## Checkpoint and rollback

After each verified milestone, update these documents and commit a focused, secret-checked diff. On resume read this file and resume JSON, then inspect Git status/history; current evidence supersedes stale documents. Record incomplete work without calling it complete.

Rollback through reviewed revert commits, never destructive resets or shared force-pushes. Source baseline: a92bea883902e1702d9da9fe2447c422e5012a12. No deployment, order, position or published Android release has been changed by this upgrade session.

## Milestone 3: conservative risk sizing

381 tests plus 3 subtests pass (11.62s). Risk defaults to 0.5%, clamps at 1%, and the independent guardian rejects over 1%. Manual calculator cannot override 1%. Lot sizing rounds down below the margin preference when necessary; daily budget, reserve, notional and margin maximum remain enforced. Final balance refresh can block submission if reserve would be consumed. Added 31 regression cases including smaller accounts, wide stops, invalid settings and last-moment balance changes. Existing daily trade/signal caps, stop protection and loss gates are unchanged. Five old expectations were updated to the requested stricter sizing semantics; no unrelated assertion was removed. Offline mocks only; no trading or deployment.

## Milestone 4: cadence and production verification

Full suite: 388 passed plus 3 subtests in 12.71s. Seven new tests cover delayed callbacks for all three timeframes, open-bar throttling, corrected/future bars, clock rollback and the actual on_state integration. No thresholds, caps or execution gates changed.

Production read-only probes on resumed session: health HTTP 200, HEALTHY feed, connected WebSocket, engine market-decision-v3.8; dashboard SCANNING, no active signal. Bitget demo client ready, zero open trades/unknown submissions/unreconciled entries, accounting complete. Two historical CLOSED records report actual fills and verified stop coverage; these are existing records, not newly executed validation trades. Production still reports 2% planned risk, proving local tightening is not deployed.

The required KYVORIQ_API_OWNER_TOKEN is absent from the host environment-variable names. Deploying the auth changes now would return 503 for private/mobile routes. User explicitly forbids credential changes without authorization; browser credential creation requires user handoff. Prepare the tested archive and exact release instructions before asking the user to provision that secret. Do not change exchange credentials, force a demo trade, bypass auth or deploy an unusable client.

## Milestone 5: release source identity and verified archive gate

Local full suite: 395 passed plus 3 subtests, 12.03s. Public health now reports a validated release-manifest commit/content hash when packaged; unstamped source reports UNATTESTED. Release packaging reads committed allowlisted files only, refuses dirty backend source, omits runtime secrets/data and stamps a reproducible ZIP. CI artifact production depends on security, backend and free-container jobs; constrained-container auth uses an ephemeral masked test secret.

Production read-only Node transport probes passed dashboard/alerts WebSocket initial frames and keepalive, bootstrap HTTP 200 and 120 chart candles from BITGET_WS. Demo enabled/ready, operator not paused, reconciliation HEALTHY, zero exchange positions and no protection halt. An earlier Python urllib probe received HTTP 403 before health; it is not recorded as a passed smoke test. No trade was forced. Existing historical fill/protection records are not fresh execution validation.

Synthetic local benchmark (20 evaluations, current hardware, includes cold first call): median 10.30ms, P95 nearest-rank 13.86ms, worst 1452.20ms, mean 82.24ms. Windows RSS measurement unavailable/null. This does not establish real market-event-to-fill latency or profitability. Investigate initial graph import overhead separately before claiming performance improvement.

Git CLI push failed in sandboxed credential-manager startup; preserve local history and use the already authorized GitHub connector for the remote recovery branch. No changes to dev-trader-v1 or main have been published.
