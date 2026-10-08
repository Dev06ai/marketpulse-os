"""Specialist reviewers for KYVORIQ's deterministic, read-only LangGraph.

Agents form independent *evidence lenses*, not an LLM voting committee.
Cautions are transparent, do not increase the strategy's heuristic confidence
and never authorize a trade. Missing/old data is UNKNOWN, not confirmation.
"""
from __future__ import annotations

import math
from typing import Any


def _num(value: Any) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError, OverflowError):
        return None


def _side(direction: str) -> str:
    return "UP" if direction == "LONG" else "DOWN"


def _verdict(support: list[str], concerns: list[str], unknown: list[str]) -> dict:
    if concerns:
        verdict = "CAUTION"
    elif support:
        verdict = "SUPPORT"
    else:
        verdict = "UNKNOWN"
    return {
        "verdict": verdict,
        "support": support[:3],
        "concerns": concerns[:3],
        "unknown": unknown[:3],
    }


def _result(name: str, candidates: list[dict], evaluator) -> dict:
    rows = {}
    for candidate in candidates[:16]:
        sid = str(candidate.get("id") or "")
        if sid:
            rows[sid] = evaluator(candidate)
    return {"agent": name, "results": rows}


def regime_agent(market: dict, candidates: list[dict]) -> dict:
    """Independently scrutinize 1h/4h trend and structural agreement."""
    ctx = market.get("features") or {}

    def assess(candidate: dict) -> dict:
        direction = str(candidate.get("direction") or "").upper()
        wants = _side(direction)
        support, concerns, unknown = [], [], []
        for field, label in (("trend_60", "1H"), ("trend_240", "4H")):
            trend = str(ctx.get(field) or "UNKNOWN").upper()
            if trend == wants:
                support.append(label + "_TREND_ALIGNED")
            elif trend in {"UP", "DOWN"}:
                concerns.append(label + "_TREND_OPPOSES")
            else:
                unknown.append(label + "_TREND_UNCLEAR")
        structure = str(ctx.get("market_structure") or "UNKNOWN").upper()
        bullish = {"BULLISH", "HIGHER_HIGHS", "HIGHER_LOW", "HIGHER_LOWS"}
        bearish = {"BEARISH", "LOWER_HIGHS", "LOWER_LOW", "LOWER_LOWS"}
        if (direction == "LONG" and structure in bullish) or (direction == "SHORT" and structure in bearish):
            support.append("STRUCTURE_ALIGNED")
        elif structure in bullish | bearish:
            concerns.append("STRUCTURE_OPPOSES")
        else:
            unknown.append("STRUCTURE_UNCLEAR")
        return _verdict(support, concerns, unknown)

    return _result("regime", candidates, assess)


def liquidity_agent(market: dict, candidates: list[dict]) -> dict:
    """Check observed reaction direction; do NOT manufacture taps or NPOC."""
    context = market.get("level_reactions") or {}
    status = str(context.get("status") or "IDLE").upper()
    trigger = context.get("trigger") or {}
    trigger_dir = str(trigger.get("direction") or "").upper()

    def assess(candidate: dict) -> dict:
        direction = str(candidate.get("direction") or "").upper()
        setup = str(candidate.get("setup") or "").upper()
        family = str(((candidate.get("evidence") or {}).get("playbook") or {}).get("family") or "").upper()
        is_reaction = "SFP" in setup or "REACTION" in setup or family in {"LEVEL_REACTION", "SFP"}
        support, concerns, unknown = [], [], []
        if status == "TRIGGERED" and trigger_dir == direction:
            support.append("DIRECTIONAL_LEVEL_REACTION_CONFIRMED")
        elif status == "TRIGGERED" and trigger_dir in {"LONG", "SHORT"} and trigger_dir != direction:
            concerns.append("OPPOSING_LEVEL_REACTION")
        elif is_reaction:
            unknown.append("NO_MATCHING_LIVE_LEVEL_TRIGGER")
        if status == "ARMED":
            unknown.append("LEVEL_ARMED_NOT_TRIGGERED")
        if not support and not concerns and not unknown:
            unknown.append("NO_ACTIONABLE_REACTION_EVIDENCE")
        return _verdict(support, concerns, unknown)

    return _result("liquidity", candidates, assess)


def orderflow_agent(market: dict, candidates: list[dict]) -> dict:
    """CVD divergence, fresh book imbalance, and OI context (not OI direction)."""
    ctx = market.get("features") or {}
    now = int(market.get("now_ms") or 0)
    book_ts = int(market.get("book_update_ms") or 0)
    book_fresh = bool(now and book_ts and -1000 <= now-book_ts <= 5000)
    divergence = str(ctx.get("cvd_price_divergence") or "NONE").upper()
    imbalance = _num(ctx.get("book_imbalance"))
    oi_points = int(ctx.get("oi_points") or 0)
    oi_change = _num(ctx.get("oi_change_5m_pct"))

    def assess(candidate: dict) -> dict:
        direction = str(candidate.get("direction") or "").upper()
        support, concerns, unknown = [], [], []
        if divergence in {"BULLISH", "BEARISH"}:
            if (divergence == "BULLISH" and direction == "LONG") or (divergence == "BEARISH" and direction == "SHORT"):
                support.append("CVD_DIVERGENCE_ALIGNED")
            else:
                concerns.append("CVD_DIVERGENCE_OPPOSES")
        else:
            unknown.append("NO_VALID_DIRECTIONAL_CVD_DIVERGENCE")
        if book_fresh and imbalance is not None and abs(imbalance) >= 0.10:
            aligned = (direction == "LONG" and imbalance > 0) or (direction == "SHORT" and imbalance < 0)
            (support if aligned else concerns).append("FRESH_BOOK_IMBALANCE_" + ("ALIGNED" if aligned else "OPPOSES"))
        else:
            unknown.append("NO_SIGNIFICANT_FRESH_BOOK_IMBALANCE")
        if oi_points >= 2 and oi_change is not None and abs(oi_change) >= 0.15:
            # Open interest expansion does not tell us whether longs or shorts lead.
            unknown.append("OI_CHANGE_CONTEXT_ONLY_NOT_DIRECTIONAL")
        else:
            unknown.append("OI_CONTEXT_INSUFFICIENT")
        return _verdict(support, concerns, unknown)

    return _result("orderflow", candidates, assess)


def entry_timing_agent(market: dict, candidates: list[dict]) -> dict:
    """Warn about chasing beyond an existing planned entry; exchange still rechecks."""
    ctx = market.get("features") or {}
    atr = _num(ctx.get("atr_15"))
    price = _num(market.get("last_price"))

    def assess(candidate: dict) -> dict:
        direction = str(candidate.get("direction") or "").upper()
        entry = _num(candidate.get("entry"))
        support, concerns, unknown = [], [], []
        if price is None or price <= 0 or entry is None or entry <= 0:
            unknown.append("LIVE_ENTRY_DRIFT_UNAVAILABLE")
        elif atr is None or atr <= 0:
            unknown.append("ATR_UNAVAILABLE_FOR_TIMING")
        else:
            adverse_drift = ((price-entry) if direction == "LONG" else (entry-price))
            if adverse_drift > max(0.7 * atr, entry * 0.0025):
                concerns.append("ENTRY_CHASING_BEYOND_PLAN")
            elif adverse_drift >= 0:
                support.append("ENTRY_DRIFT_WITHIN_REVIEW_BAND")
            else:
                unknown.append("PRICE_ON_FAVORABLE_SIDE_RECHECK_FILL")
        return _verdict(support, concerns, unknown)

    return _result("entry_timing", candidates, assess)
