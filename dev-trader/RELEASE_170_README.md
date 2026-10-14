# KYVORIQ 0.21.45 / Android Build 170

This file triggers the **versioned, signed owner-testing APK workflow** on a
release-only branch. The app source is the tested dev-trader-v1 commit
`ae05008efe95e548d79b4c5e87538b3db2f85d21`.

Changes: client-only read-only 15-minute OHLCV session volume-by-price profiles;
value-area POC/VAH/VAL aligned with the candle timestamps and price scale; VP
layer toggle; dated chart reference levels from the October 14 screenshots.
Backend already serves the public `/chart` profile schema.

Release admission requires the APK's SHA256, Android package/version,
certificate match against Build 141, exclusion of development secrets, and
immutable GitHub Release publication. No trading strategies, admin privileges,
consumer payments, or exchange execution behavior are changed.
