# KYVORIQ — automatic Deplexo deployments without Work or manual ZIP uploads

**Status: PREPARED, OFF BY DEFAULT.** No Deplexo service is changed by this file or
by merely pushing the workflow to GitHub. You authorize activation by adding
GitHub Actions secrets and explicitly enabling the repository variable below.

## How it works

A push/merge to the existing KYVORIQ stable release branch
`dev-trader-v1` runs security checks, backend regression tests, the
128MiB container test, Android build, and a signed-source release artifact.
If all required tests pass **and** the opt-in variable is true, the deploy job
uploads the backend ZIP automatically to Deplexo's official User API and
requests `POST /apps/{existing-app-id}/restart` with its returned
`sourceId`. It then polls that deployment's status.

This is an update of **the same existing app**, not `POST /deploy`, which
would create a different service and separate persistent volume. No one has
to download or manually upload a ZIP. Public APK publishing stays opt-in
and separate. PRs, draft branches, and workflow_dispatch runs cannot deploy
the backend through this job.

## One-time owner-only setup

1. In your Deplexo account, open **API Keys**:
   https://deplexo.com/api-keys
   Create a dedicated revocable token with **only**
   `app:deploy`, `app:restart`, and `logs:read` scopes.
   (If you later want account-health inspection, add `app:read`.)
   Do not select `app:delete`, `app:stop`, `env:write`,
   or unrelated account-level controls.
2. Open the existing `dev-trader-engine` app and copy its full UUID from
   its Deplexo app URL. Keep the original app, region, domain, configuration,
   Bitget **demo** credentials, owner trust/pairing and **persistent /data**.
   Never create a second service as a substitute.
3. On GitHub, open repo **Settings → Secrets and variables → Actions**:
   https://github.com/Dev06ai/marketpulse-os/settings/secrets/actions
   Add two **repository secrets**:
   - `DEPLEXO_TOKEN` = Deplexo token from step 1.
   - `DEPLEXO_APP_ID` = UUID of your original `dev-trader-engine` service.
   Store the values only in GitHub Secrets. **Never paste token into chat,
   code, a GitHub issue/PR, or an environment example.**
4. When the draft PR has passed checks and been approved for release, merge
   its audited changes into the stable `dev-trader-v1` branch. In GitHub
   **Settings → Secrets and variables → Actions → Variables** create the
   repository **variable** `KYVORIQ_AUTODEPLOY_ENABLED` with value `true`.
   This is the explicit switch enabling future deployments. Do not enable it
   until any open Bitget demo positions and in-flight submissions are
   reconciled, a rollback is available, and owner approval is clear.
5. For the first deployment, watch the **KYVORIQ CI** Actions run and the
   existing Deplexo app deployment. Confirm actual source commit and
   `/health` market freshness on the original service. Green CI alone
   does not prove successful runtime health or trading performance.

## What remains under manual authorization

- Connecting credentials and enabling automated production actions once.
- Reviewing and merging code into the protected stable branch.
- Major destructive migrations, changing exchange permissions, credential
  rotation or deployment when open/unknown demo positions could be harmed.
- If changing the token or app, update secrets; tokens may expire or be revoked.

**Safety:** Do not change `BITGET_DEMO_TRADING=true`, disable risk gates,
pretend stale data is healthy, expose secrets, or claim positive trading
expectancy without genuine forward-demo reconciliation.

To stop automated deployments immediately, set
`KYVORIQ_AUTODEPLOY_ENABLED=false` or remove that Actions variable.
To revoke Deplexo access, revoke the token in Deplexo API Keys and
remove `DEPLEXO_TOKEN` from GitHub Secrets.

See Deplexo's official User API:
https://docs.deplexo.com/reference/user-api/
