"""LangGraph early router, nuanced advisory supervisor, risk and durability."""
import time

from app.agent_orchestration import (
    build_early_candidates, classify_setup, data_sentinel,
    risk_guardian, supervisor_context,
)
from app.calibration_observer import summarize_forward_cohorts
from app.decision_graph import review_early_opportunities
from app.journal import DecisionJournal
from test_langgraph_review import market, signal


def test_early_router_reviews_rejected_detector_and_radar_without_executing():
    detected=signal()
    watch={"direction":"SHORT","setup":"Bearish SFP • FAST","tier":"DEVELOPING"}
    report=review_early_opportunities(market(),[detected],[watch])
    assert report["action"]=="OBSERVE"
    assert report["selected_id"] is None
    assert report["execution_capable"] is False
    assert not report["can_create_new_signal"]
    assert report["route"]["detector_count"]==1
    assert report["route"]["radar_count"]==1
    reviewed={x["source"]:x for x in report["candidate_reviews"]}
    assert len(reviewed["DETECTOR_PRE_GATE"]["agents"])==4
    assert "NONFINITE_OR_MISSING_PRICES" in reviewed["RADAR_NO_EXECUTABLE_PLAN"]["blockers"]
    assert report["candidate_reviews"][0]["adaptive_supervisor"]["profile"]=="REVERSAL"


def test_early_radar_missing_plan_cannot_be_approved():
    report=review_early_opportunities(market(),[],[
        {"direction":"LONG","tier":"CONFIRMED","setup":"SFP at daily low"}])
    assert report["action"]!="APPROVE"
    assert report["route"]["detector_count"]==0
    assert all(x["risk_guardian"]["execution_capable"] is False
               for x in report["candidate_reviews"])


def test_countertrend_sfp_preserves_reversal_profile_with_advisory_trend():
    row={"setup":"Bullish SFP","direction":"LONG",
         "agents":{
             "regime":{"verdict":"CAUTION","concerns":["4H_TREND_OPPOSES"]},
             "liquidity":{"verdict":"SUPPORT","support":["DIRECTIONAL_LEVEL_REACTION_CONFIRMED"]},
             "orderflow":{"verdict":"UNKNOWN"},"entry_timing":{"verdict":"SUPPORT"},
         }}
    result=supervisor_context(row)
    assert classify_setup(row)["profile"]=="REVERSAL"
    assert result["focus"]=="REVERSAL_TRIGGER_PRESENT"
    assert result["regime_conflict_is_hard_veto"] is False
    assert result["may_override_execution_rules"] is False


def test_data_sentinel_marks_nonfresh_derivatives_as_unknown_not_block():
    m=market(book_update_ms=0,trade_update_ms=0,oi_update_ms=0)
    report=data_sentinel(m)
    assert report["quote"]["status"]=="FRESH"
    assert not report["critical_blockers"]
    assert report["funding"]["status"]=="UNKNOWN"
    assert report["open_interest"]["status"]=="UNKNOWN"
    assert "ORDERBOOK_NOT_FRESH" in report["advisories"]
    m["market_update_ms"]-=9000
    assert "MARKET_QUOTE_STALE" in data_sentinel(m)["critical_blockers"]


def test_guardian_checks_leverage_risk_rr_but_cannot_execute():
    good=signal()
    result=risk_guardian(good,selected=True,max_leverage=20,max_risk_pct=1)
    assert not result["blockers"] and not result["execution_capable"]
    bad=risk_guardian(signal(target2=100600,rr=1.2),selected=True,
                      max_leverage=21,max_risk_pct=3.0)
    assert "GROSS_RR_BELOW_2_5" in bad["blockers"]
    assert "INADEQUATE_GROSS_REWARD_RISK" in bad["blockers"]
    assert "LEVERAGE_OUTSIDE_1_TO_20" in bad["blockers"]
    assert "EQUITY_RISK_EXCEEDS_1_PERCENT" in bad["blockers"]


def test_journal_status_never_claims_restart_durability_without_evidence(tmp_path):
    journal=DecisionJournal(tmp_path/"agent.sqlite")
    assert journal.record("AGENT_EARLY",{"action":"OBSERVE"})
    status=journal.status()
    assert status["ready"]
    assert not status["volume"]["restart_durability_proven"]
    assert status["volume"]["mount_check"] in {"EXPLICIT_MOUNT_SEEN","NO_EXPLICIT_DATA_MOUNT_SEEN"}
    assert DecisionJournal(tmp_path/"agent.sqlite").records(1,"AGENT_EARLY")[0]["action"]=="OBSERVE"


def test_holdout_calibration_never_claims_profit_or_autotunes():
    tiny=summarize_forward_cohorts([],True)
    assert tiny["status"]=="INSUFFICIENT_VERIFIED_FORWARD_SAMPLE"
    matched=[]
    for i in range(40):
        matched.append((
            {"_net":(2.0 if i%2 else -1.0),"closed_ts":1000+i},
            {"adaptive_supervisor":{"profile":"REVERSAL" if i%2 else "CONTINUATION"}}
        ))
    result=summarize_forward_cohorts(matched,True)
    assert result["status"]=="DESCRIPTIVE_FORWARD_HOLDOUT"
    assert result["earlier_sample"]==28
    assert result["later_holdout"]==12
    assert result["strategy_changed"] is False
    assert not result["profitability_proven"]
    assert summarize_forward_cohorts(matched,False)["status"]=="INSUFFICIENT_VERIFIED_FORWARD_SAMPLE"


def test_new_endpoints_are_readonly(monkeypatch,tmp_path):
    import asyncio
    from app import main
    from app.opportunity_scout import OpportunityScout
    from types import SimpleNamespace
    j=DecisionJournal(tmp_path/"agent.sqlite")
    mock=SimpleNamespace(last_diagnostics={"early_router":{"action":"OBSERVE"}},
                         journal=j,level_reaction_state={})
    monkeypatch.setattr(main,"engine",mock)
    assert asyncio.run(main.opportunity_router_status())["current"]["action"]=="OBSERVE"
    assert asyncio.run(main.agents_storage_status())["storage"]=="LOCAL_SQLITE"
