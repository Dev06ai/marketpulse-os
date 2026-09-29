from dataclasses import dataclass
from typing import Optional

from .analytics import MarketFeatures, compute_features
from .models import Candle, MarketState
from .knowledge import RULES


@dataclass
class Signal:
    id: str
    direction: str
    setup: str
    entry: float
    stop: float
    target1: float
    target2: float
    rr: float
    confidence: float
    grade: str
    regime: str
    invalidation: str
    thesis: list[str]
    evidence: dict
    timeframe: str

    def to_dict(self):
        return self.__dict__


def pivots(candles: list[Candle], window: int = 2):
    highs, lows = [], []
    for i in range(window, len(candles) - window):
        c = candles[i]
        if c.high >= max(x.high for x in candles[i-window:i+window+1]):
            highs.append((i, c.high))
        if c.low <= min(x.low for x in candles[i-window:i+window+1]):
            lows.append((i, c.low))
    return highs, lows


def rr(entry: float, stop: float, target: float) -> float:
    risk = abs(entry - stop)
    reward = abs(target - entry)
    return reward / risk if risk else 0.0


def _score(direction: str, setup: str, f: MarketFeatures) -> tuple[float, list[str]]:
    score = 0.58
    reasons = [f"{setup} structure confirmed"]

    trend_ok = (direction == "LONG" and f.trend_60 == "UP") or (direction == "SHORT" and f.trend_60 == "DOWN")
    trend_counter = (direction == "LONG" and f.trend_60 == "DOWN") or (direction == "SHORT" and f.trend_60 == "UP")
    if trend_ok:
        score += 0.13
        reasons.append("1h trend aligns with the trade")
    elif trend_counter:
        score -= 0.10
        reasons.append("trade is counter-trend on 1h")

    if direction == "LONG" and f.cvd_price_divergence == "BULLISH":
        score += 0.10
        reasons.append("bullish price/CVD divergence")
    elif direction == "SHORT" and f.cvd_price_divergence == "BEARISH":
        score += 0.10
        reasons.append("bearish price/CVD divergence")

    if direction == "LONG" and f.book_imbalance > 0.12:
        score += 0.07
        reasons.append("bid-side depth supports longs")
    elif direction == "SHORT" and f.book_imbalance < -0.12:
        score += 0.07
        reasons.append("ask-side depth supports shorts")

    if direction == "LONG" and f.liquidation_pressure == "LONG_LIQUIDATIONS":
        score += 0.05
        reasons.append("long liquidation pressure present")
    elif direction == "SHORT" and f.liquidation_pressure == "SHORT_LIQUIDATIONS":
        score += 0.05
        reasons.append("short liquidation pressure present")

    if f.spread_bps > 5:
        score -= 0.08
        reasons.append("wide spread reduces execution quality")

    if f.regime == "HIGH_VOL":
        score -= 0.04
        reasons.append("high volatility regime")

    return max(0.0, min(score, 0.99)), reasons


def _risk_gate(entry: float, stop: float, f: MarketFeatures) -> bool:
    if entry <= 0 or stop <= 0:
        return False
    risk = abs(entry - stop)
    if f.atr_15 <= 0:
        return True
    # Avoid microscopic stops and stops so large that the setup becomes structurally inefficient.
    return 0.15 * f.atr_15 <= risk <= 2.5 * f.atr_15


def _signal(
    *,
    id: str,
    direction: str,
    setup: str,
    entry: float,
    stop: float,
    target: float,
    timeframe: str,
    invalidation: str,
    f: MarketFeatures,
    thesis: list[str],
) -> Optional[Signal]:
    min_rr = float(RULES["risk"]["preferred_min_rr"])
    ratio = rr(entry, stop, target)
    if ratio < min_rr or not _risk_gate(entry, stop, f):
        return None
    confidence, score_reasons = _score(direction, setup, f)
    min_conf = float(RULES.get("signal", {}).get("min_confidence", 0.52))
    if confidence < min_conf:
        return None
    elite_rr = float(RULES["risk"].get("elite_min_rr", 3.0))
    elite_conf = float(RULES.get("signal", {}).get("elite_confidence", 0.70))
    grade = "A" if ratio >= elite_rr and confidence >= elite_conf else "B"
    return Signal(
        id=id,
        direction=direction,
        setup=setup,
        entry=entry,
        stop=stop,
        target1=entry + (1 if direction == "LONG" else -1) * abs(entry - stop) * 1.5,
        target2=target,
        rr=ratio,
        confidence=confidence,
        grade=grade,
        regime=f.regime,
        invalidation=invalidation,
        thesis=thesis + score_reasons,
        evidence={
            "trend_15": f.trend_15,
            "trend_60": f.trend_60,
            "book_imbalance": round(f.book_imbalance, 4),
            "spread_bps": round(f.spread_bps, 3),
            "oi_change_5m_pct": round(f.oi_change_5m_pct, 3),
            "oi_change_15m_pct": round(f.oi_change_15m_pct, 3),
            "cvd_price_divergence": f.cvd_price_divergence,
            "liquidation_pressure": f.liquidation_pressure,
        },
        timeframe=timeframe,
    )


def detect_sfp(state: MarketState) -> Optional[Signal]:
    cs = [c for c in state.candles_15 if c.confirmed]
    if len(cs) < 10 or state.last_price is None:
        return None
    f = compute_features(state)
    recent = cs[-1]
    highs, lows = pivots(cs[:-1], 2)
    ph = highs[-1][1] if highs else None
    pl = lows[-1][1] if lows else None
    min_rr = float(RULES["risk"]["preferred_min_rr"])

    if ph and recent.high > ph and recent.close < ph:
        entry, stop = recent.close, recent.high * 1.0005
        target = min((x[1] for x in lows[-5:]), default=recent.low)
        if target >= entry:
            target = entry - (stop - entry) * min_rr
        return _signal(
            id=f"sfp-short-{recent.end}",
            direction="SHORT",
            setup="Bearish SFP",
            entry=entry,
            stop=stop,
            target=target,
            timeframe="15m",
            invalidation=f"15m close above swept high {recent.high:.2f}",
            f=f,
            thesis=[
                f"Sweep above prior swing high {ph:.2f}",
                "Candle closed back below the swept level",
                "Stop anchored at sweep wick extreme",
            ],
        )

    if pl and recent.low < pl and recent.close > pl:
        entry, stop = recent.close, recent.low * 0.9995
        target = max((x[1] for x in highs[-5:]), default=recent.high)
        if target <= entry:
            target = entry + (entry - stop) * min_rr
        return _signal(
            id=f"sfp-long-{recent.end}",
            direction="LONG",
            setup="Bullish SFP",
            entry=entry,
            stop=stop,
            target=target,
            timeframe="15m",
            invalidation=f"15m close below swept low {recent.low:.2f}",
            f=f,
            thesis=[
                f"Sweep below prior swing low {pl:.2f}",
                "Candle closed back above the swept level",
                "Stop anchored at sweep wick extreme",
            ],
        )
    return None


def line_value(p1, p2, x):
    i1, y1 = p1
    i2, y2 = p2
    return y2 if i2 == i1 else y1 + (y2 - y1) * ((x - i1) / (i2 - i1))


def detect_dline(state: MarketState) -> Optional[Signal]:
    cs = [c for c in state.candles_15 if c.confirmed]
    if len(cs) < 18 or len(state.candles_60) < 12:
        return None
    f = compute_features(state)
    highs, lows = pivots(cs[:-1], 2)
    last = cs[-1]
    candidates = []

    if len(lows) >= 3:
        for a, b in zip(lows[-5:-1], lows[-4:]):
            if b[1] > a[1]:
                candidates.append(("LONG", a, b))
    if len(highs) >= 3:
        for a, b in zip(highs[-5:-1], highs[-4:]):
            if b[1] < a[1]:
                candidates.append(("SHORT", a, b))
    if not candidates:
        return None

    direction, p1, p2 = candidates[-1]
    touches = 0
    start = max(0, p1[0] - 4)
    for i, c in enumerate(cs[start:p2[0] + 5], start=start):
        lv = line_value(p1, p2, i)
        tol = max(1.0, abs(lv) * 0.0015)
        if abs(c.low - lv) <= tol or abs(c.high - lv) <= tol:
            touches += 1
    if touches < int(RULES["dline"]["preferred_touches"]):
        return None

    projected = line_value(p1, p2, len(cs) - 1)
    min_rr = float(RULES["risk"]["preferred_min_rr"])

    if direction == "LONG" and last.close > projected and last.open <= projected:
        stop = min(c.low for c in cs[-5:]) * 0.9995
        entry = last.close
        target = entry + (entry - stop) * min_rr
        return _signal(
            id=f"dline-long-{last.end}",
            direction="LONG",
            setup="D-Line Breakout",
            entry=entry,
            stop=stop,
            target=target,
            timeframe="15m",
            invalidation=f"15m close back below D-Line near {projected:.2f}",
            f=f,
            thesis=[
                "Multiple qualifying D-Line touches",
                "15m body close beyond the trend line",
                "Stop anchored below the recent execution swing",
            ],
        )

    if direction == "SHORT" and last.close < projected and last.open >= projected:
        stop = max(c.high for c in cs[-5:]) * 1.0005
        entry = last.close
        target = entry - (stop - entry) * min_rr
        return _signal(
            id=f"dline-short-{last.end}",
            direction="SHORT",
            setup="D-Line Breakout",
            entry=entry,
            stop=stop,
            target=target,
            timeframe="15m",
            invalidation=f"15m close back above D-Line near {projected:.2f}",
            f=f,
            thesis=[
                "Multiple qualifying D-Line touches",
                "15m body close beyond the trend line",
                "Stop anchored above the recent execution swing",
            ],
        )
    return None



def detect_mss(state: MarketState) -> Optional[Signal]:
    """Looser continuation setup: a confirmed 15m body close through a recent structure level."""
    cs = [c for c in state.candles_15 if c.confirmed]
    if len(cs) < 12 or state.last_price is None:
        return None
    f = compute_features(state)
    highs, lows = pivots(cs[:-1], 2)
    last = cs[-1]
    min_rr = float(RULES["risk"]["preferred_min_rr"])

    if highs:
        level = highs[-1][1]
        if last.close > level and last.open <= level:
            entry = last.close
            stop = min(c.low for c in cs[-4:]) * 0.9995
            target = entry + (entry - stop) * min_rr
            return _signal(
                id=f"mss-long-{last.end}",
                direction="LONG",
                setup="MSS Continuation",
                entry=entry,
                stop=stop,
                target=target,
                timeframe="15m",
                invalidation=f"15m close back below reclaimed structure {level:.2f}",
                f=f,
                thesis=[
                    f"15m body close above structure {level:.2f}",
                    "Momentum continuation setup rather than a first-impulse chase",
                    "Risk anchored to the recent execution swing",
                ],
            )

    if lows:
        level = lows[-1][1]
        if last.close < level and last.open >= level:
            entry = last.close
            stop = max(c.high for c in cs[-4:]) * 1.0005
            target = entry - (stop - entry) * min_rr
            return _signal(
                id=f"mss-short-{last.end}",
                direction="SHORT",
                setup="MSS Continuation",
                entry=entry,
                stop=stop,
                target=target,
                timeframe="15m",
                invalidation=f"15m close back above broken structure {level:.2f}",
                f=f,
                thesis=[
                    f"15m body close below structure {level:.2f}",
                    "Momentum continuation setup rather than a first-impulse chase",
                    "Risk anchored to the recent execution swing",
                ],
            )
    return None


class StrategyEngine:
    def __init__(self):
        self.last_signal_id = None

    def evaluate(self, state: MarketState) -> Optional[Signal]:
        if state.data_health != "HEALTHY":
            return None
        candidates = [
            detect_sfp(state),
            detect_dline(state),
            detect_mss(state),
        ]
        signals = [s for s in candidates if s is not None]
        if not signals:
            return None
        signal = max(signals, key=lambda s: (s.confidence, s.rr))
        if signal.id == self.last_signal_id:
            return None
        self.last_signal_id = signal.id
        return signal
