from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import time

from .models import Candle, MarketState
from .elliott_wave import analyze_elliott
from .volume_context import volume_context
from .structure import structure_map


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
    harmonic_pattern: str = "NONE"
    harmonic_direction: str = "NEUTRAL"
    harmonic_confidence: float = 0.0
    harmonic_reason: str = ""
    volume_context: dict = field(default_factory=dict)
    structure_map: dict = field(default_factory=dict)


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


def _harmonic_context(candles: list[Candle]) -> tuple[str, str, float, str]:
    """Conservative X-A-B-C-D harmonic-like detector for scenario watching.

    It intentionally labels approximate ratio clusters as harmonic-like rather
    than claiming an exact named pattern when the structure is ambiguous.
    """
    cs = [c for c in candles if c.confirmed]
    if len(cs) < 8:
        return "NONE", "NEUTRAL", 0.0, "Not enough confirmed pivots for harmonic context."

    highs, lows = [], []
    window = 2
    for i in range(window, len(cs) - window):
        c = cs[i]
        if c.high >= max(x.high for x in cs[i-window:i+window+1]):
            highs.append((i, float(c.high)))
        if c.low <= min(x.low for x in cs[i-window:i+window+1]):
            lows.append((i, float(c.low)))

    piv = sorted(
        [("H", i, p) for i, p in highs] + [("L", i, p) for i, p in lows],
        key=lambda x: x[1],
    )
    clean = []
    for p in piv:
        if not clean or p[0] != clean[-1][0]:
            clean.append(p)
        elif p[0] == "H" and p[2] >= clean[-1][2]:
            clean[-1] = p
        elif p[0] == "L" and p[2] <= clean[-1][2]:
            clean[-1] = p

    if len(clean) < 5:
        return "NONE", "NEUTRAL", 0.0, "No five-pivot alternating structure."

    q = clean[-5:]
    kinds = "".join(x[0] for x in q)

    def score(r1, r2, r3, r4):
        # Wide, deliberately conservative tolerances for visual scenario matching.
        s = 0.0
        s += 0.25 if 0.50 <= r1 <= 0.82 else 0.0
        s += 0.20 if 0.30 <= r2 <= 1.00 else 0.0
        s += 0.25 if 1.00 <= r3 <= 1.80 else 0.0
        s += 0.30 if 0.65 <= r4 <= 0.95 else 0.0
        return s

    if kinds == "LHLHL":
        x, a, b, c, d = [x[2] for x in q]
        xa = a - x
        ab = a - b
        bc = c - b
        cd = c - d
        ad = a - d
        if min(xa, ab, bc, cd, ad) <= 0:
            return "NONE", "NEUTRAL", 0.0, "Bullish harmonic geometry is invalid."
        r1, r2, r3, r4 = ab / xa, bc / ab, cd / bc, ad / xa
        sc = score(r1, r2, r3, r4)
        if sc >= 0.70:
            return "HARMONIC_LIKE", "LONG", sc, f"Potential bullish X-A-B-C-D ratio cluster: AB/XA={r1:.2f}, BC/AB={r2:.2f}, CD/BC={r3:.2f}, AD/XA={r4:.2f}."

    if kinds == "HLHLH":
        x, a, b, c, d = [x[2] for x in q]
        xa = x - a
        ab = b - a
        bc = b - c
        cd = d - c
        ad = d - a
        if min(xa, ab, bc, cd, ad) <= 0:
            return "NONE", "NEUTRAL", 0.0, "Bearish harmonic geometry is invalid."
        r1, r2, r3, r4 = ab / xa, bc / ab, cd / bc, ad / xa
        sc = score(r1, r2, r3, r4)
        if sc >= 0.70:
            return "HARMONIC_LIKE", "SHORT", sc, f"Potential bearish X-A-B-C-D ratio cluster: AB/XA={r1:.2f}, BC/AB={r2:.2f}, CD/BC={r3:.2f}, AD/XA={r4:.2f}."

    return "NONE", "NEUTRAL", 0.0, "No conservative harmonic ratio cluster confirmed."

def _htf_levels(candles: list[Candle], as_of_ms: int | None = None):
    from .structure import closed_bars
    now=int(as_of_ms if as_of_ms is not None else time.time()*1000)
    cs=closed_bars(candles,3_600_000,now)
    hourly={c.start:c for c in cs}
    day=now//86_400_000*86_400_000
    dt=datetime.fromtimestamp(now/1000,tz=timezone.utc)
    week=day-dt.weekday()*86_400_000
    def complete_range(start,end):
        expected=set(range(start,end,3_600_000))
        return [hourly[t] for t in sorted(expected)] if expected.issubset(hourly) else []
    previous_day=complete_range(day-86_400_000,day)
    previous_week=complete_range(week-7*86_400_000,week)
    return (max((c.high for c in previous_day),default=None),min((c.low for c in previous_day),default=None),
            max((c.high for c in previous_week),default=None),min((c.low for c in previous_week),default=None),
            hourly[week].open if week in hourly else None)


def compute_features(state: MarketState) -> MarketFeatures:
    # Several detectors and mobile requests share one feature computation.
    # All inputs affecting a result are in the key, including candle corrections.
    candles = tuple(tuple((c.start,c.end,c.open,c.high,c.low,c.close,c.volume,c.confirmed) for c in pool)
                    for pool in (state.candles_5,state.candles_15,state.candles_60))
    key = (candles,state.last_price,state.book_imbalance,state.spread_bps,
           state.liquidation_long_5m,state.liquidation_short_5m,tuple(state.oi_window),
           tuple(state.flow_history),repr(state.trade_volume_profile),int(getattr(state,"_as_of_ms",time.time()*1000))//60_000)
    cached = getattr(state,"_features_cache",None)
    if cached and cached[0] == key:
        return cached[1]
    result = _compute_features(state)
    state._features_cache = (key,result)
    return result


def _compute_features(state: MarketState) -> MarketFeatures:
    f = MarketFeatures()
    as_of=int(getattr(state,"_as_of_ms",time.time()*1000))
    f.structure_map = structure_map(state,as_of)
    f.volume_context = volume_context(state,as_of)
    if state.trade_volume_profile:
        # Only the trade profile can establish an actionable POC; estimates
        # remain available explicitly for display and comparison.
        estimate = f.volume_context
        f.volume_context = dict(state.trade_volume_profile, candle_estimate=estimate)
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

    # Compare price and CVD over the same observed five-minute tape. Comparing
    # ninety minutes of candles to six recent ticks manufactured divergence.
    tape = sorted(state.flow_history, key=lambda row: row[0])
    if len(tape) >= 2:
        end_ts = tape[-1][0]
        start = min(range(len(tape)), key=lambda i: abs(tape[i][0]-(end_ts-300_000)))
        window = tape[start:]
        span = end_ts-window[0][0]
        volume = sum(row[3] for row in window[1:])
        gap = max((b[0]-a[0] for a,b in zip(window,window[1:])), default=0)
        if 240_000 <= span <= 360_000 and gap <= 30_000 and volume > 0 and window[0][1] > 0:
            p0, p1 = window[0][1], window[-1][1]
            price_move = (p1-p0)/p0*100
            cvd_move = (window[-1][2]-window[0][2])/volume*100
        else:
            price_move = cvd_move = 0.0
        f.price_impulse = price_move
        f.cvd_impulse = cvd_move
        if price_move > 0.15 and cvd_move < -15:
            f.cvd_price_divergence = "BEARISH"
        elif price_move < -0.15 and cvd_move > 15:
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
    ) = _htf_levels(state.candles_60,as_of)

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
    (
        f.harmonic_pattern,
        f.harmonic_direction,
        f.harmonic_confidence,
        f.harmonic_reason,
    ) = _harmonic_context(state.candles_15)

    if state.last_price and f.previous_week_high and f.previous_week_low:
        swing = f.previous_week_high - f.previous_week_low
        if swing > 0:
            if f.previous_week_low + swing * 0.618 <= state.last_price <= f.previous_week_low + swing * 0.65:
                f.golden_pocket = "LONG_ZONE"
            if f.previous_week_high - swing * 0.65 <= state.last_price <= f.previous_week_high - swing * 0.618:
                f.golden_pocket = "SHORT_ZONE"

    return f
