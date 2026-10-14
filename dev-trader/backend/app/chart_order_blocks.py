"""Causal, display-only strong OB policy. Never changes execution inputs.

Strength is a reproducible heuristic, not a probability of profitable reversal.
The last opposite candle must launch a closed structural break with >=1.5 ATR
body, >=65% body/range, close in the outer 20%, >=0.5 ATR clearance and >=1.2x
prior volume. Retested/invalidated zones and discontinuous evidence are omitted.
"""
from __future__ import annotations

import math
from .models import aggregate_candles
from .structure import closed_bars

RULE_VERSION = "strong-ob-v1"
INTERVALS = {"15m": 900_000, "1h": 3_600_000, "4h": 14_400_000,
             "1D": 86_400_000, "2D": 172_800_000}


def strong_blocks(candles, timeframe, as_of_ms):
    interval = INTERVALS[timeframe]
    cs = closed_bars(candles, interval, as_of_ms)[-240:]
    if not cs or cs[-1].end+1 < (as_of_ms//interval)*interval:
        return []  # Latest completed bar is missing; freshness is unproven.
    rows = []
    for i in range(15, len(cs) - 1):
        base, move = cs[i:i + 2]
        evidence = cs[i - 15:]
        # No fresh-zone claim across missing history, including after formation.
        if any(b.start - a.start != interval for a, b in zip(evidence, evidence[1:])):
            continue
        prior = cs[i - 14:i]
        atr = sum(max(c.high-c.low, abs(c.high-p.close), abs(c.low-p.close))
                  for p, c in zip(cs[i-15:i-1], prior)) / 14
        avg_volume = sum(c.volume for c in prior) / 14
        span, body = move.high - move.low, abs(move.close - move.open)
        if atr <= 0 or avg_volume <= 0 or span <= 0:
            continue
        bullish = base.close < base.open and move.close > move.open
        bearish = base.close > base.open and move.close < move.open
        if not (bullish or bearish):
            continue
        structure = max(c.high for c in cs[i-10:i+1]) if bullish else min(c.low for c in cs[i-10:i+1])
        clearance = move.close - base.high if bullish else base.low - move.close
        extreme = (move.close-move.low)/span if bullish else (move.high-move.close)/span
        volume_ratio, displacement = move.volume/avg_volume, body/atr
        if (not (move.close > structure if bullish else move.close < structure)
                or displacement < 1.5 or body/span < .65 or extreme < .8
                or clearance/atr < .5 or volume_ratio < 1.2 or base.high-base.low > 2*atr):
            continue
        # Later touches are first boundary overlaps, not midpoint proximity.
        # Confirmation candle itself cannot consume the zone it just formed.
        later = cs[i+2:]
        if any((c.close < base.low if bullish else c.close > base.high)
               or c.low <= base.high and c.high >= base.low for c in later):
            continue
        if as_of_ms - (move.end+1) > interval * 80:
            continue
        score = min(100, 75 + int(min(10, (displacement-1.5)*10))
                    + int(min(10, (volume_ratio-1.2)*10)) + (5 if extreme >= .9 else 0))
        if timeframe == "15m" and score < 85:
            continue
        rows.append({"id": f"{RULE_VERSION}:{timeframe}:{base.start}:{'B' if bullish else 'S'}",
                     "kind": "OB", "label": f"{timeframe.upper()} OB", "timeframe": timeframe,
                     "price": (base.low+base.high)/2, "mid": (base.low+base.high)/2,
                     "zone_low": base.low, "zone_high": base.high,
                     "direction": "BULLISH" if bullish else "BEARISH", "status": "ACTIVE",
                     "source_start": base.start, "confirmed_at": move.end+1,
                     "strength_score": score, "rule_version": RULE_VERSION,
                     "source": f"{timeframe}_CONFIRMED_STRUCTURE_BREAK",
                     "displacement_atr": round(displacement, 3), "volume_ratio": round(volume_ratio, 3),
                     "structure_break": True})
    return rows


def select_blocks(rows, price):
    """At most four zones/two per side; stronger overlapping zone wins."""
    if price is None or not math.isfinite(price) or price <= 0:
        return []
    def distance(row):
        return max(row["zone_low"]-price, price-row["zone_high"], 0)/price
    ranked = sorted(rows, key=lambda r: (-r["strength_score"], distance(r),
                                         -INTERVALS[r["timeframe"]], -r["confirmed_at"], r["id"]))
    selected = []
    for row in ranked:
        if distance(row) > .12 or sum(r["direction"] == row["direction"] for r in selected) >= 2:
            continue
        if any(max(0, min(row["zone_high"], r["zone_high"])-max(row["zone_low"], r["zone_low"]))
               >= .5*min(row["zone_high"]-row["zone_low"], r["zone_high"]-r["zone_low"])
               for r in selected):
            continue
        selected.append(row)
        if len(selected) == 4:
            break
    return selected


def chart_order_blocks(state, as_of_ms):
    hourly = closed_bars(state.candles_60, INTERVALS["1h"], as_of_ms)
    pools = {"15m": state.candles_15, "1h": hourly,
             "4h": aggregate_candles(hourly, 4), "1D": aggregate_candles(hourly, 24),
             "2D": aggregate_candles(hourly, 48)}
    rows = [row for tf, cs in pools.items() for row in strong_blocks(cs, tf, as_of_ms)]
    observed = state.candles_5 + state.candles_15 + state.candles_60
    def touched(row):
        return any(c.start >= row["confirmed_at"] and c.start < as_of_ms
                   and (c.end < as_of_ms if c.confirmed else as_of_ms <= c.end+1)
                   and math.isfinite(c.low) and math.isfinite(c.high) and 0 < c.low <= c.high
                   and c.low <= row["zone_high"] and c.high >= row["zone_low"] for c in observed)
    return select_blocks([row for row in rows if not touched(row)], state.last_price)
