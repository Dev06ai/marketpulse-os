from app.learning import AdaptiveLearning
from app.models import MarketState
from app.strategy import StrategyEngine


def base_signal():
    return {
        "id": "unit-test-long-1",
        "setup": "Bullish SFP • FAST",
        "direction": "LONG",
        "timeframe": "5m",
        "entry": 100.0,
        "stop": 95.0,
        "target1": 107.5,
        "target2": 115.0,
        "rr": 3.0,
        "confidence": 0.70,
        "grade": "A",
        "regime": "RANGE",
        "evidence": {
            "trend_15": "UP",
            "trend_60": "UP",
            "trend_240": "UP",
            "market_structure": "BULLISH",
            "cvd_price_divergence": "BULLISH",
            "fvg_direction": "BULLISH",
            "order_block_direction": "BULLISH",
            "golden_pocket": "LONG_ZONE",
        },
    }


def test_learning_is_bounded_and_generates_next_time_advice(tmp_path):
    learner = AdaptiveLearning()
    learner.path = tmp_path / "learning.json"
    learner.data = {"version": 1, "trades": [], "profiles": {}, "conditions": {}, "lessons": []}
    signal = base_signal()
    learner.record_open(signal)
    learner.record_event(signal, "TP1_HIT", 107.5, "TP1 reached")
    lesson = learner.resolve(signal, "TP2_REACHED", 3.0)
    assert lesson["do_next_time"]
    assert learner.summary()["trades_learned"] == 1
    assert learner.context(signal)["confidence_delta"] == 0.0


def test_tp1_then_tp2_emit_separate_milestones():
    engine = StrategyEngine(learning=AdaptiveLearning())
    engine.active_signal = base_signal()
    engine.signal_status = "ACTIVE"

    state = MarketState(last_price=107.5, data_health="HEALTHY")
    engine._update_signal_lifecycle(state)
    assert engine.signal_status == "ACTIVE"
    assert engine.last_lifecycle_events[-1]["type"] == "TP1_HIT"
    assert engine.active_signal["tp1_hit_ts"]

    state.last_price = 115.0
    engine._update_signal_lifecycle(state)
    assert engine.signal_status == "TARGET_REACHED"
    assert engine.last_lifecycle_events[-1]["type"] == "TP2_HIT"
    assert engine.active_signal["tp2_hit_ts"]
    assert engine.active_signal["learning_review"]["outcome"] == "TP2_REACHED"


def test_sl_after_tp1_is_learned_as_partial_then_reversal():
    engine = StrategyEngine(learning=AdaptiveLearning())
    signal = base_signal()
    signal["id"] = "unit-test-long-sl"
    engine.active_signal = signal
    engine.signal_status = "ACTIVE"

    state = MarketState(last_price=108.0, data_health="HEALTHY")
    engine._update_signal_lifecycle(state)
    assert engine.last_lifecycle_events[-1]["type"] == "TP1_HIT"

    state.last_price = 95.0
    engine._update_signal_lifecycle(state)
    assert engine.signal_status == "INVALIDATED"
    assert engine.last_lifecycle_events[-1]["type"] == "SL_HIT"
    assert engine.active_signal["learning_review"]["outcome"] == "SL_HIT"


def test_profitable_manual_close_is_learned_as_win(tmp_path):
    learner = AdaptiveLearning()
    learner.path = tmp_path / "learning.json"
    signal = base_signal()
    learner.record_open(signal)
    lesson = learner.resolve(signal, "CLOSED", 0.8)
    assert lesson["outcome"] == "CLOSED"
    assert learner.summary()["wins"] == 1
    assert learner.summary()["losses"] == 0
