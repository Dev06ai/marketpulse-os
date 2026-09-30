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
    return float(os.getenv("MIN_CONFIDENCE", str(RULES.get("scan", {}).get("min_confidence", 0.44))))

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
    atr = f.atr_15 or 0.0
    if atr <= 0:
        return True
    low = float(RULES.get("scan", {}).get("risk_atr_min", 0.08))
    high = float(RULES.get("scan", {}).get("risk_atr_max", 3.0))
    return low * atr <= risk <= high * atr


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
            "trend_240": f.trend_240,
            "market_structure": f.market_structure,
            "fvg_direction": f.fvg_direction,
            "order_block_direction": f.order_block_direction,
            "golden_pocket": f.golden_pocket,
            "weekly_open": f.weekly_open,
            "previous_week_high": f.previous_week_high,
            "previous_week_low": f.previous_week_low,
        },
        timeframe=timeframe,
    )


def detect_sfp(state: MarketState) -> Optional[Signal]:
    cs = [c for c in state.candles_15 if c.confirmed]
    fast = [c for c in state.candles_5 if c.confirmed]
    source = fast if len(fast) >= 12 else cs
    if len(source) < 10 or state.last_price is None:
        return None
    f = compute_features(state)
    recent = source[-1]
    highs, lows = pivots(source[:-1], 2)
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
            timeframe="5m" if source is fast else "15m",
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
            timeframe="5m" if source is fast else "15m",
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
    if len(cs) < int(RULES.get("mss", {}).get("minimum_confirmed_candles", 8)) or state.last_price is None:
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
        self.last_lifecycle_event: dict | None = None
        self.setup_memories: list[dict] = []
        self.position_management: dict | None = None
        self.last_diagnostics: dict = {"status": "STARTING", "wait_reason": "Engine has not evaluated market data yet.", "blocked_by": [], "setups": {}, "signal_state": "NONE"}
        self.opportunity_radar_state: list[dict] = []
        self.scenario_tree_state: list[dict] = []
        self.liquidity_map_state: dict = {"above": [], "below": []}
        self.multi_tf_story: str = "Waiting for multi-timeframe data."

    def set_setup_memories(self, memories: list[dict] | None):
        self.setup_memories = list(memories or [])[:200]

    def _find_memory_match(self, signal: Signal, state: MarketState) -> dict | None:
        if state.last_price is None:
            return None
        price = float(state.last_price)
        f = compute_features(state)
        direction = signal.direction.upper()
        signal_setup = signal.setup.upper()

        best = None
        best_score = -1e9
        for raw in self.setup_memories:
            if not isinstance(raw, dict) or raw.get("active") is False:
                continue
            interval = str(raw.get("interval") or "ALL").upper()
            if interval not in {"ALL", signal.timeframe.upper()}:
                continue
            mem_direction = str(raw.get("direction") or "BOTH").upper()
            if mem_direction not in {"BOTH", direction}:
                continue

            low = raw.get("zoneLow", raw.get("zone_low"))
            high = raw.get("zoneHigh", raw.get("zone_high"))
            in_zone = True
            if low is not None and high is not None:
                try:
                    lo, hi = sorted((float(low), float(high)))
                    in_zone = lo <= price <= hi
                except (TypeError, ValueError):
                    in_zone = False
            if not in_zone:
                continue

            setup_key = str(raw.get("setupKey", raw.get("setup_key", "GENERIC"))).upper()
            patterns = [str(x).upper() for x in (raw.get("triggerPatterns", raw.get("trigger_patterns")) or [])]
            setup_match = setup_key == "GENERIC" or setup_key in signal_setup or signal_setup in setup_key
            pattern_match = any(p and (p in signal_setup or p in " ".join(signal.thesis).upper()) for p in patterns)
            if not (setup_match or pattern_match):
                continue

            required = raw.get("requiredEvidence", raw.get("required_evidence")) or {}
            evidence_ok = True
            for key, expected in required.items():
                if key == "regime" and str(f.regime).upper() != str(expected).upper():
                    evidence_ok = False
                elif key == "market_structure" and str(f.market_structure).upper() != str(expected).upper():
                    evidence_ok = False
                elif key == "cvd_price_divergence" and str(f.cvd_price_divergence).upper() != str(expected).upper():
                    evidence_ok = False
            if not evidence_ok:
                continue

            score = float(raw.get("priority") or 1)
            if setup_match:
                score += 3
            if pattern_match:
                score += 2
            if best is None or score > best_score:
                best_score = score
                best = {
                    "id": raw.get("id"),
                    "title": raw.get("title", setup_key),
                    "setup_key": setup_key,
                    "direction": mem_direction,
                    "interval": interval,
                    "zone_low": low,
                    "zone_high": high,
                    "priority": raw.get("priority", 1),
                    "source_type": raw.get("sourceType", raw.get("source_type", "manual")),
                    "notes": raw.get("notes", ""),
                    "score": round(score, 3),
                }
        return best

    def _apply_memory_context(self, signal: Signal, state: MarketState):
        match = self._find_memory_match(signal, state)
        if not match:
            return None
        bonus = min(0.07, 0.025 + 0.008 * float(match.get("priority") or 1))
        signal.confidence = min(0.99, signal.confidence + bonus)
        if signal.rr >= float(RULES["risk"].get("elite_min_rr", 3.0)) and signal.confidence >= float(RULES.get("signal", {}).get("elite_confidence", 0.70)):
            signal.grade = "A"
        signal.evidence["memory_match"] = match
        signal.thesis.append(f"Human setup memory matched at the mapped zone: {match.get('title', match.get('setup_key', 'saved setup'))}.")
        signal.thesis.append("Memory is advisory: existing live risk/data/setup gates still apply.")
        return match
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

    def setup_watch(self, state: MarketState) -> list[dict]:
        if state.last_price is None:
            return []
        price = float(state.last_price)
        watched = []
        for raw in self.setup_memories:
            if not isinstance(raw, dict) or raw.get("active") is False:
                continue
            low = raw.get("zoneLow", raw.get("zone_low"))
            high = raw.get("zoneHigh", raw.get("zone_high"))
            if low is None or high is None:
                continue
            try:
                lo, hi = sorted((float(low), float(high)))
            except (TypeError, ValueError):
                continue
            if price < lo:
                edge_distance_pct = (lo - price) / max(price, 1.0) * 100.0
                state_name = "APPROACHING" if edge_distance_pct <= 0.35 else "BELOW"
            elif price > hi:
                edge_distance_pct = (price - hi) / max(price, 1.0) * 100.0
                state_name = "APPROACHING" if edge_distance_pct <= 0.35 else "ABOVE"
            else:
                state_name = "AT_ZONE"
                edge_distance_pct = 0.0
            watched.append({
                "id": raw.get("id"),
                "title": raw.get("title", raw.get("setupKey", "saved setup")),
                "direction": raw.get("direction", "BOTH"),
                "zone_low": lo,
                "zone_high": hi,
                "state": state_name,
                "distance_pct": round(edge_distance_pct, 3),
                "priority": raw.get("priority", 1),
                "trigger_patterns": raw.get("triggerPatterns", raw.get("trigger_patterns", [])),
            })
        watched.sort(key=lambda x: (0 if x["state"] == "AT_ZONE" else 1, -float(x.get("priority") or 1), float(x.get("distance_pct") or 0)))
        return watched[:30]

    def _direction_evidence(self, direction: str, f: MarketFeatures, memory_match: dict | None = None) -> tuple[int, list[str]]:
        direction = direction.upper()
        score = 0
        reasons: list[str] = []
        if (direction == "LONG" and f.trend_15 == "UP") or (direction == "SHORT" and f.trend_15 == "DOWN"):
            score += 1; reasons.append("15m trend aligns")
        if (direction == "LONG" and f.trend_60 == "UP") or (direction == "SHORT" and f.trend_60 == "DOWN"):
            score += 1; reasons.append("1h trend aligns")
        if (direction == "LONG" and f.trend_240 == "UP") or (direction == "SHORT" and f.trend_240 == "DOWN"):
            score += 1; reasons.append("4h trend aligns")
        if (direction == "LONG" and str(f.market_structure).upper() == "BULLISH") or (direction == "SHORT" and str(f.market_structure).upper() == "BEARISH"):
            score += 1; reasons.append("market structure aligns")
        if (direction == "LONG" and f.cvd_price_divergence == "BULLISH") or (direction == "SHORT" and f.cvd_price_divergence == "BEARISH"):
            score += 1; reasons.append("CVD divergence aligns")
        if (direction == "LONG" and f.book_imbalance > 0.08) or (direction == "SHORT" and f.book_imbalance < -0.08):
            score += 1; reasons.append("orderbook pressure aligns")
        if direction == "LONG" and f.oi_change_5m_pct > 0.15 and f.price_impulse > 0:
            score += 1; reasons.append("price + OI supports continuation")
        elif direction == "SHORT" and f.oi_change_5m_pct > 0.15 and f.price_impulse < 0:
            score += 1; reasons.append("price + OI supports continuation")
        elif f.liquidation_pressure == ("LONG_LIQUIDATIONS" if direction == "LONG" else "SHORT_LIQUIDATIONS"):
            score += 1; reasons.append("directional liquidation pressure")
        if memory_match:
            score += 1; reasons.append("saved setup memory is nearby")
        return min(score, 8), reasons

    def _nearest_memory(self, state: MarketState, direction: str | None = None, max_distance_pct: float = 0.75) -> dict | None:
        if state.last_price is None:
            return None
        price = float(state.last_price)
        direction = direction.upper() if direction else None
        best = None
        best_dist = 1e9
        for raw in self.setup_memories:
            if not isinstance(raw, dict) or raw.get("active") is False:
                continue
            mem_dir = str(raw.get("direction") or "BOTH").upper()
            if direction and mem_dir not in {"BOTH", direction}:
                continue
            low = raw.get("zoneLow", raw.get("zone_low"))
            high = raw.get("zoneHigh", raw.get("zone_high"))
            if low is None or high is None:
                continue
            try:
                lo, hi = sorted((float(low), float(high)))
            except (TypeError, ValueError):
                continue
            dist = 0.0 if lo <= price <= hi else (lo - price if price < lo else price - hi)
            dist_pct = dist / max(price, 1.0) * 100.0
            if dist_pct <= max_distance_pct and dist_pct < best_dist:
                best_dist = dist_pct
                best = {
                    "id": raw.get("id"),
                    "title": raw.get("title", raw.get("setupKey", "saved setup")),
                    "direction": mem_dir,
                    "zone_low": lo,
                    "zone_high": hi,
                    "distance_pct": round(dist_pct, 3),
                    "priority": raw.get("priority", 1),
                    "trigger_patterns": raw.get("triggerPatterns", raw.get("trigger_patterns", [])),
                    "source_type": raw.get("sourceType", raw.get("source_type", "manual")),
                }
        return best

    def _build_multi_tf_story(self, f: MarketFeatures) -> str:
        parts = []
        parts.append(f"4H {f.trend_240.lower()}")
        parts.append(f"1H {f.trend_60.lower()}")
        parts.append(f"15m {f.trend_15.lower()}")
        if f.trend_60 == f.trend_240 and f.trend_60 in {"UP", "DOWN"}:
            parts.append(f"higher timeframes are aligned {f.trend_60.lower()}")
        elif f.trend_15 != "UNKNOWN" and f.trend_60 != "UNKNOWN" and f.trend_15 != f.trend_60:
            parts.append("15m is moving against the 1H, suggesting a pullback or early reversal")
        if f.market_structure != "UNKNOWN":
            parts.append(f"15m structure is {f.market_structure.lower()}")
        return "; ".join(parts) + "."

    def _build_liquidity_map(self, state: MarketState, f: MarketFeatures) -> dict:
        if state.last_price is None:
            return {"above": [], "below": []}
        price = float(state.last_price)
        levels: list[dict] = []
        candidates = [
            ("recent 15m high", f.liquidity_high),
            ("recent 15m low", f.liquidity_low),
            ("previous day high", f.previous_day_high),
            ("previous day low", f.previous_day_low),
            ("previous week high", f.previous_week_high),
            ("previous week low", f.previous_week_low),
            ("weekly open", f.weekly_open),
        ]
        for title, level in candidates:
            if level is not None and float(level) > 0:
                side = "above" if float(level) > price else "below"
                levels.append({"title": title, "price": round(float(level), 2), "side": side, "distance_pct": round(abs(float(level) - price) / price * 100.0, 3)})
        for raw in self.setup_memories:
            if not isinstance(raw, dict) or raw.get("active") is False:
                continue
            low = raw.get("zoneLow", raw.get("zone_low"))
            high = raw.get("zoneHigh", raw.get("zone_high"))
            if low is None or high is None:
                continue
            try:
                lo, hi = sorted((float(low), float(high)))
            except (TypeError, ValueError):
                continue
            if lo > price:
                levels.append({"title": raw.get("title", "saved zone"), "price": round(lo, 2), "side": "above", "distance_pct": round((lo-price)/price*100.0,3)})
            elif hi < price:
                levels.append({"title": raw.get("title", "saved zone"), "price": round(hi, 2), "side": "below", "distance_pct": round((price-hi)/price*100.0,3)})
        out = {"above": [], "below": []}
        for side in ("above", "below"):
            unique = {}
            for row in sorted((x for x in levels if x["side"] == side), key=lambda x: x["distance_pct"]):
                unique[(row["title"], row["price"])] = row
            out[side] = list(unique.values())[:5]
        return out

    def _build_opportunity_radar(self, state: MarketState, f: MarketFeatures) -> list[dict]:
        radar = []
        for direction in ("LONG", "SHORT"):
            memory = self._nearest_memory(state, direction, 0.75)
            score, reasons = self._direction_evidence(direction, f, memory)
            pattern_bonus = 0
            setup = "Opportunity watch"
            last_15 = [c for c in state.candles_15 if c.confirmed]
            if last_15:
                last = last_15[-1]
                highs, lows = pivots(last_15[:-1], 2) if len(last_15) >= 5 else ([], [])
                if direction == "LONG" and lows and last.low < lows[-1][1] and last.close > lows[-1][1]:
                    pattern_bonus = 2; setup = "Bullish SFP developing"
                elif direction == "SHORT" and highs and last.high > highs[-1][1] and last.close < highs[-1][1]:
                    pattern_bonus = 2; setup = "Bearish SFP developing"
                elif direction == "LONG" and f.trend_15 == "UP" and f.market_structure == "BULLISH":
                    setup = "Bullish continuation developing"
                elif direction == "SHORT" and f.trend_15 == "DOWN" and f.market_structure == "BEARISH":
                    setup = "Bearish continuation developing"
            total = min(8, score + pattern_bonus)
            tier = "EARLY" if total >= 2 else "WATCH"
            if total >= 4:
                tier = "DEVELOPING"
            if total >= 6:
                tier = "CONFIRMED"
            radar.append({
                "direction": direction,
                "tier": tier,
                "score": total,
                "max_score": 8,
                "setup": setup,
                "reasons": reasons[:5],
                "memory": memory,
                "action": ("watch for confirmation" if tier in {"WATCH","EARLY"} else "setup is actively developing"),
            })
        radar.sort(key=lambda x: (-x["score"], 0 if x["tier"] == "CONFIRMED" else 1))
        return radar

    def _build_scenarios(self, state: MarketState, f: MarketFeatures, radar: list[dict]) -> list[dict]:
        long = next(x for x in radar if x["direction"] == "LONG")
        short = next(x for x in radar if x["direction"] == "SHORT")
        scenarios = []
        scenarios.append({
            "name": "Bullish continuation / reversal",
            "direction": "LONG",
            "state": "ACTIVE" if long["score"] >= short["score"] + 2 else "WATCH",
            "evidence": long["score"],
            "trigger": "reclaim/sweep-and-hold + bullish structure/CVD",
            "invalidation": "loss of the nearest mapped long support or clear bearish acceptance",
        })
        scenarios.append({
            "name": "Bearish continuation / reversal",
            "direction": "SHORT",
            "state": "ACTIVE" if short["score"] >= long["score"] + 2 else "WATCH",
            "evidence": short["score"],
            "trigger": "rejection/SFP + bearish structure/CVD",
            "invalidation": "reclaim of the nearest mapped short resistance",
        })
        scenarios.append({
            "name": "Range / two-sided rotation",
            "direction": "BOTH",
            "state": "ACTIVE" if f.regime == "RANGE" or abs(long["score"] - short["score"]) <= 1 else "WATCH",
            "evidence": round(max(0, 8 - abs(long["score"] - short["score"]) * 2), 2),
            "trigger": "sweep one side of a range and rotate back",
            "invalidation": "clean acceptance outside the range",
        })
        return scenarios

    def diagnostics(self, state: MarketState) -> dict:
        cs = [c for c in state.candles_15 if c.confirmed]
        highs, lows = pivots(cs[:-1], 2) if len(cs) >= 5 else ([], [])
        last = cs[-1] if cs else None
        f0 = compute_features(state)
        radar = self._build_opportunity_radar(state, f0) if state.last_price is not None else []
        scenarios = self._build_scenarios(state, f0, radar) if radar else []
        self.opportunity_radar_state = radar
        self.scenario_tree_state = scenarios
        self.liquidity_map_state = self._build_liquidity_map(state, f0)
        self.multi_tf_story = self._build_multi_tf_story(f0)
        radar_top = radar[0] if radar else None
        result = {
            "status": "SCANNING" if state.data_health == "HEALTHY" else ("DEGRADED_SCANNING" if state.data_health == "DEGRADED" else "CONNECTING"),
            "wait_reason": "" if state.data_health == "HEALTHY" else "Opportunity radar remains active while the live feed recovers.",
            "blocked_by": ["data_health"] if state.data_health not in {"HEALTHY", "DEGRADED"} else [],
            "setups": {},
            "min_rr": _min_rr(),
            "min_confidence": _min_confidence(),
            "manual_execution_only": True,
            "confirmed_15m_candles": len(cs),
            "confirmed_1h_candles": len([c for c in state.candles_60 if c.confirmed]),
            "signal_state": self.signal_status,
            "active_signal": self.active_signal,
            "setup_watch": self.setup_watch(state),
            "opportunity_radar": radar,
            "scenario_tree": scenarios,
            "liquidity_map": self.liquidity_map_state,
            "multi_timeframe_story": self.multi_tf_story,
            "radar_lead": radar_top,
            "data_quality": state.data_health,
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
        if state.data_health == "DEGRADED":
            waits.insert(0, "Primary feed unavailable: using secondary market data; microstructure freshness is reduced.")
        result["wait_reason"] = " | ".join(waits) if waits else "At least one setup passed all diagnostic gates."
        result["signal_state"] = self.signal_status
        result["active_signal"] = self.active_signal
        return result


    def _build_position_management(self, previous: dict | None, new_signal: Signal, state: MarketState) -> dict | None:
        if not previous or previous.get("direction") == new_signal.direction or self.signal_status != "ACTIVE":
            return None
        try:
            prev_entry = float(previous.get("entry"))
            prev_stop = float(previous.get("stop"))
            current = float(state.last_price)
        except (TypeError, ValueError):
            return None

        prev_dir = str(previous.get("direction", "")).upper()
        risk = abs(prev_entry - prev_stop)
        pnl = (current - prev_entry) if prev_dir == "LONG" else (prev_entry - current)
        pnl_r = (pnl / risk) if risk > 0 else 0.0

        f = compute_features(state)
        memory = (new_signal.evidence or {}).get("memory_match")
        reasons: list[str] = []

        if new_signal.setup:
            reasons.append(f"New {new_signal.setup} signal confirmed.")
        if new_signal.direction == "SHORT":
            if f.trend_60 == "DOWN":
                reasons.append("1h trend has bearish alignment.")
            if f.trend_240 == "DOWN":
                reasons.append("4h trend also supports the short.")
            if str(f.market_structure).upper() in {"BEARISH", "DOWN", "LOWER_HIGHS", "LOWER_LOW"}:
                reasons.append("Market structure is shifting bearish.")
            if f.cvd_price_divergence == "BEARISH":
                reasons.append("Bearish price/CVD divergence supports the reversal.")
            if f.book_imbalance < -0.12:
                reasons.append("Order-book imbalance favors sellers.")
            if f.liquidation_pressure == "SHORT_LIQUIDATIONS":
                reasons.append("Short-side liquidation pressure is present.")
        else:
            if f.trend_60 == "UP":
                reasons.append("1h trend has bullish alignment.")
            if f.trend_240 == "UP":
                reasons.append("4h trend also supports the long.")
            if str(f.market_structure).upper() in {"BULLISH", "UP", "HIGHER_HIGHS", "HIGHER_LOW"}:
                reasons.append("Market structure is shifting bullish.")
            if f.cvd_price_divergence == "BULLISH":
                reasons.append("Bullish price/CVD divergence supports the reversal.")
            if f.book_imbalance > 0.12:
                reasons.append("Order-book imbalance favors buyers.")
            if f.liquidation_pressure == "LONG_LIQUIDATIONS":
                reasons.append("Long-side liquidation pressure is present.")

        if memory:
            reasons.append(f"Saved human setup memory matches: {memory.get('title', memory.get('setup_key', 'mapped setup'))}.")

        strength = 1
        if (new_signal.direction == "SHORT" and f.trend_60 == "DOWN") or (new_signal.direction == "LONG" and f.trend_60 == "UP"):
            strength += 1
        if (new_signal.direction == "SHORT" and f.trend_240 == "DOWN") or (new_signal.direction == "LONG" and f.trend_240 == "UP"):
            strength += 1
        if (new_signal.direction == "SHORT" and str(f.market_structure).upper() in {"BEARISH","DOWN","LOWER_HIGHS","LOWER_LOW"}) or (new_signal.direction == "LONG" and str(f.market_structure).upper() in {"BULLISH","UP","HIGHER_HIGHS","HIGHER_LOW"}):
            strength += 1
        if (new_signal.direction == "SHORT" and f.cvd_price_divergence == "BEARISH") or (new_signal.direction == "LONG" and f.cvd_price_divergence == "BULLISH"):
            strength += 1
        if (new_signal.direction == "SHORT" and f.book_imbalance < -0.12) or (new_signal.direction == "LONG" and f.book_imbalance > 0.12):
            strength += 1
        if memory:
            strength += 1

        status = "STRONG_REVERSAL" if strength >= 4 else ("REVERSAL" if strength >= 2 else "EARLY_REVERSAL")
        action = (
            f"Close/secure the existing {prev_dir} before taking the new {new_signal.direction}."
            if strength >= 2
            else f"Do not blindly flip; reassess the existing {prev_dir} while the new {new_signal.direction} develops."
        )
        reason_text = reasons[:5]

        return {
            "type": "POSITION_REVERSAL",
            "status": status,
            "strength_score": strength,
            "from_direction": prev_dir,
            "to_direction": new_signal.direction,
            "from_signal_id": previous.get("id"),
            "to_signal_id": new_signal.id,
            "previous_entry": prev_entry,
            "current_price": current,
            "open_pnl_r": round(pnl_r, 3),
            "open_pnl_direction": "PROFIT" if pnl_r > 0 else ("LOSS" if pnl_r < 0 else "FLAT"),
            "action": action,
            "reason": " ".join(reason_text) if reason_text else "A new opposite-direction setup has been confirmed.",
            "reasons": reason_text,
            "why_new_trade": f"The new {new_signal.direction} setup is being supported by {strength} independent reversal/context confirmations, not direction alone.",
            "manual_execution_only": True,
            "note": "Advisory position management only. The bot does not place or close exchange orders automatically.",
        }

    def _update_signal_lifecycle(self, state: MarketState):
        self.last_lifecycle_event = None
        if not self.active_signal or state.last_price is None or self.signal_status != "ACTIVE":
            return
        stop = float(self.active_signal["stop"])
        target = float(self.active_signal["target2"])
        direction = self.active_signal["direction"]
        previous = self.signal_status
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

        if self.signal_status != previous:
            result_r = 1.0 if self.signal_status == "TARGET_REACHED" else -1.0
            signal_snapshot = dict(self.active_signal)
            self.last_lifecycle_event = {
                "signal": signal_snapshot,
                "outcome": self.signal_status,
                "result_r": result_r,
            }
            for row in self.signal_history:
                if row.get("id") == self.active_signal.get("id"):
                    row["status"] = self.signal_status
                    row["resolved_ts"] = int(time.time() * 1000)
                    row["result_r"] = result_r
                    break

    def evaluate(self, state: MarketState) -> Optional[Signal]:
        self.last_evaluated_ts = int(time.time() * 1000)
        self.position_management = None
        self._update_signal_lifecycle(state)
        self.last_diagnostics = self.diagnostics(state)
        # Keep loose mode active on the secondary REST feed. Candle-based setups
        # can still be evaluated with reduced microstructure freshness rather than
        # freezing the bot until the primary WebSocket is perfect.
        if state.data_health not in {"HEALTHY", "DEGRADED"}:
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
        self._apply_memory_context(signal, state)
        previous_signal = dict(self.active_signal) if self.active_signal else None
        self.position_management = self._build_position_management(previous_signal, signal, state)
        if self.position_management:
            signal.evidence["position_management"] = self.position_management
            signal.thesis.append(self.position_management["action"])
            signal.thesis.append("Reversal reason: " + self.position_management["why_new_trade"])
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
