"""Scout & performance observer must never become paper-fill or trade logic."""
import asyncio

from app.journal import DecisionJournal
from app.models import MarketState
from app.opportunity_scout import (
    GRACE_MS, HORIZON_MS, OpportunityScout, price_path_outcome,
)
from app.performance_learning_agent import analyze_performance


def feed(ts=10_000_000):
    return MarketState(
        last_price=100000, ws_connected=True, data_health="HEALTHY",
        last_market_update_ts=ts,
    )


def rejected(sid="rej-1", direction="LONG", allow=False):
    return {
        "id": sid, "allow": allow,
        "direction": direction, "setup": "SFP at daily low",
        "reason": "No confirmed reclaim",
        "signal": {"id": sid, "direction": direction},
    }


def fresh_path(start, entry=100000, end=101000):
    # 60 minutes of continuous minute data, with a valid terminal tick.
    return [(start + i*60_000, entry+(end-entry)*(i/60.0))
            for i in range(61)]


def test_scout_records_only_observations_and_deduplicates(tmp_path):
    journal = DecisionJournal(tmp_path/"scout.sqlite")
    scout = OpportunityScout(journal)
    now = 10_000_000
    rows = scout.observe(
        feed(now), [rejected()], [{"direction": "LONG", "tier": "DEVELOPING",
                                   "setup": "Momentum Capture"}],
        now_ms=now,
    )
    assert len(rows) == 2
    assert all(row["status"] == "OPEN" for row in rows)
    assert {r["source"] for r in rows} == {"REJECTED_CANDIDATE", "RADAR_WATCH"}
    assert scout.observe(feed(now+1000), [rejected()], [], now_ms=now+1000) == []
    assert journal.records(10, "SCOUT")[0]["interpretation"].endswith("NOT_TRADES")
    assert not scout.summary()["execution_capable"]


def test_selected_is_not_recorded_as_missed_candidate(tmp_path):
    journal = DecisionJournal(tmp_path/"scout.sqlite")
    scout = OpportunityScout(journal)
    assert not scout.observe(feed(), [rejected(allow=True)],
                             [], selected_id="rej-1", now_ms=10_000_000)
    assert not scout.summary()["tracked"]


def test_degraded_stale_or_disconnected_feed_cannot_open_scout(tmp_path):
    scout = OpportunityScout(DecisionJournal(tmp_path/"scout.sqlite"))
    state = feed()
    state.ws_connected = False
    assert not scout.observe(state, [rejected()], [], now_ms=10_000_000)
    state.ws_connected = True
    state.data_health = "DEGRADED"
    assert not scout.observe(state, [rejected()], [], now_ms=10_000_000)
    state.data_health = "HEALTHY"
    state.last_market_update_ts -= 6000
    assert not scout.observe(state, [rejected()], [], now_ms=10_000_000)


def test_scout_result_from_covered_price_path_is_not_a_trade():
    start = 10_000_000
    obs = dict(opened_ts=start, reference_price=100000, direction="LONG")
    result = price_path_outcome(obs, fresh_path(start))
    assert result["status"] == "RESOLVED_PRICE_ONLY"
    assert result["directional_move_pct"] == 1.0
    assert result["favorable_excursion_pct"] == 1.0
    assert result["adverse_excursion_pct"] == 0.0
    assert result["meaning"].endswith("NOT_AN_EXECUTABLE_TRADE")


def test_holes_or_missing_terminal_ticks_are_unverifiable():
    start = 10_000_000
    obs = dict(opened_ts=start, reference_price=100000, direction="SHORT")
    path = fresh_path(start)
    assert price_path_outcome(obs, path[:42])["status"] == "UNVERIFIABLE"
    holed = [row for row in path if row[0] < start+10*60_000 or
             row[0] > start+35*60_000]
    assert price_path_outcome(obs, holed)["status"] == "UNVERIFIABLE"


def test_scout_uses_journal_only_and_survives_restart(tmp_path):
    journal = DecisionJournal(tmp_path/"scout.sqlite")
    start = 10_000_000
    tracker = OpportunityScout(journal)
    assert len(tracker.observe(feed(start), [rejected()], [], now_ms=start)) == 1
    for stamp, price in fresh_path(start):
        journal.tick(stamp, price)
    restarted = OpportunityScout(journal)
    assert restarted.summary()["pending"] == 1
    # The final observation must have matured fully first.
    assert restarted.resolve_due(start+HORIZON_MS+GRACE_MS-1000) == []
    done = restarted.resolve_due(start+HORIZON_MS+GRACE_MS+31_000)
    assert len(done) == 1 and done[0]["status"] == "RESOLVED_PRICE_ONLY"
    assert restarted.resolve_due(start+HORIZON_MS+GRACE_MS+61_000) == []
    assert OpportunityScout(journal).summary()["pending"] == 0
    assert journal.records(50, "SCOUT")[0]["status"] == "RESOLVED_PRICE_ONLY"


def trade(id="tr-1", signal="s-1", net=10, confirmed=True, status="CLOSED"):
    return {
        "execution_id": id, "status": status, "signal_id": signal,
        "actual_fill_confirmed": confirmed, "net_profit_usdt": net,
        "closed_ts": 200_000, "fees_usdt": 0.5,
    }


def graph_record():
    return {
        "ts": 100_000, "version": "langgraph-specialists-v2",
        "engine_selected_id": "s-1",
        "candidate_reviews": [{
            "id": "s-1",
            "agents": {
                "orderflow": {"verdict": "CAUTION"},
                "regime": {"verdict": "SUPPORT"},
            },
        }],
    }


def test_learning_keeps_verified_demo_fills_separate_from_scout():
    scout = [
        {"status": "RESOLVED_PRICE_ONLY", "directional_move_pct": 12,
         "source": "REJECTED_CANDIDATE"},
        {"status": "UNVERIFIABLE", "directional_move_pct": None},
    ]
    report = analyze_performance(
        [trade(), trade(id="pending", status="OPEN", net=99999),
         trade(id="uncertain", confirmed=False, net=99999)],
        [graph_record()], scout,
        ledger={"complete_window": True, "fee_accounting_complete": True},
    )
    assert report["exchange_demo"]["verified_closed"] == 1
    assert report["exchange_demo"]["net_usdt"] == 10
    assert report["exchange_demo"]["matched_langgraph_decisions"] == 1
    assert report["agent_outcome_comparison"]["orderflow"]["CAUTION"]["samples"] == 1
    assert report["agent_outcome_comparison"]["orderflow"]["CAUTION"]["net_mean_usdt"] is None
    assert report["scout_price_observations"]["resolved_price_paths"] == 1
    assert report["scout_price_observations"]["unverifiable"] == 1
    assert report["scout_price_observations"]["metrics_are_trade_profit"] is False
    assert report["profitability_proven"] is False


def test_learning_never_reports_fee_complete_pnl_when_ledger_is_incomplete():
    report = analyze_performance([trade()], [graph_record()], [],
                                 ledger={"complete_window": True,
                                         "fee_accounting_complete": False})
    assert report["exchange_demo"]["net_usdt"] is None
    assert report["exchange_demo"]["average_net_usdt"] is None
    assert report["exchange_demo"]["sample_status"] == "INSUFFICIENT_OR_INCOMPLETE_ACCOUNTING"


def test_unmatched_graph_signals_never_receive_trade_attribution():
    report = analyze_performance([trade(signal="different")],
                                 [graph_record()], [],
                                 ledger={"complete_window": True,
                                         "fee_accounting_complete": True})
    assert report["exchange_demo"]["matched_langgraph_decisions"] == 0
    assert report["agent_outcome_comparison"] == {}


def test_read_only_new_agent_endpoints(monkeypatch,tmp_path):
    from app import main
    tracker = OpportunityScout(DecisionJournal(tmp_path/"j.db"))
    monkeypatch.setattr(main, "scout", tracker)
    assert asyncio.run(main.scout_status())["mode"] == "ADVISORY_ONLY"
    monkeypatch.setattr(main, "agent_learning_snapshot", {})
    monkeypatch.setattr(main, "agent_learning_updated_ms", 0)
    result = asyncio.run(main.performance_learning_status())
    assert result["status"] == "NO_REPORT_YET"
    assert result["execution_capable"] is False
