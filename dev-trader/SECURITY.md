# Dev Trader security invariants

These rules are release blockers, not suggestions.

1. **Never commit credentials.** Bitget keys/passphrases, cloud tokens, database URLs, signing keys, OAuth secrets, Firebase service accounts and similar credentials must exist only in provider/server secret storage. `.env.example` files contain blank values or unmistakable placeholders only.
2. **Never put server secrets in Android.** Anything shipped in an APK must be treated as recoverable by an attacker. Do not hard-code Bitget secrets, cloud service credentials, database credentials, signing secrets or a long-lived backend master token in `BuildConfig`, resources, assets or source.
3. **Demo execution remains fail-closed.** The current Bitget executor is demo-only. Do not add live-money execution unless authentication, authorization, audit logging, key scoping, withdrawal-disabled API permissions and an explicit user-controlled live-trading safety design are implemented and independently reviewed first.
4. **No unauthenticated state-changing trading API.** Public HTTP/WebSocket clients must never be able to create, alter or close exchange orders, modify credentials, change risk limits or invoke administrative actions. Any future state-changing route requires server-side authentication and authorization plus tests proving unauthenticated requests are rejected.
5. **Minimize public data.** Do not return credentials, authorization headers, raw environment variables, database connection strings, private account identifiers or stack traces in API responses or logs. Personal account/execution data should be placed behind authentication before the backend is shared with anyone else.
6. **Treat Git history as permanent.** Removing a secret from the newest commit is not remediation. Revoke/rotate the credential first, then remove it from history if appropriate. The security workflow scans current tracked files and reachable Git history without printing suspected values.
7. **Frontend/public environment variables are public.** Never place secrets in `NEXT_PUBLIC_*`, `REACT_APP_*`, Android resources, browser JavaScript or any client-delivered configuration.
8. **Least privilege.** Exchange keys should have only the minimum permissions needed. Withdrawal/transfer permissions are forbidden for Dev Trader automation. Cloud/provider billing limits and alerts should be enabled wherever the provider supports them.
9. **Fail closed on uncertainty.** Authentication, exchange reconciliation, stop protection, credential configuration or data-integrity uncertainty must block execution rather than assume safety.
10. **Security changes require regression checks.** Secret scanning, backend tests and Android release checks must stay enabled. Do not bypass a failing security check to publish a build.

If a credential may have been exposed, assume it is compromised and rotate it rather than trying to decide whether someone actually used it.
