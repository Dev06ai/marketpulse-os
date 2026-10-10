"""Strictly descriptive forward-only calibration of agent classifications.

Exact execution IDs and exchange fills remain authoritative. No calibration
parameter is ever fed back into strategy/risk. No hindsight-based optimization.
"""
from __future__ import annotations

from collections import defaultdict
import math

MIN_TOTAL = 30
MIN_HOLDOUT = 10
MIN_BUCKET = 10


def summarize_forward_cohorts(matched: list[tuple[dict,dict]], fee_complete: bool) -> dict:
    # Reject contaminated cohorts rather than silently discarding losing,
    # malformed, or infinite-PnL records and claiming a strong mean from survivors.
    clean = []
    for item in matched:
        if not isinstance(item, (tuple, list)) or len(item) != 2:
            continue
        trade, review = item
        if not isinstance(trade, dict) or not isinstance(review, dict):
            continue
        net, closed = trade.get("_net"), trade.get("closed_ts")
        if (type(net) not in (int, float) or not math.isfinite(net) or
                type(closed) is not int or closed <= 0):
            continue
        clean.append((trade, review))
    clean.sort(key=lambda x: x[0]["closed_ts"])
    n=len(clean)
    input_complete = len(clean) == len(matched)
    if not fee_complete or not input_complete or n<MIN_TOTAL:
        return {
            "status":"INSUFFICIENT_VERIFIED_FORWARD_SAMPLE",
            "verified_matched":n,"required":MIN_TOTAL,
            "fee_accounting_complete":fee_complete,
            "input_records_complete":input_complete,
            "rejected_records":len(matched)-len(clean),
            "strategy_changed":False,
        }
    boundary=int(n*0.70)
    holdout=clean[boundary:]
    if len(holdout)<MIN_HOLDOUT:
        return {
            "status":"INSUFFICIENT_HOLDOUT",
            "verified_matched":n,"holdout":len(holdout),
            "strategy_changed":False,
        }
    # This is only a temporal diagnostic split. It is NOT a backtest,
    # causal attribution, or a statistically significant return forecast.
    def summarize(rows):
        groups=defaultdict(list)
        for trade,review in rows:
            profile=str((review.get("adaptive_supervisor") or {}).get("profile") or "UNKNOWN")
            groups[profile].append(trade["_net"])
        return {
            k:{
                "samples":len(v),
                "mean_net_usdt":round(sum(v)/len(v),4) if len(v)>=MIN_BUCKET else None,
                "evidence":"DESCRIPTIVE_ONLY" if len(v)>=MIN_BUCKET else "INSUFFICIENT_BUCKET",
            }
            for k,v in sorted(groups.items())
        }
    return {
        "status":"DESCRIPTIVE_FORWARD_HOLDOUT",
        "verified_matched":n,
        "earlier_sample":boundary,
        "later_holdout":len(holdout),
        "earlier_profiles":summarize(clean[:boundary]),
        "later_profiles":summarize(holdout),
        "selection_warning":"This is not randomized, causal or independently validated",
        "strategy_changed":False,
        "auto_tuning_enabled":False,
        "profitability_proven":False,
    }
