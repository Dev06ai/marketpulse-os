"""Free, deterministic KYVORIQ multi-agent policy extensions.

No model keys, no network calls, no orders. Every verdict is evidence-based.
Early opportunities are observations, never a replacement for existing gates.
"""
from __future__ import annotations

import math
from typing import Any

VERSION = "router-supervisor-v3"
MAX_EARLY = 12
MIN_NET_RR = 2.5


def numeric(raw: Any) -> float | None:
    if isinstance(raw, bool):
        return None
    try:
        v = float(raw)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError, OverflowError):
        return None


def classify_setup(signal: dict) -> dict:
    setup = str(signal.get("setup") or "").upper()
    family = str(((signal.get("evidence") or {}).get("playbook") or {}).get("family") or "").upper()
    if "SFP" in setup or "REACTION" in setup or "HARMONIC" in setup or family in {"SFP","LEVEL_REACTION","HARMONIC"}:
        return {"profile":"REVERSAL","required_evidence":"FRESH_DIRECTIONAL_RECLAIM_OR_REJECTION"}
    if "MOMENTUM" in setup or family == "MOMENTUM_CAPTURE":
        return {"profile":"MOMENTUM","required_evidence":"CONFIRMED_DISPLACEMENT_AND_VOLUME"}
    if any(label in setup for label in ("BREAKOUT","RETEST","D-LINE","MSS")) or family in {"BREAKOUT_RETEST","D_LINE","MSS"}:
        return {"profile":"BREAKOUT","required_evidence":"CONFIRMED_BREAK_AND_RETEST"}
    return {"profile":"CONTINUATION","required_evidence":"STRUCTURE_AND_CONFIRMATION"}


def data_sentinel(market: dict) -> dict:
    """Critical quote freshness is blocking; stale auxiliary feeds are UNKNOWN."""
    now = int(market.get("now_ms") or 0)
    def age(field: str, max_ms: int) -> dict:
        ts = int(market.get(field) or 0)
        if not now or not ts:
            return {"status":"UNKNOWN","age_ms":None,"fresh_limit_ms":max_ms}
        age_ms=now-ts
        return {"status":"FRESH" if -1000<=age_ms<=max_ms else "STALE",
                "age_ms":age_ms,"fresh_limit_ms":max_ms}
    quote=age("market_update_ms",3000)
    book=age("book_update_ms",5000)
    trades=age("trade_update_ms",15000)
    oi=age("oi_update_ms",120000)
    liqs=age("liquidation_update_ms",300000)
    # Funding updates lack a verified timestamp on current MarketState.
    return {
        "quote":quote,"orderbook":book,"trades":trades,
        "open_interest":oi,"liquidations":liqs,
        "funding":{"status":"UNKNOWN","reason":"NO_VERIFIED_TIMESTAMP"},
        "critical_blockers":[
            "MARKET_QUOTE_UNVERIFIED" if quote["status"]=="UNKNOWN" else "MARKET_QUOTE_STALE"
        ] if quote["status"]!="FRESH" else [],
        "advisories":[name.upper()+"_NOT_FRESH" for name,check in
                      (("orderbook",book),("trades",trades),("open_interest",oi),("liquidations",liqs))
                      if check["status"]!="FRESH"][:4],
        "derivatives_not_required_for_price_setup":True,
    }


def risk_guardian(signal: dict, *, selected: bool, max_leverage: int | None = None,
                  max_risk_pct: float | None = None) -> dict:
    """Independent second opinion; cannot size, approve or execute an order.

    Passing this review is *insufficient* without real exchange equity, fill,
    margin and live structural-stop admission. Unknown risk data stays UNKNOWN.
    """
    d=str(signal.get("direction") or "").upper()
    entry=numeric(signal.get("entry"))
    stop=numeric(signal.get("stop"))
    target=numeric(signal.get("target2"))
    blockers=[]
    if d not in {"LONG","SHORT"}:
        blockers.append("INVALID_DIRECTION")
    if any(v is None or v<=0 for v in (entry,stop,target)):
        blockers.append("NONFINITE_OR_MISSING_PRICES")
    elif not ((stop<entry<target) if d=="LONG" else (target<entry<stop)):
        blockers.append("INVALID_LONG_STOP_TARGET_GEOMETRY" if d=="LONG" else
                        "INVALID_SHORT_STOP_TARGET_GEOMETRY" if d=="SHORT" else
                        "INVALID_STOP_TARGET_GEOMETRY")
    gross=0.0
    if entry and stop and target and entry!=stop and d in {"LONG","SHORT"}:
        gross=((target-entry) if d=="LONG" else (entry-target))/abs(entry-stop)
        if gross<2.5:
            blockers.append("GROSS_RR_BELOW_2_5")
    reported_rr=numeric(signal.get("rr"))
    if reported_rr is not None and reported_rr<2.5:
        blockers.append("INADEQUATE_GROSS_REWARD_RISK")
    if str(signal.get("grade") or "").upper()!="A" and selected:
        blockers.append("NOT_GRADE_A")
    evidence=signal.get("evidence") or {}
    htf=evidence.get("htf_policy") or {}
    net=numeric(htf.get("estimated_net_rr"))
    if net is not None and net<MIN_NET_RR:
        blockers.append("ESTIMATED_NET_RR_BELOW_2_5")
    if htf.get("eligible") is False:
        blockers.append("HTF_STRUCTURAL_RISK_BLOCKED")
    if max_leverage is not None and (max_leverage<1 or max_leverage>20):
        blockers.append("LEVERAGE_OUTSIDE_1_TO_20")
    if max_risk_pct is not None and (not 0<max_risk_pct<=2):
        blockers.append("EQUITY_RISK_EXCEEDS_2_PERCENT")
    return {
        "status":"REJECT" if blockers else ("PRECHECK_PASS" if net is not None else "PARTIAL_CHECK"),
        "blockers":blockers[:8],
        "gross_rr":round(gross,4),"known_net_rr":net,
        "structural_stop_verified":htf.get("eligible") is True,
        "exchange_equity_checked":False,
        "execution_capable":False,
        "requires_final_exchange_and_stop_check":True,
    }


def build_early_candidates(detectors: list[dict], radar: list[dict]) -> tuple[list[dict], dict]:
    """Bounded, non-executable watch candidates from *existing* detectors/radar.

    Radar watches have NO invented price or stop; cannot be order candidates.
    """
    rows=[]
    for src in detectors[:8]:
        sid=str(src.get("id") or "")[:96]
        if sid and str(src.get("direction") or "").upper() in {"LONG","SHORT"}:
            rows.append(dict(src, id=sid, _origin="DETECTOR_PRE_GATE"))
    for lead in radar[:4]:
        direction=str(lead.get("direction") or "").upper()
        if direction not in {"LONG","SHORT"} or str(lead.get("tier") or "").upper() not in {"DEVELOPING","CONFIRMED"}:
            continue
        setup=str(lead.get("setup") or "Radar watch")[:100]
        rows.append({
            "id":"watch:"+direction+":"+setup,
            "direction":direction,"setup":setup,"evidence":{},
            "entry":None,"stop":None,"target2":None,"grade":"WATCH",
            "_origin":"RADAR_NO_EXECUTABLE_PLAN",
        })
    rows=rows[:MAX_EARLY]
    profiles={}
    for row in rows:
        profiles[classify_setup(row)["profile"]]=profiles.get(classify_setup(row)["profile"],0)+1
    return rows,{
        "detector_count":sum(row["_origin"]=="DETECTOR_PRE_GATE" for row in rows),
        "radar_count":sum(row["_origin"]=="RADAR_NO_EXECUTABLE_PLAN" for row in rows),
        "profiles":profiles,
        "execution_capable":False,
        "missing_plan_never_filled":True,
    }


def supervisor_context(review: dict) -> dict:
    """No numerical win probability, votes or unvalidated auto-authorization."""
    profile=classify_setup(review)
    agents=review.get("agents") or {}
    flow=agents.get("orderflow") or {}
    liquidity=agents.get("liquidity") or {}
    regime=agents.get("regime") or {}
    supports=[k for k,v in agents.items() if v.get("verdict")=="SUPPORT"]
    cautions=[k for k,v in agents.items() if v.get("verdict")=="CAUTION"]
    if profile["profile"]=="REVERSAL":
        # Countertrend by itself cannot veto a legitimately triggered SFP.
        important="DIRECTIONAL_LEVEL_REACTION_CONFIRMED" in (liquidity.get("support") or [])
        focus="REVERSAL_TRIGGER_PRESENT" if important else "REVERSAL_NEEDS_CONFIRMED_TRIGGER"
    elif profile["profile"]=="MOMENTUM":
        focus="FLOW_SUPPORT" if flow.get("verdict")=="SUPPORT" else "MOMENTUM_FLOW_NOT_CONFIRMED"
    else:
        focus="TREND_SUPPORT" if regime.get("verdict")=="SUPPORT" else "STRUCTURE_NOT_FULLY_ALIGNED"
    return {
        "profile":profile["profile"],
        "focus":focus,
        "supporting_agents":supports,"caution_agents":cautions,
        "regime_conflict_is_hard_veto":False,
        "status":"CONTEXT_SUPPORT" if supports and not cautions else "MIXED_OR_INCOMPLETE",
        "confidence_is_probability":False,
        "may_override_execution_rules":False,
    }



def graph_market(state, features, now_ms: int, reactions: dict | None = None) -> dict:
    """Cheap immutable-ish bounded observation snapshot shared by both stages."""
    oi=getattr(state,"oi_window",[]) or []
    liquidations=getattr(state,"liquidation_window",[]) or []
    return {
        "health":getattr(state,"data_health","UNKNOWN"),
        "connected":bool(getattr(state,"ws_connected",False)),
        "now_ms":now_ms,
        "market_update_ms":getattr(state,"last_market_update_ts",None),
        "book_update_ms":getattr(state,"last_book_ts",None),
        "trade_update_ms":getattr(state,"last_trade_ts",None),
        "oi_update_ms":oi[-1][0] if oi else None,
        "liquidation_update_ms":liquidations[-1][0] if liquidations else None,
        "bid":getattr(state,"bid",None),
        "ask":getattr(state,"ask",None),
        "spread_bps":getattr(features,"spread_bps",0),
        "last_price":getattr(state,"last_price",None),
        "level_reactions":reactions or {},
        "features":{
            "trend_60":getattr(features,"trend_60","UNKNOWN"),
            "trend_240":getattr(features,"trend_240","UNKNOWN"),
            "market_structure":getattr(features,"market_structure","UNKNOWN"),
            "atr_15":getattr(features,"atr_15",0),
            "cvd_price_divergence":getattr(features,"cvd_price_divergence","NONE"),
            "book_imbalance":getattr(features,"book_imbalance",0),
            "oi_change_5m_pct":getattr(features,"oi_change_5m_pct",0),
            "oi_points":len(oi),
        },
    }
