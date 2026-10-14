# KYVORIQ chart and security audit — Build 167 candidate

Base Android source: 4a3b65b265ee9b43fdafb19985523b887a7ac6da (Build 166 UI).
Private backend base: efc053dd4c29d06a81b35040085d3ba05f149d64.

## Changes

- New display-only `strong-ob-v1` detector. Requires closed structural break,
  opposite base candle, displacement body >=1.5 prior ATR, body/range >=65%,
  close in outer 20%, clearance >=0.5 ATR and volume >=1.2 prior mean.
  Strength score is a heuristic, not a win-rate estimate.
- Confirmed complete, contiguous history only; reject missing latest bars,
  invalidated or boundary-retested zones. Never count formation as a retest.
- Up to four zones, two per direction, within 12% of current price; strongest
  wins overlaps of >=50% of the smaller zone. 15m requires score >=85; others
  >=75. Exact wick boundaries retained; IDs include timeframe and formation.
- Android applies the same admission/caps and hides legacy/unscored OBs.
  Removed reconstruction from `/features`, preventing stale OB resurrection.
- Private responses must still match the session that requested them.
  Private chart data is guarded after sign-out, expiry or public fallback.
- Market health rejects future timestamps beyond 1 second and nonpositive prices.
- Shared bounded JWKS document cache, four-second lookup timeout, no permanent
  per-key cache; provider outage is 503, not an incorrect-password response.

## Scope and release gates

Preserve Build 166 login, icons, navigation and motion work. The server detector
does not alter private strategy order-block inputs or enable trading. Do not
deploy the older backend snapshot bundled in the Android repository: its API
predates the private repository's authentication boundary. The matching backend
patch belongs only in `Dev06ai/KYVORIQ-`.

Consumer backend/entitlement/payment activation remains pending external setup.
Do not interpret offline passing tests as live Firebase, billing, push delivery
or continuous hosting verification. New Android builds hide unscored server OBs
until the matching authenticated backend update is deployed.

Rollback: previous signed Build 166 artifacts and the private backend base SHA.
No destructive migrations, credential rotation or real-money actions included.
