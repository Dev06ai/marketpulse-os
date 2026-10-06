from app.analytics import MarketFeatures
from app.level_reactions import LevelReactionTracker, FIFTEEN_MIN_MS, THIRTY_MIN_MS
from app.models import Candle, MarketState
from app.strategy import StrategyEngine


def candle(start, o, h, l, c, confirmed=False):
    return Candle(start=start, end=start + 300_000 - 1, open=o, high=h, low=l, close=c, volume=10, confirmed=confirmed)


def test_proximity_only_arms_level_without_trigger():
    tracker = LevelReactionTracker()
    state = MarketState(
        last_price=100.2,
        candles_5=[candle(1_000_000, 100.1, 100.5, 99.8, 100.2, False)],
    )
    f = MarketFeatures(atr_15=10.0, previous_day_low=100.0)
    result = tracker.update(state, f, now_ms=1_100_000)
    assert result["status"] == "ARMED"
    assert result["trigger"] is None
    assert result["armed"][0]["label"] == "D LOW"


def test_daily_reaction_triggers_then_hides_after_30_minutes():
    tracker = LevelReactionTracker()
    state = MarketState(
        last_price=102.0,
        candles_5=[candle(1_000_000, 100.0, 102.2, 99.2, 102.0, False)],
    )
    f = MarketFeatures(atr_15=5.0, previous_day_low=100.0)
    first = tracker.update(state, f, now_ms=1_100_000)
    assert first["status"] == "TRIGGERED"
    assert first["trigger"]["label"] == "D LOW"
    assert first["trigger"]["direction"] == "LONG"
    assert first["trigger"]["hide_after_ms"] - first["trigger"]["played_at_ms"] == THIRTY_MIN_MS

    later = tracker.update(state, f, now_ms=1_100_000 + THIRTY_MIN_MS + 1)
    assert all(row["label"] != "D LOW" for row in later["levels"])


def test_sfp_reaction_uses_15_minute_chart_lifetime():
    tracker = LevelReactionTracker()
    state = MarketState(
        last_price=102.0,
        candles_5=[candle(1_000_000, 99.8, 102.2, 98.8, 102.0, False)],
    )
    f = MarketFeatures(atr_15=5.0)
    result = tracker.update(
        state,
        f,
        sfp_hunter={"target_level": 100.0, "direction": "LONG", "status": "NEAR_TRIGGER"},
        now_ms=1_100_000,
    )
    assert result["trigger"]["kind"] == "SFP"
    assert result["trigger"]["hide_after_ms"] - result["trigger"]["played_at_ms"] == FIFTEEN_MIN_MS


def test_engine_can_build_candidate_only_after_confirmed_level_reaction():
    engine = StrategyEngine()
    now = 10_000_000
    engine.level_reaction_state = {
        "status": "TRIGGERED",
        "levels": [
            {"kind": "DAILY", "label": "D LOW", "price": 100.0, "state": "PLAYED"},
            {"kind": "DAILY", "label": "D HIGH", "price": 112.0, "state": "WATCH"},
        ],
        "trigger": {
            "id": "DAILY:D LOW:100.00",
            "kind": "DAILY",
            "label": "D LOW",
            "price": 100.0,
            "direction": "LONG",
            "reaction": "RECLAIM_REJECTION",
            "played_at_ms": now,
            "reaction_candle_start": now - 60_000,
        },
    }
    state = MarketState(
        last_price=102.0,
        candles_5=[candle(now - 60_000, 100.0, 102.2, 99.2, 102.0, False)],
    )
    f = MarketFeatures(
        atr_15=2.0,
        atr_60=4.0,
        trend_15="UP",
        trend_60="UP",
        trend_240="UP",
        market_structure="BULLISH",
        regime="TREND_UP",
        order_block_direction="BULLISH",
    )

    import app.strategy as strategy
    original_time = strategy.time.time
    strategy.time.time = lambda: now / 1000
    try:
        sig = engine._level_reaction_signal(state, f)
    finally:
        strategy.time.time = original_time

    assert sig is not None
    assert sig.direction == "LONG"
    assert "Level Reaction" in sig.setup
    assert sig.evidence["level_reaction_policy"] == "REACTION_REQUIRED_NO_BLIND_LEVEL_ENTRY"
