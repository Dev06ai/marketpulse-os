# KYVORIQ release acceptance — 2026-10-10

The tested secured backend is deployed; full 16-phase acceptance remains incomplete.

- [x] Preserve existing source and verified Git recovery checkpoints.
- [x] 395 backend tests + 3 subtests pass.
- [x] Security and full-history secret scan pass.
- [x] Constrained 128 MiB / 0.25 CPU container, auth/WS and persisted-volume checks pass.
- [x] Android debug build passes; existing build 131 pairing code unchanged.
- [x] User provisions owner token; value never exposed by agent.
- [x] Upload tested archive to existing app without changing host settings/credentials/data mount.
- [x] Deployed health identity matches 5aacf5b and release content digest.
- [x] Public charts available; private HTTP/WS deny unauthenticated access; invalid pairing refused.
- [x] App configuration explicitly disables real-money execution; demo transport remains locked.
- [x] User confirms phone secure pairing and dashboard connection; server sees authenticated WS client.
- [x] User confirms System Check, notification test, demo information and previous history.
- [ ] Extended background/restart soak and fresh exchange lifecycle evidence.
- [x] User confirms authenticated post-restart history is preserved.
- [ ] Independently verify risk/protection figures and a natural demo lifecycle.
- [ ] Observe stable fresh demo book/trade data; intermittent degradation remains protected.
- [ ] Observe natural qualified demo entry, fill, protection and close with auditable evidence.
- [ ] Finish full timestamp pipeline, comparable out-of-sample evaluation and all requested E2E scenarios.
- [ ] Finish remaining 16-phase acceptance; no profitability claims from tests.

Unchecked items are pending, not passed. No new APK is required for this backend-only release. Do not merge unrelated branches or restore the old unauthenticated ZIP blindly. Preserve /data and the tested source-stamped release for recovery.

Latest selection/book fixes:412 local tests pass; CI and rollout pending. Keep deployed and tested revisions distinct.
