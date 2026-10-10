from app.analytics import MarketFeatures
from app.level_reactions import FIVE_MIN_MS, LevelReactionTracker, FIFTEEN_MIN_MS, THIRTY_MIN_MS
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
    assert first["status"] == "ARMED"
    assert first["trigger"] is None
    assert first["armed"][0]["arming_reason"] == "LEVEL_FIRST_OBSERVED"

    state.last_price = 100.0
    assert tracker.update(state, f, now_ms=1_100_500)["trigger"] is None
    state.last_price = 102.0
    triggered = tracker.update(state, f, now_ms=1_101_000)
    assert triggered["status"] == "TRIGGERED"
    assert triggered["trigger"]["label"] == "D LOW"
    assert triggered["trigger"]["direction"] == "LONG"
    assert triggered["trigger"]["hide_after_ms"] - triggered["trigger"]["tapped_at_ms"] == FIVE_MIN_MS
    assert triggered["trigger"]["hide_after_ms"] - triggered["trigger"]["played_at_ms"] <= FIVE_MIN_MS

    later = tracker.update(state, f, now_ms=1_101_000 + THIRTY_MIN_MS + 1)
    assert all(row["label"] != "D LOW" for row in later["levels"])


def test_sfp_reaction_uses_15_minute_chart_lifetime():
    tracker = LevelReactionTracker()
    state = MarketState(
        last_price=102.0,
        candles_5=[candle(1_000_000, 99.8, 102.2, 98.8, 102.0, False)],
    )
    f = MarketFeatures(atr_15=5.0)
    first = tracker.update(
        state,
        f,
        sfp_hunter={"target_level": 100.0, "direction": "LONG", "status": "NEAR_TRIGGER"},
        now_ms=1_100_000,
    )
    assert first["trigger"] is None
    state.last_price = 100.0
    tracker.update(state, f, sfp_hunter={"target_level": 100.0, "direction": "LONG", "status": "NEAR_TRIGGER"}, now_ms=1_100_500)
    state.last_price = 102.0
    result = tracker.update(
        state,
        f,
        sfp_hunter={"target_level": 100.0, "direction": "LONG", "status": "NEAR_TRIGGER"},
        now_ms=1_101_000,
    )
    assert result["trigger"]["kind"] == "SFP"
    assert result["trigger"]["hide_after_ms"] - result["trigger"]["tapped_at_ms"] == FIVE_MIN_MS
    assert result["trigger"]["hide_after_ms"] - result["trigger"]["played_at_ms"] <= FIVE_MIN_MS


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
            "reaction_candle_end": now - 1,
            "reaction_candle_low": 99.2,
            "reaction_candle_high": 102.2,
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
    assert sig.evidence["level_reaction_policy"] == "MAPPED_BEFORE_TRIGGER_REACTION_REQUIRED_NO_BLIND_LEVEL_ENTRY"
    assert sig.evidence["level_reaction_stop_anchor"]["low"] == 99.2
    assert sig.stop < 100.0


def test_stale_closed_candle_can_arm_but_cannot_fabricate_reaction():
    tracker = LevelReactionTracker()
    stale = candle(1_000_000, 100.0, 103.0, 99.0, 102.0, True)
    state = MarketState(last_price=102.0, candles_5=[stale])
    f = MarketFeatures(atr_15=5.0, previous_day_low=100.0)

    result = tracker.update(state, f, now_ms=2_000_000)
    assert result["trigger"] is None
    assert result["reaction_candle_fresh"] is False


def test_newly_discovered_level_cannot_hindsight_trigger_on_same_update():
    tracker = LevelReactionTracker()
    state = MarketState(
        last_price=102.0,
        candles_5=[candle(1_000_000, 100.0, 102.5, 99.0, 102.0, False)],
    )
    f = MarketFeatures(atr_15=5.0, previous_day_low=100.0)

    first = tracker.update(state, f, now_ms=1_100_000)
    assert first["trigger"] is None
    assert first["status"] == "ARMED"

    second = tracker.update(state, f, now_ms=1_101_000)
    assert second["trigger"] is None
    # Only a newly observed touch/reclaim can qualify this old wick.
    state.last_price = 100.0
    assert tracker.update(state, f, now_ms=1_102_000)["trigger"] is None
    state.last_price = 102.0
    assert tracker.update(state, f, now_ms=1_103_000)["trigger"]["label"] == "D LOW"


def test_level_reaction_stop_stays_anchored_to_original_reaction_candle():
    engine = StrategyEngine()
    now = 20_000_000
    engine.level_reaction_state = {
        "status": "TRIGGERED",
        "levels": [{"kind": "DAILY", "label": "D HIGH", "price": 110.0, "state": "WATCH"}],
        "trigger": {
            "id": "DAILY:D LOW:100.00",
            "kind": "DAILY",
            "label": "D LOW",
            "price": 100.0,
            "direction": "LONG",
            "reaction": "RECLAIM_REJECTION",
            "state": "PLAYED",
            "played_at_ms": now - 60_000,
            "reaction_candle_start": now - 240_000,
            "reaction_candle_end": now - 1,
            "reaction_candle_low": 98.0,
            "reaction_candle_high": 103.0,
        },
    }
    # The current bar has a much higher low; using it would incorrectly tighten
    # the stop away from the actual reaction invalidation.
    state = MarketState(
        last_price=102.0,
        candles_5=[candle(now - 60_000, 102.0, 103.0, 101.5, 102.0, False)],
    )
    state._as_of_ms = now
    f = MarketFeatures(atr_15=2.0, atr_60=4.0)

    sig = engine._level_reaction_signal(state, f)
    assert sig is not None
    assert sig.evidence["level_reaction_stop_anchor"]["low"] == 98.0
    assert sig.stop <= 98.0


def test_fully_tapped_level_retires_after_five_minutes_without_blind_trade():
    tracker = LevelReactionTracker()
    state = MarketState(
        last_price=103.0,
        candles_5=[candle(1_000_000, 103.0, 103.5, 102.5, 103.0, False)],
    )
    f = MarketFeatures(atr_15=4.0, previous_day_low=100.0)

    # First observation only maps the level; hindsight cannot consume it.
    first = tracker.update(state, f, now_ms=1_100_000)
    assert any(row["label"] == "D LOW" for row in first["levels"])

    # A later live bar fully trades through the exact level but does not reclaim
    # far enough to qualify a trade. It becomes TAPPED, not a signal.
    state.candles_5=[candle(1_200_000, 100.4, 100.7, 99.7, 100.1, False)]
    state.last_price=100.1
    tapped = tracker.update(state, f, now_ms=1_250_000)
    row = next(row for row in tapped["levels"] if row["label"] == "D LOW")
    assert row["state"] == "TAPPED"
    assert tapped["trigger"] is None
    assert row["hide_after_ms"] - row["tapped_at_ms"] == FIVE_MIN_MS

    # It remains visible briefly, then retires and cannot immediately re-arm
    # while the structural level id is unchanged.
    state.last_price=101.0
    before = tracker.update(state, f, now_ms=1_250_000 + FIVE_MIN_MS - 1)
    assert any(row["label"] == "D LOW" for row in before["levels"])
    after = tracker.update(state, f, now_ms=1_250_000 + FIVE_MIN_MS + 1)
    assert all(row["label"] != "D LOW" for row in after["levels"])
    assert after["trigger"] is None



def test_zone_midpoint_touch_does_not_retire_whole_zone():
    tracker = LevelReactionTracker()
    now = 2_000_000
    state = MarketState(
        last_price=100.5,
        candles_5=[candle(now - 60_000, 100.4, 100.8, 100.2, 100.5, False)],
    )
    f = MarketFeatures(atr_15=5.0)
    # Inject one already-seen manual-style zone directly through the tracker by
    # patching collect_reaction_levels in this module.
    import app.level_reactions as lr
    original = lr.collect_reaction_levels
    lr.collect_reaction_levels = lambda *_: [{
        "id":"zone","kind":"OB_ZONE","label":"1H OB","price":100.5,
        "direction":"BOTH","zone_low":100.0,"zone_high":101.0,
    }]
    try:
        tracker.update(state, f, now_ms=now-1_000)
        result = tracker.update(state, f, now_ms=now)
    finally:
        lr.collect_reaction_levels = original
    assert "zone" not in tracker.tapped
    assert any(row["id"]=="zone" for row in result["levels"])


def test_expired_unconfirmed_candle_cannot_trigger_new_reclaim_with_later_price():
    tracker = LevelReactionTracker()
    start = 3_000_000
    state = MarketState(
        last_price=102.0,
        candles_5=[candle(start, 100.0, 103.0, 99.0, 102.0, False)],
    )
    f = MarketFeatures(atr_15=5.0, previous_day_low=100.0)
    tracker.update(state, f, now_ms=start+60_000)
    # In the next bar, the cached open candle is already expired even
    # though a fresh quote arrives; it cannot supply an old sweep wick.
    state.last_price = 100.0
    touched = tracker.update(state, f, now_ms=start+300_000+20_000)
    assert touched["reaction_candle_fresh"] is False
    assert touched["trigger"] is None
    state.last_price = 102.0
    late = tracker.update(state, f, now_ms=start+300_000+40_000)
    assert late["reaction_candle_fresh"] is False
    assert late["trigger"] is None


def test_forming_candle_timing_allows_one_second_edge_not_90s():
    start = 5_000_000
    raw = candle(start,100,102,99,100,False)
    state = MarketState(last_price=100,candles_5=[raw])
    assert LevelReactionTracker._live_candle(state,raw.end) is raw
    assert LevelReactionTracker._live_candle(state,raw.end+1000) is raw
    assert LevelReactionTracker._live_candle(state,raw.end+1001) is None


def test_only_exchange_trade_profile_exact_npoc_can_arm_level():
    from app.level_reactions import collect_reaction_levels
    estimated = MarketFeatures(volume_context={
        "untouched_poc": 100.0, "exact_npoc": False,
        "profile_status": "ESTIMATED",
    })
    assert not any(r["kind"] == "NPOC" and r.get("source") == "EXECUTED_TRADE_PROFILE"
                   for r in collect_reaction_levels(estimated))
    exact = MarketFeatures(volume_context={
        "untouched_poc": 100.0, "exact_npoc": True,
        "profile_status": "VERIFIED",
    })
    rows = collect_reaction_levels(exact)
    assert any(r["kind"] == "NPOC" and r["price"] == 100
               and r.get("source") == "EXECUTED_TRADE_PROFILE" for r in rows)


def test_verified_npoc_touch_only_arms_until_fresh_reclaim():
    tracker = LevelReactionTracker()
    start = 8_000_000
    state = MarketState(
        last_price=102.0,
        candles_5=[candle(start,100,102.3,99.2,102,False)],
    )
    f = MarketFeatures(
        atr_15=5.0, market_structure="BULLISH",
        volume_context={"untouched_poc": 100.0, "exact_npoc": True},
    )
    observed = tracker.update(state,f,now_ms=start+60_000)
    assert observed["trigger"] is None  # No hindsight on discovery.
    state.last_price = 100.0
    touched = tracker.update(state,f,now_ms=start+61_000)
    assert touched["trigger"] is None  # Level contact alone is not a trade.
    state.last_price = 102.0
    reclaim = tracker.update(state,f,now_ms=start+62_000)
    assert reclaim["trigger"] is not None
    assert reclaim["trigger"]["kind"] == "NPOC"
    assert reclaim["trigger"]["direction"] == "LONG"
