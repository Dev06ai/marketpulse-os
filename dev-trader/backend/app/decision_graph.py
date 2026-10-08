"""KYVORIQ multi-agent LangGraph decision-review pipeline.

Deterministic, bounded, read-only specialist agents. No LLM or external API
calls; they cannot invent a trade, overwrite a price, change risk parameters
or execute a Bitget order. The pre-existing quality gate remains authoritative.
"""
from __future__ import annotations

import math
import operator
import time
from functools import lru_cache
from typing import Annotated, Any, TypedDict

from langgraph.graph import END, START, StateGraph

from . import decision_agents as agents
from .agent_orchestration import data_sentinel, risk_guardian, supervisor_context, build_early_candidates

VERSION = "langgraph-specialists-v3"
AGENT_NAMES = ("regime", "liquidity", "orderflow", "entry_timing")


class ReviewState(TypedDict, total=False):
    market: dict[str, Any]
    candidates: list[dict[str, Any]]
    original_id: str
    blockers: list[str]
    agent_reports: Annotated[list[dict[str, Any]], operator.add]
    reviews: list[dict[str, Any]]
    selected_id: str | None
    action: str
    trace: list[str]
    sentinel: dict[str, Any]
    early: bool


def _positive(value: Any) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) and number > 0 else 0.0
    except (TypeError, ValueError, OverflowError):
        return 0.0


def _market_health(state: ReviewState) -> dict:
    market = state["market"]
    sentinel = data_sentinel(market)
    blockers: list[str] = list(sentinel["critical_blockers"])
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
    return {"blockers": list(dict.fromkeys(blockers)), "sentinel": sentinel, "trace": ["market_health"]}


def _after_market(state: ReviewState) -> str:
    return "supervisor" if state.get("blockers") else "dispatch_specialists"


def _dispatch_specialists(state: ReviewState) -> dict:
    return {"trace": state.get("trace", []) + ["dispatch_specialists"]}


def _regime(state: ReviewState) -> dict:
    return {"agent_reports": [agents.regime_agent(state["market"], state["candidates"])]}


def _liquidity(state: ReviewState) -> dict:
    return {"agent_reports": [agents.liquidity_agent(state["market"], state["candidates"])]}


def _orderflow(state: ReviewState) -> dict:
    return {"agent_reports": [agents.orderflow_agent(state["market"], state["candidates"])]}


def _entry_timing(state: ReviewState) -> dict:
    return {"agent_reports": [agents.entry_timing_agent(state["market"], state["candidates"])]}


def _candidate_review(state: ReviewState) -> dict:
    reports = {report["agent"]: report.get("results", {})
               for report in state.get("agent_reports", [])}
    reactions = state["market"].get("level_reactions") or {}
    reviews = []
    for signal in state.get("candidates", [])[:16]:
        evidence = signal.get("evidence") or {}
        decision = evidence.get("decision_engine") or {}
        playbook = evidence.get("playbook") or {}
        sid = str(signal.get("id") or "")
        agent_verdicts = {name: reports.get(name, {}).get(sid, {
            "verdict": "UNKNOWN", "support": [], "concerns": [],
            "unknown": ["AGENT_RESULT_UNAVAILABLE"],
        }) for name in AGENT_NAMES}
        concerns = [name + ":" + reason for name, review in agent_verdicts.items()
                    for reason in review.get("concerns", [])]
        support_count = sum(v["verdict"] == "SUPPORT" for v in agent_verdicts.values())
        caution_count = sum(v["verdict"] == "CAUTION" for v in agent_verdicts.values())
        reviews.append({
            "id": sid,
            "setup": str(signal.get("setup") or ""),
            "direction": str(signal.get("direction") or "").upper(),
            "family": str(playbook.get("family") or "UNKNOWN"),
            "confirmations": int(decision.get("confirmations") or 0),
            "level_status": str(reactions.get("status") or "IDLE"),
            "rank": [
                int(decision.get("confirmations") or 0),
                _positive(signal.get("confidence")),
                _positive(signal.get("rr")),
            ],
            "supporting_agents": support_count,
            "caution_agents": caution_count,
            "disagreement": bool(caution_count),
            "concerns": concerns[:8],
            "agents": agent_verdicts,
            "adaptive_supervisor": supervisor_context(dict(signal, agents=agent_verdicts)),
            "source": signal.get("_origin", "QUALIFIED_DETECTOR"),
            "signal": signal,
            "blockers": [],
        })
    return {
        "reviews": reviews,
        "trace": state.get("trace", []) + [
            "regime", "liquidity", "orderflow", "entry_timing", "candidate_review"
        ],
    }


def _risk_preflight(state: ReviewState) -> dict:
    reviewed=[]
    for review in state.get("reviews",[]):
        row=dict(review)
        signal=row.pop("signal")
        report=risk_guardian(signal,selected=not state.get("early",False))
        # Watches can contain no prices by design. A watch NEVER converts
        # into an approved order through LangGraph.
        row["risk_guardian"]=report
        row["blockers"]=report["blockers"]
        reviewed.append(row)
    return {"reviews":reviewed,"trace":state.get("trace",[])+["risk_preflight"]}


def _supervisor(state: ReviewState) -> dict:
    blockers = state.get("blockers") or []
    reviews = state.get("reviews") or []
    original = next((r for r in reviews if r["id"] == state.get("original_id")), None)
    if blockers:
        action = "WAIT"
        selected_id = None
    elif state.get("early"):
        # Route all pre-gate detections through the SAME parallel specialists
        # while making it impossible for the graph to approve a trade.
        action = "OBSERVE"
        selected_id = None
    elif not original or original.get("blockers"):
        action = "REJECT"
        selected_id = None
        if not original:
            blockers = ["ORIGINAL_CANDIDATE_NOT_FOUND"]
        else:
            blockers = list(original["blockers"])
    else:
        # Agent disagreements are *recorded* for shadow evaluation; not an
        # uncalibrated vote to change trade direction or live execution.
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
    builder.add_node("dispatch_specialists", _dispatch_specialists)
    builder.add_node("regime", _regime)
    builder.add_node("liquidity", _liquidity)
    builder.add_node("orderflow", _orderflow)
    builder.add_node("entry_timing", _entry_timing)
    builder.add_node("candidate_review", _candidate_review)
    builder.add_node("risk_preflight", _risk_preflight)
    builder.add_node("supervisor", _supervisor)
    builder.add_edge(START, "market_health")
    builder.add_conditional_edges(
        "market_health", _after_market,
        {"dispatch_specialists": "dispatch_specialists", "supervisor": "supervisor"},
    )
    # Four agents run in one parallel graph step; fan-in waits for all four.
    # Separate keys are merged through an append reducer, avoiding concurrent
    # writes to scalar fields.
    for node in AGENT_NAMES:
        builder.add_edge("dispatch_specialists", node)
    builder.add_edge(list(AGENT_NAMES), "candidate_review")
    builder.add_edge("candidate_review", "risk_preflight")
    builder.add_edge("risk_preflight", "supervisor")
    builder.add_edge("supervisor", END)
    return builder.compile()


def review_decision(market: dict, candidates: list[dict], original_id: str, *, early: bool = False) -> dict:
    """Review only; fail-closed exceptions are handled by strategy.py in guard mode."""
    started = time.perf_counter()
    result = _graph().invoke({
        "market": market,
        "candidates": candidates[:16],
        "original_id": original_id,
        "early": early,
        "blockers": [],
        "agent_reports": [],
        "trace": [],
        "reviews": [],
    })
    selected = next(
        (row for row in result.get("reviews", []) if row["id"] == original_id),
        {},
    )
    return {
        "version": VERSION,
        "stage": "EARLY_OBSERVATION_ONLY" if early else "QUALIFIED_SHADOW_REVIEW",
        "action": result["action"],
        "data_sentinel": result.get("sentinel", {}),
        "adaptive_supervisor": selected.get("adaptive_supervisor", {}),
        "risk_guardian": selected.get("risk_guardian", {}),
        "selected_id": result.get("selected_id"),
        "engine_selected_id": original_id,
        "blockers": result.get("blockers", [])[:8],
        "trace": result.get("trace", [])[:12],
        "agents": list(AGENT_NAMES),
        "agent_disagreement": bool(selected.get("disagreement")),
        "selected_concerns": selected.get("concerns", [])[:8],
        "candidate_reviews": result.get("reviews", [])[:16],
        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        "execution_capable": False,
        "confidence_is_probability": False,
    }



def review_early_opportunities(market: dict, detected: list[dict],
                               radar: list[dict]) -> dict:
    """Read-only LangGraph fan-out BEFORE the conventional quality gates.

    Both detected candidates and indicator-only radar watches are reviewed.
    No phantom entry/stop is assigned to watches, and action cannot APPROVE.
    """
    candidates,counts=build_early_candidates(detected,radar)
    if not candidates:
        return {"version":VERSION,"stage":"EARLY_OBSERVATION_ONLY",
                "action":"NO_WATCH","candidate_reviews":[],
                "route":counts,"execution_capable":False}
    report=review_decision(market,candidates,"__NOT_EXECUTABLE__",early=True)
    return dict(report,route=counts,selected_id=None,
                action="WAIT" if report["action"]=="WAIT" else "OBSERVE",
                execution_capable=False,can_create_new_signal=False)
