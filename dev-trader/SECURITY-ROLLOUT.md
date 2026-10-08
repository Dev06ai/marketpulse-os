# KYVORIQ private API hardening — deployment hold

This change is a **proposed, fail-closed backend gate**, not a production release. It protects the Python app's private trade journal, Bitget demo account/execution data, diagnostic exports, and outbound trading WebSocket stream.

## What is private by default
- All HTTP routes except an explicit set of safe, read-only market/status routes require an owner bearer token.
- The WebSocket at `/ws` also requires a valid bearer token. Arbitrary web origins are rejected.
- Unconfigured or short owner credentials return HTTP 503 for private REST routes and WebSocket policy closure. Invalid credentials return HTTP 401 or WebSocket policy closure.
- In-browser API reference endpoints are disabled. Private responses use no-store, clickjacking and MIME-sniffing protection headers.
- The WebSocket caps concurrent listeners and incoming application message size. HTTP endpoints reject oversized declared Content-Length values.
- Direct trading mutation endpoints remain absent. Existing demo-only execution constraints are not loosened.

## RELEASE BLOCKER — Android application is not yet paired
The existing Android `SafeActivity` and `SignalService` currently connect without authentication. **If this branch were deployed as-is, private trade views, bootstrap and the WebSocket would stop working.**

Before merging or deploying:
1. Implement a device-specific owner pairing flow: generate asymmetric keys on-device with Android Keystore; approve a challenge through a separately authenticated owner channel; issue short-lived server-side device access tokens (or verify signed requests) with revocation/rotation and per-device ACLs.
2. Update the Android REST and WebSocket clients to authenticate using those device-specific credentials. **Never embed the backend master bearer token in the APK, BuildConfig, git, JavaScript, client config, or update manifest.**
3. Configure `KYVORIQ_API_OWNER_TOKEN` securely in the backend secret manager with a randomly generated value **at least 32 characters long**. This is an operator/break-glass credential, not a mobile-app token. Avoid sending token values through chat, CI output or logs.
4. Run integration and pairing tests, verify application bootstrap/chart/trade log/WebSocket/reconnection, and test demo trade continuity in a staging deployment.
5. Confirm deployed services and active host. Render's legacy dev-trader-engine is suspended; Android currently targets Deplexo. Do not switch hosts or modify the Bitget demo/live trading configuration as part of this PR.
6. Review external ingress rate limits, broker API scope (demo and withdrawals disabled), push token controls and deployment environment variable names in the hosting provider.

## Operational constraints
- This is not a substitute for an ingress WAF, multi-device authorization or encrypted Keystore credentials on Android.
- Rejected oversized declared bodies do not by themselves cover arbitrary chunked streaming body sizes. Apply an ingress body-size cap at the proxy.
- Endpoint defenses cannot prevent secrets leaked from *old* git history; revoke exposed keys immediately. Security scans report no known matches, not proof of absence.
- This security branch is intentionally based on `dev-trader-v1`, **not** MarketPulse `main`. Do not merge MarketPulse's separate PR #116 blindly into the trading branch.
- Run `python dev-trader/backend/test_api_security.py` and GitHub's KYVORIQ API Security Regression workflow before approving the PR.
