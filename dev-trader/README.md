# Dev Trader — Private Klein Mode 1

A private-first Android alert app plus live market engine for manual trading on Klein Funding.

## Safety
- No automated Klein execution.
- Signals are informational and must be manually reviewed/executed.
- Default risk cap is 1% per setup.
- Preferred technical RR is 3:1.

## Live data
The engine uses Bybit public linear WebSockets for BTCUSDT ticker, public trades, level-1 order book, and 15m/1h klines. The phone receives validated state snapshots every second.

## Knowledge integrated
Rules distilled from the user-supplied D-Line checklist, Bitcoin price-action manual, and advanced Bitcoin price-action/order-flow guide live under backend/knowledge.

## Remote maintenance
Strategy code, feed handling, configuration, and notification backend are separate from the Android UI. Routine server/strategy fixes can therefore be deployed without a new APK.

## Build
Android uses AGP 9.4.0, Gradle 9.6.0, Kotlin 2.4.10, and Compose BOM 2026.09.00. FCM is prepared but requires the user's own Firebase project configuration.
