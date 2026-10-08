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
        "market_health", "liquidity", "candidate_review", "risk_preflight", "supervisor"
    ]
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
