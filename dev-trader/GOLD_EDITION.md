# KYVORIQ Gold Edition — Android 0.19.0 / build 119

The Android interface now shares a warm gold design system: deep gold (#B8860B),
champagne gold (#E7C46A), ember (#DD9741), and charcoal (#0D0E10). Raised surfaces
use subtle bronze light, fine gold edges and restrained geometric facets.
Headers, navigation, controls, chart chrome, privacy, calculator, notifications
and home-screen widgets follow this palette. Trading direction and risk retain
semantic green/red colors and text labels.

Native motion includes directional workspace transitions, bounded press feedback
and ripples, price movement/settling, equity-line reveal and quieter decision
scans. System-disabled animation and battery saver suppress decorative motion.
Decision scans stop while hidden/detached and cannot reschedule during teardown.
Launch animations cancel on detach, and price animation cancellation restores a
single readable value.

UI refinements include icon navigation, warmer text hierarchy, a larger compact
Decision Center, bounded Entry Checks scrolling, selected-control accessibility
state, and preserving the original dashboard when returning from the calculator.
System Back and the calculator Back button both restore that dashboard without
rebuilding or duplicating navigation.

Validation: existing six compact/tall native layout captures, plus native taps
through tabs, timeframe selection, calculator side selection and both return
paths, Privacy Shield, and reduced-motion navigation. The release pipeline also
requires backend/security/container/live-host checks and signed Android builds.
No backend trading rules or exchange execution settings are changed here.
