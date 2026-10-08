"""KYVORIQ Performance Learning Agent: descriptive, read-only, evidence-led.

Actual net P&L is sourced *only* from reconciled Bitget demo closes. Scout
price-path observations remain separate and never become synthetic fills.
No parameter tuning, order execution, statistical significance or win claims.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from typing import Any

VERSION = "performance-learning-observer-v1"
MIN_EVALUABLE = 30


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        num = float(value)
        return num if math.isfinite(num) else None
    except (TypeError, ValueError, OverflowError):
        return None


def analyze_performance(trades: list[dict], graph_records: list[dict],
                        scout_records: list[dict], ledger: dict | None = None) -> dict:
    """No hindsight trade matching: exact stable signal ID is required."""
    ledger = ledger or {}
    fees_complete = bool(ledger.get("complete_window") and ledger.get("fee_accounting_complete"))
    graph_by_id: dict[str, dict] = {}
    for record in sorted(graph_records, key=lambda x:int(x.get("ts") or 0)):
        signal_id = str(record.get("engine_selected_id") or "")
        if signal_id and str(record.get("version") or "").startswith("langgraph-"):
            graph_by_id[signal_id] = record

    closed: list[dict] = []
    excluded = Counter()
    for trade in trades:
        if str(trade.get("status") or "").upper() != "CLOSED":
            excluded["not_closed"] += 1
            continue
        # Only finalized fills with proven exchange execution count as actual.
        if trade.get("actual_fill_confirmed") is not True:
            excluded["fill_unverified"] += 1
            continue
        net = _number(trade.get("net_profit_usdt"))
        if net is None or not trade.get("closed_ts"):
            excluded["net_or_close_missing"] += 1
            continue
        closed.append(dict(trade, _net=net))
    closed.sort(key=lambda x: int(x["closed_ts"]))

    # These are real exchange-observed trades, not observations nor simulations.
    total = sum(t["_net"] for t in closed)
    equity = 0.0
    peak = 0.0
    max_drawdown = 0.0
    for row in closed:
        equity += row["_net"]
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, peak-equity)
    matched = []
    for row in closed:
        ref = graph_by_id.get(str(row.get("signal_id") or ""))
        if not ref:
            continue
        selected = next((v for v in (ref.get("candidate_reviews") or [])
                         if v.get("id") == ref.get("engine_selected_id")), {})
        matched.append((row, selected))

    # Compare the outcomes of sets flagged by agents versus outcomes without
    # those flags. This is observational correlation, NOT a causal result.
    breakdown: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for trade, review in matched:
        for name, agent in (review.get("agents") or {}).items():
            verdict = str(agent.get("verdict") or "UNKNOWN").upper()
            breakdown[str(name)][verdict].append(trade["_net"])
    agent_comparisons = {}
    for name, labels in sorted(breakdown.items()):
        agent_comparisons[name] = {}
        for label, values in sorted(labels.items()):
            n = len(values)
            agent_comparisons[name][label] = {
                "samples": n,
                "net_usdt": round(sum(values), 4) if fees_complete else None,
                "net_mean_usdt": round(sum(values)/n, 4) if fees_complete and n >= MIN_EVALUABLE else None,
                "evidence": "DESCRIPTIVE_NOT_CAUSAL" if fees_complete and n >= MIN_EVALUABLE
                            else "INSUFFICIENT_OR_INCOMPLETE_ACCOUNTING",
            }

    observed = [r for r in scout_records if r.get("status") == "RESOLVED_PRICE_ONLY"
                and _number(r.get("directional_move_pct")) is not None]
    unverifiable = sum(r.get("status") == "UNVERIFIABLE" for r in scout_records)
    by_source = Counter(r.get("source", "UNKNOWN") for r in observed)
    return {
        "version": VERSION,
        "mode": "READ_ONLY_NO_AUTOTUNING",
        "execution_capable": False,
        "automatic_strategy_changes": False,
        "ledger_fee_accounting_complete": fees_complete,
        "exchange_demo": {
            "verified_closed": len(closed),
            "excluded": dict(excluded),
            "net_usdt": round(total, 4) if fees_complete else None,
            "average_net_usdt": round(total/len(closed), 4) if fees_complete and len(closed) >= MIN_EVALUABLE else None,
            "closed_trade_pnl_drawdown_usdt": round(max_drawdown, 4) if fees_complete else None,
            "matched_langgraph_decisions": len(matched),
            "matching_rule": "EXACT_SIGNAL_ID_ONLY",
            "sample_status": "DESCRIPTIVE_NOT_CAUSAL" if fees_complete and len(closed) >= MIN_EVALUABLE
                             else "INSUFFICIENT_OR_INCOMPLETE_ACCOUNTING",
        },
        "agent_outcome_comparison": agent_comparisons,
        "scout_price_observations": {
            "resolved_price_paths": len(observed),
            "unverifiable": unverifiable,
            "positive_directional_moves": sum(_number(r["directional_move_pct"]) > 0 for r in observed),
            "by_source": dict(by_source),
            "metrics_are_trade_profit": False,
            "status": "OBSERVED_PRICE_ONLY_NO_HYPOTHETICAL_FILL_OR_PNL",
        },
        "guidance": (
            "Observe more forward sessions. Never infer an executable missed trade "
            "or automatically change risk, leverage or strategy from this report."
        ),
        "profitability_proven": False,
    }
