# KYVORIQ Consumer API — gated foundation, not a public service yet

**Do not deploy this onto the existing Voroa/Bitget execution service.** It uses a completely separate process, database, domain, runtime credentials, log/alert streams, least-privilege data store and incident response path. It does not import or expose the private trade engine.

## Security design
- Hosted identity provider performs signup/login with passkeys/MFA, breached-password screening, CAPTCHA and provider rate limits. This API accepts ONLY asymmetric issuer/audience-validated JWTs from its pinned JWKS HTTPS endpoint.
- No signup passwords, API master tokens or gateway secret are sent to the APK. Short session lifetimes and revocation strategies are required for deployment.
- Basic/Pro/Elite entitlements live in PostgreSQL, not Android preferences, JWT tier claims, URL parameters, or hidden UI controls. Nonexistent/expired tiers fall back to Basic.
- Admin identity requires explicit OIDC subject allowlisting AND an MFA claim. Subscription upgrades never confer admin.
- All business data endpoints must check server-side grants; the current /v1/access route is a **decision API**, not a substitute for enforcement on future datasets.
- No checkout or paid billing is enabled until a merchant and store policy are selected. Verified, replay-protected webhooks, event deduplication, server-to-server order/subscription lookups, refunds, cancellations, chargebacks and subscription expiry tests are mandatory.
- Deploy with managed WAF/rate limiting at the ingress, lockout/backoff at IdP, TLS, MFA step-up, tamper-resistant logs, admin change approvals and independent pen test. No absolute guarantee against bypass or brute force is possible.
- Do NOT insert owner Bitget demo credentials or public exchange execution endpoints here.

## Required configuration (runtime-only, not source)
- `KYVORIQ_CONSUMER_OIDC_ISSUER`: managed identity provider issuer URL
- `KYVORIQ_CONSUMER_OIDC_AUDIENCE`: exact consumer API audience
- `KYVORIQ_CONSUMER_OIDC_JWKS_URL`: HTTPS signing keys URL
- `KYVORIQ_CONSUMER_DATABASE_URL`: independent PostgreSQL DSN with limited privileges
- `KYVORIQ_ADMIN_SUBJECTS`: immutable, explicitly approved IdP subject IDs, not email addresses
- Android `-PkyvoriqConsumerPortalUrl=https://accounts.example.com` when a real portal is live, empty otherwise

## Launch blockers
1. Choose whether the paid distribution is Google Play, a separately distributed Android APK, or both. Play-distributed digital subscriptions generally require Play Billing subject to policy and exceptions; externally distributed apps can use an appropriate compliant payment gateway.
2. Select identity provider and configure MFA, account recovery, email verification, device sessions and abuse safeguards.
3. Set up billing catalog/prices/taxes, webhooks/refunds/chargebacks and trusted subscription records; no client-reported 'payment complete' endpoints.
4. Implement real feature-data proxy endpoints that read verified entitlements on every request; never connect consumer devices directly to `/bootstrap`, `/trades` or `/ws` on the private owner trading backend.
5. Complete security/privacy and regulatory review for consumer financial signals, marketing claims, risk disclosure, customer data and payment processing.
6. Run load, incident, disaster recovery and adversarial tests before any public launch.


## Build 161 managed Google/Gmail/email authentication (provisioning required)
This branch adds native Android Firebase Authentication support: email/password login,
email verification **link** (not an SMS/email numeric OTP), emailed password reset,
Google OAuth sign-in, device-local sign-out, and owner sign-out with locally encrypted
device-bearer removal. The account CTA has an accessible low-power gold shimmer.
**No Firebase project is configured in the public APK by default.** Without real
provider configuration the auth methods fail closed. Do not claim registrations,
verification email delivery, Gmail OTP, MFA, login, billing or public launch work
until deployed end-to-end with configured provider and email delivery.

### Firebase configuration (never source secrets)
1. Connect a private KYVORIQ-only Firebase project (not the private Bitget/Voroa
   backend). Enable Authentication email/password and Google providers, set a
   verified support address, authorized domains and verification/reset templates.
   Configure anti-enumeration and per-IP/account login/registration/reset
   rate limits in the provider/Identity Platform as available; add abuse
   protection (App Check, Play Integrity, CAPTCHA/reCAPTCHA) and MFA for admins.
2. Register Android `com.devtrader.app`, correct production signing
   certificate fingerprints, and a Google OAuth Web Client ID. Do not bundle
   Google/Bitget/admin private keys in APK or GitHub.
3. Supply client-public identifiers securely through CI build properties:
   `-PkyvoriqFirebaseApiKey=...`, `-PkyvoriqFirebaseAppId=...`,
   `-PkyvoriqFirebaseProjectId=...`, `-PkyvoriqGoogleWebClientId=...`.
   The existing CI deliberately omits these until the user connects Firebase.
4. Configure separate consumer FastAPI: issuer
   `https://securetoken.google.com/<firebase-project-id>`, audience exactly
   `<firebase-project-id>`, pinned JWKS URL
   `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`,
   and a separate consumer Postgres DSN. Firebase project/API key config alone
   is NOT authorization. Never use a client-supplied tier, email or admin flag.
5. Set mandatory, distributed TLS Redis
   `KYVORIQ_CONSUMER_REDIS_URL=rediss://...` and a unique random
   `KYVORIQ_RATE_LIMIT_HMAC_KEY` (at least 32 bytes, never in source).
   Consumer API uses Redis atomic 120/min and 1200/hour per hashed remote IP,
   returns 429 with Retry-After, and returns 503 (fail closed) if Redis fails.
   Configure ingress real-client-IP trust carefully; never accept arbitrary
   `X-Forwarded-For` supplied by untrusted clients.
6. Set `KYVORIQ_ADMIN_SUBJECTS` to the *immutable Firebase user UIDs* manually
   approved as admins. Admin bearer requires verified email and recent signed
   strong MFA, including Firebase TOTP. Even approved admins do not receive
   Bitget trading control through consumer API.
7. Deploy identity and account API on a fully separate host/runtime from
   private automated trading and market data. Validate signup/login,
   email verification, Google account, forgot-password recovery, expiry,
   token revocation, registration rate limits and independent penetration tests.
   Release only after these functional and security checks pass.
8. Add deletion/export/privacy flows, accessibility testing, security support
   policy and Google Play Billing before paid production release.

Consumer account web portals are still fail-closed. Native Firebase forms can be
used once configured; any email/Gmail code specifically requiring **numeric
OTP** would require a separately secured transactional email OTP provider
and replay-safe server verification, which is **not implemented** in this branch.
Email verification links are used here.

## Read-only features delivered in Build 161
- The Android account sheet contains Login, Sign up, Google sign-in, Forgot
  password and red Sign out. Owner local pairing is never granted from consumer
  identity. Logout clears owner chart overlays and stops private service UI.
- The Insights screen removes Alert Intelligence, Position Risk and Connection
  cards for every role; private telemetry remains computationally isolated.
- Order block *prices stay at real market coordinates*. Captions use separated
  inner-left lanes with a minimum gap, avoid custom alerts and paginate
  overcrowded zones. Tapping the OB page indicator cycles through available
  true-price level labels instead of stacking them.
