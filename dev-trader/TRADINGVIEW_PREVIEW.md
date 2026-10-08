# Optional TradingView Lightweight Charts preview (Build 130)

The existing native MarketChartView remains KYVORIQ's default. It retains its 1h opening viewport, reverse-swipe chart panning, right-side level price labels, haptics, fullscreen mode and custom SFP/OB drawings.

A separate **TRADINGVIEW CHART** opt-in button launches a full-screen preview, and **CLOSE PREVIEW** always returns to the native chart. The preview uses the public candles and level prices already received from the backend; no API credentials, demo order access, account balances or JavaScript bridge enter its WebView.

The experimental preview uses TradingView Lightweight Charts version **5.2.1** from the pinned unpkg HTTPS URL. The source distribution is Apache-2.0, and public displays must show attribution:
**TradingView Lightweight Charts™ — Copyright (c) 2025 TradingView, Inc. — https://www.tradingview.com/**.
The preview includes a visible clickable attribution line and requests the attribution logo.

Safety: file/content access and DOM storage disabled, no JavaScript bridge, mixed HTTP content blocked, no in-WebView URL navigation. Resource requests are restricted to the exact versioned JavaScript bundle. Content Security Policy disables external connections, arbitrary images and frames. All market-provided labels are inserted via JSON encoding with HTML metacharacter escaping.

**Important limitations:** This is network-dependent (CDN required), opt-in only, and is *not* a complete replacement for the native chart. The preview supports live received candles and price-line overlays but does not yet replicate KYVORIQ's reverse-swipe gestures, interactive level toggles, zone shading or all signal effects. The native chart retains those capabilities. CDN unavailability displays an error and never affects native chart or demo execution.

The dependency is not present in the backend Docker image. Review privacy and dependency trust before enabling an offline-vendored renderer in a later release.
