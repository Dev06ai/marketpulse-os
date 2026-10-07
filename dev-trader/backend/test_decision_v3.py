import asyncio
import time
from types import SimpleNamespace

import pytest

from app.analytics import MarketFeatures, _htf_levels, compute_features
from app.evaluation import (exit_observation, advance_exit, ShadowEvaluator,
                            chronological_split, replay_decisions)
from app.journal import DecisionJournal, performance_scorecard
from app.models import Candle, MarketState, aggregate_candles
from app.playbooks import policy, admission, family
from app.structure import confirmed_swings, timeframe_structure, RegimeSelector
from app.trade_profile import TradeVolumeProfile, DAY_MS
from test_execution import audit_executor, audit_signal


def bars(interval=3_600_000,n=30,start=0):
    return [Candle(start+i*interval,start+(i+1)*interval-1,100+i,102+i,99+i,101+i,10,True) for i in range(n)]


def setup(name="Trend Pullback",direction="LONG"):
    return SimpleNamespace(id="candidate",setup=name,direction=direction,entry=100000.,stop=99500.,
                           target1=100700.,target2=101750.,confidence=.85,rr=3.5,grade="A",evidence={})


def features():
    return MarketFeatures(atr_15=500,atr_60=1000,trend_15="UP",trend_60="UP",trend_240="UP",
        regime="TREND_UP",structure_map={"1h":dict(status="READY",bias="BULLISH",contiguous_recent=True,
            levels=[],last_closed_ts=3_600_000,efficiency=.7),"4h":dict(bias="BULLISH",levels=[])})


def test_aggregation_rejects_missing_duplicate_and_unaligned_hours():
    cs=bars(n=4)
    assert len(aggregate_candles(cs+[cs[0]],4))==1
    assert aggregate_candles(cs[:2]+cs[3:],4)==[]
    assert aggregate_candles(bars(n=4,start=3_600_000),4)==[]


def test_swings_only_exist_after_right_hand_confirmation():
    cs=bars(interval=900_000,n=5)
    cs[2].high=120
    assert confirmed_swings(cs[:4])==[]
    swing=confirmed_swings(cs)[0]
    assert swing["price"]==120 and swing["confirmed_at"]==cs[-1].end+1
    assert timeframe_structure(cs,900_000,cs[3].end+1)["levels"]==[]


def test_swing_cannot_bridge_missing_candles():
    cs=bars(n=5);cs[2].high=200
    assert confirmed_swings(cs[:1]+cs[2:])==[]


def test_future_confirmed_bar_is_excluded_from_structure():
    cs=bars(n=20)
    first=timeframe_structure(cs[:12],3_600_000,cs[11].end+1)
    assert timeframe_structure(cs,3_600_000,cs[11].end+1)==first


def test_closed_swing_break_has_explicit_confirmation_time():
    cs=bars(n=12)
    cs[2].high=120
    cs[7].high=122;cs[7].close=121
    result=timeframe_structure(cs,3_600_000,cs[-1].end+1)
    broken=next(l for l in result["levels"] if l["price"]==120)
    assert broken["status"]=="BROKEN" and broken["invalidated_at"]==cs[7].end+1


def test_regime_hysteresis_counts_distinct_hourly_closes():
    f=features();selector=RegimeSelector()
    assert selector.update(f)["regime"]=="TREND_UP"
    f.regime="TREND_DOWN"
    for _ in range(20):
        assert selector.update(f)["regime"]=="TREND_UP"
    f.structure_map["1h"]["last_closed_ts"]+=3_600_000
    assert selector.update(f)["regime"]=="TREND_UP"
    f.structure_map["1h"]["last_closed_ts"]+=3_600_000
    assert selector.update(f)["regime"]=="TREND_DOWN"
    f.volatility_pct=2
    assert selector.update(f)["regime"]=="HIGH_VOL"


def test_incomplete_days_and_weeks_do_not_create_major_levels():
    # Unix epoch Thursday; anchor a Monday two weeks later.
    monday=11*DAY_MS
    cs=bars(n=168,start=monday-7*DAY_MS)
    full=_htf_levels(cs,monday+1000)
    assert full[0] is not None and full[2] is not None
    assert _htf_levels(cs[1:],monday+1000)[2] is None
    assert _htf_levels(cs[:-1],monday+1000)[0] is None


def test_feature_cache_invalidates_when_a_closed_candle_is_corrected():
    state=MarketState(candles_15=bars(900_000),last_price=130)
    first=compute_features(state)
    assert compute_features(state) is first
    state.candles_15[10].high+=50
    assert compute_features(state) is not first


def test_profile_deduplicates_and_marks_startup_partial():
    p=TradeVolumeProfile(width=25);day=10*DAY_MS
    assert p.ingest("x",day+100,100000,2,day+100)
    assert not p.ingest("x",day+100,100000,2,day+100)
    assert not p.ingest("bad",day+200,float("nan"),1,day+200)
    assert p.sessions[day]["volume"]==2
    result=p.snapshot(day+1000)
    assert result["observed_session_vwap"]==100000 and result["session_vwap"] is None
    assert not result["exact_npoc"]


def complete_profile():
    p=TradeVolumeProfile(width=25);day=10*DAY_MS
    p.connect(day-1)
    for i,ts in enumerate(range(day,day+DAY_MS,30_000)):
        p.ingest(str(i),ts,100000,1,ts)
    p.ingest("next-day",day+DAY_MS,102000,1,day+DAY_MS)
    return p,day+DAY_MS


def test_npoc_requires_both_complete_profile_and_complete_touch_history():
    p,day=complete_profile()
    result=p.snapshot(day+1000)
    assert result["exact_npoc"] and result["untouched_poc"]==100012.5
    p.ingest("touch",day+2000,100010,1,day+2000)
    assert p.snapshot(day+2000)["untouched_poc"] is None


def test_disconnect_across_midnight_invalidates_previous_coverage():
    p,day=complete_profile()
    p.last_received=day-1000
    p.gap(day+1000)
    assert not p.snapshot(day+1000)["previous_session_complete"]
    assert not p.snapshot(day+1000)["exact_npoc"]


def test_malformed_or_unidentified_trade_invalidates_profile_coverage():
    p,day=complete_profile()
    assert p.snapshot(day+1000)["exact_npoc"]
    assert not p.ingest("",day+2000,100000,1,day+2000)
    assert not p.snapshot(day+2000)["exact_npoc"]


def test_v3_continuation_requires_one_hour_context_without_wave_votes():
    f=features();s=setup();state=MarketState(last_price=100000,data_health="HEALTHY",
        last_market_update_ts=1000,last_trade_ts=1000,last_book_ts=1000)
    s.evidence["playbook"]=policy(s,state,f,dict(regime="TREND_UP"))
    assert admission(s,state,f,1100)[0]
    f.elliott_direction="SHORT";f.elliott_confidence=.99;f.harmonic_direction="SHORT";f.harmonic_confidence=.99
    assert admission(s,state,f,1100)[0]
    f.trend_60="DOWN"
    assert not policy(s,state,f,dict(regime="TREND_DOWN"))["allow"]


def test_sfp_must_be_at_major_level_and_have_independent_flow():
    f=features();s=setup("Bullish SFP • FAST");state=MarketState(last_price=100000,data_health="HEALTHY",
        last_market_update_ts=1000,last_trade_ts=1000,last_book_ts=1000)
    assert not policy(s,state,f,dict(regime="TREND_UP"))["allow"]
    f.previous_day_low=99900
    s.evidence["playbook"]=policy(s,state,f,dict(regime="TREND_UP"))
    assert s.evidence["playbook"]["allow"]
    assert not admission(s,state,f,1100)[0]
    f.book_imbalance=.2
    assert admission(s,state,f,1100)[0]


def test_playbook_admission_uses_quality_governor_rr_threshold():
    f=features();s=setup();state=MarketState(last_price=100000,data_health="HEALTHY",
        last_market_update_ts=1000,last_trade_ts=1000,last_book_ts=1000)
    s.rr=2.5
    s.evidence["playbook"]=policy(s,state,f,dict(regime="TREND_UP"))
    allowed,reason=admission(s,state,f,1100,min_confidence=.78,min_rr=3.0)
    assert not allowed and "R:R >= 3.00" in reason
    s.rr=3.1
    assert admission(s,state,f,1100,min_confidence=.78,min_rr=3.0)[0]


def test_zone_and_manual_level_reactions_use_dedicated_playbook():
    now=100_000
    f=features();f.book_imbalance=.2
    state=MarketState(last_price=100000,data_health="HEALTHY",
        last_market_update_ts=now,last_trade_ts=now,last_book_ts=now)

    for setup_name,kind in [
        ("1H OB Zone Reaction","OB_ZONE"),
        ("Weekly nPOC Level Reaction","WEEKLY_NPOC"),
        ("Range POC Level Reaction","RANGE_POC"),
        ("Supply Zone Reaction","SUPPLY_ZONE"),
    ]:
        s=setup(setup_name,"LONG" if kind != "SUPPLY_ZONE" else "SHORT")
        if s.direction == "SHORT":
            f.trend_60="DOWN";f.trend_240="DOWN"
            f.structure_map["1h"]["bias"]="BEARISH"
        else:
            f.trend_60="UP";f.trend_240="UP"
            f.structure_map["1h"]["bias"]="BULLISH"
        s.evidence["level_reaction"]={
            "kind":kind,"label":setup_name,"direction":s.direction,"state":"PLAYED",
            "played_at_ms":now-10_000,"price":99950,
        }
        assert family(s.setup)=="LEVEL_REACTION"
        s.evidence["playbook"]=policy(s,state,f,dict(regime="TREND_DOWN" if s.direction=="SHORT" else "TREND_UP"))
        assert s.evidence["playbook"]["allow"], (setup_name,s.evidence["playbook"]["reason"])


def test_mapped_level_reaction_has_dedicated_playbook_and_freshness_guard():
    now=100_000
    f=features();f.book_imbalance=.2
    s=setup("15M OB Level Reaction","LONG")
    s.evidence["level_reaction"]={
        "kind":"OB","label":"15M OB","direction":"LONG","state":"PLAYED",
        "played_at_ms":now-10_000,"price":99950,
    }
    state=MarketState(last_price=100000,data_health="HEALTHY",
        last_market_update_ts=now,last_trade_ts=now,last_book_ts=now)
    assert family(s.setup)=="LEVEL_REACTION"
    s.evidence["playbook"]=policy(s,state,f,dict(regime="TREND_UP"))
    assert s.evidence["playbook"]["allow"]
    assert s.evidence["playbook"]["at_htf_level"]
    assert admission(s,state,f,now,min_confidence=.78,min_rr=3.0)[0]
    s.evidence["level_reaction"]["played_at_ms"]=now-181_000
    allowed,reason=admission(s,state,f,now,min_confidence=.78,min_rr=3.0)
    assert not allowed and "stale" in reason



@pytest.mark.parametrize("field",["last_market_update_ts","last_trade_ts","last_book_ts"])
def test_v3_never_approves_stale_or_future_feeds(field):
    f=features();s=setup();state=MarketState(last_price=100000,data_health="HEALTHY",
        last_market_update_ts=1000,last_trade_ts=1000,last_book_ts=1000)
    s.evidence["playbook"]=policy(s,state,f,dict(regime="TREND_UP"))
    setattr(state,field,90000)
    assert not admission(s,state,f,1100)[0]


def shadow_signal():
    return dict(id="shadow",direction="LONG",setup="TEST",entry=100000,stop=99500,
                target1=100700,target2=101750,trade_style="SCALP")


def test_partial_exit_uses_costs_and_can_only_tighten_after_confirmed_structure():
    row=exit_observation(shadow_signal(),1000,"PARTIAL_AND_STRUCTURE")
    advance_exit(row,100800,2000)
    assert row["partial"] and row["remaining"]==.5 and row["stop"]==99500
    structure={"1h":dict(levels=[dict(kind="LOW",status="ACTIVE",confirmed_at=1500,price=100300)])}
    advance_exit(row,100900,3000,structure)
    assert row["stop"]==100300
    advance_exit(row,100200,4000,structure)
    assert row["status"]=="CLOSED" and row["net_r"]>0
    # Stop gaps exit at the observed price, not at an imaginary stop fill.
    stopped=exit_observation(shadow_signal(),1000,"FIXED_TARGET")
    advance_exit(stopped,99000,2000)
    assert stopped["net_r"] < -1


def test_shadow_missing_price_path_is_excluded_and_time_exit_is_costed():
    row=exit_observation(shadow_signal(),1000,"TIME_EXIT")
    advance_exit(row,100000,1000+2*3_600_000)
    assert row["reason"]=="TIME" and row["net_r"]<0
    assert row["evidence_status"]=="INCOMPLETE_PATH"


def test_journal_reopens_and_shadow_outcomes_never_count_as_exchange_profit(tmp_path):
    j=DecisionJournal(tmp_path/"journal.db")
    s=ShadowEvaluator(j)
    s.observe_candidate(shadow_signal(),1000,selected=True)
    s.tick(MarketState(last_price=102000,data_health="HEALTHY"),2000,{})
    s.tick(MarketState(last_price=102000,data_health="HEALTHY"),3000,{})
    restored=ShadowEvaluator(DecisionJournal(tmp_path/"journal.db"))
    assert restored.summary()["variants"]["FIXED_TARGET"]["closed"]==1
    assert len(j.records(10,"SHADOW_OUTCOME"))==3
    assert not performance_scorecard([])["profitability_proven"]
    assert j.status()["durability"].startswith("EPHEMERAL")


def test_journal_deduplicates_unchanged_decisions_and_samples_one_price_per_second(tmp_path):
    j=DecisionJournal(tmp_path/"journal.db");state=MarketState(last_price=100000)
    j.observe(state,dict(ts=1000,status="WAIT",regime="RANGE"),[])
    j.observe(state,dict(ts=2000,status="WAIT",regime="RANGE"),[])
    assert j.status()["records"]==1
    j.tick(1000,100000);j.tick(1100,100001)
    assert j.status()["price_samples"]==1


def test_replay_excludes_future_candles_and_does_not_claim_profitability():
    cs=bars(n=20)
    record=dict(kind="DECISION",ts=cs[11].end+1,market=MarketState(candles_60=cs).snapshot(history=True))
    result=replay_decisions([record])
    assert result["records"][0]["structure_map"]["1h"]["last_closed_ts"]==record["ts"]
    assert not result["profitability_backtest_available"]


def test_chronological_split_keeps_equal_timestamps_in_one_window():
    rows=[dict(kind="DECISION",ts=(i//2)*1000) for i in range(30)]
    report=chronological_split(rows)
    assert report["training_end_exclusive"]==report["unseen_start_inclusive"]
    assert report["training_records"]+report["unseen_records"]==30
    assert not chronological_split(rows[:10])["available"]


def test_scorecard_excludes_pending_and_uses_exchange_net_results():
    rows=[dict(status="CLOSED",closed_ts=i+1,net_profit_usdt=p,fees_usdt=-.1,result_r=p)
          for i,p in enumerate([2,-1,-2,3])]
    rows.append(dict(status="OPEN",net_profit_usdt=100))
    report=performance_scorecard(rows)
    assert report["net_usdt"]==2 and report["max_drawdown_usdt"]==3
    assert report["max_consecutive_losses"]==2
    assert report["closed_trades"]==4


def test_canceled_partial_fill_is_managed_as_real_remaining_exposure(monkeypatch,tmp_path):
    executor=audit_executor(monkeypatch,tmp_path)
    executor.client.order_detail=lambda *args:dict(orderStatus="canceled",baseVolume=".001",priceAvg="100000")
    checks=[]
    async def protect(trade): checks.append(trade["filled_qty"])
    executor._ensure_trade_protection=protect
    trade=dict(execution_id="partial",order_id="id",direction="LONG",status="ORDER_PENDING",
               signal_snapshot=audit_signal(),signal_id="signal",entry_plan=100000,filled_qty=0)
    executor.data["trades"]=[trade]
    asyncio.run(executor._poll_fill("partial"))
    assert trade["status"]=="OPEN" and trade["terminal_partial_fill"]
    assert trade["filled_qty"]==.001 and checks==[.001]


def test_partial_fills_are_protected_before_final_fill(monkeypatch,tmp_path):
    executor=audit_executor(monkeypatch,tmp_path)
    values=iter([dict(orderStatus="partially_filled",baseVolume=".001",priceAvg="100000"),
                 dict(orderStatus="filled",baseVolume=".002",priceAvg="100000")])
    executor.client.order_detail=lambda *args:next(values)
    checks=[]
    async def protect(trade): checks.append((trade["status"],trade["filled_qty"]))
    executor._ensure_trade_protection=protect
    async def fast_sleep(_): pass
    monkeypatch.setattr("app.execution.asyncio.sleep",fast_sleep)
    trade=dict(execution_id="partial",order_id="id",direction="LONG",status="ORDER_PENDING",
               signal_snapshot=audit_signal(),signal_id="signal",entry_plan=100000,filled_qty=0)
    executor.data["trades"]=[trade]
    asyncio.run(executor._poll_fill("partial"))
    assert checks==[("ORDER_PENDING",.001),("OPEN",.002)]


def test_execution_identity_retains_v3_family_and_revision_after_restart():
    from app.trade_identity import client_identity,decode_identity
    signal=dict(id="new",direction="LONG",setup="Trend Pullback",timeframe="15m",
                regime="TREND_UP",engine_revision="market-decision-v3")
    recovered=decode_identity(client_identity(signal,2.45))
    assert recovered["setup"]=="TREND PULLBACK"
    assert recovered["engine_revision"]=="market-decision-v3"


def test_journal_failure_is_reported_without_breaking_market_processing(tmp_path):
    j=DecisionJournal(tmp_path/"journal.db")
    assert not j.record("BAD",dict(price=float("nan")))
    assert j.status()["error"]=="ValueError"
    j.db.close()
    assert j.records()==[] and j.status()["error"]=="ProgrammingError"


def test_engine_selects_a_v3_playbook_and_journals_the_decision(monkeypatch,tmp_path):
    from app import strategy
    from app.strategy import StrategyEngine,Signal
    monkeypatch.setenv("LEARNING_STATE_FILE",str(tmp_path/"learn.json"))
    monkeypatch.setenv("DECISION_JOURNAL_FILE",str(tmp_path/"journal.db"))
    now=int(time.time()*1000)
    f=features();f.market_structure="BULLISH"
    monkeypatch.setattr(strategy,"compute_features",lambda state:f)
    signal=Signal(id="v3-integration",direction="LONG",setup="Trend Pullback",entry=100000,stop=99500,
        target1=100700,target2=101750,rr=3.5,confidence=.85,grade="A",regime="TREND_UP",
        invalidation="pullback low",thesis=[],evidence={},timeframe="15m",trade_style="SWING",style_reason="1h context")
    for name in ("detect_sfp","detect_dline","detect_mss","detect_breakout_retest"):
        monkeypatch.setattr(strategy,name,lambda state:None)
    monkeypatch.setattr(strategy,"detect_trend_pullback",lambda state:signal)
    engine=StrategyEngine()
    monkeypatch.setattr(engine,"_momentum_signal",lambda state,f:None)
    state=MarketState(last_price=100000,data_health="HEALTHY",last_market_update_ts=now,last_trade_ts=now,last_book_ts=now)
    assert engine.evaluate(state).id==signal.id
    assert engine.active_signal["engine_revision"]=="market-decision-v3.6"
    record=engine.journal.records(1,"DECISION")[0]
    assert record["report"]["selected"]==signal.id
    assert record["candidates"][0]["family"]=="TREND_PULLBACK"
    assert engine.daily_signal_count==1


def test_evaluation_endpoints_keep_shadow_and_real_results_distinct():
    from app import main
    report=asyncio.run(main.evaluation())
    assert report["engine_revision"]=="market-decision-v3.6"
    assert report["shadow"]["mode"]=="SHADOW_ONLY"
    assert not report["scorecard"]["profitability_proven"]
    replay=asyncio.run(main.decision_replay(1))
    assert not replay["profitability_backtest_available"]
