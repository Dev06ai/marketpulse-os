from __future__ import annotations

from dataclasses import dataclass
from math import sqrt

from .models import Candle, MarketState


@dataclass
class MarketFeatures:
    atr_15: float = 0.0
    atr_60: float = 0.0
    trend_15: str = "UNKNOWN"
    trend_60: str = "UNKNOWN"
    regime: str = "UNKNOWN"
    volatility_pct: float = 0.0
    book_imbalance: float = 0.0
    spread_bps: float = 0.0
    oi_change_5m_pct: float = 0.0
    oi_change_15m_pct: float = 0.0
    cvd_impulse: float = 0.0
    price_impulse: float = 0.0
    cvd_price_divergence: str = "NONE"
    liquidation_pressure: str = "NEUTRAL"


def _atr(candles: list[Candle], n: int = 14) -> float:
    cs = [c for c in candles if c.confirmed]
    if len(cs) < 2:
        return 0.0
    sample = cs[-n:]
    tr = []
    prev = cs[-len(sample) - 1].close if len(cs) > len(sample) else sample[0].open
    for c in sample:
        tr.append(max(c.high - c.low, abs(c.high - prev), abs(c.low - prev)))
        prev = c.close
    return sum(tr) / len(tr) if tr else 0.0


def _trend(candles: list[Candle], lookback: int = 20) -> str:
    cs = [c for c in candles if c.confirmed]
    if len(cs) < 6:
        return "UNKNOWN"
    x = cs[-lookback:] if len(cs) >= lookback else cs
    first, last = x[0].close, x[-1].close
    span = max(c.high for c in x) - min(c.low for c in x)
    if span <= 0:
        return "RANGE"
    move = (last - first) / span
    if move > 0.18:
        return "UP"
    if move < -0.18:
        return "DOWN"
    return "RANGE"


def _pct_change(window: list[tuple[int, float]], minutes: int) -> float:
    if len(window) < 2:
        return 0.0
    now_ts, now_val = window[-1]
    target = now_ts - minutes * 60_000
    prior = min(window, key=lambda x: abs(x[0] - target))
    if prior[1] == 0:
        return 0.0
    return (now_val - prior[1]) / prior[1] * 100.0


def compute_features(state: MarketState) -> MarketFeatures:
    f = MarketFeatures()
    f.atr_15 = _atr(state.candles_15)
    f.atr_60 = _atr(state.candles_60)
    f.trend_15 = _trend(state.candles_15)
    f.trend_60 = _trend(state.candles_60)

    if state.last_price and f.atr_15:
        f.volatility_pct = f.atr_15 / state.last_price * 100.0

    f.book_imbalance = state.book_imbalance
    f.spread_bps = state.spread_bps
    f.oi_change_5m_pct = _pct_change(state.oi_window, 5)
    f.oi_change_15m_pct = _pct_change(state.oi_window, 15)

    cs = [c for c in state.candles_15 if c.confirmed]
    if len(cs) >= 6:
        p0 = cs[-6].close
        p1 = cs[-1].close
        price_move = (p1 - p0) / p0 * 100.0 if p0 else 0.0
        cvd_window = state.cvd_history[-6:] if len(state.cvd_history) >= 6 else state.cvd_history
        cvd_move = 0.0
        if len(cvd_window) >= 2:
            cvd0, cvd1 = cvd_window[0][1], cvd_window[-1][1]
            scale = max(abs(cvd0) + abs(cvd1), 1.0)
            cvd_move = (cvd1 - cvd0) / scale * 100.0
        f.price_impulse = price_move
        f.cvd_impulse = cvd_move
        if price_move > 0.15 and cvd_move < -0.15:
            f.cvd_price_divergence = "BEARISH"
        elif price_move < -0.15 and cvd_move > 0.15:
            f.cvd_price_divergence = "BULLISH"

    if state.liquidation_long_5m > state.liquidation_short_5m * 1.5 and state.liquidation_long_5m > 0:
        f.liquidation_pressure = "LONG_LIQUIDATIONS"
    elif state.liquidation_short_5m > state.liquidation_long_5m * 1.5 and state.liquidation_short_5m > 0:
        f.liquidation_pressure = "SHORT_LIQUIDATIONS"

    if f.trend_60 == "UP" and f.volatility_pct < 1.5:
        f.regime = "TREND_UP"
    elif f.trend_60 == "DOWN" and f.volatility_pct < 1.5:
        f.regime = "TREND_DOWN"
    elif f.volatility_pct >= 1.5:
        f.regime = "HIGH_VOL"
    else:
        f.regime = "RANGE"

    return f
