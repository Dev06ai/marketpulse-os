"""Candidate ranking must not hide a safer, independently eligible setup."""
import pytest

from app import strategy
from app.strategy import Signal, StrategyEngine
from test_decision_v3 import features
from test_htf_policy import scenario


def candidate(identity, confidence, stop=99000):
    return Signal(id=identity, direction="LONG", setup="Trend Pullback",
        entry=100000, stop=stop, target1=102000, target2=104500,
        rr=4500 / (100000-stop), confidence=confidence, grade="A",
        regime="TREND_UP", invalidation="confirmed pullback low", thesis=[],
        evidence={}, timeframe="15m", trade_style="SWING", style_reason="1h context")


@pytest.fixture
def selection(monkeypatch, tmp_path):
    monkeypatch.setenv("LEARNING_STATE_FILE", str(tmp_path/"learning.json"))
    monkeypatch.setenv("DECISION_JOURNAL_FILE", str(tmp_path/"journal.db"))
    monkeypatch.setenv("KYVORIQ_EARLY_ROUTER_MODE", "off")
    monkeypatch.setenv("KYVORIQ_LANGGRAPH_MODE", "off")
    monkeypatch.setenv("DEMO_EXECUTION_PAUSED", "false")
    f=features(); f.market_structure="BULLISH"
    monkeypatch.setattr(strategy, "compute_features", lambda state:f)
    for name in ("detect_sfp", "detect_dline", "detect_mss", "detect_breakout_retest", "detect_trend_pullback"):
        monkeypatch.setattr(strategy, name, lambda state:None)
    engine=StrategyEngine()
    monkeypatch.setattr(engine, "_momentum_signal", lambda state,f:None)
    monkeypatch.setattr(engine, "_level_reaction_signal", lambda state,f:None)
    _,state=scenario()
    state.last_trade_ts=state.last_book_ts=state.last_market_update_ts

    def supply(first, second):
        monkeypatch.setattr(strategy, "detect_sfp", lambda state:first)
        monkeypatch.setattr(strategy, "detect_trend_pullback", lambda state:second)
    return engine,state,supply


def test_invalid_high_score_does_not_hide_valid_lower_score(selection):
    engine,state,supply=selection
    supply(candidate("unsafe-top", .99, 99900), candidate("valid-second", .85))
    selected=engine.evaluate(state)
    assert selected is not None
    assert selected.id=="valid-second"
    assert engine.daily_signal_count==1
    assert set(engine.active_signals)=={"valid-second"}
    decisions={row["id"]:row for row in engine.candidate_decisions}
    assert not decisions["unsafe-top"]["allow"]
    assert "STOP_INSIDE_LIQUIDITY_NOISE_OR_INVALIDATION" in decisions["unsafe-top"]["reason"]
    assert decisions["valid-second"]["allow"]
    assert engine.last_diagnostics["htf_policy"]["eligible"]


def test_no_candidate_surviving_htf_policy_keeps_signal_quota(selection):
    engine,state,supply=selection
    supply(candidate("bad-one", .99, 99900), candidate("bad-two", .90, 99800))
    assert engine.evaluate(state) is None
    assert engine.daily_signal_count==0
    assert not engine.active_signals
    assert "htf_structural_risk" in engine.last_diagnostics["blocked_by"]
    assert all(not row["allow"] for row in engine.candidate_decisions)


def test_best_eligible_candidate_retains_existing_rank(selection):
    engine,state,supply=selection
    supply(candidate("lower", .85), candidate("higher", .90))
    assert engine.evaluate(state).id=="higher"
    assert engine.daily_signal_count==1


@pytest.mark.parametrize("barrier", ["daily_cap", "pause", "stale_book"])
def test_candidate_fallback_never_bypasses_existing_barriers(selection,monkeypatch,barrier):
    engine,state,supply=selection
    supply(candidate("invalid", .99, 99900), candidate("valid", .85))
    before=0
    if barrier=="daily_cap":
        engine.daily_signal_count=strategy._quality_max_daily()
        before=engine.daily_signal_count
    elif barrier=="pause":
        monkeypatch.setenv("DEMO_EXECUTION_PAUSED", "true")
    else:
        state.last_book_ts-=6000
    assert engine.evaluate(state) is None
    assert engine.daily_signal_count==before
    assert not engine.active_signals


@pytest.mark.parametrize("failure", ["veto", "unavailable"])
def test_fallback_still_requires_guard_review(selection,monkeypatch,failure):
    from app import decision_graph
    engine,state,supply=selection
    supply(candidate("invalid", .99, 99900), candidate("valid", .85))
    monkeypatch.setenv("KYVORIQ_LANGGRAPH_MODE", "guard")
    reviewed=[]
    def review(**kwargs):
        reviewed.append(kwargs)
        if failure=="unavailable":
            raise RuntimeError("review unavailable")
        return {"version":"test", "action":"WAIT", "blockers":["test veto"]}
    monkeypatch.setattr(decision_graph, "review_decision", review)
    assert engine.evaluate(state) is None
    assert len(reviewed)==1
    assert reviewed[0]["original_id"]=="valid"
    assert [row["id"] for row in reviewed[0]["candidates"]]==["valid"]
    assert engine.daily_signal_count==0
    assert not engine.active_signals
    assert engine.last_diagnostics["blocked_by"]==[
        "langgraph_review" if failure=="veto" else "langgraph_unavailable"]
