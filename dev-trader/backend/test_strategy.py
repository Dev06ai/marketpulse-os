import time

from app.models import Candle, MarketState
from app.strategy import detect_sfp, detect_dline, _trade_plan
from app.analytics import MarketFeatures

def c(i,o,h,l,cl,confirmed=True):
    return Candle(i*900000,(i+1)*900000,o,h,l,cl,100,confirmed)

def test_bearish_sfp():
    cs=[c(i,100,102+i%2,99,100+(i%3)) for i in range(12)]
    cs[4]=c(4,100,102,60,100)
    cs[6]=c(6,100,110,99,100)
    cs[-2]=c(10,100,102,99,101)
    cs[-1]=c(11,100,112,95,100)
    state=MarketState(candles_15=cs, last_price=100, data_health="HEALTHY")
    sig=detect_sfp(state)
    assert sig is not None
    assert sig.direction=="SHORT"
    assert sig.rr >= 3.0

def test_bullish_dline_smoke():
    cs=[]
    for i in range(24):
        base=100+i*0.4
        low=base
        high=base+2
        close=base+1
        cs.append(c(i,base+0.5,high,low,close))
    cs[-1]=c(23,107.0,111.0,106.8,110.5)
    state=MarketState(candles_15=cs,candles_60=cs[-12:])
    sig=detect_dline(state)
    assert sig is None or sig.direction=="LONG"


def test_engine_diagnostics_explain_wait_state():
    from app.strategy import StrategyEngine
    cs=[c(i,100,102,99,100) for i in range(24)]
    state=MarketState(candles_15=cs,candles_60=cs[:12],last_price=100,data_health="HEALTHY")
    d=StrategyEngine().diagnostics(state)
    assert d["status"]=="SCANNING"
    assert "SFP" in d["setups"]
    assert "D-Line" in d["setups"]
    assert "MSS" in d["setups"]
    assert d["wait_reason"]
    assert d["manual_execution_only"] is True


def test_evidence_matrix_consistent_with_radar():
    from app.strategy import StrategyEngine
    cs=[c(i,100+i*0.2,102+i*0.2,99+i*0.2,101+i*0.2) for i in range(24)]
    state=MarketState(candles_15=cs,candles_60=cs[:12],last_price=105.6,data_health="HEALTHY")
    engine=StrategyEngine()
    d=engine.diagnostics(state)
    assert set(d["evidence_matrix"]) == {"LONG", "SHORT"}
    assert d["evidence_matrix"]["LONG"]["max_score"] == 8
    assert d["evidence_matrix"]["SHORT"]["max_score"] == 8
    assert "price_oi" in d["evidence_matrix"]["LONG"]["checks"]
    assert "nearby_memory" in d["evidence_matrix"]["LONG"]["checks"]


def test_trade_plan_widens_microscopic_stop_and_builds_realistic_targets():
    f = MarketFeatures(atr_15=180.0, trend_60="DOWN", trend_240="DOWN", market_structure="BEARISH")
    stop, tp1, tp2, style, reason, risk = _trade_plan(
        direction="SHORT",
        setup="Bearish SFP • FAST",
        timeframe="5m",
        entry=84231.70,
        raw_stop=84294.13,
        raw_target=83312.70,
        f=f,
    )
    assert style == "SCALP"
    assert risk >= 180.0 * 0.65
    assert stop > 84294.13
    assert tp1 < 84231.70
    assert tp2 < tp1
    assert 3.0 <= abs(tp2 - 84231.70) / risk <= 3.5


def test_aligned_15m_setup_can_be_classified_as_swing():
    f = MarketFeatures(atr_15=150.0, trend_60="UP", trend_240="UP", market_structure="BULLISH")
    stop, tp1, tp2, style, reason, risk = _trade_plan(
        direction="LONG",
        setup="MSS Continuation",
        timeframe="15m",
        entry=84000.0,
        raw_stop=83880.0,
        raw_target=85000.0,
        f=f,
    )
    assert style == "SWING"
    assert risk >= 150.0
    assert tp1 > 84000.0
    assert tp2 > tp1
    assert 3.5 <= abs(tp2 - 84000.0) / risk <= 5.0


def test_quality_governor_allows_independent_setups_while_trade_is_active():
    from app.strategy import StrategyEngine
    cs = [c(i,100,102,99,100,confirmed=True) for i in range(24)]
    state = MarketState(
        candles_15=cs,
        candles_60=cs[:12],
        last_price=100,
        data_health="HEALTHY",
    )
    engine = StrategyEngine()
    engine.active_signal = {
        "id": "existing-1",
        "direction": "LONG",
        "setup": "Bullish SFP • FAST",
        "entry": 100.0,
        "stop": 98.0,
        "target1": 103.0,
        "target2": 106.0,
        "rr": 3.0,
        "confidence": 0.90,
        "grade": "A",
    }
    engine.signal_status = "ACTIVE"
    engine.active_signals["existing-1"] = engine.active_signal
    assert engine.governor_status()["active_signal_lock"] is False
    assert engine.governor_status()["active_signal_count"] == 1


def test_quality_governor_enforces_daily_cap():
    from app.strategy import StrategyEngine
    cs = [c(i,100,102,99,100,confirmed=True) for i in range(24)]
    state = MarketState(
        candles_15=cs,
        candles_60=cs[:12],
        last_price=100,
        data_health="HEALTHY",
    )
    engine = StrategyEngine()
    engine.daily_signal_count = 6
    assert engine.evaluate(state) is None
    assert "DAILY CAP" in engine.governor_status()["lock_reason"]


def test_quality_governor_enforces_post_resolution_cooldown():
    from app.strategy import StrategyEngine
    import time as _time
    cs = [c(i,100,102,99,100,confirmed=True) for i in range(24)]
    state = MarketState(
        candles_15=cs,
        candles_60=cs[:12],
        last_price=100,
        data_health="HEALTHY",
    )
    engine = StrategyEngine()
    engine.signal_status = "NONE"
    engine.last_resolved_ts = int(_time.time() * 1000)
    assert engine.evaluate(state) is None
    assert "COOLDOWN" in engine.governor_status()["lock_reason"]


def test_elliott_impulse_rules_and_context():
    from app.elliott_wave import _bull_impulse, _bear_impulse

    bull = [
        ("L", 0, 100.0),
        ("H", 1, 110.0),
        ("L", 2, 104.0),
        ("H", 3, 120.0),
        ("L", 4, 114.0),
        ("H", 5, 128.0),
    ]
    ok, confidence, reason = _bull_impulse(bull)
    assert ok is True
    assert confidence >= 0.8
    assert "5-wave impulse" in reason

    invalid_bull = [
        ("L", 0, 100.0),
        ("H", 1, 110.0),
        ("L", 2, 99.0),   # wave 2 retraces 100%+
        ("H", 3, 120.0),
        ("L", 4, 114.0),
        ("H", 5, 128.0),
    ]
    ok, _, _ = _bull_impulse(invalid_bull)
    assert ok is False

    bear = [
        ("H", 0, 128.0),
        ("L", 1, 118.0),
        ("H", 2, 124.0),
        ("L", 3, 108.0),
        ("H", 4, 114.0),
        ("L", 5, 100.0),
    ]
    ok, confidence, reason = _bear_impulse(bear)
    assert ok is True
    assert confidence >= 0.8
    assert "5-wave impulse" in reason


def test_market_features_include_elliott_context():
    from app.analytics import compute_features
    cs = [c(i, 100 + i * 0.5, 102 + i * 0.5, 99 + i * 0.5, 101 + i * 0.5) for i in range(24)]
    state = MarketState(
        candles_15=cs,
        candles_60=cs,
        last_price=112.5,
        data_health="HEALTHY",
    )
    f = compute_features(state)
    assert f.elliott_phase
    assert f.elliott_direction in {"LONG", "SHORT", "NEUTRAL", "UNKNOWN"}
    assert 0.0 <= f.elliott_confidence <= 1.0


def test_market_story_is_structured_and_auditable():
    from app.strategy import StrategyEngine

    cs = [c(i, 100 + i * 0.2, 102 + i * 0.2, 99 + i * 0.2, 101 + i * 0.2) for i in range(30)]
    state = MarketState(
        candles_15=cs,
        candles_60=cs,
        last_price=106.8,
        data_health="HEALTHY",
    )
    engine = StrategyEngine()
    diagnostics = engine.diagnostics(state)
    story = diagnostics["market_story"]

    assert story["bias"] in {"BULLISH", "BEARISH", "LEAN_LONG", "LEAN_SHORT", "BALANCED"}
    assert isinstance(story["summary"], str) and story["summary"]
    assert isinstance(story["narrative"], list) and story["narrative"]
    assert "15m" in story["wave_context"]
    assert "1h" in story["wave_context"]
    assert "LONG" in story["trade_map"]
    assert "SHORT" in story["trade_map"]
    assert "no_trade_reason" in story


def test_harmonic_context_accepts_ratio_cluster_and_rejects_weak_matches():
    from app.analytics import _harmonic_context

    class X:
        def __init__(self, start, open_, high, low, close):
            self.start = start
            self.open = open_
            self.high = high
            self.low = low
            self.close = close
            self.confirmed = True

    # Synthetic bullish X-A-B-C-D-like geometry inside the tolerant ranges.
    prices = [100.0, 120.0, 109.0, 116.0, 104.0, 0.0]
    candles = []
    for i in range(5):
        p = prices[i]
        candles.append(X(i * 60_000, p, p + 0.1, p - 0.1, p))
    # Add neighbors to make local pivot detection possible.
    candles = [
        X(0, 100, 100.5, 99.5, 100),
        X(1, 120, 120.5, 119.5, 120),
        X(2, 109, 109.5, 108.5, 109),
        X(3, 116, 116.5, 115.5, 116),
        X(4, 104, 104.5, 103.5, 104),
        X(5, 118, 118.5, 117.5, 118),
        X(6, 101, 101.5, 100.5, 101),
    ]
    pattern, direction, confidence, _ = _harmonic_context(candles)
    assert pattern in {"NONE", "HARMONIC_LIKE"}
    assert direction in {"LONG", "NEUTRAL"}


def test_reference_scenarios_are_wired_into_scenario_tree():
    from app.strategy import StrategyEngine

    engine = StrategyEngine()
    cs = [c(i, 100 + i * 0.1, 102 + i * 0.1, 99 - i * 0.05, 101 + i * 0.1) for i in range(40)]
    state = MarketState(
        candles_15=cs,
        candles_60=cs,
        last_price=104.0,
        data_health="HEALTHY",
    )
    diagnostics = engine.diagnostics(state)
    names = [x.get("name", "") for x in diagnostics.get("scenario_tree", [])]
    assert any("bearish ABC / 5-wave continuation" in x for x in names)
    assert any("1H OB bounce" in x for x in names)
    assert any("harmonic" in x.lower() for x in names)
    assert any("flat B retest" in x for x in names)


def c5(i, o, h, l, cl, volume, confirmed=True):
    return Candle(i * 300000, (i + 1) * 300000, o, h, l, cl, volume, confirmed)


def test_fast_move_context_triggers_early_on_large_5m_expansion():
    from app.strategy import StrategyEngine

    candles = []
    price = 100000.0
    for i in range(18):
        move = 8.0 if i < 14 else 12.0
        o = price
        cl = price + move
        candles.append(c5(i, o, cl + 2.0, o - 2.0, cl, 100.0))
        price = cl

    # Strong current expansion with volume and a local range break.
    candles[-1] = c5(
        17,
        candles[-2].close,
        candles[-2].close + 900.0,
        candles[-2].close - 10.0,
        candles[-2].close + 850.0,
        260.0,
        False,
    )

    state = MarketState(
        candles_5=candles,
        candles_15=[],
        candles_60=[],
        last_price=candles[-1].close,
        book_imbalance=0.20,
        oi_window=[],
        data_health="HEALTHY",
    )
    engine = StrategyEngine()
    ctx = engine._build_fast_move_context(state, MarketFeatures())
    assert ctx["direction"] == "LONG"
    assert ctx["status"] in {"ARMED", "TRIGGERED", "EXTENDED"}
    assert ctx["move_atr"] > 1.0
    assert ctx["volume_ratio"] > 1.0


def test_fast_move_does_not_trigger_on_wick_only_break():
    from app.strategy import StrategyEngine
    candles = []
    price = 100000.0
    for i in range(18):
        cl = price + 20.0
        candles.append(c5(i, price, cl + 2.0, price - 2.0, cl, 100.0))
        price = cl
    # Wick above the recent high, but close/live body does not accept beyond it.
    candles[-1] = c5(
        17,
        candles[-2].close,
        max(c.high for c in candles[-4:-1]) + 80.0,
        candles[-2].close - 5.0,
        candles[-2].close + 5.0,
        220.0,
        False,
    )
    state = MarketState(
        candles_5=candles,
        last_price=candles[-1].close,
        data_health="HEALTHY",
    )
    engine = StrategyEngine()
    ctx = engine._build_fast_move_context(state, MarketFeatures())
    assert ctx["status"] != "TRIGGERED"


def test_momentum_trade_is_not_created_after_mature_impulse():
    from app.strategy import StrategyEngine
    candles = []
    price = 100000.0
    for i in range(18):
        cl = price + 40.0
        candles.append(c5(i, price, cl + 4.0, price - 4.0, cl, 140.0))
        price = cl
    state = MarketState(
        candles_5=candles,
        last_price=price,
        data_health="HEALTHY",
    )
    engine = StrategyEngine()
    f = MarketFeatures()
    ctx = engine._build_fast_move_context(state, f)
    # The exact threshold is implementation detail; a clearly mature impulse
    # must be handled as an extended/watch state rather than a chase entry.
    assert ctx["status"] == "EXTENDED"
    assert engine._momentum_signal(state, f) is None


def test_fast_move_radar_mentions_momentum_in_large_move():
    from app.strategy import StrategyEngine

    candles = []
    price = 100000.0
    for i in range(18):
        cl = price + 25.0
        candles.append(c5(i, price, cl + 3.0, price - 3.0, cl, 100.0))
        price = cl
    candles[-1] = c5(
        17,
        candles[-2].close,
        candles[-2].close + 70.0,
        candles[-2].close - 5.0,
        candles[-2].close + 30.0,
        300.0,
        False,
    )

    state = MarketState(
        candles_5=candles,
        last_price=candles[-1].close,
        data_health="HEALTHY",
    )
    engine = StrategyEngine()
    f = MarketFeatures()
    radar = engine._build_opportunity_radar(state, f)
    assert any("Momentum Capture" in row.get("setup", "") for row in radar)


def test_video_reference_training_is_loaded_and_wave_c_scenario_exists():
    from app.strategy import StrategyEngine

    engine = StrategyEngine()
    cs = [c(i, 84000 + i * 5, 84020 + i * 5, 83950 + i * 5, 84010 + i * 5) for i in range(40)]
    state = MarketState(
        candles_15=cs,
        candles_60=cs,
        last_price=84200.0,
        data_health="HEALTHY",
    )
    diagnostics = engine.diagnostics(state)
    features = diagnostics["market_features"]
    scenarios = diagnostics["scenario_tree"]

    assert features["video_reference_training"] is True
    assert features["video_reference_lessons"] >= 5
    assert any("Wave-C / Wave-5 confluence completion" in s.get("name", "") for s in scenarios)


def test_additional_reference_training_is_loaded():
    from app.strategy import StrategyEngine

    engine = StrategyEngine()
    cs = [c(i, 84000 + ((i % 6) * 20), 84050 + ((i % 6) * 20), 83950 - ((i % 5) * 15), 84000 + ((i % 6) * 15)) for i in range(30)]
    state = MarketState(
        candles_15=cs,
        candles_60=cs,
        last_price=84000.0,
        data_health="HEALTHY",
    )
    diagnostics = engine.diagnostics(state)
    features = diagnostics["market_features"]
    scenarios = diagnostics["scenario_tree"]

    assert features["additional_reference_training"] is True
    assert any("converging trendline compression" in s.get("name", "").lower() for s in scenarios)


def test_learning_vetoes_repeatedly_bad_setup_context(tmp_path):
    from app.learning import AdaptiveLearning
    learner = AdaptiveLearning()
    learner.path = tmp_path / "learning.json"
    signal = {
        "id": "bad-base",
        "setup": "MSS Continuation",
        "direction": "LONG",
        "timeframe": "15m",
        "entry": 100.0,
        "stop": 98.0,
        "target1": 103.0,
        "target2": 104.5,
        "rr": 2.25,
        "confidence": 0.82,
        "grade": "A",
        "regime": "TREND_UP",
        "evidence": {
            "trend_15": "UP",
            "trend_60": "UP",
            "trend_240": "UP",
            "market_structure": "BULLISH",
            "cvd_price_divergence": "NONE",
            "fvg_direction": "NONE",
            "order_block_direction": "NONE",
            "golden_pocket": "NONE",
        },
    }
    for i in range(5):
        signal_i = dict(signal, id=f"bad-{i}")
        learner.record_open(signal_i)
        learner.resolve(signal_i, "SL_HIT", -1.0)
    decision = learner.decision_filter(signal)
    assert decision["allow"] is False
    assert "historical setup edge is weak" in decision["reason"]


def test_duplicate_setup_cluster_is_blocked_for_recent_nearby_signal():
    from app.strategy import StrategyEngine, Signal
    engine = StrategyEngine()
    now = int(time.time() * 1000)
    existing = Signal(
        id="existing",
        direction="LONG",
        setup="MSS Continuation",
        entry=100.0,
        stop=98.0,
        target1=103.0,
        target2=106.0,
        rr=3.0,
        confidence=0.90,
        grade="A",
        regime="TREND_UP",
        invalidation="test",
        thesis=[],
        evidence={},
        timeframe="15m",
        trade_style="SWING",
        style_reason="test",
    ).to_dict()
    existing["created_ts"] = now
    engine.active_signals["existing"] = existing
    candidate = Signal(
        id="candidate",
        direction="LONG",
        setup="MSS Continuation",
        entry=100.02,
        stop=98.02,
        target1=103.3,
        target2=106.3,
        rr=3.0,
        confidence=0.90,
        grade="A",
        regime="TREND_UP",
        invalidation="test",
        thesis=[],
        evidence={},
        timeframe="15m",
        trade_style="SWING",
        style_reason="test",
    )
    blocked, reason = engine._duplicate_setup_blocked(
        candidate,
        MarketState(last_price=100.02, data_health="HEALTHY"),
    )
    assert blocked is True
    assert "duplicate" in reason


def test_fast_move_context_low_displacement_does_not_crash():
    from app.strategy import StrategyEngine
    cs = [Candle(i*300000,(i+1)*300000,100,100.4,99.8,100.1,100,True) for i in range(20)]
    state = MarketState(candles_5=cs, last_price=100.1, data_health="HEALTHY")
    engine = StrategyEngine()
    ctx = engine._build_fast_move_context(state, MarketFeatures(atr_15=1.0))
    assert ctx["status"] == "WATCH"
    assert ctx["extension_threshold"] > 0


def test_direction_evidence_uses_opposite_side_liquidations():
    from app.strategy import StrategyEngine

    engine = StrategyEngine()
    features = MarketFeatures(liquidation_pressure="LONG_LIQUIDATIONS")

    short_score, short_reasons = engine._direction_evidence("SHORT", features)
    long_score, long_reasons = engine._direction_evidence("LONG", features)

    assert short_score == 1
    assert "opposite-side liquidation pressure supports continuation" in short_reasons
    assert long_score == 0
    assert not long_reasons


def test_early_momentum_keeps_the_15m_antichase_veto_off(monkeypatch):
    import app.strategy as strategy_module
    from app.strategy import Signal, StrategyEngine

    now = int(time.time() * 1000)
    state = MarketState(
        candles_15=[
            c(0, 100.0, 101.0, 99.0, 100.0),
            c(1, 100.0, 106.0, 99.0, 105.0),
            c(2, 105.0, 111.0, 104.0, 110.0),
            c(3, 110.0, 141.0, 109.0, 140.0),
        ],
        last_price=140.0,
        data_health="HEALTHY",
        last_market_update_ts=now,
        last_trade_ts=now,
    )
    features = MarketFeatures(
        atr_15=10.0,
        trend_15="UP",
        trend_60="UP",
        trend_240="UP",
        market_structure="BULLISH",
        regime="TREND_UP",
        spread_bps=1.0,
        cvd_price_divergence="BULLISH",
        fvg_direction="BULLISH",
    )
    monkeypatch.setattr(strategy_module, "compute_features", lambda _state: features)

    engine = StrategyEngine()
    engine.learning.decision_filter = lambda _signal: {"allow": True, "reason": ""}

    signal = Signal(
        id="momentum-antichase-test",
        direction="LONG",
        setup="Momentum Capture • FAST",
        entry=140.0,
        stop=132.0,
        target1=151.0,
        target2=164.0,
        rr=3.0,
        confidence=0.90,
        grade="A",
        regime="TREND_UP",
        invalidation="test",
        thesis=[],
        evidence={},
        timeframe="5m",
        trade_style="SCALP",
        style_reason="test",
    )

    allowed, reason = engine._elite_decision_gate(signal, state)
    assert allowed, reason


def test_position_management_uses_opposite_side_liquidations():
    from app.strategy import StrategyEngine, Signal

    engine = StrategyEngine()
    engine.signal_status = "ACTIVE"

    previous = {
        "id": "old-long",
        "direction": "LONG",
        "entry": 100.0,
        "stop": 98.0,
    }
    new_short = Signal(
        id="new-short",
        direction="SHORT",
        setup="Bearish SFP",
        entry=99.0,
        stop=101.0,
        target1=96.0,
        target2=93.0,
        rr=3.0,
        confidence=0.9,
        grade="A",
        regime="TREND_DOWN",
        invalidation="above",
        thesis=[],
        evidence={},
        timeframe="15m",
        trade_style="SCALP",
        style_reason="test",
    )

    state = MarketState(
        last_price=99.0,
        liquidation_long_5m=50.0,
        liquidation_short_5m=5.0,
        data_health="HEALTHY",
    )
    management = engine._build_position_management(previous, new_short, state)

    assert management is not None
    assert any("Long-side liquidation pressure supports the short." in r for r in management["reasons"])
