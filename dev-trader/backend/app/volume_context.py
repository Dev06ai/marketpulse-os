"""Candle-derived volume context, explicitly distinct from trade-level NPOC."""
import math
import time

from .models import MarketState

DAY_MS = 86_400_000
BAR_MS = 900_000


def volume_context(state: MarketState, now_ms: int | None = None) -> dict:
    day = (now_ms if now_ms is not None else int(time.time() * 1000)) // DAY_MS * DAY_MS
    result = {"source": "CANDLE_VOLUME_ESTIMATE", "exact_npoc": False,
              "previous_day_poc": None, "untouched_poc": None,
              "session_vwap": None, "profile_status": "UNAVAILABLE"}
    previous = {c.start: c for c in state.candles_15
                if c.confirmed and day-DAY_MS <= c.start < day}
    expected = set(range(day-DAY_MS, day, BAR_MS))
    valid = (set(previous) == expected and all(c.volume >= 0 and math.isfinite(c.volume)
             and 0 < c.low <= c.high and c.low <= c.close <= c.high for c in previous.values()))
    if valid and sum(c.volume for c in previous.values()) > 0:
        low = min(c.low for c in previous.values())
        high = max(c.high for c in previous.values())
        width = (high-low)/36
        bins = [0.0]*36
        for c in previous.values():
            typical = (c.high+c.low+c.close)/3
            index = min(35, max(0, int((typical-low)/width))) if width else 0
            bins[index] += c.volume
        peak = max(range(36), key=lambda index: bins[index])
        poc = low+(peak+.5)*width if width else low
        today = [c for c in state.candles_15 if day <= c.start < day+DAY_MS]
        # Missing current-day bars cannot prove that the level is untouched.
        required_today = set(range(day, (now_ms if now_ms is not None else int(time.time()*1000)) // BAR_MS * BAR_MS + BAR_MS, BAR_MS))
        complete_today = required_today.issubset({c.start for c in today})
        touched = any(c.low <= poc <= c.high for c in today)
        if state.last_price is not None and abs(state.last_price-poc) <= max(1e-8, width/2):
            touched = True
        result.update(previous_day_poc=round(poc, 4), profile_status="ESTIMATED",
                      untouched_poc=round(poc, 4) if complete_today and not touched else None,
                      touch_history_complete=complete_today)
    session = [c for c in state.candles_5 if c.confirmed and day <= c.start < day+DAY_MS
               and c.volume > 0 and math.isfinite(c.volume) and 0 < c.low <= c.close <= c.high]
    if session and {c.start for c in session} == set(range(day, (now_ms if now_ms is not None else int(time.time()*1000)) // 300_000 * 300_000, 300_000)):
        result["session_vwap"] = round(sum((c.high+c.low+c.close)/3*c.volume for c in session)/sum(c.volume for c in session), 4)
    return result
