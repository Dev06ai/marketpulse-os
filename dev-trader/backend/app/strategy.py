from dataclasses import dataclass
from typing import Optional
import os
import time

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


def _min_rr() -> float:
    return float(os.getenv("MIN_RR", str(RULES["risk"]["preferred_min_rr"])))

def _min_confidence() -> float:
    return float(os.getenv("MIN_CONFIDENCE", str(RULES.get("signal", {}).get("min_confidence", 0.52))))

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

    if f.trend_240 == "UP" and direction == "LONG":
        score += 0.04
        reasons.append("4h trend aligns")
    elif f.trend_240 == "DOWN" and direction == "SHORT":
        score += 0.04
        reasons.append("4h trend aligns")
    elif f.trend_240 in {"UP", "DOWN"}:
        score -= 0.03
        reasons.append("4h trend is counter-directional")

    if f.golden_pocket == ("LONG_ZONE" if direction == "LONG" else "SHORT_ZONE"):
        score += 0.04
        reasons.append("price is in the corresponding golden-pocket zone")

    if f.fvg_direction == ("BULLISH" if direction == "LONG" else "BEARISH"):
        score += 0.03
        reasons.append("recent FVG supports direction")

    if f.order_block_direction == ("BULLISH" if direction == "LONG" else "BEARISH"):
        score += 0.03
        reasons.append("recent order block supports direction")

    return max(0.0, min(score, 0.99)), reasons


def _risk_gate(entry: float, stop: float, f: MarketFeatures) -> bool:
    if entry <= 0 or stop <= 0:
        return False
    risk = abs(entry - stop)
    if f.atr_15 <= 0:
        return True
    # Avoid microscopic stops and stops so large that the setup becomes structurally inefficient.
    return 0.15 * f.atr_15 <= risk <= 2.5 * f.atr_15


def _gate_details(direction: str, setup: str, entry: float, stop: float, target: float, f: MarketFeatures) -> dict:
    min_rr = _min_rr()
    ratio = rr(entry, stop, target)
    risk = abs(entry - stop)
    risk_ok = _risk_gate(entry, stop, f)
    confidence, score_reasons = _score(direction, setup, f)
    confidence_ok = confidence >= _min_confidence()
    checks = {
        "rr": round(ratio, 3),
        "min_rr": min_rr,
        "risk_distance": round(risk, 4),
        "atr_15": round(f.atr_15, 4),
        "risk_gate": risk_ok,
        "confidence": round(confidence, 3),
        "min_confidence": _min_confidence(),
        "confidence_gate": confidence_ok,
    }
    reasons = []
    if ratio < min_rr:
        reasons.append(f"R:R {ratio:.2f} is below minimum {min_rr:.2f}")
    if not risk_ok:
        reasons.append("stop distance fails the ATR risk gate")
    if not confidence_ok:
        reasons.append(f"confidence {confidence:.0%} is below minimum {_min_confidence():.0%}")
    return {"checks": checks, "reasons": reasons, "score_reasons": score_reasons}


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
    gate = _gate_details(direction, setup, entry, stop, target, f)
    ratio = gate["checks"]["rr"]
    confidence = gate["checks"]["confidence"]
    if gate["reasons"]:
        return None
    score_reasons = gate["score_reasons"]
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
        self.active_signal = None
        self.signal_status = "NONE"
        self.signal_history: list[dict] = []
        self.last_evaluated_ts = 0
        self.last_diagnostics = {
            "status": "STARTING",
            "wait_reason": "Engine has not evaluated market data yet.",
            "blocked_by": [],
            "setups": {},
            "signal_state": "NONE",
        }

    def _pattern_gate(self, state: MarketState, setup: str, direction: str, entry: float, stop: float, target: float, f: MarketFeatures, structural: dict) -> dict:
        gate = _gate_details(direction, setup, entry, stop, target, f)
        status = "VALIDATED" if not gate["reasons"] else "REJECTED"
        return {
            "status": status,
            "direction": direction,
            "structural": structural,
            "risk_and_quality": gate["checks"],
            "rejection_reasons": gate["reasons"],
            "score_context": gate["score_reasons"],
        }

    def diagnostics(self, state: MarketState) -> dict:
        cs = [c for c in state.candles_15 if c.confirmed]
        highs, lows = pivots(cs[:-1], 2) if len(cs) >= 5 else ([], [])
        last = cs[-1] if cs else None
        f0 = compute_features(state)
        result = {
            "status": "SCANNING" if state.data_health == "HEALTHY" else "BLOCKED",
            "wait_reason": "",
            "blocked_by": [] if state.data_health == "HEALTHY" else ["data_health"],
            "setups": {},
            "min_rr": _min_rr(),
            "min_confidence": _min_confidence(),
            "manual_execution_only": True,
            "confirmed_15m_candles": len(cs),
            "confirmed_1h_candles": len([c for c in state.candles_60 if c.confirmed]),
            "signal_state": self.signal_status,
            "active_signal": self.active_signal,
            "market_features": {
                "trend_15": f0.trend_15,
                "trend_60": f0.trend_60,
                "trend_240": f0.trend_240,
                "market_structure": f0.market_structure,
                "regime": f0.regime,
                "atr_15": round(f0.atr_15, 4),
                "volatility_pct": round(f0.volatility_pct, 4),
                "oi_change_5m_pct": round(f0.oi_change_5m_pct, 4),
                "oi_change_15m_pct": round(f0.oi_change_15m_pct, 4),
                "cvd_price_divergence": f0.cvd_price_divergence,
                "book_imbalance": round(f0.book_imbalance, 4),
                "spread_bps": round(f0.spread_bps, 4),
                "fvg_direction": f0.fvg_direction,
                "order_block_direction": f0.order_block_direction,
                "golden_pocket": f0.golden_pocket,
                "previous_day_high": f0.previous_day_high,
                "previous_day_low": f0.previous_day_low,
                "previous_week_high": f0.previous_week_high,
                "previous_week_low": f0.previous_week_low,
                "weekly_open": f0.weekly_open,
            },
            "last_evaluated_ts": self.last_evaluated_ts,
        }

        if state.data_health != "HEALTHY":
            result["wait_reason"] = "Signal evaluation is blocked until the market data feed is healthy."
            return result

        # SFP diagnostics
        if len(cs) < 10:
            result["setups"]["SFP"] = {
                "status": "WAITING",
                "reason": f"Need 10 confirmed 15m candles; have {len(cs)}.",
            }
        else:
            recent = cs[-1]
            ph = highs[-1][1] if highs else None
            pl = lows[-1][1] if lows else None
            sfp_detail = {"status": "WAITING", "prior_swing_high": ph, "prior_swing_low": pl}
            if ph is not None and recent.high > ph:
                if recent.close < ph:
                    entry, stop = recent.close, recent.high * 1.0005
                    target = min((x[1] for x in lows[-5:]), default=recent.low)
                    if target >= entry:
                        target = entry - (stop - entry) * _min_rr()
                    sfp_detail = {"status": "CANDIDATE", "pattern": "Bearish SFP", "swept_level": ph,
                                  **self._pattern_gate(state, "Bearish SFP", "SHORT", entry, stop, target, compute_features(state),
                                                     {"sweep": True, "close_back_inside": True, "entry": entry, "stop": stop, "target": target})}
                else:
                    sfp_detail["reason"] = "High swept the prior swing high, but the candle did not close back below it."
            elif pl is not None and recent.low < pl:
                if recent.close > pl:
                    entry, stop = recent.close, recent.low * 0.9995
                    target = max((x[1] for x in highs[-5:]), default=recent.high)
                    if target <= entry:
                        target = entry + (entry - stop) * _min_rr()
                    sfp_detail = {"status": "CANDIDATE", "pattern": "Bullish SFP", "swept_level": pl,
                                  **self._pattern_gate(state, "Bullish SFP", "LONG", entry, stop, target, compute_features(state),
                                                     {"sweep": True, "close_back_inside": True, "entry": entry, "stop": stop, "target": target})}
                else:
                    sfp_detail["reason"] = "Low swept the prior swing low, but the candle did not close back above it."
            else:
                sfp_detail["reason"] = "No confirmed sweep of the latest 15m swing high/low."
            result["setups"]["SFP"] = sfp_detail

        # D-Line diagnostics
        if len(cs) < 18 or len(state.candles_60) < 12:
            result["setups"]["D-Line"] = {
                "status": "WAITING",
                "reason": f"Need 18 confirmed 15m and 12 confirmed 1h candles; have {len(cs)} and {len([c for c in state.candles_60 if c.confirmed])}.",
            }
        else:
            f = compute_features(state)
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
                result["setups"]["D-Line"] = {
                    "status": "WAITING",
                    "reason": "No qualifying rising-low or falling-high D-Line geometry.",
                }
            else:
                direction, p1, p2 = candidates[-1]
                touches = 0
                start = max(0, p1[0] - 4)
                for i, c in enumerate(cs[start:p2[0] + 5], start=start):
                    lv = line_value(p1, p2, i)
                    tol = max(1.0, abs(lv) * 0.0015)
                    if abs(c.low - lv) <= tol or abs(c.high - lv) <= tol:
                        touches += 1
                projected = line_value(p1, p2, len(cs) - 1)
                structural = {
                    "direction": direction,
                    "touches": touches,
                    "required_touches": int(RULES["dline"]["preferred_touches"]),
                    "projected_line": projected,
                }
                if touches < int(RULES["dline"]["preferred_touches"]):
                    structural["status"] = "WAITING"
                    structural["reason"] = f"Only {touches} qualifying touches; need {int(RULES['dline']['preferred_touches'])}."
                    result["setups"]["D-Line"] = structural
                else:
                    last = cs[-1]
                    if direction == "LONG":
                        confirmed = last.close > projected and last.open <= projected
                        entry, stop, target = last.close, min(c.low for c in cs[-5:]) * 0.9995, last.close + (last.close - min(c.low for c in cs[-5:]) * 0.9995) * _min_rr()
                    else:
                        confirmed = last.close < projected and last.open >= projected
                        entry, stop, target = last.close, max(c.high for c in cs[-5:]) * 1.0005, last.close - (max(c.high for c in cs[-5:]) * 1.0005 - last.close) * _min_rr()
                    if not confirmed:
                        structural["status"] = "WAITING"
                        structural["reason"] = "D-Line geometry exists, but there is no confirmed 15m body close through the projected line."
                        result["setups"]["D-Line"] = structural
                    else:
                        result["setups"]["D-Line"] = self._pattern_gate(
                            state, "D-Line Breakout", direction, entry, stop, target, f,
                            {**structural, "body_close_confirmation": True, "entry": entry, "stop": stop, "target": target},
                        )

        # MSS diagnostics
        if len(cs) < 12:
            result["setups"]["MSS"] = {
                "status": "WAITING",
                "reason": f"Need 12 confirmed 15m candles; have {len(cs)}.",
            }
        else:
            f = compute_features(state)
            mss = {"status": "WAITING"}
            confirmed = False
            if highs and last and last.close > highs[-1][1] and last.open <= highs[-1][1]:
                level = highs[-1][1]
                entry = last.close
                stop = min(c.low for c in cs[-4:]) * 0.9995
                target = entry + (entry - stop) * _min_rr()
                mss = self._pattern_gate(state, "MSS Continuation", "LONG", entry, stop, target, f,
                                         {"structure_level": level, "body_close": True, "entry": entry, "stop": stop, "target": target})
                confirmed = True
            elif lows and last and last.close < lows[-1][1] and last.open >= lows[-1][1]:
                level = lows[-1][1]
                entry = last.close
                stop = max(c.high for c in cs[-4:]) * 1.0005
                target = entry - (stop - entry) * _min_rr()
                mss = self._pattern_gate(state, "MSS Continuation", "SHORT", entry, stop, target, f,
                                         {"structure_level": level, "body_close": True, "entry": entry, "stop": stop, "target": target})
                confirmed = True
            if not confirmed:
                mss["reason"] = "No confirmed 15m body close through the latest structure level."
            result["setups"]["MSS"] = mss

        waits = []
        for name, detail in result["setups"].items():
            if detail.get("status") in {"WAITING", "REJECTED"}:
                reasons = detail.get("rejection_reasons") or [detail.get("reason", "No qualifying setup")]
                waits.append(f"{name}: " + "; ".join(reasons))
            elif detail.get("status") == "CANDIDATE":
                waits.append(f"{name}: candidate awaiting quality gates")
        result["wait_reason"] = " | ".join(waits) if waits else "At least one setup passed all diagnostic gates."
        result["signal_state"] = self.signal_status
        result["active_signal"] = self.active_signal
        return result

    def _update_signal_lifecycle(self, state: MarketState):
        if not self.active_signal or state.last_price is None or self.signal_status != "ACTIVE":
            return
        stop = float(self.active_signal["stop"])
        target = float(self.active_signal["target2"])
        direction = self.active_signal["direction"]
        if direction == "LONG":
            if state.last_price <= stop:
                self.signal_status = "INVALIDATED"
            elif state.last_price >= target:
                self.signal_status = "TARGET_REACHED"
        else:
            if state.last_price >= stop:
                self.signal_status = "INVALIDATED"
            elif state.last_price <= target:
                self.signal_status = "TARGET_REACHED"
        self.active_signal["lifecycle"] = self.signal_status
        self.active_signal["last_price_seen"] = state.last_price

    def evaluate(self, state: MarketState) -> Optional[Signal]:
        self.last_evaluated_ts = int(time.time() * 1000)
        self._update_signal_lifecycle(state)
        self.last_diagnostics = self.diagnostics(state)
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
        self.active_signal = signal.to_dict()
        self.active_signal["lifecycle"] = "ACTIVE"
        self.active_signal["created_ts"] = self.last_evaluated_ts
        self.signal_status = "ACTIVE"
        self.signal_history.insert(0, {
            "id": signal.id,
            "direction": signal.direction,
            "setup": signal.setup,
            "entry": signal.entry,
            "stop": signal.stop,
            "target2": signal.target2,
            "rr": signal.rr,
            "confidence": signal.confidence,
            "grade": signal.grade,
            "created_ts": self.last_evaluated_ts,
            "status": "ACTIVE",
        })
        self.signal_history = self.signal_history[:25]
        self.last_diagnostics["signal_state"] = self.signal_status
        self.last_diagnostics["active_signal"] = self.active_signal
        self.last_diagnostics["signal_history"] = self.signal_history
        return signal
