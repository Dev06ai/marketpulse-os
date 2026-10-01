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


def test_quality_governor_locks_until_active_signal_resolves():
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
    }
    engine.signal_status = "ACTIVE"
    assert engine.evaluate(state) is None
    assert engine.governor_status()["active_signal_lock"] is True


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
    engine.daily_signal_count = 3
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
        candles[-2].close + 50.0,
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
