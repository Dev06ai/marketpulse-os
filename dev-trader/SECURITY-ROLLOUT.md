# KYVORIQ rollout — do not merge without coordinated hosting update

## Scope
This branch protects private KYVORIQ trade/account execution data and the mobile WebSocket. Its Android client now includes an opt-in "PAIR DEVICE" flow, and stores only a short-lived device access token encrypted with Android Keystore. **The master secret is typed only when pairing, never compiled into the APK or persisted by the phone.**

### Owner provisioning
1. Generate a high-entropy 48+-character master secret using a reputable password manager. Store it only as `KYVORIQ_API_OWNER_TOKEN` in the **active Deplexo backend** secret manager (not in chat, code, GitHub Actions logs, or BuildConfig).
2. Release the updated Android APK first, preserving existing backend compatibility. After the APK is installed, stage the new backend and verify `/health` remains available while `/trades` returns 401 without credentials and `/auth/pair` returns 401 for a wrong secret.
3. From **KYVORIQ > INSIGHTS > PAIR DEVICE**, paste the secret once over the app's pinned HTTPS-origin backend; the server issues a randomly identified HMAC-protected device bearer valid for up to seven days. Android stores only this session encrypted with AES-GCM via Android Keystore.
4. Verify Android bootstrap, private trade history, dashboard and background WebSocket, demo-trade continuity, notification updates, renew pairing after token expiry, and revocation by rotating the master secret.
5. Configure provider-side external IP restrictions, per-host rate limits, logs that omit credentials, and backup/restore. Active Deplexo configuration and true production secrets **cannot be verified through the currently available GitHub/Render connectors**.

### Security boundaries and limitations
- By default, `/bootstrap`, `/trades`, `/execution/status`, decision logs, exports, and `/ws` require owner authentication; unprovisioned servers refuse private access (503).
- `/auth/pair` is the sole public POST endpoint added; constant-time secret comparison and a bounded global per-process attempt window help resist brute force. Secrets must be high entropy.
- Device sessions are HMAC-signed and **stateless**, expire in seven days, and are invalidated collectively by rotating the master token, including existing sockets on the next broadcast tick or received message. **Individual device revocation, replay resistance after bearer theft, and server-side device-specific ACLs are NOT implemented**; those require a more advanced owner-root-of-trust protocol with persistent state and device keypairs before multi-user use.
- Access tokens are bearer credentials. Android Keystore mitigates stored token theft but cannot completely protect tokens on a compromised or rooted device.
- No exchange API key is shipped to Android. Broker execution endpoints remain demo-only and no new order mutation API was added.
- Origin checks protect browser WebSockets, not native client identity. Use HTTPS/WSS exclusively.
- The app's REST fallback and WebSocket will fail if the secured backend is activated **before** the new Android build is installed and paired. Thus the two releases require coordination.
- Actual streamed HTTP bodies are bounded to 64 KiB before parsing, including missing or understated Content-Length, with a 10-second body deadline. Query and WebSocket message caps also apply. Provider-level DDoS protection is still outside this application.
- Secret scanner passing doesn't prove there were never secrets leaked; rotate any known exposed credentials.

### Engineering gates
- `python dev-trader/backend/test_api_security.py`
- Full `pytest` backend suite and real ASGI pairing/trade-data tests
- Free-host constrained container smoke using an ephemeral CI-only token (never a production secret)
- Android debug build, Git-history scans, signed release validation
- No rollout until all gates pass and the **current active** Deplexo deployment is identified; previous Render services remain suspended.

### Separate PR
MarketPulse PR #116 targets `main` and has separate database-cert/MFA compatibility work. Never merge it indiscriminately with this KYVORIQ backend PR.

## Verified deployment target and release procedure (2026-10-10)

The existing Google-linked owner account controls app `5a86072f-c595-4200-80ba-0bd3be2ba352`. It is running from `KYVORIQ-Deplexo-Integrations-v4.zip`, **not Git auto-deploy**. Build root `.`, Dockerfile `Dockerfile`, persistent volume `/data`. Keep the app and volume; do not create a duplicate service. A plain Redeploy rebuilds the currently uploaded ZIP and cannot publish this branch.

Required owner token is currently absent. The user has build 131 installed. The user must authorize and provision a 48+ character owner secret through Deplexo before rollout; never copy exchange keys or put secrets in this document. Preserve existing Bitget demo configuration, pause state, caps and storage. Recheck exposure/protection immediately before deployment and retain the previous image/source for rollback.

Release archive: run the full backend/security checks, then `python dev-trader/tools/package_release.py --output <outside-backend>/KYVORIQ-deplexo-backend.zip` from a committed tree. CI produces this artifact only after its backend/security/constrained-container jobs succeed. Verify archive SHA-256 against its manifest; upload it as a **new version of the existing app**. Do not click Redeploy on the old ZIP and report success.

After deployment, `/health.build.source_commit` and `content_sha256` must match the archive manifest. Require healthy Bitget feed and correct version; confirm unauthenticated private HTTP/WS denial. Pair build 131 through its device-pairing screen, then verify authenticated bootstrap/chart/history and both socket profiles. Verify 0.5% default / 1% hard risk, retained daily cap, exchange reconciliation, and every existing position's stop coverage. Do not force a signal/trade or reset daily budgets for testing. Observe the next naturally qualified demo setup and distinguish order acknowledgement from confirmed fill and stop protection.

If credential provisioning, constrained-container checks, source identity or mobile pairing is incomplete, do not deploy. Local/mock evidence is not production acceptance.
