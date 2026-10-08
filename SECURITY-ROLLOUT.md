# Security hardening rollout checklist

This change set is **not automatically deployed** and deliberately fails closed in production for sensitive features.

## Required configuration before merging/deploying

- Configure `NODE_ENV=production`, `MARKETPULSE_ADMIN_EMAIL` and a high-entropy `MARKETPULSE_ADMIN_TOTP_SECRET` on the hosting provider. Admin sessions are capped at 24 hours (12 hours by default) and inactive admin sessions expire after one hour.
- If `DATABASE_URL` is configured, make sure its Postgres server certificate can be verified. Provide `MARKETPULSE_PG_SSL_CA` (PEM content, supports escaped newlines) if a private CA is used. No TLS bypass is permitted.
- `MARKETPULSE_TRUST_PROXY` defaults to false. Set to true only when the hosting edge guarantees it **overwrites or safely appends** `X-Forwarded-For`; otherwise rate limits intentionally use the TCP peer address. Verify correct behavior behind your proxy before enabling.
- Keep provider/API keys only in Render/hosting secret env vars. Do not place private values in `public/`, mobile APK source constants, browser code, `.env.example`, screenshots or logs. Rotate secrets that were ever committed; deleting a tracked file does not erase Git history.
- The legacy anonymous `/api/memory` and device `/api/analytics` paths now require login and use a user-scoped device hash. Old anonymous memory cannot be automatically imported because its ownership cannot be verified. Users must sign in and may need to re-create device-local preferences. Do not bypass this with a global shared token.
- Security testing must show that existing KYVORIQ/Dev Trader clients still work. Verify the Dev Trader bridge header, watchdog secrets and all mutation/admin workflows before deployment.
- A production Postgres failure fails closed rather than silently storing user data on an ephemeral instance.

## Scope and remaining work

This branch hardens the accessible `marketpulse-os` backend. It **does not prove** unrelated Android projects, other repositories, Render environment values, DB credentials, historical commits or live endpoints are clean.

Before release, review the GitHub Actions security gate, full-history Gitleaks findings, dependency audit, integration tests, production DB TLS handshake, and configuration migration. Rotate all exposed tokens out of band. Review webhook signatures, CSRF on all cookie-mutating operations, shared/proxy-aware rate limiting across multiple replicas and contextual HTML escaping for dynamic dashboards as additional defense-in-depth work.

The CSP, HSTS, X-Frame-Options, HttpOnly and SameSite protections are present in the existing server; this PR retains them. It adds stream size bounds and rejects cross-site browser mutation hints. Do not claim vulnerability-free status based on a passing CI check.
