# KYVORIQ system audit — 7 October 2026

Source baseline: `591183b`, Android 0.18.2/build 117, engine v3.5.
Candidate release: Android 0.18.3/build 118, engine `market-decision-v3.6`.

## Scope and results

Reviewed strategy admission and reaction detection, risk sizing and final order
admission, demo reconciliation and protection, fill accounting and learning
lifecycle, feed ingestion/backfill, HTTP and WebSocket delivery, Android chart
requests, background notifications, privacy/permissions, update downloads, and
the release pipeline. The backend suite covers SFP, D-Line, MSS, momentum,
breakout/retest, pullback, mapped levels, higher-timeframe structure, contextual
Elliott/harmonics, restart recovery, learning and exchange safety.

Baseline: 225 backend tests passed. The expanded suite passes 261 tests.
These are offline regressions and API checks, not live trading results.

## Defects fixed

1. Socket opportunity alerts were never stored when Firebase was disabled or a
   mobile client was connected. Opportunity state now updates independently of
   the secondary Firebase delivery path.
2. A level first mapped after an intrabar wick could claim that historical wick
   on the next update. Reaction admission now requires interaction observed
   while mapped, a new extreme crossing the level, or a subsequent candle.
   Regression fixtures now exercise a real subsequent touch and reclaim.
3. Invalid/unknown fee values could leave accounting marked complete; invalid
   realized PnL could silently become an authoritative zero. These cases now
   mark fee accounting/window completeness false and block new execution through
   the existing incomplete-accounting gate.
4. Depth replay could refresh freshness using receive time. Depth now retains
   exchange age and duplicate/non-increasing sequences cannot refresh it.
   Quote/trade freshness also retains exchange age; future timestamps cannot
   establish HEALTHY. Invalid ticker/trade packets cannot restore WS authority.
5. Malformed JSON envelopes, timestamps, depth sequence values and liquidation
   rows could interrupt the stream; invalid/nonfinite liquidation amounts could
   poison output. These inputs are now rejected without accepting false evidence.
6. REST candle backfill lacked the geometry, finite-value, timestamp alignment
   and volume validation already used by live candles. Invalid rows are now
   excluded while valid history remains available.
7. Entry freshness was checked before leverage verification, but not afterwards.
   Feed health and decision freshness are checked again before saving intent or
   submitting an order.
8. Risk-calculator inputs could produce invalid JSON or a positive reward ratio
   for a target on the loss side. Invalid geometry/nonfinite/negative inputs now
   return HTTP 422; valid long/short sizing retains the configured risk cap.
9. Android update streaming exceptions could escape the callback, leaving a
   failed download without a recoverable UI state. Downloads now catch failures,
   delete partial files, cap size at 64 MiB, use finite timeouts and avoid updating
   destroyed activities. JSON response read failures also return a clean failure.
   Metadata requires a full SHA-256 and the project's GitHub release URL;
   version text cannot become an arbitrary cache filename. Cache-busting query
   concatenation is corrected.
10. The special-use foreground-service type was supplied on Android 29–33 even
    though it was introduced in 34. The typed call is now guarded at API 34.
11. Release publication did not depend on the separate security workflow. The
    release pipeline now directly requires full-history/current-source scanning.

## Verification

- Backend: **261 tests pass**; Python compilation passes.
- Local real HTTP/WebSocket probe: health, system check, dashboard socket,
  alerts socket, both keepalive paths and bootstrap pass.
- 22 additional HTTP surfaces return valid JSON with demo execution disabled.
- Current source and full fetched Git history secret scan: pass.
- Whitespace/diff checks and workflow YAML validation: pass.
- Offline 20-sample benchmark before the last timestamp-only changes: about
  11.93 ms/evaluation, 41.98 MiB peak RSS, 12,075-byte dashboard snapshot.
  This synthetic measurement excludes exchange traffic and host constraints.

## Release and deployment limits

The update manifest is deliberately left on the previously published APK until
the signed build and required CI checks pass. Build 118 is a release candidate,
not a locally verified APK: this environment has no Android SDK/Gradle/emulator
or signing credentials. Android compilation, emulator layout and physical-phone
verification remain pending. Docker/container checks are also pending here.

The Deplexo host and GitHub Actions API could not be reached from this session.
No live host revision, live exchange/API permissions, real fill/stop coverage or
24/7 soak result has been verified. Backend deployment is separate from APK
publication; these source fixes must reach Deplexo before they change its engine.
No demo positions were opened or closed during this audit.

Demo-only execution, Grade-A/freshness gates, confidence margin bands, daily
limits, one unresolved position, verified stop protection and historical vetoes
are retained. No profitability or zero-bug guarantee follows from these checks.
