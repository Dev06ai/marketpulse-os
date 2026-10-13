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
