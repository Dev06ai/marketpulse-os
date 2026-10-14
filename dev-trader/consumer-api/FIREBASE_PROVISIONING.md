# KYVORIQ • Firebase project onboarding: verified Android identity

The existing KYVORIQ consumer auth UI has already been implemented in the
Build 161 source. **Firebase is NOT connected and no new project has been
created.** This file intentionally contains no Google OAuth secrets, service
account private keys, passwords or API credentials.

## Exact Android registration (verified from published APK signing block)

- Firebase display name: KYVORIQ
- Android package: `com.devtrader.app`
- Certificate SHA-1: `67:7B:5A:1F:47:C4:DA:35:2E:07:A2:89:C2:E8:5D:BE:4A:93:D1:E4`
- Certificate SHA-256: `17:E4:C5:50:AA:23:5D:AE:92:60:58:65:4F:20:3E:CA:E9:D7:B3:0B:43:2B:DE:9D:C2:C3:58:E2:83:60:CB:AB`
- The certificate fingerprints were extracted from APK Signature Scheme v2 signer
  certificate in the GitHub-signed Build 161 APK. SHA-256 agrees with the
  already verified release continuity check from Builds 157–161.

The fingerprint above is for the **sideloaded release APK**; Google Play may
sign distributed APKs with a different **Play App Signing** certificate. Once
Play app signing is enabled, register the Play certificate fingerprints too.
Do not substitute the local debug keystore fingerprints.

## Provider actions requiring owner's interactive Google authorization

1. In Google Firebase Console, authenticate using the Google account that
   owns the KYVORIQ Firebase project. Existing projects should be reviewed
   before creating a new one. Create a free/Spark project only if none exists.
   Do **not** enable Google Cloud paid billing, upgrade to Blaze or buy
   third-party services without owner approval.
2. Register the Android package and production signing fingerprints above.
3. In Firebase Authentication, enable Email/Password and Google providers.
   Set the verified support address, authorized domain(s) and callback
   configuration. Test verification link, password-reset link and Google
   sign-in with a real consenting tester account.
4. Record only public `firebase_project_id`, Android `firebase_app_id`,
   and OAuth **Web client ID**. Place the project's client Web API key in
   repository Actions Secret `KYVORIQ_FIREBASE_WEB_API_KEY` (although a
   Firebase Web API key isn't an administrator secret, do not paste it into
   chat or logs). Do not upload a service-account JSON or private signing key.
5. Run the manual GitHub Actions workflow
   `.github/workflows/kyvoriq-firebase-onboarding-162.yml` on `main`
   (the source branch copy is `build-firebase-connected-162.yml`).
   The hardened workflow also requires a reviewed immutable `source_commit`
   and accepts `consumer_api_origin` for the independent HTTPS account API.
   Leaving the origin blank creates an identity-only candidate, which cannot
   pass end-to-end server account verification. Use the three public project
   IDs, never a credential value in workflow inputs. It builds a **signed testing APK**
   using the GitHub repository's existing established signing identity,
   versionCode 162, and upload it as a private testing artifact.
   **It does not publish to the app's update manifest.**
   The candidate is uploaded only after consumer security and offline Android
   emulator checks pass. `TEST-SCOPE.json` explicitly records live Firebase
   end-to-end testing as unverified. Offline checks cannot prove Google OAuth,
   verification/reset email delivery, revocation, or deployed server access.
6. Deploy the consumer API independently of the private Bitget/Voroa engine
   with verified issuer/audience/JWKS, a separate consumer Postgres database,
   protected Redis abuse-limiting connection, HMAC key and safe network ingress.
   Keep `KYVORIQ_CONSUMER_AUTH_ENABLED=false` until a real tester verifies
   email signup, email verification, password reset, Google login, logout,
   account deletion and server bearer-token acceptance end-to-end.
7. Neither the Android app's local Google identity nor an arbitrary JWT claim
   may confer admin/Pro/Elite or trading capability. Admin requires the
   server-side immutable UID allowlist, recent MFA and server entitlement DB.

### Limitation as of 2026-10-14

The Firebase Codex plugin is available in the ChatGPT directory, but is not
connected to the user's account in this chat. Creating a Firebase project
requires user-authenticated access to their Google account. Previous attempts
to create an isolated free Render consumer staging service returned HTTP 500,
and no consumer service was created. Existing Render services were suspended.
No one should claim consumer login is live without re-verifying all of this.
