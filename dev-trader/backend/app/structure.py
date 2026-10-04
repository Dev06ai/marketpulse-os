"""Causal structure: a swing exists only after its right-hand bars close."""
from __future__ import annotations

import math
from .models import Candle, MarketState, aggregate_candles


def closed_bars(candles, interval_ms, as_of_ms):
    rows = {}
    for c in candles:
        values = (c.open, c.high, c.low, c.close, c.volume)
        if (c.confirmed and c.end < as_of_ms and c.end-c.start+1 == interval_ms
                and all(math.isfinite(v) for v in values)
                and 0 < c.low <= min(c.open, c.close) <= max(c.open, c.close) <= c.high
                and c.volume >= 0):
            rows[c.start] = c
    return sorted(rows.values(), key=lambda c: c.start)


def confirmed_swings(candles, width=2):
    out = []
    if width < 1:
        return out
    for i in range(width, len(candles)-width):
        group = candles[i-width:i+width+1]
        interval = candles[i].end-candles[i].start+1
        if any(b.start-a.start != interval for a,b in zip(group, group[1:])):
            continue
        c = candles[i]
        others = group[:width]+group[width+1:]
        # Equal highs/lows do not create several artificial distinct swings.
        for kind, valid, price in (("HIGH", all(c.high > x.high for x in others), c.high),
                                   ("LOW", all(c.low < x.low for x in others), c.low)):
            if valid:
                out.append(dict(kind=kind, price=price, start=c.start,
                                confirmed_at=group[-1].end+1, index=i))
    return sorted(out, key=lambda x: (x["confirmed_at"], x["kind"]))


def timeframe_structure(candles, interval_ms, as_of_ms):
    cs = closed_bars(candles, interval_ms, as_of_ms)[-240:]
    if len(cs) < 8:
        return dict(status="WARMING", bias="UNKNOWN", levels=[], last_break=None,
                    range_high=None, range_low=None, last_closed_ts=cs[-1].end+1 if cs else 0)
    swings = confirmed_swings(cs)
    highs = [s for s in swings if s["kind"] == "HIGH"]
    lows = [s for s in swings if s["kind"] == "LOW"]
    bias = "RANGE"
    if len(highs) >= 2 and len(lows) >= 2:
        if highs[-1]["price"] > highs[-2]["price"] and lows[-1]["price"] > lows[-2]["price"]:
            bias = "BULLISH"
        elif highs[-1]["price"] < highs[-2]["price"] and lows[-1]["price"] < lows[-2]["price"]:
            bias = "BEARISH"
    levels, breaks = [], []
    for swing in swings:
        price = swing["price"]
        after = [c for c in cs if c.start >= swing["confirmed_at"]]
        broken = next((c for c in after if (c.close > price if swing["kind"] == "HIGH" else c.close < price)), None)
        touched = any(c.low <= price <= c.high for c in after)
        expired = cs[-1].end+1-swing["confirmed_at"] > interval_ms*120
        level = dict(swing, timeframe_ms=interval_ms,
                     status="BROKEN" if broken else "EXPIRED" if expired else "TOUCHED" if touched else "ACTIVE",
                     invalidated_at=broken.end+1 if broken else None,
                     expires_at=swing["confirmed_at"]+interval_ms*120)
        levels.append(level)
        if broken:
            breaks.append(dict(direction="LONG" if swing["kind"] == "HIGH" else "SHORT",
                               level=price, confirmed_at=broken.end+1, swing_confirmed_at=swing["confirmed_at"]))
    latest = max(breaks, key=lambda x:x["confirmed_at"], default=None)
    if latest and latest["confirmed_at"] == cs[-1].end+1:
        latest = dict(latest, event="CHOCH" if (bias == "BEARISH" and latest["direction"] == "LONG")
                      or (bias == "BULLISH" and latest["direction"] == "SHORT") else "BOS")
    elif latest:
        latest = dict(latest, event="HISTORICAL_BREAK")
    recent = cs[-20:]
    travel = sum(abs(b.close-a.close) for a,b in zip(recent,recent[1:]))
    efficiency = abs(recent[-1].close-recent[0].close)/travel if travel else 0.0
    return dict(status="READY", bias=bias, levels=levels[-24:], last_break=latest,
                range_high=max(c.high for c in recent), range_low=min(c.low for c in recent),
                efficiency=round(efficiency,4), last_closed_ts=cs[-1].end+1,
                contiguous_recent=all(b.start-a.start == interval_ms for a,b in zip(recent,recent[1:])))


def structure_map(state: MarketState, as_of_ms: int):
    hourly = closed_bars(state.candles_60, 3_600_000, as_of_ms)
    return {"15m": timeframe_structure(state.candles_15,900_000,as_of_ms),
            "1h": timeframe_structure(hourly,3_600_000,as_of_ms),
            "4h": timeframe_structure(aggregate_candles(hourly,4),14_400_000,as_of_ms),
            "daily": timeframe_structure(aggregate_candles(hourly,24),86_400_000,as_of_ms),
            "as_of_ms": as_of_ms, "swing_confirmation_bars": 2}


class RegimeSelector:
    """Change regime only after two distinct closed 1h observations agree."""
    def __init__(self):
        self.current = "UNKNOWN"
        self.pending = "UNKNOWN"
        self.count = 0
        self.last_bar = 0

    def update(self, features):
        h = features.structure_map.get("1h", {})
        bar = h.get("last_closed_ts",0)
        raw = features.regime
        event = h.get("last_break") or {}
        if features.volatility_pct >= 1.5:
            raw = "HIGH_VOL"
        elif event.get("confirmed_at") == bar and event.get("event") in {"BOS","CHOCH"}:
            raw = "BREAKOUT_"+event["direction"]
        elif h.get("efficiency",1) < .25:
            raw = "RANGE"
        if bar > self.last_bar:
            contiguous = not self.last_bar or bar-self.last_bar == 3_600_000
            self.count = self.count+1 if raw == self.pending and contiguous else 1
            self.pending, self.last_bar = raw,bar
            if self.current == "UNKNOWN" or self.count >= 2:
                self.current = raw
        # Shock vetoes apply immediately; a candle cannot delay risk protection.
        effective = "HIGH_VOL" if raw == "HIGH_VOL" else self.current
        return dict(regime=effective, pending=raw, stable=raw == self.current,
                    agreeing_closed_bars=self.count, last_closed_ts=self.last_bar)
