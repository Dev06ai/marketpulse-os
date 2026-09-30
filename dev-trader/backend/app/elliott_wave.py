from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .models import Candle


@dataclass
class ElliottContext:
    phase: str = "UNKNOWN"
    direction: str = "NEUTRAL"
    wave: str = "UNCOUNTED"
    confidence: float = 0.0
    retracement: float | None = None
    extension: float | None = None
    structural_valid: bool = False
    reason: str = "Insufficient or ambiguous pivots for a reliable count."
    degree: str = "15m"


def _pivots(candles: list[Candle], window: int = 2) -> list[tuple[str, int, float]]:
    cs = [c for c in candles if c.confirmed]
    out: list[tuple[str, int, float]] = []
    if len(cs) < window * 2 + 3:
        return out
    for i in range(window, len(cs) - window):
        c = cs[i]
        hi = c.high >= max(x.high for x in cs[i-window:i+window+1])
        lo = c.low <= min(x.low for x in cs[i-window:i+window+1])
        if hi:
            out.append(("H", i, float(c.high)))
        if lo:
            out.append(("L", i, float(c.low)))
    out.sort(key=lambda x: x[1])
    # Force alternation and remove adjacent duplicate pivot types by retaining
    # the more extreme point. This is intentionally conservative.
    clean: list[tuple[str, int, float]] = []
    for p in out:
        if not clean or p[0] != clean[-1][0]:
            clean.append(p)
            continue
        if p[0] == "H" and p[2] >= clean[-1][2]:
            clean[-1] = p
        elif p[0] == "L" and p[2] <= clean[-1][2]:
            clean[-1] = p
    return clean


def _ratio(a: float, b: float) -> float:
    return abs(b - a) / abs(a) if a else 0.0


def _bull_impulse(p: list[tuple[str, int, float]]) -> tuple[bool, float, str]:
    if len(p) < 6:
        return False, 0.0, ""
    q = p[-6:]
    kinds = "".join(x[0] for x in q)
    if kinds != "LHLHLH":
        return False, 0.0, ""
    p0, p1, p2, p3, p4, p5 = [x[2] for x in q]
    w1 = p1 - p0
    w2 = p1 - p2
    w3 = p3 - p2
    w4 = p3 - p4
    w5 = p5 - p4
    if min(w1, w3, w5) <= 0:
        return False, 0.0, ""
    wave2_retrace = w2 / w1 if w1 else 99.0
    wave4_overlap = p4 <= p1
    wave3_not_shortest = w3 >= min(w1, w5)
    valid = wave2_retrace < 1.0 and not wave4_overlap and wave3_not_shortest and p3 > p1
    score = 0.0
    score += 0.35 if wave2_retrace < 1.0 else 0.0
    score += 0.35 if not wave4_overlap else 0.0
    score += 0.20 if wave3_not_shortest else 0.0
    score += 0.10 if p3 > p1 else 0.0
    retrace = w2 / w1 if w1 else None
    reason = f"Possible bullish 5-wave impulse; wave-2 retrace={retrace:.2f}, wave-3/1={w3/w1:.2f}, wave-5/1={w5/w1:.2f}."
    return valid, min(score, 1.0), reason


def _bear_impulse(p: list[tuple[str, int, float]]) -> tuple[bool, float, str]:
    if len(p) < 6:
        return False, 0.0, ""
    q = p[-6:]
    kinds = "".join(x[0] for x in q)
    if kinds != "HLHLHL":
        return False, 0.0, ""
    p0, p1, p2, p3, p4, p5 = [x[2] for x in q]
    w1 = p0 - p1
    w2 = p2 - p1
    w3 = p2 - p3
    w4 = p4 - p3
    w5 = p4 - p5
    if min(w1, w3, w5) <= 0:
        return False, 0.0, ""
    wave2_retrace = w2 / w1 if w1 else 99.0
    wave4_overlap = p4 >= p1
    wave3_not_shortest = w3 >= min(w1, w5)
    valid = wave2_retrace < 1.0 and not wave4_overlap and wave3_not_shortest and p3 < p1
    score = 0.0
    score += 0.35 if wave2_retrace < 1.0 else 0.0
    score += 0.35 if not wave4_overlap else 0.0
    score += 0.20 if wave3_not_shortest else 0.0
    score += 0.10 if p3 < p1 else 0.0
    reason = f"Possible bearish 5-wave impulse; wave-2 retrace={retrace:.2f}." if False else f"Possible bearish 5-wave impulse; wave-2 retrace={wave2_retrace:.2f}, wave-3/1={w3/w1:.2f}, wave-5/1={w5/w1:.2f}."
    return valid, min(score, 1.0), reason


def _abc(p: list[tuple[str, int, float]]) -> tuple[str, float, str]:
    if len(p) < 4:
        return "UNKNOWN", 0.0, ""
    q = p[-4:]
    kinds = "".join(x[0] for x in q)
    if kinds == "HLHL":
        a = q[1][2] - q[0][2]
        b = q[2][2] - q[1][2]
        c = q[2][2] - q[3][2]
        if a < 0 and c > 0:
            return "CORRECTION_UP", 0.45, "Possible bullish ABC correction."
    if kinds == "LHLH":
        a = q[1][2] - q[0][2]
        b = q[2][2] - q[1][2]
        c = q[2][2] - q[3][2]
        if a > 0 and c < 0:
            return "CORRECTION_DOWN", 0.45, "Possible bearish ABC correction."
    return "UNKNOWN", 0.0, ""


def analyze_elliott(candles: Iterable[Candle], degree: str = "15m") -> ElliottContext:
    cs = [c for c in candles if c.confirmed]
    piv = _pivots(cs, 2)
    if len(piv) < 4:
        return ElliottContext(degree=degree)

    bull_ok, bull_score, bull_reason = _bull_impulse(piv)
    bear_ok, bear_score, bear_reason = _bear_impulse(piv)

    if bull_ok or bear_ok:
        if bull_score >= bear_score:
            return ElliottContext(
                phase="IMPULSE_UP",
                direction="LONG",
                wave="1-2-3-4-5",
                confidence=bull_score,
                structural_valid=True,
                reason=bull_reason,
                degree=degree,
            )
        return ElliottContext(
            phase="IMPULSE_DOWN",
            direction="SHORT",
            wave="1-2-3-4-5",
            confidence=bear_score,
            structural_valid=True,
            reason=bear_reason,
            degree=degree,
        )

    phase, score, reason = _abc(piv)
    if phase != "UNKNOWN":
        return ElliottContext(
            phase=phase,
            direction="LONG" if phase == "CORRECTION_UP" else "SHORT",
            wave="A-B-C",
            confidence=score,
            structural_valid=True,
            reason=reason,
            degree=degree,
        )

    return ElliottContext(
        phase="RANGE_OR_AMBIGUOUS",
        direction="NEUTRAL",
        wave="UNCOUNTED",
        confidence=0.15,
        structural_valid=False,
        reason="Pivot sequence does not satisfy the conservative impulse/ABC templates; keep alternate counts open.",
        degree=degree,
    )
