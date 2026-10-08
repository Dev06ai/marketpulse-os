"""KYVORIQ LangGraph decision-review pipeline.

A short-lived, deterministic graph: no LLM calls, broker credentials, order placement,
or autonomous tool execution. The existing playbook and Bitget executor remain authoritative.
Runs only for already-qualified candidates, with a bounded diagnostic result.
"""
from __future__ import annotations

import math
import time
from functools import lru_cache
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

VERSION = "langgraph-review-v1"


class ReviewState(TypedDict, total=False):
    market: dict[str, Any]
    candidates: list[dict[str, Any]]
    original_id: str
    blockers: list[str]
    reviews: list[dict[str, Any]]
    selected_id: str | None
    action: str
    trace: list[str]


def _positive(value: Any) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) and number > 0 else 0.0
    except (TypeError, ValueError, OverflowError):
        return 0.0


def _market_health(state: ReviewState) -> dict:
    market = state["market"]
    blockers: list[str] = []
    if market.get("health") != "HEALTHY" or not market.get("connected"):
        blockers.append("MARKET_FEED_NOT_HEALTHY")
    now_ms = int(market.get("now_ms") or 0)
    quote_ts = int(market.get("market_update_ms") or 0)
    if now_ms and quote_ts and not -1000 <= now_ms - quote_ts <= 3000:
        blockers.append("MARKET_QUOTE_STALE")
    bid = _positive(market.get("bid"))
    ask = _positive(market.get("ask"))
    if bid and ask and bid >= ask:
        blockers.append("CROSSED_ORDER_BOOK")
    spread = _positive(market.get("spread_bps"))
    if spread > 25:
        blockers.append("EXCESSIVE_MARKET_SPREAD")
    return {"blockers": blockers, "trace": ["market_health"]}


def _after_market(state: ReviewState) -> str:
    return "supervisor" if state.get("blockers") else "liquidity"


def _liquidity(state: ReviewState) -> dict:
    """Annotate proximity/trigger context without fabricating a level touch."""
    market = state["market"]
    reaction = market.get("level_reactions") or {}
    status = str(reaction.get("status") or "IDLE").upper()
    trigger = reaction.get("trigger") or {}
    return {
        "trace": state.get("trace", []) + ["liquidity"],
        "market": dict(market, level_status=status,
                       level_trigger_type=str(trigger.get("type") or "")),
    }


def _candidate_review(state: ReviewState) -> dict:
    reviews = []
    for signal in state.get("candidates", [])[:16]:
        evidence = signal.get("evidence") or {}
        decision = evidence.get("decision_engine") or {}
        playbook = evidence.get("playbook") or {}
        reviews.append({
            "id": str(signal.get("id") or ""),
            "setup": str(signal.get("setup") or ""),
            "direction": str(signal.get("direction") or "").upper(),
            "family": str(playbook.get("family") or "UNKNOWN"),
            "confirmations": int(decision.get("confirmations") or 0),
            "level_status": state["market"].get("level_status", "IDLE"),
            "rank": [
                int(decision.get("confirmations") or 0),
                _positive(signal.get("confidence")),
                _positive(signal.get("rr")),
            ],
            "signal": signal,
            "blockers": [],
        })
    return {"reviews": reviews, "trace": state.get("trace", []) + ["candidate_review"]}


def _risk_preflight(state: ReviewState) -> dict:
    reviewed = []
    for review in state.get("reviews", []):
        row = dict(review)
        signal = row.pop("signal")
        direction = row["direction"]
        entry = _positive(signal.get("entry"))
        stop = _positive(signal.get("stop"))
        target = _positive(signal.get("target2"))
        rr = _positive(signal.get("rr"))
        reasons = []
        if direction not in {"LONG", "SHORT"}:
            reasons.append("INVALID_DIRECTION")
        if not all((entry, stop, target)):
            reasons.append("NONFINITE_OR_MISSING_PRICES")
        elif direction == "LONG" and not (stop < entry < target):
            reasons.append("INVALID_LONG_STOP_TARGET_GEOMETRY")
        elif direction == "SHORT" and not (target < entry < stop):
            reasons.append("INVALID_SHORT_STOP_TARGET_GEOMETRY")
        if rr < 1.5:
            reasons.append("INADEQUATE_GROSS_REWARD_RISK")
        if str(signal.get("grade") or "").upper() != "A":
            reasons.append("NOT_GRADE_A")
        row["blockers"] = reasons
        reviewed.append(row)
    return {"reviews": reviewed, "trace": state.get("trace", []) + ["risk_preflight"]}


def _supervisor(state: ReviewState) -> dict:
    blockers = state.get("blockers") or []
    reviews = state.get("reviews") or []
    original = next((r for r in reviews if r["id"] == state.get("original_id")), None)
    if blockers:
        action = "WAIT"
        selected_id = None
    elif not original or original.get("blockers"):
        action = "REJECT"
        selected_id = None
        if not original:
            blockers = ["ORIGINAL_CANDIDATE_NOT_FOUND"]
        else:
            blockers = list(original["blockers"])
    else:
        # Graph never silently substitutes another setup for the engine's
        # selected signal. Existing elite/playbook gates own signal ranking.
        action = "APPROVE"
        selected_id = original["id"]
    return {
        "action": action,
        "selected_id": selected_id,
        "blockers": blockers,
        "trace": state.get("trace", []) + ["supervisor"],
    }


@lru_cache(maxsize=1)
def _graph():
    builder = StateGraph(ReviewState)
    builder.add_node("market_health", _market_health)
    builder.add_node("liquidity", _liquidity)
    builder.add_node("candidate_review", _candidate_review)
    builder.add_node("risk_preflight", _risk_preflight)
    builder.add_node("supervisor", _supervisor)
    builder.add_edge(START, "market_health")
    builder.add_conditional_edges("market_health", _after_market,
                                  {"liquidity": "liquidity", "supervisor": "supervisor"})
    builder.add_edge("liquidity", "candidate_review")
    builder.add_edge("candidate_review", "risk_preflight")
    builder.add_edge("risk_preflight", "supervisor")
    builder.add_edge("supervisor", END)
    return builder.compile()


def review_decision(market: dict, candidates: list[dict], original_id: str) -> dict:
    """Review only; never execute. Failures are handled fail-closed by the caller in guard mode."""
    started = time.perf_counter()
    result = _graph().invoke({
        "market": market,
        "candidates": candidates[:16],
        "original_id": original_id,
        "blockers": [],
        "trace": [],
        "reviews": [],
    })
    return {
        "version": VERSION,
        "action": result["action"],
        "selected_id": result.get("selected_id"),
        "engine_selected_id": original_id,
        "blockers": result.get("blockers", [])[:8],
        "trace": result.get("trace", [])[:8],
        "candidate_reviews": [
            {k: v for k, v in row.items() if k != "signal"}
            for row in result.get("reviews", [])[:16]
        ],
        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        "execution_capable": False,
    }
