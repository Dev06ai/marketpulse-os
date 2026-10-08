# KYVORIQ open-source integration — safety-first, free-host compatible

## Applied to the backend

1. **Hypothesis** (`HypothesisWorks/hypothesis`, MPL 2.0): Python property tests of risk geometry, lot precision, invalid inputs and duplicate order retry risk, CI only. `hypothesis==6.168.5` is deliberately NOT installed in Deplexo.
2. **Bitget official UTA v3 SDK** (`BitgetLimited/v3-bitget-api-sdk`): source/API contract audit and offline mock tests, rather than copying their code or replacing KYVORIQ's demo-only `app/bitget.py`. Existing V3 client uses canonical signature, authenticated read accounts and explicit market-order payloads; SDK does not automatically certify app logic.
3. **Smart Money Concepts** (`joshyattridge/smart-money-concepts`): `app/smc_shadow.py` is an original, confirmed-candle-only independent BOS/CHoCH/FVG cross-check. It is NOT vendored/copied from the package and cannot produce trades. Its labels are not independent proof of an edge.
4. **Tenacity** (`jd/tenacity`, Apache 2): pinned runtime package; only the authenticated Bitget REST `_get` function retries transient network failures (three max, exponential wait). **Never retry private POST** since a timed-out order may have been accepted by the exchange.
5. **Cryptofeed** (`bmoscon/cryptofeed`, AGPL): researched as a reference for timestamped Bitget ticker/derivatives parsing, **not installed**. Current release requires Python >=3.13; this image is Python 3.12. Note all external reference licenses before copying code.
6. **Freqtrade** (`freqtrade/freqtrade`, GPL 3): offline research path through `dev-trader/tools/export_confirmed_ohlcv.py`. Export verified confirmed OHLCV snapshots, and perform research/backtests outside production. A CSV export does not claim any backtest result or trading profit. No GPL bot bundled into Deplexo.
7. **Prometheus Python Client** (`prometheus/client_python`, Apache 2/BSD): pinned and used with custom isolated CollectorRegistry. `GET /metrics` exports only low-cardinality primary-feed readiness, evaluation counts, SMC observations/disagreements, and safe GET retry counts. **No credentials, signal IDs, exchange position sizes, account balances or prices**.
8. **TradingView Lightweight Charts** (`tradingview/lightweight-charts`, Apache 2, attribution required): any optional renderer must include NOTICE and a visible link to https://www.tradingview.com. Existing native KYVORIQ chart is the stable default until an optional replacement passes touch/overlay and emulator tests. Do not silently load a live CDN script or erase current drawing semantics.

## Operational notes

The existing LangGraph v3 graph still admits trades only after the original strategy, structural stop, independent guardian and Bitget demo executor pass. No SMC shadow result, exporter or metric bypasses them.

New read-only endpoint: `/agents/smc`, plus `/metrics`.
Test package `hypothesis` is installed only in GitHub CI.
Retries are only for transport-classified failures on GET (including rate limits and transient HTTP server errors), never order submission or close. Other HTTP errors are surfaced without retry.

Frequent metric polling on the free service is not required. A normal GET `/metrics` produces a small text response. Do not deploy a whole Prometheus server to the 128 MiB Deplexo container.

**Deployment remains manual**: a green GitHub workflow does not mean that the ZIP already running in Deplexo contains new code.

## Research export

Save a JSON market snapshot with confirmed candle arrays (e.g. keys `candles_15` or `candles_60`) to a private local file, then run:

```bash
python dev-trader/tools/export_confirmed_ohlcv.py --input chart_snapshot.json --timeframe 15m --output BTCUSDT_15m.csv
```

Input bars that are incomplete, duplicated, mathematically inconsistent or unconfirmed are skipped. No fake fills/PNL and no paid subscriptions are involved. Research needs additional period coverage, realistic fees/slippage and walk-forward holdouts before drawing trading conclusions.
