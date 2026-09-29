# Phase 401–500 — Apex Execution + Exchange Terminal

All 100 phases are registered in `phase401-500-apex-engine.js`.

Groups:
- 401–420: live execution contract, arming, idempotency, exchange constraints, reconciliation, exposure firewall.
- 421–435: canonical price/candle/flow/derivatives authority, freshness, sequence, failover and mismatch quarantine.
- 436–450: exchange-style chart renderer, scales, crosshair, zoom/pan, volume, EMA/VWAP, structure/liquidity/level layers and sync tagging.
- 451–463: evidence arbitration, probability/RR/invalidation/target integrity, confluence conflict penalties, hysteresis and snapshot hashing.
- 464–477: entry precision, order type, slippage, exchange rounding, post-only/reduce-only, stop/target, retry/rate/latency/fill controls.
- 478–489: outcome attribution, signal-to-fill mapping, MAE/MFE, failure replay, adaptive proposals, challenger, walk-forward promotion, reliability maps, rollback/freeze.
- 490–500: new terminal shell, tape, order book, positions, command strip, Why-No-Trade, evidence matrix, execution timeline, replay, admin/integrity/mismatch HUDs and live/paper separation.

Live execution:
MarketPulse uses the existing Bybit execution adapter. The automatic real-money path is implemented but remains fail-closed unless all of the following are explicitly present:
`LIVE_TRADING_ENABLED=true`, `LIVE_AUTO_EXECUTION_ENABLED=true`, production credentials, explicit LIVE arm, successful reconciliation, kill switch off, and a passing canonical/execution gate.

No API secret is written into the repository. A code deployment alone does not place a real-money order.
