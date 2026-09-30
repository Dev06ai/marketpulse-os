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
