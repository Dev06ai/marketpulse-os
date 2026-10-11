"""Immediate closed-bar decisions without running the engine on every tick."""
from .models import MarketState


def confirmed_bar_key(state: MarketState, now_ms: int) -> tuple:
    keys = []
    for pool in (state.candles_5, state.candles_15, state.candles_60):
        candle = next((c for c in reversed(pool) if c.confirmed and c.end < now_ms), None)
        keys.append(None if candle is None else (
            candle.start, candle.end, candle.open, candle.high, candle.low,
            candle.close, candle.volume,
        ))
    return tuple(keys)


def evaluation_due(state: MarketState, now_ms: int, last_eval_ms: int, previous_bars: tuple | None):
    bars = confirmed_bar_key(state, now_ms)
    # Receipt timestamps need not equal callback time. A new/corrected latest
    # closed bar gets one immediate review, including the 1H/derived-4H inputs.
    due = (not last_eval_ms or now_ms < last_eval_ms or now_ms-last_eval_ms >= 1000
           or bars != previous_bars)
    return due, bars
