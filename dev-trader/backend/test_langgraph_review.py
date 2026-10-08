"""Regression tests for the read-only KYVORIQ LangGraph decision reviewer."""
import time

from app.decision_graph import review_decision


def market(**changes):
    now = int(time.time() * 1000)
    base = {
        "health": "HEALTHY",
        "connected": True,
        "now_ms": now,
        "market_update_ms": now,
        "bid": 99999.0,
        "ask": 100001.0,
        "spread_bps": 0.2,
        "level_reactions": {"status": "TRIGGERED", "trigger": {"type": "SFP"}},
    }
    base.update(changes)
    return base


def signal(**changes):
    base = {
        "id": "long-sfp-123",
        "direction": "LONG",
        "setup": "Level Reaction SFP",
        "entry": 100000.0,
        "stop": 99500.0,
        "target2": 101500.0,
        "rr": 3.0,
        "confidence": 0.86,
        "grade": "A",
        "evidence": {
            "decision_engine": {"confirmations": 4},
            "playbook": {"family": "LEVEL_REACTION"},
        },
    }
    base.update(changes)
    return base


def review(m=None, candidates=None, original="long-sfp-123"):
    return review_decision(m or market(), candidates if candidates is not None else [signal()], original)


def test_healthy_long_sfp_passes_read_only_review():
    result = review()
    assert result["action"] == "APPROVE"
    assert result["selected_id"] == "long-sfp-123"
    assert result["execution_capable"] is False
    assert result["trace"] == [
        "market_health", "dispatch_specialists",
        "regime", "liquidity", "orderflow", "entry_timing",
        "candidate_review", "risk_preflight", "supervisor",
    ]
    assert result["agents"] == ["regime", "liquidity", "orderflow", "entry_timing"]
    assert result["confidence_is_probability"] is False
    assert result["candidate_reviews"][0]["family"] == "LEVEL_REACTION"
    assert result["candidate_reviews"][0]["level_status"] == "TRIGGERED"
    assert "signal" not in result["candidate_reviews"][0]


def test_degraded_market_must_wait_not_approve():
    result = review(market(health="DEGRADED"))
    assert result["action"] == "WAIT"
    assert result["selected_id"] is None
    assert "MARKET_FEED_NOT_HEALTHY" in result["blockers"]


def test_stale_quotes_are_rejected_before_candidate_review():
    m = market()
    m["market_update_ms"] -= 5000
    result = review(m)
    assert result["action"] == "WAIT"
    assert "MARKET_QUOTE_STALE" in result["blockers"]
    assert result["trace"] == ["market_health", "supervisor"]


def test_crossed_quote_and_wide_spread_are_blocked():
    result = review(market(bid=100002.0, ask=100001.0, spread_bps=40.0))
    assert result["action"] == "WAIT"
    assert "CROSSED_ORDER_BOOK" in result["blockers"]
    assert "EXCESSIVE_MARKET_SPREAD" in result["blockers"]


def test_invalid_long_stop_geometry_is_rejected():
    result = review(candidates=[signal(stop=100500.0)])
    assert result["action"] == "REJECT"
    assert "INVALID_LONG_STOP_TARGET_GEOMETRY" in result["blockers"]


def test_short_direction_and_geometry_work():
    short = signal(id="short-dline", direction="SHORT",
                   entry=100000.0, stop=100500.0, target2=98500.0)
    result = review(candidates=[short], original="short-dline")
    assert result["action"] == "APPROVE"
    assert result["selected_id"] == "short-dline"


def test_missing_original_or_invalid_reward_risk_cannot_be_approved():
    result = review(original="unknown")
    assert result["action"] == "REJECT"
    assert result["blockers"] == ["ORIGINAL_CANDIDATE_NOT_FOUND"]
    result = review(candidates=[signal(rr=1.0)])
    assert result["action"] == "REJECT"
    assert "INADEQUATE_GROSS_REWARD_RISK" in result["blockers"]


def test_nonfinite_prices_fail_closed():
    result = review(candidates=[signal(entry=float("nan"))])
    assert result["action"] == "REJECT"
    assert "NONFINITE_OR_MISSING_PRICES" in result["blockers"]


def test_graph_never_replaces_existing_engine_selected_id():
    alternative = signal(id="other", confidence=0.99)
    result = review(candidates=[signal(), alternative])
    assert result["action"] == "APPROVE"
    assert result["selected_id"] == "long-sfp-123"
    assert len(result["candidate_reviews"]) == 2


def test_parallel_agents_evaluate_confirmations_without_creating_trade():
    m = market(
        last_price=100030.0,
        book_update_ms=int(time.time()*1000),
        level_reactions={"status": "TRIGGERED", "trigger": {"direction": "LONG", "type": "SFP"}},
        features={
            "trend_60": "UP", "trend_240": "UP", "market_structure": "BULLISH",
            "atr_15": 300.0, "cvd_price_divergence": "BULLISH",
            "book_imbalance": 0.2, "oi_change_5m_pct": 0.3, "oi_points": 5,
        },
    )
    result = review(m)
    row = result["candidate_reviews"][0]
    assert result["action"] == "APPROVE"
    assert row["supporting_agents"] == 4
    assert row["caution_agents"] == 0
    assert row["agents"]["regime"]["verdict"] == "SUPPORT"
    assert row["agents"]["liquidity"]["verdict"] == "SUPPORT"
    assert row["agents"]["orderflow"]["verdict"] == "SUPPORT"
    assert row["agents"]["entry_timing"]["verdict"] == "SUPPORT"
    assert not result["agent_disagreement"]
    assert result["execution_capable"] is False


def test_agents_surface_countertrend_flow_conflict_and_chasing_as_caution_only():
    m = market(
        last_price=102000.0,
        book_update_ms=int(time.time()*1000),
        level_reactions={"status": "TRIGGERED", "trigger": {"direction": "SHORT"}},
        features={
            "trend_60": "DOWN", "trend_240": "DOWN", "market_structure": "BEARISH",
            "atr_15": 400.0, "cvd_price_divergence": "BEARISH",
            "book_imbalance": -0.25, "oi_change_5m_pct": 0.5, "oi_points": 5,
        },
    )
    result = review(m)
    row = result["candidate_reviews"][0]
    assert result["action"] == "APPROVE"  # Advisory, not an unvalidated entry veto.
    assert result["selected_id"] == "long-sfp-123"
    assert row["caution_agents"] == 4
    assert result["agent_disagreement"]
    assert "entry_timing:ENTRY_CHASING_BEYOND_PLAN" in result["selected_concerns"]
    assert "regime:1H_TREND_OPPOSES" in result["selected_concerns"]


def test_absent_or_stale_orderbook_never_counts_as_buy_confirmation():
    m = market(features={
        "trend_60": "UNKNOWN", "trend_240": "UNKNOWN",
        "cvd_price_divergence": "NONE", "book_imbalance": 0.9,
        "oi_change_5m_pct": 0.0, "oi_points": 0,
    }, book_update_ms=0)
    result = review(m)
    flow = result["candidate_reviews"][0]["agents"]["orderflow"]
    assert flow["verdict"] == "UNKNOWN"
    assert "NO_SIGNIFICANT_FRESH_BOOK_IMBALANCE" in flow["unknown"]
    assert "OI_CONTEXT_INSUFFICIENT" in flow["unknown"]


def test_open_interest_is_not_a_directional_confirmation():
    m = market(features={
        "cvd_price_divergence": "NONE", "book_imbalance": 0.0,
        "oi_change_5m_pct": 10.0, "oi_points": 5,
    })
    flow = review(m)["candidate_reviews"][0]["agents"]["orderflow"]
    assert flow["verdict"] == "UNKNOWN"
    assert "OI_CHANGE_CONTEXT_ONLY_NOT_DIRECTIONAL" in flow["unknown"]
    assert flow["support"] == []


def test_all_agent_reports_stay_bound_to_original_selected_signal():
    other = signal(id="short-alt", direction="SHORT", entry=100000.0,
                   stop=100500.0, target2=98500.0, confidence=0.99)
    result = review(candidates=[signal(), other])
    assert result["selected_id"] == "long-sfp-123"
    rows = {row["id"]: row for row in result["candidate_reviews"]}
    assert set(rows) == {"long-sfp-123", "short-alt"}
    assert len(rows["long-sfp-123"]["agents"]) == 4
    assert len(rows["short-alt"]["agents"]) == 4


def test_agent_disagreement_counts_are_descriptive_not_fake_win_rates():
    from app.agent_metrics import summarize_agent_reviews
    matched = review(market(
        last_price=102000,
        features={"trend_60": "DOWN", "trend_240": "DOWN",
                  "market_structure": "BEARISH", "atr_15": 400},
    ))
    summary = summarize_agent_reviews([matched, {"action": "APPROVE", "version": "legacy"}])
    assert summary["sampled_reviews"] == 1
    assert summary["agent_disagreements"] == 1
    assert summary["agents"]["regime"]["CAUTION"] == 1
    assert summary["profitability_proven"] is False


def test_agent_status_endpoint_is_readonly_and_bounded(monkeypatch):
    import asyncio
    from app import main

    monkeypatch.setenv("KYVORIQ_LANGGRAPH_MODE", "shadow")
    monkeypatch.setattr(main.engine.journal, "records", lambda limit, kind: [])
    status = asyncio.run(main.agent_status())
    assert status["mode"] == "shadow"
    assert status["execution_capable"] is False
    assert status["statistics"]["sampled_reviews"] == 0
    assert status["agent_names"] == ["regime", "liquidity", "orderflow", "entry_timing", "opportunity_scout", "performance_learning", "early_opportunity_router", "adaptive_supervisor", "data_quality_sentinel", "risk_guardian"]
