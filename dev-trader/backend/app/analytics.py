from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from .models import Candle, MarketState
from .elliott_wave import analyze_elliott


@dataclass
class MarketFeatures:
    atr_15: float = 0.0
    atr_60: float = 0.0
    trend_15: str = "UNKNOWN"
    trend_60: str = "UNKNOWN"
    trend_240: str = "UNKNOWN"
    market_structure: str = "UNKNOWN"
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
    previous_day_high: float | None = None
    previous_day_low: float | None = None
    previous_week_high: float | None = None
    previous_week_low: float | None = None
    weekly_open: float | None = None
    liquidity_high: float | None = None
    liquidity_low: float | None = None
    fvg_direction: str = "NONE"
    fvg_mid: float | None = None
    order_block_direction: str = "NONE"
    order_block_mid: float | None = None
    golden_pocket: str = "NONE"
    elliott_phase: str = "UNKNOWN"
    elliott_direction: str = "NEUTRAL"
    elliott_wave: str = "UNCOUNTED"
    elliott_confidence: float = 0.0
    elliott_reason: str = ""
    elliott_60_phase: str = "UNKNOWN"
    elliott_60_direction: str = "NEUTRAL"
    elliott_60_confidence: float = 0.0
    elliott_60_reason: str = ""


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


def trend(candles: list[Candle], lookback: int = 20) -> str:
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


def ema(candles: list[Candle], period: int = 50) -> float | None:
    cs = [c for c in candles if c.confirmed]
    if not cs:
        return None
    alpha = 2.0 / (period + 1)
    value = cs[0].close
    for c in cs[1:]:
        value = alpha * c.close + (1 - alpha) * value
    return value


def _pct_change(window: list[tuple[int, float]], minutes: int) -> float:
    if len(window) < 2:
        return 0.0
    now_ts, now_val = window[-1]
    target = now_ts - minutes * 60_000
    prior = min(window, key=lambda x: abs(x[0] - target))
    if prior[1] == 0:
        return 0.0
    return (now_val - prior[1]) / prior[1] * 100.0


def _structure(candles: list[Candle]) -> str:
    cs = [c for c in candles if c.confirmed]
    if len(cs) < 8:
        return "UNKNOWN"
    recent_high = max(c.high for c in cs[-4:])
    prior_high = max(c.high for c in cs[-8:-4])
    recent_low = min(c.low for c in cs[-4:])
    prior_low = min(c.low for c in cs[-8:-4])
    if recent_high > prior_high and recent_low > prior_low:
        return "BULLISH"
    if recent_high < prior_high and recent_low < prior_low:
        return "BEARISH"
    return "RANGE"


def _fvg(candles: list[Candle]) -> tuple[str, float | None]:
    cs = [c for c in candles if c.confirmed]
    if len(cs) < 3:
        return "NONE", None
    a, _, c = cs[-3:]
    if a.high < c.low:
        return "BULLISH", (a.high + c.low) / 2.0
    if a.low > c.high:
        return "BEARISH", (c.high + a.low) / 2.0
    return "NONE", None


def _order_block(candles: list[Candle]) -> tuple[str, float | None]:
    cs = [c for c in candles if c.confirmed]
    if len(cs) < 5:
        return "NONE", None
    for i in range(len(cs) - 2, max(-1, len(cs) - 8), -1):
        base = cs[i]
        nxt = cs[i + 1]
        if nxt.close > base.high and nxt.close > nxt.open:
            return "BULLISH", (base.open + base.close) / 2.0
        if nxt.close < base.low and nxt.close < nxt.open:
            return "BEARISH", (base.open + base.close) / 2.0
    return "NONE", None


def _htf_levels(candles: list[Candle]):
    cs = [c for c in candles if c.confirmed]
    if not cs:
        return None, None, None, None, None

    daily: dict[str, list[Candle]] = {}
    weekly: dict[str, list[Candle]] = {}
    for c in cs:
        dt = datetime.fromtimestamp(c.start / 1000, tz=timezone.utc)
        daily.setdefault(dt.strftime("%Y-%m-%d"), []).append(c)
        key = f"{dt.isocalendar().year}-W{dt.isocalendar().week:02d}"
        weekly.setdefault(key, []).append(c)

    days = sorted(daily)
    prev_day_high = prev_day_low = None
    if len(days) >= 2:
        prev = daily[days[-2]]
        prev_day_high = max(c.high for c in prev)
        prev_day_low = min(c.low for c in prev)

    weeks = sorted(weekly)
    prev_week_high = prev_week_low = None
    if len(weeks) >= 2:
        prev = weekly[weeks[-2]]
        prev_week_high = max(c.high for c in prev)
        prev_week_low = min(c.low for c in prev)

    current_dt = datetime.fromtimestamp(cs[-1].start / 1000, tz=timezone.utc)
    current_key = f"{current_dt.isocalendar().year}-W{current_dt.isocalendar().week:02d}"
    current_week = weekly.get(current_key, [])
    weekly_open = current_week[0].open if current_week else None
    return prev_day_high, prev_day_low, prev_week_high, prev_week_low, weekly_open


def compute_features(state: MarketState) -> MarketFeatures:
    f = MarketFeatures()
    f.atr_15 = _atr(state.candles_15)
    f.atr_60 = _atr(state.candles_60)
    f.trend_15 = trend(state.candles_15)
    f.trend_60 = trend(state.candles_60)
    f.trend_240 = trend(state.candles_4h())
    f.market_structure = _structure(state.candles_15)

    if state.last_price and f.atr_15:
        f.volatility_pct = f.atr_15 / state.last_price * 100.0

    f.book_imbalance = state.book_imbalance
    f.spread_bps = state.spread_bps
    f.oi_change_5m_pct = _pct_change(state.oi_window, 5)
    f.oi_change_15m_pct = _pct_change(state.oi_window, 15)

    recent = [c for c in state.candles_15[-8:] if c.confirmed]
    f.liquidity_high = max((c.high for c in recent), default=None)
    f.liquidity_low = min((c.low for c in recent), default=None)
    f.fvg_direction, f.fvg_mid = _fvg(state.candles_15)
    f.order_block_direction, f.order_block_mid = _order_block(state.candles_15)

    cs = [c for c in state.candles_15 if c.confirmed]
    if len(cs) >= 6:
        p0, p1 = cs[-6].close, cs[-1].close
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

    (
        f.previous_day_high,
        f.previous_day_low,
        f.previous_week_high,
        f.previous_week_low,
        f.weekly_open,
    ) = _htf_levels(state.candles_60)

    if f.trend_60 == "UP" and f.volatility_pct < 1.5:
        f.regime = "TREND_UP"
    elif f.trend_60 == "DOWN" and f.volatility_pct < 1.5:
        f.regime = "TREND_DOWN"
    elif f.volatility_pct >= 1.5:
        f.regime = "HIGH_VOL"
    else:
        f.regime = "RANGE"

    wave15 = analyze_elliott(state.candles_15, "15m")
    wave60 = analyze_elliott(state.candles_60, "1h")
    f.elliott_phase = wave15.phase
    f.elliott_direction = wave15.direction
    f.elliott_wave = wave15.wave
    f.elliott_confidence = wave15.confidence
    f.elliott_reason = wave15.reason
    f.elliott_60_phase = wave60.phase
    f.elliott_60_direction = wave60.direction
    f.elliott_60_confidence = wave60.confidence
    f.elliott_60_reason = wave60.reason

    if state.last_price and f.previous_week_high and f.previous_week_low:
        swing = f.previous_week_high - f.previous_week_low
        if swing > 0:
            if f.previous_week_low + swing * 0.618 <= state.last_price <= f.previous_week_low + swing * 0.65:
                f.golden_pocket = "LONG_ZONE"
            if f.previous_week_high - swing * 0.65 <= state.last_price <= f.previous_week_high - swing * 0.618:
                f.golden_pocket = "SHORT_ZONE"

    return f
