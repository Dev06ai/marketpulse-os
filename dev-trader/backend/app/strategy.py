from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
import os
import time

from .analytics import MarketFeatures, compute_features
from .models import Candle, MarketState
from .knowledge import RULES, MARKET_KNOWLEDGE, knowledge_summary
from .learning import AdaptiveLearning


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
    trade_style: str
    style_reason: str

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

def _quality_rules() -> dict:
    return dict((RULES.get("signal_policy", {}).get("quality_governor", {}) or {}))

def _quality_max_daily() -> int:
    return max(1, int(os.getenv(
        "MAX_DAILY_SIGNALS",
        str(_quality_rules().get("max_signals_per_utc_day", 3)),
    )))

def _quality_cooldown_ms() -> int:
    minutes = float(os.getenv(
        "SIGNAL_COOLDOWN_MINUTES",
        str(_quality_rules().get("cooldown_minutes_after_resolution", 120)),
    ))
    return max(0, int(minutes * 60_000))

def _quality_min_confidence() -> float:
    return float(os.getenv(
        "QUALITY_MIN_CONFIDENCE",
        str(_quality_rules().get("min_confidence", 0.70)),
    ))

def _quality_min_rr() -> float:
    return float(os.getenv(
        "QUALITY_MIN_RR",
        str(_quality_rules().get("min_rr", 3.0)),
    ))


def _trade_style(direction: str, setup: str, timeframe: str, f: MarketFeatures) -> tuple[str, str]:
    """Classify the setup before choosing stop/targets.

    SCALP = fast 5m/15m reaction or mixed higher-timeframe context.
    SWING = 15m setup with aligned 1h and 4h context, or a broader continuation.
    """
    setup_upper = str(setup).upper()
    tf = str(timeframe).lower()
    if "FAST" in setup_upper or tf == "5m":
        return "SCALP", "Fast 5m/15m reaction setup; targets are built from intraday ATR."
    if (
        tf in {"15m", "1h"}
        and ((direction == "LONG" and f.trend_60 == "UP" and f.trend_240 == "UP")
             or (direction == "SHORT" and f.trend_60 == "DOWN" and f.trend_240 == "DOWN"))
        and f.market_structure in {"BULLISH", "BEARISH"}
    ):
        return "SWING", "Higher-timeframe trend and structure align; targets use a wider swing plan."
    return "SCALP", "Intraday setup without full higher-timeframe alignment; targets use the scalp plan."


def _trade_plan(
    *,
    direction: str,
    setup: str,
    timeframe: str,
    entry: float,
    raw_stop: float,
    raw_target: float,
    f: MarketFeatures,
) -> tuple[float, float, float, str, str, float]:
    """Build a structurally anchored but non-microscopic stop/target plan.

    The stop is never tightened past the supplied invalidation anchor. When a
    raw stop is too close, it is widened using ATR so ordinary BTC noise is less
    likely to hit it immediately. TP1/TP2 are volatility-aware and bounded so a
    distant historical level cannot create an unrealistic 10R+ target.
    """
    style, style_reason = _trade_style(direction, setup, timeframe, f)
    atr = max(float(f.atr_15 or 0.0), abs(entry) * 0.0005)
    anchor_risk = abs(entry - raw_stop)

    if style == "SWING":
        min_risk = max(atr * 1.00, abs(entry) * 0.0010)
        tp1_rr = 1.60
        tp2_rr = 3.50
        max_rr = 5.00
    else:
        min_risk = max(atr * 0.65, abs(entry) * 0.0007)
        tp1_rr = 1.40
        tp2_rr = 3.00
        max_rr = 3.50

    risk = max(anchor_risk, min_risk)
    if direction == "LONG":
        stop = min(raw_stop, entry - risk)
        risk = entry - stop
        tp1 = entry + risk * tp1_rr
        structural_distance = abs(raw_target - entry)
        target_distance = min(max(structural_distance, risk * tp2_rr), risk * max_rr)
        tp2 = entry + target_distance
    else:
        stop = max(raw_stop, entry + risk)
        risk = stop - entry
        tp1 = entry - risk * tp1_rr
        structural_distance = abs(raw_target - entry)
        target_distance = min(max(structural_distance, risk * tp2_rr), risk * max_rr)
        tp2 = entry - target_distance

    # Do not permit the planner to reduce risk below its volatility floor.
    if risk <= 0:
        risk = min_risk
        stop = entry - risk if direction == "LONG" else entry + risk
        tp1 = entry + risk * tp1_rr if direction == "LONG" else entry - risk * tp1_rr
        tp2 = entry + risk * tp2_rr if direction == "LONG" else entry - risk * tp2_rr

    return stop, tp1, tp2, style, style_reason, risk



def _score(direction: str, setup: str, f: MarketFeatures) -> tuple[float, list[str]]:
    score = 0.58
    reasons = [f"{setup} structure confirmed"]
    if str(setup).upper().startswith("MOMENTUM CAPTURE"):
        # Fast-move candidates are only allowed into the live engine when the
        # detector already found strong displacement/flow. Give this path a
        # higher base confidence, while the dedicated quality gate below still
        # enforces its own momentum-specific safeguards.
        score = 0.74
        reasons.append("dedicated fast-move detector triggered")

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

    wave_align = f.elliott_direction == ("LONG" if direction == "LONG" else "SHORT")
    wave_strong = f.elliott_confidence >= float(RULES.get("signal_policy", {}).get("quality_governor", {}).get("elliott_min_confidence", 0.55))
    if wave_align and wave_strong:
        score += 0.08
        reasons.append(f"Elliott Wave context aligns ({f.elliott_phase}, {f.elliott_wave})")
    elif f.elliott_direction not in {"NEUTRAL", "UNKNOWN"} and not wave_align and f.elliott_confidence >= 0.65:
        score -= 0.06
        reasons.append("Elliott Wave context is strongly counter-directional")


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
    stop, target1, target2, trade_style, style_reason, risk_distance = _trade_plan(
        direction=direction,
        setup=setup,
        timeframe=timeframe,
        entry=entry,
        raw_stop=stop,
        raw_target=target,
        f=f,
    )
    gate = _gate_details(direction, setup, entry, stop, target2, f)
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
        target1=target1,
        target2=target2,
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
            "elliott_phase": f.elliott_phase,
            "elliott_direction": f.elliott_direction,
            "elliott_wave": f.elliott_wave,
            "elliott_confidence": round(f.elliott_confidence, 3),
            "elliott_reason": f.elliott_reason,
            "elliott_1h_phase": f.elliott_60_phase,
            "elliott_1h_direction": f.elliott_60_direction,
            "elliott_1h_confidence": round(f.elliott_60_confidence, 3),
            "elliott_1h_reason": f.elliott_60_reason,
            "weekly_open": f.weekly_open,
            "previous_week_high": f.previous_week_high,
            "previous_week_low": f.previous_week_low,
            "trade_style": trade_style,
            "style_reason": style_reason,
            "risk_distance": round(risk_distance, 4),
            "risk_pct_of_price": round((risk_distance / entry * 100.0) if entry else 0.0, 4),
            "atr_15_multiple": round((risk_distance / f.atr_15) if f.atr_15 else 0.0, 3),
        },
        timeframe=timeframe,
        trade_style=trade_style,
        style_reason=style_reason,
    )


def detect_sfp(state: MarketState) -> Optional[Signal]:
    """Detect SFPs intrabar so fast reversals are not delayed until candle close.

    Confirmed candles establish the reference swing. The currently forming 5m
    candle (when available) supplies the live sweep/reclaim state. This keeps
    the confirmed strategy intact while allowing an early manual-execution
    signal when price has already swept and reclaimed liquidity.
    """
    confirmed_5 = [c for c in state.candles_5 if c.confirmed]
    confirmed_15 = [c for c in state.candles_15 if c.confirmed]
    forming_5 = state.candles_5[-1] if state.candles_5 and not state.candles_5[-1].confirmed else None

    if len(confirmed_5) >= 12:
        source = confirmed_5
        timeframe = "5m"
        live = forming_5
    else:
        source = confirmed_15
        timeframe = "15m"
        live = state.candles_15[-1] if state.candles_15 and not state.candles_15[-1].confirmed else None

    if len(source) < 10 or state.last_price is None:
        return None

    f = compute_features(state)
    highs, lows = pivots(source, 2)
    ph = highs[-1][1] if highs else None
    pl = lows[-1][1] if lows else None
    min_rr = float(RULES["risk"]["preferred_min_rr"])

    if live is not None:
        # The exchange ticker is the execution price; the forming candle is
        # only used for its live high/low/open and start timestamp.
        current_high = max(float(live.high), float(state.last_price))
        current_low = min(float(live.low), float(state.last_price))
        current_close = float(state.last_price)
        current_start = live.start
        current_end = live.end
    else:
        recent = source[-1]
        current_high = recent.high
        current_low = recent.low
        current_close = recent.close
        current_start = recent.start
        current_end = recent.end

    if ph is not None and current_high > ph and current_close < ph:
        entry = current_close
        stop = current_high * 1.0005
        target = min((x[1] for x in lows[-5:]), default=current_low)
        if target >= entry:
            target = entry - (stop - entry) * min_rr
        return _signal(
            id=f"sfp-short-{timeframe}-{current_start}-{int(ph)}",
            direction="SHORT",
            setup="Bearish SFP • FAST",
            entry=entry,
            stop=stop,
            target=target,
            timeframe=timeframe,
            invalidation=f"{timeframe} close above swept high {current_high:.2f}",
            f=f,
            thesis=[
                f"Live sweep above prior swing high {ph:.2f}",
                "Price is back below the swept level before candle close",
                "Stop anchored at the live sweep wick extreme",
            ],
        )

    if pl is not None and current_low < pl and current_close > pl:
        entry = current_close
        stop = current_low * 0.9995
        target = max((x[1] for x in highs[-5:]), default=current_high)
        if target <= entry:
            target = entry + (entry - stop) * min_rr
        return _signal(
            id=f"sfp-long-{timeframe}-{current_start}-{int(pl)}",
            direction="LONG",
            setup="Bullish SFP • FAST",
            entry=entry,
            stop=stop,
            target=target,
            timeframe=timeframe,
            invalidation=f"{timeframe} close below swept low {current_low:.2f}",
            f=f,
            thesis=[
                f"Live sweep below prior swing low {pl:.2f}",
                "Price is back above the swept level before candle close",
                "Stop anchored at the live sweep wick extreme",
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
    def __init__(self, learning: AdaptiveLearning | None = None):
        self.learning = learning or AdaptiveLearning()
        self.last_signal_id = None
        self.active_signal = None
        self.signal_status = "NONE"
        self.signal_history: list[dict] = []
        self.last_evaluated_ts = 0
        self.last_lifecycle_event: dict | None = None
        self.last_lifecycle_events: list[dict] = []
        self.setup_memories: list[dict] = []
        self.position_management: dict | None = None
        self.last_diagnostics: dict = {"status": "STARTING", "wait_reason": "Engine has not evaluated market data yet.", "blocked_by": [], "setups": {}, "signal_state": "NONE"}
        self.opportunity_radar_state: list[dict] = []
        self.scenario_tree_state: list[dict] = []
        self.liquidity_map_state: dict = {"above": [], "below": []}
        self.multi_tf_story: str = "Waiting for multi-timeframe data."
        self.signal_day_utc = datetime.now(timezone.utc).date().isoformat()
        self.daily_signal_count = 0
        self.last_resolved_ts = 0
        self.governor_lock_reason = ""
        self.governor_last_quality_rejection = ""
        self._rehydrate_signal_governor()

    def _rotate_governor_day(self):
        today = datetime.now(timezone.utc).date().isoformat()
        if today != self.signal_day_utc:
            self.signal_day_utc = today
            self.daily_signal_count = 0
            self.governor_lock_reason = ""

    def _rehydrate_signal_governor(self):
        """Restore the daily quota, cooldown, and active-signal lock after restart."""
        self._rotate_governor_day()
        try:
            trades = list(self.learning.recent_trades())
        except Exception:
            trades = []
        active = None
        daily = 0
        last_resolved = 0
        now = int(time.time() * 1000)
        day = self.signal_day_utc
        for row in trades:
            opened = int(row.get("opened_ts") or 0)
            resolved = int(row.get("resolved_ts") or 0)
            if opened:
                opened_day = datetime.fromtimestamp(opened / 1000, tz=timezone.utc).date().isoformat()
                if opened_day == day:
                    daily += 1
            if resolved:
                last_resolved = max(last_resolved, resolved)
            if str(row.get("status") or "").upper() == "ACTIVE" and opened:
                active = row
        self.daily_signal_count = min(daily, _quality_max_daily())
        self.last_resolved_ts = last_resolved
        if active:
            self.active_signal = {
                "id": active.get("id"),
                "direction": active.get("direction"),
                "setup": active.get("setup"),
                "entry": active.get("entry"),
                "stop": active.get("stop"),
                "target1": active.get("target1"),
                "target2": active.get("target2"),
                "rr": active.get("rr"),
                "timeframe": active.get("timeframe"),
                "created_ts": active.get("opened_ts"),
                "lifecycle": "ACTIVE",
                "lifecycle_stage": "ACTIVE",
            }
            self.signal_status = "ACTIVE"
            self.last_signal_id = active.get("id")
            self.governor_lock_reason = "An unresolved signal is still active."
        else:
            self.active_signal = None
            self.signal_status = "NONE"

    def rehydrate_remote_history(self, rows: list[dict] | None):
        """Merge durable remote trade history into daily-cap and cooldown state."""
        self._rotate_governor_day()
        rows = list(rows or [])
        daily = 0
        last_resolved = self.last_resolved_ts
        today = self.signal_day_utc
        for row in rows[:250]:
            try:
                opened = int(row.get("opened_ts") or row.get("created_ts") or 0)
            except (TypeError, ValueError):
                opened = 0
            if opened:
                try:
                    opened_day = datetime.fromtimestamp(opened / 1000, tz=timezone.utc).date().isoformat()
                except (ValueError, OSError, OverflowError):
                    opened_day = ""
                if opened_day == today:
                    daily += 1
            try:
                resolved = int(row.get("resolved_ts") or 0)
            except (TypeError, ValueError):
                resolved = 0
            last_resolved = max(last_resolved, resolved)
        self.daily_signal_count = max(self.daily_signal_count, min(daily, _quality_max_daily()))
        self.last_resolved_ts = max(self.last_resolved_ts, last_resolved)

    def restore_external_active_signal(self, row: dict | None):
        """Lock the engine to a durable open prediction after a backend restart."""
        if not isinstance(row, dict):
            return
        if self.signal_status == "ACTIVE" and self.active_signal:
            return
        direction = str(row.get("direction") or row.get("side") or "").upper()
        if direction not in {"LONG", "SHORT"}:
            return
        try:
            entry = float(row.get("entry"))
            stop = float(row.get("stop"))
            target = float(row.get("target2", row.get("target")))
        except (TypeError, ValueError):
            return
        signal_id = str(row.get("id") or row.get("signal_id") or "")
        if not signal_id:
            return
        self.active_signal = {
            "id": signal_id,
            "direction": direction,
            "setup": row.get("setup") or "Persisted open signal",
            "entry": entry,
            "stop": stop,
            "target1": target,
            "target2": target,
            "rr": float(row.get("rr") or 0.0),
            "confidence": float(row.get("confidence") or 0.0),
            "grade": row.get("grade") or "A",
            "timeframe": row.get("timeframe") or "15m",
            "trade_style": row.get("trade_style") or "SCALP",
            "created_ts": int(row.get("opened_ts") or row.get("created_ts") or time.time() * 1000),
            "lifecycle": "ACTIVE",
            "lifecycle_stage": "ACTIVE",
        }
        self.last_signal_id = signal_id
        self.signal_status = "ACTIVE"
        self.governor_lock_reason = "ACTIVE: durable open signal recovered after restart."

    def governor_status(self) -> dict:
        self._rotate_governor_day()
        now = int(time.time() * 1000)
        cooldown_left = max(0, _quality_cooldown_ms() - (now - self.last_resolved_ts)) if self.last_resolved_ts else 0
        active_lock = self.signal_status == "ACTIVE" and bool(self.active_signal)
        return {
            "enabled": bool(_quality_rules().get("enabled", True)),
            "elliott_knowledge": knowledge_summary(),
            "mode": "ELITE_QUALITY",
            "daily_count": self.daily_signal_count,
            "daily_max": _quality_max_daily(),
            "cooldown_minutes": round(_quality_cooldown_ms() / 60_000),
            "cooldown_remaining_ms": cooldown_left,
            "active_signal_lock": active_lock,
            "lock_reason": self.governor_lock_reason,
            "last_quality_rejection": self.governor_last_quality_rejection,
            "min_confidence": _quality_min_confidence(),
            "min_rr": _quality_min_rr(),
        }

    def _governor_allows_new_signal(self) -> bool:
        self._rotate_governor_day()
        cfg = _quality_rules()
        if not bool(cfg.get("enabled", True)):
            self.governor_lock_reason = ""
            return True
        if self.signal_status == "ACTIVE" and self.active_signal:
            self.governor_lock_reason = "WAITING: current signal must resolve at TP2 or SL before another signal is issued."
            return False
        if self.daily_signal_count >= _quality_max_daily():
            self.governor_lock_reason = f"DAILY CAP: {self.daily_signal_count}/{_quality_max_daily()} quality signals used."
            return False
        if self.last_resolved_ts:
            cooldown_left = _quality_cooldown_ms() - (int(time.time() * 1000) - self.last_resolved_ts)
            if cooldown_left > 0:
                minutes = max(1, round(cooldown_left / 60_000))
                self.governor_lock_reason = f"COOLDOWN: wait about {minutes} more minute(s) after the last resolved signal."
                return False
        self.governor_lock_reason = ""
        return True

    def _quality_gate(self, signal: Signal, state: MarketState) -> tuple[bool, str]:
        cfg = _quality_rules()
        if not bool(cfg.get("enabled", True)):
            return True, ""
        f = compute_features(state)
        momentum_exception = str(signal.setup).upper().startswith("MOMENTUM CAPTURE")
        momentum_ctx = self._build_fast_move_context(state, f) if momentum_exception else None
        if momentum_exception and (not momentum_ctx or momentum_ctx.get("status") != "TRIGGERED"):
            return False, "momentum trigger is no longer active"
        reasons = []
        momentum_min_conf = float(cfg.get("momentum_min_confidence", 0.74))
        min_conf_required = momentum_min_conf if momentum_exception else _quality_min_confidence()
        if signal.confidence < min_conf_required:
            reasons.append(f"confidence {signal.confidence:.0%} < {min_conf_required:.0%}")
        if signal.rr < _quality_min_rr():
            reasons.append(f"R:R {signal.rr:.2f} < {_quality_min_rr():.2f}")
        if bool(cfg.get("require_grade_a", True)) and signal.grade != "A":
            reasons.append("grade is not A")
        direction = signal.direction.upper()
        if bool(cfg.get("require_1h_alignment", True)) and not momentum_exception:
            aligned = (direction == "LONG" and f.trend_60 == "UP") or (direction == "SHORT" and f.trend_60 == "DOWN")
            if not aligned:
                reasons.append("1h trend is not aligned")
        if bool(cfg.get("require_4h_alignment", True)) and not momentum_exception:
            aligned = (direction == "LONG" and f.trend_240 == "UP") or (direction == "SHORT" and f.trend_240 == "DOWN")
            if not aligned:
                reasons.append("4h trend is not aligned")
        if bool(cfg.get("require_structure_alignment", True)) and not momentum_exception:
            aligned = (
                (direction == "LONG" and str(f.market_structure).upper() in {"BULLISH","UP","HIGHER_HIGHS","HIGHER_LOW"})
                or
                (direction == "SHORT" and str(f.market_structure).upper() in {"BEARISH","DOWN","LOWER_HIGHS","LOWER_LOW"})
            )
            if not aligned:
                reasons.append("market structure is not aligned")
        if bool(cfg.get("block_high_vol", True)) and f.regime == "HIGH_VOL" and not momentum_exception:
            reasons.append("high-volatility regime")
        if bool(cfg.get("block_range_non_sfp", True)) and f.regime == "RANGE" and "SFP" not in signal.setup.upper() and not momentum_exception:
            reasons.append("range regime: only SFP setups are eligible")
        max_spread = float(cfg.get("max_spread_bps", 5.0))
        if f.spread_bps > max_spread:
            reasons.append(f"spread {f.spread_bps:.2f} bps > {max_spread:.2f} bps")
        confirmations = 0
        wave_threshold = float(cfg.get("elliott_min_confidence", 0.55))
        if (
            f.elliott_direction == direction
            and f.elliott_confidence >= wave_threshold
            and f.elliott_60_direction in {"NEUTRAL", direction}
            and f.elliott_60_confidence >= 0.40
        ):
            confirmations += 1
        if (direction == "LONG" and f.cvd_price_divergence == "BULLISH") or (direction == "SHORT" and f.cvd_price_divergence == "BEARISH"):
            confirmations += 1
        if (direction == "LONG" and f.book_imbalance > 0.12) or (direction == "SHORT" and f.book_imbalance < -0.12):
            confirmations += 1
        if f.fvg_direction == ("BULLISH" if direction == "LONG" else "BEARISH"):
            confirmations += 1
        if f.order_block_direction == ("BULLISH" if direction == "LONG" else "BEARISH"):
            confirmations += 1
        if f.golden_pocket == ("LONG_ZONE" if direction == "LONG" else "SHORT_ZONE"):
            confirmations += 1
        required = max(
            0,
            int(cfg.get("momentum_min_confirmations", 2)) if momentum_exception
            else int(cfg.get("minimum_extra_confirmations", 2))
        )
        if momentum_exception:
            # The fast detector itself counts as one confirmation; the live
            # microstructure context must still provide at least one additional
            # directional confirmation.
            confirmations += 2
        if confirmations < required:
            reasons.append(f"only {confirmations} extra confirmations; need {required}")
        if reasons:
            return False, "; ".join(reasons)
        return True, ""


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

    def _apply_learning_context(self, signal: Signal, state: MarketState):
        context = self.learning.context(signal.to_dict())
        signal.evidence["adaptive_learning"] = context
        delta = float(context.get("confidence_delta") or 0.0)
        if delta:
            signal.confidence = max(0.0, min(0.99, signal.confidence + delta))
            if signal.rr >= float(RULES["risk"].get("elite_min_rr", 3.0)) and signal.confidence >= float(RULES.get("signal", {}).get("elite_confidence", 0.70)):
                signal.grade = "A"
        favorable = context.get("favorable_conditions") or []
        caution = context.get("caution_conditions") or []
        if favorable:
            signal.thesis.append("Adaptive learning: historically favorable context — " + ", ".join(x["tag"] for x in favorable[:2]) + ".")
        if caution:
            signal.thesis.append("Adaptive learning caution: weak historical context — " + ", ".join(x["tag"] for x in caution[:2]) + ".")
        signal.thesis.append("Learning is advisory and bounded; risk gates and manual execution remain unchanged.")

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

    def _build_market_story(
        self,
        state: MarketState,
        f: MarketFeatures,
        radar: list[dict],
        sfp_hunter: dict,
        breakout_watch: dict,
        setups: dict[str, dict],
    ) -> dict:
        """Build an auditable market narrative from structure and confluence."""
        direction_scores = {
            "LONG": next((int(x.get("score", 0)) for x in radar if x.get("direction") == "LONG"), 0),
            "SHORT": next((int(x.get("score", 0)) for x in radar if x.get("direction") == "SHORT"), 0),
        }

        if f.trend_240 == "UP" and f.trend_60 == "UP" and f.market_structure == "BULLISH":
            bias = "BULLISH"
        elif f.trend_240 == "DOWN" and f.trend_60 == "DOWN" and f.market_structure == "BEARISH":
            bias = "BEARISH"
        elif direction_scores["LONG"] >= direction_scores["SHORT"] + 2:
            bias = "LEAN_LONG"
        elif direction_scores["SHORT"] >= direction_scores["LONG"] + 2:
            bias = "LEAN_SHORT"
        else:
            bias = "BALANCED"

        narrative = [
            f"4H trend is {f.trend_240.lower()} and 1H trend is {f.trend_60.lower()}",
            f"15m structure is {f.market_structure.lower()} with 15m trend {f.trend_15.lower()}",
            f"15m Elliott context is {f.elliott_phase.lower().replace('_', ' ')} / {f.elliott_wave.lower()} / {f.elliott_direction.lower()} at {f.elliott_confidence:.0%} confidence",
            f"1H Elliott context is {f.elliott_60_phase.lower().replace('_', ' ')} / {f.elliott_60_direction.lower()} at {f.elliott_60_confidence:.0%} confidence",
        ]

        if f.trend_15 != f.trend_60 and f.trend_15 not in {"UNKNOWN", "RANGE"} and f.trend_60 not in {"UNKNOWN", "RANGE"}:
            narrative.append("15m is moving against the 1H, so treat the move as a pullback/reversal candidate rather than automatic continuation.")

        if f.cvd_price_divergence != "NONE":
            narrative.append(f"CVD/price context is {f.cvd_price_divergence.lower()}.")
        if abs(f.oi_change_15m_pct) >= 0.25:
            narrative.append(f"15m open interest changed {f.oi_change_15m_pct:+.2f}% and is included as positioning context.")
        if f.fvg_direction != "NONE":
            narrative.append(f"Recent FVG is {f.fvg_direction.lower()}.")
        if f.order_block_direction != "NONE":
            narrative.append(f"Recent order block is {f.order_block_direction.lower()}.")

        trigger_candidates: list[str] = []
        if sfp_hunter.get("status") == "TRIGGERED":
            trigger_candidates.append(f"{sfp_hunter.get('pattern', 'SFP')} at {sfp_hunter.get('target_level', 'liquidity level')}")
        if breakout_watch.get("status") == "BREAKOUT":
            trigger_candidates.append(str(breakout_watch.get("event", "breakout")))
        for name in ("SFP", "D-Line", "MSS"):
            detail = setups.get(name) or {}
            if detail.get("status") == "VALIDATED":
                trigger_candidates.append(f"{name} validated")
            elif detail.get("status") == "CANDIDATE":
                trigger_candidates.append(f"{name} candidate")

        if trigger_candidates:
            narrative.append("Current trigger map: " + " • ".join(trigger_candidates[:4]))
        else:
            narrative.append("No confirmed price-action trigger is active; the engine is waiting for one.")

        governor = self.governor_status()
        active = self.active_signal if self.signal_status == "ACTIVE" else None
        if active:
            no_trade_reason = "An active signal is unresolved; no opposite-direction signal is permitted."
        elif governor.get("daily_count", 0) >= governor.get("daily_max", 3):
            no_trade_reason = "Daily elite-signal quota has been reached; WAIT."
        elif governor.get("cooldown_remaining_ms", 0) > 0:
            no_trade_reason = "Post-trade quality cooldown is active; WAIT for a new independent setup."
        elif bias == "BALANCED":
            no_trade_reason = "Directional evidence is balanced; wait for structural confirmation."
        elif f.elliott_phase == "RANGE_OR_AMBIGUOUS" and abs(direction_scores["LONG"] - direction_scores["SHORT"]) < 2:
            no_trade_reason = "Elliott count is ambiguous and directional evidence is not decisive; do not force a wave count."
        else:
            no_trade_reason = "WAIT unless a candidate clears every live quality gate."

        summary = (
            f"MARKET STORY: {bias}. "
            + " → ".join([
                f"4H {f.trend_240.lower()}",
                f"1H {f.trend_60.lower()}",
                f"15m {f.trend_15.lower()}",
                f"{f.market_structure.lower()} structure",
            ])
            + f". Elliott: {f.elliott_phase.lower().replace('_', ' ')}"
            + (f" with {f.elliott_direction.lower()} context." if f.elliott_direction not in {"NEUTRAL", "UNKNOWN"} else ".")
        )

        return {
            "bias": bias,
            "summary": summary,
            "narrative": narrative,
            "wave_context": {
                "15m": {
                    "phase": f.elliott_phase,
                    "wave": f.elliott_wave,
                    "direction": f.elliott_direction,
                    "confidence": round(f.elliott_confidence, 3),
                    "reason": f.elliott_reason,
                },
                "1h": {
                    "phase": f.elliott_60_phase,
                    "direction": f.elliott_60_direction,
                    "confidence": round(f.elliott_60_confidence, 3),
                    "reason": f.elliott_60_reason,
                },
            },
            "trade_map": {
                "LONG": {
                    "status": "STRONGER_CONTEXT" if direction_scores["LONG"] >= direction_scores["SHORT"] + 2 else "WATCH",
                    "trigger": "Bullish SFP/reclaim, validated D-Line/MSS, or accepted breakout with supporting confluence.",
                    "invalidation": "Loss of structural support/swept low or clear bearish acceptance.",
                },
                "SHORT": {
                    "status": "STRONGER_CONTEXT" if direction_scores["SHORT"] >= direction_scores["LONG"] + 2 else "WATCH",
                    "trigger": "Bearish SFP/rejection, validated D-Line/MSS, or accepted breakout with supporting confluence.",
                    "invalidation": "Reclaim of structural resistance/swept high or clear bullish acceptance.",
                },
            },
            "trigger_map": trigger_candidates[:5],
            "primary_scenario": "LONG" if direction_scores["LONG"] >= direction_scores["SHORT"] else "SHORT",
            "long_score": direction_scores["LONG"],
            "short_score": direction_scores["SHORT"],
            "no_trade_reason": no_trade_reason,
            "active_signal_lock": bool(active),
            "governor": governor,
        }

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

    def _build_fast_move_context(self, state: MarketState, f: MarketFeatures) -> dict:
        """Detect early, high-energy 5m BTC moves before a 15m candle closes.

        This is intentionally an early-warning layer. It does not by itself
        guarantee a trade; it feeds a stricter momentum signal path and a
        notification so the user can react before a large move is mature.
        """
        cs = [c for c in state.candles_5 if c.confirmed]
        forming = state.candles_5[-1] if state.candles_5 and not state.candles_5[-1].confirmed else None
        if len(cs) < 14 or state.last_price is None:
            return {
                "status": "WATCH",
                "direction": "NONE",
                "score": 0.0,
                "reason": "Waiting for enough 5m structure.",
            }

        sample = cs[-13:]
        tr_values = []
        prev = sample[0].open
        for c in sample:
            tr_values.append(max(c.high - c.low, abs(c.high - prev), abs(c.low - prev)))
            prev = c.close
        atr5 = sum(tr_values[-12:]) / max(1, len(tr_values[-12:]))
        if atr5 <= 0:
            return {"status": "WATCH", "direction": "NONE", "score": 0.0, "reason": "5m ATR unavailable."}

        # Use the recent 15-minute window rather than a 30-minute anchor so
        # sudden 5m expansions are recognized early instead of only after most
        # of the move has already happened.
        reference = cs[-4].close
        price = float(state.last_price)
        move = price - float(reference)
        move_atr = abs(move) / atr5

        avg_volume = sum(max(0.0, c.volume) for c in cs[-13:-1]) / 12.0
        current_volume = float(forming.volume if forming is not None else cs[-1].volume)
        volume_ratio = current_volume / avg_volume if avg_volume > 0 else 1.0

        prior = cs[-4:-1]
        recent_high = max((c.high for c in prior), default=price)
        recent_low = min((c.low for c in prior), default=price)
        hi = max(price, float(forming.high)) if forming is not None else float(cs[-1].high)
        lo = min(price, float(forming.low)) if forming is not None else float(cs[-1].low)
        bullish_break = hi > recent_high and move > 0
        bearish_break = lo < recent_low and move < 0

        live_open = float(forming.open) if forming is not None else float(cs[-1].open)
        live_hi = float(forming.high) if forming is not None else float(cs[-1].high)
        live_lo = float(forming.low) if forming is not None else float(cs[-1].low)
        live_close = price
        body_fraction = abs(live_close - live_open) / max(live_hi - live_lo, 1e-9)
        bullish_acceptance = (
            (forming is None and float(cs[-1].close) > recent_high)
            or (forming is not None and price > recent_high and body_fraction >= 0.55)
        )
        bearish_acceptance = (
            (forming is None and float(cs[-1].close) < recent_low)
            or (forming is not None and price < recent_low and body_fraction >= 0.55)
        )
        bullish_break = bullish_acceptance and move > 0
        bearish_break = bearish_acceptance and move < 0
        direction = "LONG" if bullish_break else "SHORT" if bearish_break else ("LONG" if move > 0 else "SHORT")
        if move_atr < 1.10:
            return {
                "status": "WATCH",
                "direction": direction,
                "score": round(move_atr / 1.10 * 0.25, 3),
                "move_atr": round(move_atr, 3),
                "volume_ratio": round(volume_ratio, 2),
                "recent_high": round(recent_high, 2),
                "recent_low": round(recent_low, 2),
                "reason": "5m displacement is not yet large enough.",
            }

        score = 0.0
        reasons = [f"5m displacement {move_atr:.2f} ATR"]
        if move_atr >= 1.35:
            score += 0.25
            reasons.append("fast directional expansion")
        if move_atr >= 1.80:
            score += 0.10
        if volume_ratio >= 1.25:
            score += 0.20
            reasons.append(f"volume {volume_ratio:.1f}x baseline")
        if volume_ratio >= 1.75:
            score += 0.05
        if bullish_break or bearish_break:
            score += 0.25
            reasons.append("5m range/structure break")
        if direction == "LONG":
            if f.oi_change_5m_pct > 0.10:
                score += 0.10
                reasons.append("OI expansion supports long continuation")
            if f.book_imbalance > 0.08:
                score += 0.05
                reasons.append("orderbook supports buyers")
            if f.liquidation_pressure == "LONG_LIQUIDATIONS":
                score += 0.05
            if f.cvd_impulse > 0:
                score += 0.05
                reasons.append("CVD impulse is positive")
        else:
            if f.oi_change_5m_pct > 0.10:
                score += 0.10
                reasons.append("OI expansion supports short continuation")
            if f.book_imbalance < -0.08:
                score += 0.05
                reasons.append("orderbook supports sellers")
            if f.liquidation_pressure == "SHORT_LIQUIDATIONS":
                score += 0.05
            if f.cvd_impulse < 0:
                score += 0.05
                reasons.append("CVD impulse is negative")

        score = min(1.0, score)
        if move_atr > 3.00:
            return {
                "status": "EXTENDED",
                "direction": direction,
                "score": round(score, 3),
                "move_atr": round(move_atr, 3),
                "volume_ratio": round(volume_ratio, 2),
                "recent_high": round(recent_high, 2),
                "recent_low": round(recent_low, 2),
                "reasons": reasons[:6],
                "reason": "Move is already extended; do not chase the impulse. Wait for pullback/retest.",
            }

        flow_confirmation = (
            (direction == "LONG" and (f.cvd_impulse > 0 or f.book_imbalance > 0.08 or f.oi_change_5m_pct > 0.10))
            or
            (direction == "SHORT" and (f.cvd_impulse < 0 or f.book_imbalance < -0.08 or f.oi_change_5m_pct > 0.10))
        )
        status = "TRIGGERED" if (
            score >= 0.70
            and move_atr >= 1.35
            and (bullish_break or bearish_break)
            and (volume_ratio >= 1.25 or flow_confirmation)
        ) else ("ARMED" if score >= 0.45 else "WATCH")
        return {
            "status": status,
            "direction": direction,
            "score": round(score, 3),
            "move_atr": round(move_atr, 3),
            "volume_ratio": round(volume_ratio, 2),
            "recent_high": round(recent_high, 2),
            "recent_low": round(recent_low, 2),
            "atr5": round(atr5, 4),
            "reasons": reasons[:6],
            "reason": (
                "Fast move trigger: notify and evaluate an early momentum setup."
                if status == "TRIGGERED"
                else "Momentum is building; watch for structure confirmation."
            ),
        }

    def _momentum_signal(self, state: MarketState, f: MarketFeatures) -> Optional[Signal]:
        ctx = self._build_fast_move_context(state, f)
        if ctx.get("status") != "TRIGGERED" or state.last_price is None:
            return None

        # Notify early through the radar, but never chase a mature impulse.
        # A trade candidate must come from the first expansion or a clean retest.
        if float(ctx.get("move_atr") or 0.0) > 3.00:
            return None

        direction = str(ctx.get("direction") or "").upper()
        if direction not in {"LONG", "SHORT"}:
            return None

        entry = float(state.last_price)
        atr5 = float(ctx.get("atr5") or 0.0)
        if atr5 <= 0:
            return None

        recent_high = float(ctx.get("recent_high") or entry)
        recent_low = float(ctx.get("recent_low") or entry)
        buffer = max(atr5 * 0.35, entry * 0.00035)
        if direction == "LONG":
            raw_stop = recent_low - buffer
            raw_target = entry + max((entry - raw_stop) * 3.20, atr5 * 4.0)
            invalidation = f"5m momentum invalid if price accepts back below {raw_stop:.2f}."
        else:
            raw_stop = recent_high + buffer
            raw_target = entry - max((raw_stop - entry) * 3.20, atr5 * 4.0)
            invalidation = f"5m momentum invalid if price accepts back above {raw_stop:.2f}."

        return _signal(
            id=f"momentum-fast-{direction}-{int((state.last_kline_5_ts or int(time.time()*1000))//300000)}",
            direction=direction,
            setup="Momentum Capture • FAST",
            entry=entry,
            stop=raw_stop,
            target=raw_target,
            timeframe="5m",
            invalidation=invalidation,
            f=f,
            thesis=[
                "Early momentum-capture path triggered before the 15m candle fully confirms.",
                f"5m displacement is {float(ctx.get('move_atr', 0.0)):.2f} ATR with {float(ctx.get('volume_ratio', 1.0)):.2f}x volume.",
                *list(ctx.get("reasons") or [])[:4],
            ],
        )

    def _build_opportunity_radar(self, state: MarketState, f: MarketFeatures) -> list[dict]:
        radar = []
        fast_move = self._build_fast_move_context(state, f)
        confirmed_5 = [c for c in state.candles_5 if c.confirmed]
        confirmed_15 = [c for c in state.candles_15 if c.confirmed]
        forming_5 = state.candles_5[-1] if state.candles_5 and not state.candles_5[-1].confirmed else None
        for direction in ("LONG", "SHORT"):
            memory = self._nearest_memory(state, direction, 0.75)
            score, reasons = self._direction_evidence(direction, f, memory)
            pattern_bonus = 0
            setup = "Opportunity watch"

            source = confirmed_5 if len(confirmed_5) >= 12 else confirmed_15
            forming = forming_5 if source is confirmed_5 else (
                state.candles_15[-1] if state.candles_15 and not state.candles_15[-1].confirmed else None
            )
            if len(source) >= 10:
                highs, lows = pivots(source, 2)
                ph = highs[-1][1] if highs else None
                pl = lows[-1][1] if lows else None
                live_price = float(state.last_price) if state.last_price is not None else None
                hi = max(float(forming.high), live_price) if forming is not None and live_price is not None else (forming.high if forming is not None else None)
                lo = min(float(forming.low), live_price) if forming is not None and live_price is not None else (forming.low if forming is not None else None)
                close = live_price if forming is not None and live_price is not None else (forming.close if forming is not None else (source[-1].close if source else None))

                if direction == "LONG" and pl is not None and lo is not None and close is not None and lo < pl and close > pl:
                    pattern_bonus = 3
                    setup = "Bullish SFP • FAST"
                    reasons = [f"live sweep below {pl:.2f} and reclaim", *reasons]
                elif direction == "SHORT" and ph is not None and hi is not None and close is not None and hi > ph and close < ph:
                    pattern_bonus = 3
                    setup = "Bearish SFP • FAST"
                    reasons = [f"live sweep above {ph:.2f} and reclaim", *reasons]
                elif direction == "LONG" and f.trend_15 == "UP" and f.market_structure == "BULLISH":
                    setup = "Bullish continuation developing"
                elif direction == "SHORT" and f.trend_15 == "DOWN" and f.market_structure == "BEARISH":
                    setup = "Bearish continuation developing"

            if fast_move.get("status") in {"ARMED", "TRIGGERED"} and fast_move.get("direction") == direction:
                fast_bonus = 2 if fast_move.get("status") == "TRIGGERED" else 1
                pattern_bonus += fast_bonus
                setup = "Momentum Capture • FAST"
                reasons = [
                    f"5m momentum {fast_move.get('status').lower()}",
                    f"{float(fast_move.get('move_atr', 0.0)):.2f} ATR displacement",
                    f"{float(fast_move.get('volume_ratio', 1.0)):.1f}x volume",
                    *list(fast_move.get("reasons") or [])[:2],
                    *reasons,
                ]

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
    def _build_reference_scenarios(self, state: MarketState, f: MarketFeatures) -> list[dict]:
        """Translate reference-video concepts into dynamic watch states."""
        video_training = MARKET_KNOWLEDGE.get("video_reference_training", {}) or {}
        if state.last_price is None:
            return []

        price = float(state.last_price)

        def last_ob(candles: list[Candle]):
            cs = [c for c in candles if c.confirmed]
            if len(cs) < 5:
                return None
            for i in range(len(cs) - 2, max(-1, len(cs) - 9), -1):
                base, nxt = cs[i], cs[i + 1]
                if nxt.close > base.high and nxt.close > nxt.open:
                    return ("BULLISH", (base.open + base.close) / 2.0)
                if nxt.close < base.low and nxt.close < nxt.open:
                    return ("BEARISH", (base.open + base.close) / 2.0)
            return None

        ob15 = last_ob(state.candles_15)
        ob1h = last_ob(state.candles_60)
        confirmed15 = [c for c in state.candles_15 if c.confirmed]
        recent_high = max((c.high for c in confirmed15[-20:]), default=None)
        recent_low = min((c.low for c in confirmed15[-20:]), default=None)

        upper = (ob15[1] if ob15 else None) or recent_high
        lower = (ob1h[1] if ob1h else None) or recent_low
        daily_low = f.previous_day_low
        daily_high = f.previous_day_high

        def near(level, pct=0.45):
            return level is not None and abs(price - float(level)) / max(price, 1.0) * 100 <= pct

        def converging_structure(candles: list[Candle]) -> dict:
            cs = [c for c in candles if c.confirmed]
            if len(cs) < 20:
                return {"status": "WATCH", "upper": None, "lower": None, "width_pct": None, "reason": "Not enough pivots."}
            highs, lows = pivots(cs, 2)
            if len(highs) < 2 or len(lows) < 2:
                return {"status": "WATCH", "upper": None, "lower": None, "width_pct": None, "reason": "Need two clear highs and lows."}

            h1_idx, h1 = highs[-2]
            h2_idx, h2 = highs[-1]
            l1_idx, l1 = lows[-2]
            l2_idx, l2 = lows[-1]
            h_slope = (float(h2) - float(h1)) / max(1, h2_idx - h1_idx)
            l_slope = (float(l2) - float(l1)) / max(1, l2_idx - l1_idx)

            last_idx = len(cs) - 1
            upper_proj = float(h2) + h_slope * max(0, last_idx - h2_idx)
            lower_proj = float(l2) + l_slope * max(0, last_idx - l2_idx)
            if upper_proj <= lower_proj:
                return {"status": "WATCH", "upper": upper_proj, "lower": lower_proj, "width_pct": None, "reason": "Projected boundaries crossed."}

            width_pct = (upper_proj - lower_proj) / max(price, 1.0) * 100
            converging = h_slope < 0 and l_slope > 0
            status = "WATCH"
            if converging and width_pct <= 1.20:
                status = "ARMED"
            if converging and width_pct <= 0.75:
                status = "DEVELOPING"

            edge = min(abs(price - upper_proj), abs(price - lower_proj)) / max(price, 1.0) * 100
            return {
                "status": status,
                "upper": round(upper_proj, 2),
                "lower": round(lower_proj, 2),
                "width_pct": round(width_pct, 3),
                "upper_slope": round(h_slope, 5),
                "lower_slope": round(l_slope, 5),
                "near_edge_pct": round(edge, 3),
                "reason": (
                    "Descending resistance + ascending support are converging."
                    if status != "WATCH"
                    else "Trendline compression is not sufficiently validated."
                ),
            }

        triangle = converging_structure(state.candles_5 if len(state.candles_5) >= 20 else state.candles_15)

        bearish_context = (
            f.trend_60 == "DOWN"
            or f.trend_240 == "DOWN"
            or f.elliott_phase == "IMPULSE_DOWN"
            or f.elliott_direction == "SHORT"
        )
        bullish_context = (
            f.trend_60 == "UP"
            or f.trend_240 == "UP"
            or f.elliott_phase == "IMPULSE_UP"
            or f.elliott_direction == "LONG"
        )

        scenarios = []

        # Reference 1/5/6/7: bearish local sequence with an eventual 1H/daily
        # reaction, including the possibility of a temporary Wave-2/B bounce.
        down_state = "WATCH"
        down_reason = "Waiting for rejection plus a confirmed bearish structure shift."
        if near(upper) and bearish_context:
            down_state = "ARMED"
            down_reason = "Price is near a dynamic resistance/15m-2H style zone while bearish context is present."
        if (
            f.market_structure == "BEARISH"
            and bearish_context
            and (f.elliott_phase == "IMPULSE_DOWN" or f.trend_15 == "DOWN")
        ):
            down_state = "DEVELOPING"
            down_reason = "Bearish structure and Elliott/HTF context support monitoring a 5-wave or ABC continuation."
        scenarios.append({
            "name": "Reference: bearish ABC / 5-wave continuation",
            "direction": "SHORT",
            "state": down_state,
            "setup_family": "bearish_five_wave_to_confluence",
            "reason": down_reason,
            "trigger": "15m/5m rejection at the upper zone followed by bearish MSS/SFP and acceptance below the reaction low.",
            "wave_plan": "1 displacement → 2 corrective bounce → 3 continuation → 4 corrective bounce → 5 into confluence, only if each structural rule survives.",
            "target_ladder": [x for x in [lower, daily_low] if x is not None][:3],
            "invalidation": "Acceptance above the source resistance or a Wave-2 retracement that breaks the impulse structure.",
        })

        bounce_state = "WATCH"
        bounce_reason = "Waiting for price to interact with the dynamic 1H order-block proxy."
        if near(lower):
            bounce_state = "ARMED"
            bounce_reason = "Price is at/near the dynamic 1H order-block proxy; a reaction is possible."
        if near(lower) and bullish_context and f.market_structure == "BULLISH":
            bounce_state = "DEVELOPING"
            bounce_reason = "1H-zone reaction has bullish structure support; monitor whether this is reversal or only a corrective bounce."
        scenarios.append({
            "name": "Reference: 1H OB bounce → possible Wave-2/B → continuation",
            "direction": "BOTH",
            "state": bounce_state,
            "setup_family": "one_hour_ob_bounce_then_continuation",
            "reason": bounce_reason,
            "trigger": "Lower-timeframe reclaim inside the 1H OB for the bounce; rejection at the next upper zone re-activates the bearish continuation thesis.",
            "invalidation": "Clean acceptance below the 1H OB for a bullish bounce thesis, or acceptance above the higher-degree resistance for a bearish continuation thesis.",
        })

        harmonic_state = "WATCH"
        harmonic_reason = f.harmonic_reason
        if f.harmonic_pattern != "NONE" and f.harmonic_confidence >= 0.70:
            harmonic_state = "ARMED"
        if f.harmonic_pattern != "NONE" and near(lower):
            harmonic_state = "DEVELOPING"
        scenarios.append({
            "name": "Reference: harmonic X-A-B-C-D completion",
            "direction": f.harmonic_direction if f.harmonic_direction in {"LONG", "SHORT"} else "BOTH",
            "state": harmonic_state,
            "setup_family": "harmonic_completion",
            "reason": harmonic_reason,
            "trigger": "D-point reaction + MSS/rejection + flow confirmation at the structural confluence zone.",
            "invalidation": "Price accepts beyond D-point/structural invalidation without reversal confirmation.",
            "note": "Ratio match alone stays WATCH; the bot must see price-action confirmation.",
        })

        flat_state = "WATCH"
        if f.trend_60 == "DOWN" and f.trend_15 == "UP" and near(upper):
            flat_state = "ARMED"
        if f.trend_60 == "DOWN" and f.trend_15 == "UP" and near(upper) and f.elliott_phase in {"CORRECTION_UP", "RANGE_OR_AMBIGUOUS"}:
            flat_state = "DEVELOPING"
        scenarios.append({
            "name": "Reference: flat B retest → C continuation",
            "direction": "SHORT",
            "state": flat_state,
            "setup_family": "flat_b_retest_then_c",
            "reason": "15m countertrend bounce against a weaker 1H context can represent a B-wave retest before another C-leg.",
            "trigger": "B-wave reaches prior swing/resistance, then rejects with bearish MSS/displacement.",
            "invalidation": "The B-wave accepts beyond the higher-degree invalidation level.",
        })

        triangle_state = triangle.get("status", "WATCH")
        if triangle_state == "ARMED" and triangle.get("near_edge_pct", 99.0) <= 0.45:
            triangle_state = "DEVELOPING"
        scenarios.append({
            "name": "Reference: converging trendline compression / triangle",
            "direction": "BOTH",
            "state": triangle_state,
            "setup_family": "converging_trendlines",
            "reason": triangle.get("reason", "Watching converging boundaries."),
            "upper_boundary": triangle.get("upper"),
            "lower_boundary": triangle.get("lower"),
            "width_pct": triangle.get("width_pct"),
            "trigger": "Body-close breakout beyond a validated boundary followed by displacement/retest; alternatively, SFP rejection at a boundary for a mean-reversion setup.",
            "invalidation": "Breakout that closes back inside the structure, or a boundary that loses repeated-touch validation.",
            "warning": "Do not predict the breakout direction solely from the triangle shape.",
        })

        range_state = "WATCH"
        if f.regime == "RANGE" and lower is not None and upper is not None:
            range_state = "ARMED" if (near(lower, 0.75) or near(upper, 0.75)) else "WATCH"
        scenarios.append({
            "name": "Reference: zone-to-zone range rotation",
            "direction": "BOTH",
            "state": range_state,
            "setup_family": "range_rotation_between_zones",
            "reason": "Use the upper/lower dynamic zones as range boundaries until price proves acceptance outside them.",
            "trigger": "Sweep/reclaim at the lower zone for long-side rotation or sweep/rejection at the upper zone for short-side rotation.",
            "invalidation": "Body-close acceptance outside the range plus retest confirmation.",
        })

        wave_c_state = "WATCH"
        wave_c_reason = "Waiting for a lower confluence zone and reversal confirmation."
        if lower is not None and near(lower, 0.65) and bearish_context:
            wave_c_state = "ARMED"
            wave_c_reason = "Price is approaching a dynamic 1H/daily-support cluster that can host a Wave-C or Wave-5 completion."
        if (
            lower is not None
            and near(lower, 0.50)
            and bearish_context
            and (
                f.cvd_price_divergence == "BULLISH"
                or f.market_structure == "BULLISH"
                or f.harmonic_direction == "LONG"
            )
        ):
            wave_c_state = "DEVELOPING"
            wave_c_reason = "Lower confluence is being reached with early reversal evidence; wait for bullish MSS/reclaim before promotion."
        scenarios.append({
            "name": "Video reference: Wave-C / Wave-5 confluence completion",
            "direction": "LONG",
            "state": wave_c_state,
            "setup_family": "confluence_bottom",
            "reason": wave_c_reason,
            "trigger": "Liquidity sweep or rejection in the confluence zone followed by bullish MSS, reclaim and supportive CVD/OI/order-flow context.",
            "target_ladder": [x for x in [upper, daily_high] if x is not None][:3],
            "invalidation": "Clean acceptance through the confluence zone or continuation with no reversal structure.",
            "source": "video_reference_training",
            "training_loaded": bool(video_training),
        })

        for scenario in scenarios:
            scenario["source"] = scenario.get("source", "video_reference_training")
            scenario["training_loaded"] = bool(video_training)
        return scenarios

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
        scenarios.extend(self._build_reference_scenarios(state, f))
        return scenarios

    def _build_evidence_matrix(self, f: MarketFeatures, state: MarketState) -> dict:
        def aligned(direction: str, field: str, value) -> bool:
            if field == "trend_15":
                return value == ("UP" if direction == "LONG" else "DOWN")
            if field == "trend_60":
                return value == ("UP" if direction == "LONG" else "DOWN")
            if field == "trend_240":
                return value == ("UP" if direction == "LONG" else "DOWN")
            if field == "market_structure":
                return str(value).upper() == ("BULLISH" if direction == "LONG" else "BEARISH")
            if field == "cvd":
                return value == ("BULLISH" if direction == "LONG" else "BEARISH")
            if field == "orderbook":
                return float(value) > 0.08 if direction == "LONG" else float(value) < -0.08
            if field == "memory":
                return value is not None
            return False

        matrix = {}
        for direction in ("LONG", "SHORT"):
            memory = self._nearest_memory(state, direction, 0.75)
            checks = {
                "trend_15": aligned(direction, "trend_15", f.trend_15),
                "trend_60": aligned(direction, "trend_60", f.trend_60),
                "trend_240": aligned(direction, "trend_240", f.trend_240),
                "market_structure": aligned(direction, "market_structure", f.market_structure),
                "cvd": aligned(direction, "cvd", f.cvd_price_divergence),
                "orderbook": aligned(direction, "orderbook", f.book_imbalance),
                "price_oi": (
                    f.oi_change_5m_pct > 0.15 and f.price_impulse > 0
                    if direction == "LONG"
                    else f.oi_change_5m_pct > 0.15 and f.price_impulse < 0
                ),
                "nearby_memory": aligned(direction, "memory", memory),
            }
            score = sum(1 for ok in checks.values() if ok)
            matrix[direction] = {
                "checks": checks,
                "score": score,
                "max_score": len(checks),
                "missing": [k for k, ok in checks.items() if not ok],
                "nearby_memory": memory,
            }
        return matrix

    def _build_sfp_hunter(self, state: MarketState, f: MarketFeatures) -> dict:
        cs = [c for c in state.candles_15 if c.confirmed]
        if len(cs) < 6 or state.last_price is None:
            return {"status": "BUILDING", "message": "Waiting for enough 15m structure."}
        highs, lows = pivots(cs[:-1], 2)
        price = float(state.last_price)
        recent_high = highs[-1][1] if highs else None
        recent_low = lows[-1][1] if lows else None
        candidates = []
        # Direction must match the side of price. A swing low above current
        # price is resistance, not a LONG support trigger, and vice versa.
        if recent_high and recent_high > price:
            dist = (recent_high - price) / price * 100
            candidates.append(("SHORT", "swing high", recent_high, dist))
        if recent_low and recent_low < price:
            dist = (price - recent_low) / price * 100
            candidates.append(("LONG", "swing low", recent_low, dist))
        candidates.sort(key=lambda x: x[3])
        nearest = candidates[0] if candidates else None
        if not nearest:
            return {
                "status": "REBUILDING",
                "message": "Price is outside the latest swing range; rebuilding fresh liquidity references.",
                "recent_swing_high": round(recent_high, 2) if recent_high else None,
                "recent_swing_low": round(recent_low, 2) if recent_low else None,
            }
        direction, label, level, distance = nearest
        pattern = "NONE"
        candle = cs[-1]
        if direction == "SHORT" and candle.high > level and candle.close < level:
            pattern = "BEARISH_SFP"
        elif direction == "LONG" and candle.low < level and candle.close > level:
            pattern = "BULLISH_SFP"
        memory = self._nearest_memory(state, direction, 0.75)
        if pattern != "NONE":
            status = "TRIGGERED"
        elif distance <= 0.35:
            status = "NEAR_TRIGGER"
        else:
            status = "WATCH"
        return {
            "status": status,
            "direction": direction,
            "target_level": round(level, 2),
            "distance_pct": round(distance, 3),
            "pattern": pattern,
            "setup_memory": memory,
            "cvd": f.cvd_price_divergence,
            "oi_5m_pct": round(f.oi_change_5m_pct, 3),
            "message": (
                "Sweep and reclaim detected." if pattern != "NONE"
                else "Near a liquidity swing; watch for sweep + close back through the level."
            ),
        }

    def _build_breakout_watch(self, state: MarketState, f: MarketFeatures) -> dict:
        if state.last_price is None:
            return {"status": "WAITING", "message": "Waiting for live price."}
        price = float(state.last_price)
        candidates = []
        for name, level, direction in [
            ("previous day high", f.previous_day_high, "UP"),
            ("previous day low", f.previous_day_low, "DOWN"),
            ("previous week high", f.previous_week_high, "UP"),
            ("previous week low", f.previous_week_low, "DOWN"),
            ("weekly open", f.weekly_open, "BOTH"),
        ]:
            if level is None:
                continue
            dist = abs(price - float(level)) / price * 100
            if dist <= 1.0:
                candidates.append({"name": name, "level": round(float(level), 2), "direction": direction, "distance_pct": round(dist, 3)})
        candidates.sort(key=lambda x: x["distance_pct"])
        nearest = candidates[:4]
        last = [c for c in state.candles_15 if c.confirmed][-1:] if state.candles_15 else []
        state_name = "WATCH"
        event = "NONE"
        if nearest and last:
            c = last[0]
            level = nearest[0]["level"]
            if c.close > level and c.open <= level:
                state_name, event = "BREAKOUT", "BULLISH_BREAKOUT"
            elif c.close < level and c.open >= level:
                state_name, event = "BREAKOUT", "BEARISH_BREAKOUT"
            elif abs(price - level) / price * 100 <= 0.20:
                state_name, event = "AT_LEVEL", "BREAKOUT_IMMINENT"
        return {
            "status": state_name,
            "event": event,
            "nearby_levels": nearest,
            "message": (
                "Breakout/reclaim event detected." if event != "NONE"
                else "Watching nearby daily/weekly levels for breakout or rejection."
            ),
        }

    def diagnostics(self, state: MarketState) -> dict:
        cs = [c for c in state.candles_15 if c.confirmed]
        highs, lows = pivots(cs[:-1], 2) if len(cs) >= 5 else ([], [])
        last = cs[-1] if cs else None
        f0 = compute_features(state)
        radar = self._build_opportunity_radar(state, f0) if state.last_price is not None else []
        scenarios = self._build_scenarios(state, f0, radar) if radar else []
        self.opportunity_radar_state = radar
        self.scenario_tree_state = scenarios
        learning_context = self.learning.context(self.active_signal) if self.active_signal else None
        self.liquidity_map_state = self._build_liquidity_map(state, f0)
        self.multi_tf_story = self._build_multi_tf_story(f0)
        radar_top = radar[0] if radar else None
        sfp_hunter = self._build_sfp_hunter(state, f0)
        breakout_watch = self._build_breakout_watch(state, f0)
        evidence_matrix = self._build_evidence_matrix(f0, state)
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
            "trade_governor": self.governor_status(),
            "setup_watch": self.setup_watch(state),
            "opportunity_radar": radar,
            "scenario_tree": scenarios,
            "liquidity_map": self.liquidity_map_state,
            "multi_timeframe_story": self.multi_tf_story,
            "market_story": {},
            "radar_lead": radar_top,
            "evidence_matrix": evidence_matrix,
            "sfp_hunter": sfp_hunter,
            "breakout_watch": breakout_watch,
            "fast_move": self._build_fast_move_context(state, f0),
            "evidence_matrix": evidence_matrix,
            "data_quality": state.data_health,
            "learning": self.learning.summary(),
            "learning_context": learning_context,
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
                "elliott_phase": f0.elliott_phase,
                "elliott_direction": f0.elliott_direction,
                "elliott_wave": f0.elliott_wave,
                "elliott_confidence": round(f0.elliott_confidence, 3),
                "elliott_reason": f0.elliott_reason,
                "elliott_1h_phase": f0.elliott_60_phase,
                "elliott_1h_direction": f0.elliott_60_direction,
                "elliott_1h_confidence": round(f0.elliott_60_confidence, 3),
                "elliott_1h_reason": f0.elliott_60_reason,
                "harmonic_pattern": f0.harmonic_pattern,
                "harmonic_direction": f0.harmonic_direction,
                "harmonic_confidence": round(f0.harmonic_confidence, 3),
                "harmonic_reason": f0.harmonic_reason,
                "reference_scenario_training": MARKET_KNOWLEDGE.get("reference_scenario_training", {}).get("source", "loaded"),
                "additional_reference_training": bool(MARKET_KNOWLEDGE.get("additional_reference_training")),
                "video_reference_training": bool(MARKET_KNOWLEDGE.get("video_reference_training")),
                "video_reference_lessons": len(
                    MARKET_KNOWLEDGE.get("video_reference_training", {}).get("lessons", []) or []
                ),
                "previous_day_high": f0.previous_day_high,
                "previous_day_low": f0.previous_day_low,
                "previous_week_high": f0.previous_week_high,
                "previous_week_low": f0.previous_week_low,
                "weekly_open": f0.weekly_open,
            },
            "last_evaluated_ts": self.last_evaluated_ts,
        }

        if state.data_health not in {"HEALTHY", "DEGRADED"}:
            result["wait_reason"] = "Signal evaluation is paused while the market feed reconnects."
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

        result["market_story"] = self._build_market_story(
            state, f0, radar, sfp_hunter, breakout_watch, result["setups"]
        )
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
        if strength >= 2 and pnl_r > 0.25:
            action = f"Existing {prev_dir} is in profit (+{pnl_r:.2f}R): secure/book profit, then consider the new {new_signal.direction}."
        elif strength >= 2 and pnl_r <= 0:
            action = f"Existing {prev_dir} thesis is under pressure: close/reassess it before taking the new {new_signal.direction}."
        elif strength >= 2:
            action = f"Existing {prev_dir} is near flat: secure the position and transition to the new {new_signal.direction} only if its thesis remains valid."
        else:
            action = f"Do not blindly flip; keep reassessing the existing {prev_dir} while the new {new_signal.direction} develops."
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
        self.last_lifecycle_events = []
        # In Bitget Demo execution mode, the exchange's actual TP/SL/order
        # lifecycle is authoritative. Do not resolve the signal from a local
        # price touch, or the learner could count a theoretical result before
        # the exchange position actually closes.
        if os.getenv("BITGET_DEMO_TRADING", "false").lower() in {"1", "true", "yes", "on"}:
            return
        if not self.active_signal or state.last_price is None or self.signal_status != "ACTIVE":
            return

        price = float(state.last_price)
        stop = float(self.active_signal["stop"])
        target1 = float(self.active_signal["target1"])
        target2 = float(self.active_signal["target2"])
        direction = str(self.active_signal["direction"]).upper()
        now = int(time.time() * 1000)
        events: list[dict] = []

        def emit(stage: str, event_type: str, level: float, note: str, final: bool, result_r: float = 0.0):
            event = {
                "key": f"{event_type}:{self.active_signal.get('id')}",
                "type": event_type,
                "stage": stage,
                "signal_id": self.active_signal.get("id"),
                "direction": direction,
                "setup": self.active_signal.get("setup", ""),
                "price": price,
                "level": level,
                "ts": now,
                "note": note,
                "final": final,
                "result_r": round(float(result_r), 3),
            }
            events.append(event)
            self.learning.record_event(self.active_signal, event_type, price, note)
            self.active_signal["last_event"] = event

        tp1_hit = bool(self.active_signal.get("tp1_hit_ts"))
        if direction == "LONG":
            if not tp1_hit and price >= target1:
                self.active_signal["tp1_hit_ts"] = now
                emit("TP1", "TP1_HIT", target1,
                     "TP1 reached. Protect the remaining position manually; TP2 remains the final tracked target.",
                     False, 1.5)
                tp1_hit = True
            if price >= target2:
                if not tp1_hit:
                    self.active_signal["tp1_hit_ts"] = now
                    emit("TP1", "TP1_HIT", target1, "Price crossed TP1 and TP2 in the same market update.", False, 1.5)
                self.active_signal["tp2_hit_ts"] = now
                self.signal_status = "TARGET_REACHED"
                emit("TP2", "TP2_HIT", target2, "Final tracked target reached.", True, float(self.active_signal.get("rr") or 0.0))
            elif price <= stop:
                self.active_signal["sl_hit_ts"] = now
                self.signal_status = "INVALIDATED"
                emit("SL", "SL_HIT", stop,
                     "Stop/invalidation level reached." if not tp1_hit else
                     "Stop reached after TP1. Actual realized PnL depends on manual position management.",
                     True, 0.0 if tp1_hit else -1.0)
        else:
            if not tp1_hit and price <= target1:
                self.active_signal["tp1_hit_ts"] = now
                emit("TP1", "TP1_HIT", target1,
                     "TP1 reached. Protect the remaining position manually; TP2 remains the final tracked target.",
                     False, 1.5)
                tp1_hit = True
            if price <= target2:
                if not tp1_hit:
                    self.active_signal["tp1_hit_ts"] = now
                    emit("TP1", "TP1_HIT", target1, "Price crossed TP1 and TP2 in the same market update.", False, 1.5)
                self.active_signal["tp2_hit_ts"] = now
                self.signal_status = "TARGET_REACHED"
                emit("TP2", "TP2_HIT", target2, "Final tracked target reached.", True, float(self.active_signal.get("rr") or 0.0))
            elif price >= stop:
                self.active_signal["sl_hit_ts"] = now
                self.signal_status = "INVALIDATED"
                emit("SL", "SL_HIT", stop,
                     "Stop/invalidation level reached." if not tp1_hit else
                     "Stop reached after TP1. Actual realized PnL depends on manual position management.",
                     True, 0.0 if tp1_hit else -1.0)

        self.active_signal["lifecycle"] = self.signal_status
        self.active_signal["lifecycle_stage"] = "TP2_HIT" if self.active_signal.get("tp2_hit_ts") else ("TP1_HIT" if self.active_signal.get("tp1_hit_ts") else "ACTIVE")
        self.active_signal["last_price_seen"] = price
        self.last_lifecycle_events = events

        if events:
            final = next((x for x in reversed(events) if x.get("final")), None)
            if final:
                lesson = self.learning.resolve(
                    self.active_signal,
                    "TP2_REACHED" if final["type"] == "TP2_HIT" else "SL_HIT",
                    float(final["result_r"]),
                )
                final["learning_review"] = lesson
                self.active_signal["learning_review"] = lesson

            signal_snapshot = dict(self.active_signal)
            for event in events:
                self.last_lifecycle_event = {
                    "signal": signal_snapshot,
                    "event": event,
                    "outcome": (
                        "TP1_REACHED" if event["type"] == "TP1_HIT"
                        else "TARGET_REACHED" if event["type"] == "TP2_HIT"
                        else "INVALIDATED"
                    ),
                    "result_r": float(event.get("result_r") or 0.0),
                }

            if self.signal_status != "ACTIVE":
                self.last_resolved_ts = now
                self.governor_lock_reason = "RESOLVED: quality cooldown is active before the next signal."
                for row in self.signal_history:
                    if row.get("id") == self.active_signal.get("id"):
                        row["status"] = self.signal_status
                        row["resolved_ts"] = now
                        row["result_r"] = float((final or events[-1]).get("result_r") or 0.0)
                        row["tp1_hit"] = bool(self.active_signal.get("tp1_hit_ts"))
                        row["learning_review"] = self.active_signal.get("learning_review")
                        break


    def resolve_external_execution(self, event: dict):
        """Resolve the active strategy signal from an actual exchange demo close."""
        if not self.active_signal:
            return
        if str(event.get("signal_id") or event.get("execution_signal_id") or "") not in {"", str(self.active_signal.get("id"))}:
            return
        reason = str(event.get("close_reason") or "").upper()
        status = "TARGET_REACHED" if reason == "TP" else "EXECUTION_FAILED" if reason == "FAILED" else "INVALIDATED"
        ts = int(event.get("ts") or time.time() * 1000)
        result_r = float(event.get("result_r") or 0.0)
        self.signal_status = status
        self.last_resolved_ts = ts
        self.governor_lock_reason = "RESOLVED: quality cooldown is active before the next signal."
        self.active_signal["lifecycle"] = status
        self.active_signal["lifecycle_stage"] = "TP2_HIT" if reason == "TP" else "SL_HIT" if reason == "SL" else "EXECUTION_FAILED" if reason == "FAILED" else "RESOLVED"
        self.active_signal["resolved_ts"] = ts
        self.active_signal["execution_managed"] = True
        self.active_signal["close_reason"] = reason or "UNKNOWN"
        self.active_signal["realized_pnl_usdt"] = event.get("net_profit_usdt")
        self.active_signal["actual_result_r"] = result_r
        self.active_signal["learning_review"] = event.get("learning_review")
        for row in self.signal_history:
            if row.get("id") == self.active_signal.get("id"):
                row["status"] = status
                row["resolved_ts"] = ts
                row["result_r"] = result_r
                row["close_reason"] = reason or "UNKNOWN"
                row["realized_pnl_usdt"] = event.get("net_profit_usdt")
                row["learning_review"] = event.get("learning_review")
                break

    def evaluate(self, state: MarketState) -> Optional[Signal]:
        self.last_evaluated_ts = int(time.time() * 1000)
        self.position_management = None
        self._update_signal_lifecycle(state)
        self._rotate_governor_day()
        self.last_diagnostics = self.diagnostics(state)
        if not self._governor_allows_new_signal():
            self.last_diagnostics["status"] = "QUALITY_LOCK"
            self.last_diagnostics["wait_reason"] = self.governor_lock_reason
            self.last_diagnostics["blocked_by"] = ["quality_governor"]
            return None
        # Keep loose mode active on the secondary REST feed. Candle-based setups
        # can still be evaluated with reduced microstructure freshness rather than
        # freezing the bot until the primary WebSocket is perfect.
        if state.data_health not in {"HEALTHY", "DEGRADED"}:
            return None
        candidates = [
            detect_sfp(state),
            detect_dline(state),
            detect_mss(state),
            self._momentum_signal(state, compute_features(state)),
        ]
        signals = [s for s in candidates if s is not None]
        if not signals:
            return None

        # The base detector can find several setups; only keep candidates that
        # survive the strict "best trade only" quality gate after learning/context
        # adjustments. This prevents frequent low-conviction direction flips.
        qualified = []
        rejected = []
        for candidate in signals:
            self._apply_memory_context(candidate, state)
            self._apply_learning_context(candidate, state)
            ok, reason = self._quality_gate(candidate, state)
            if ok:
                qualified.append(candidate)
            else:
                rejected.append(f"{candidate.setup}: {reason}")
        if not qualified:
            self.governor_last_quality_rejection = " | ".join(rejected[:3])
            self.governor_lock_reason = "WAITING: no candidate met the elite quality gate."
            self.last_diagnostics["status"] = "QUALITY_LOCK"
            self.last_diagnostics["wait_reason"] = "No candidate met the elite quality gate."
            self.last_diagnostics["blocked_by"] = ["quality_governor"]
            return None

        signal = max(qualified, key=lambda s: (s.confidence, s.rr))
        self.governor_last_quality_rejection = ""
        previous_signal = dict(self.active_signal) if self.active_signal else None
        self.position_management = self._build_position_management(previous_signal, signal, state)
        if self.position_management:
            signal.evidence["position_management"] = self.position_management
            signal.thesis.append(self.position_management["action"])
            signal.thesis.append("Reversal reason: " + self.position_management["why_new_trade"])
        if signal.id == self.last_signal_id:
            return None
        self.last_signal_id = signal.id
        self.daily_signal_count += 1
        self.governor_lock_reason = "ACTIVE: waiting for this signal to resolve at TP2 or SL."
        self.active_signal = signal.to_dict()
        self.active_signal["lifecycle"] = "ACTIVE"
        self.active_signal["lifecycle_stage"] = "ACTIVE"
        self.active_signal["created_ts"] = self.last_evaluated_ts
        self.learning.record_open(self.active_signal)
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
            "tp1_hit": False,
            "tp2_hit": False,
        })
        self.signal_history = self.signal_history[:25]
        self.last_diagnostics["signal_state"] = self.signal_status
        self.last_diagnostics["active_signal"] = self.active_signal
        self.last_diagnostics["signal_history"] = self.signal_history
        return signal
