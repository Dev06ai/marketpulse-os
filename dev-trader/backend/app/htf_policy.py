"""KYVORIQ higher-timeframe futures risk policy (read-only evaluation).

Uses only confirmed 1H and *complete* 4H candles. A policy-APPROVE means a
pre-existing strategy candidate passed additional checks, never an order.
No missing derivative, macro, liquidation or indicator value is manufactured.
"""
from __future__ import annotations

import math
from typing import Any

MAX_LEVERAGE = 5
MAX_RISK_PCT = 2.0
MIN_GROSS_RR = 2.5
MIN_NET_RR = 2.5
POLICY_VERSION = "btc-htf-derivatives-risk-v1"


def number(raw: Any) -> float | None:
    try:
        value = float(raw)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError, OverflowError):
        return None


def _ema(values: list[float], period: int) -> list[float]:
    alpha = 2.0 / (period+1)
    out = []
    result = values[0]
    for v in values:
        result = alpha*v + (1-alpha)*result
        out.append(result)
    return out


def rsi_series(closes: list[float], period: int = 14) -> list[float | None]:
    """Wilder RSI; no warmup values are used as evidence."""
    result: list[float | None] = [None] * len(closes)
    if len(closes) <= period:
        return result
    differences = [b-a for a,b in zip(closes, closes[1:])]
    gain = sum(max(d,0.0) for d in differences[:period])/period
    loss = sum(max(-d,0.0) for d in differences[:period])/period
    for i in range(period,len(closes)):
        if i > period:
            d = differences[i-1]
            gain = (gain*(period-1) + max(d,0.0))/period
            loss = (loss*(period-1) + max(-d,0.0))/period
        result[i] = 50.0 if gain == 0 and loss == 0 else (
            100.0 if loss == 0 else 100 - 100/(1+gain/loss)
        )
    return result


def rsi_divergence(bars: list, rsis: list[float | None], window: int = 2) -> str:
    """Price vs RSI at *confirmed* local swings, no future/unfinished bars."""
    if len(bars) < 25:
        return "UNKNOWN"
    for attribute, name in (("low", "BULLISH"), ("high", "BEARISH")):
        pivots = []
        for i in range(max(15, len(bars)-35), len(bars)-window):
            segment = bars[i-window:i+window+1]
            val = float(getattr(bars[i], attribute))
            if rsis[i] is not None and (
                val <= min(float(getattr(b, attribute)) for b in segment) if name=="BULLISH"
                else val >= max(float(getattr(b, attribute)) for b in segment)
            ):
                pivots.append(i)
        if len(pivots) >= 2:
            left,right = pivots[-2:]
            first = float(getattr(bars[left], attribute))
            second = float(getattr(bars[right], attribute))
            if name == "BULLISH" and second < first*0.9997 and rsis[right] > rsis[left]+1.0:
                return "BULLISH"
            if name == "BEARISH" and second > first*1.0003 and rsis[right] < rsis[left]-1.0:
                return "BEARISH"
    return "NONE"


def volume_weighted_macd(bars: list) -> dict:
    """Volume-adjusted EMA(12)-EMA(26), signal EMA(9).

    Adaptive alpha weights each complete bar by volume relative to the preceding
    20-bar average, capped to limit outlier influence. This is an explicitly
    defined implementation, not a claim to the only standard 'VW-MACD'.
    """
    if len(bars) < 45:
        return {"status": "INSUFFICIENT_CANDLES", "direction": "UNKNOWN"}
    volume = [number(c.volume) for c in bars]
    close = [number(c.close) for c in bars]
    if any(v is None or v <= 0 for v in volume) or any(v is None or v <= 0 for v in close):
        return {"status": "INCOMPLETE_VOLUME", "direction": "UNKNOWN"}
    base12=base26=float(close[0])
    macd=[]
    for i,(price,vol) in enumerate(zip(close,volume)):
        history=volume[max(0,i-20):i] or [vol]
        ratio=max(0.25,min(3.0,vol/(sum(history)/len(history))))
        a12=min(0.80,(2.0/13)*ratio)
        a26=min(0.80,(2.0/27)*ratio)
        base12 = base12*(1-a12)+price*a12
        base26 = base26*(1-a26)+price*a26
        macd.append(base12-base26)
    signal = _ema(macd, 9)
    hist = macd[-1]-signal[-1]
    return {
        "status": "CONFIRMED_CANDLES_ONLY",
        "direction": "BULLISH" if hist > 0 else "BEARISH" if hist < 0 else "NEUTRAL",
        "histogram": round(hist, 5),
        "histogram_previous": round(macd[-2]-signal[-2], 5),
        "interpretation": "VOLUME_ADJUSTED_EMA_MACD_NOT_A_PROBABILITY",
    }


def _recent_pivot(bars: list, which: str, window: int = 2) -> float | None:
    if len(bars) < 12:
        return None
    for i in range(len(bars)-window-1, max(window-1,len(bars)-35), -1):
        v = float(getattr(bars[i],which))
        group=bars[i-window:i+window+1]
        compare=[float(getattr(c,which)) for c in group]
        if (v <= min(compare) if which=="low" else v >= max(compare)):
            return v
    return None


def _atr_hourly(bars: list) -> float | None:
    if len(bars) < 16:
        return None
    sample=bars[-14:]
    trs=[]
    prev=float(bars[-15].close)
    for b in sample:
        hi,lo=float(b.high),float(b.low)
        trs.append(max(hi-lo,abs(hi-prev),abs(lo-prev)))
        prev=float(b.close)
    result=sum(trs)/len(trs)
    return result if result>0 and math.isfinite(result) else None


def structural_stop(state, signal: dict, features) -> dict:
    """Require actual stop *beyond* last confirmed 1h pivot and relevant OB.

    No synthetic stop rewrite; otherwise the strategy must generate a new
    setup with a valid structural stop and attainable targets.
    """
    direction=str(signal.get("direction") or "").upper()
    entry=number(signal.get("entry"))
    stop=number(signal.get("stop"))
    hourly=[c for c in state.candles_60 if c.confirmed]
    fourhour=state.candles_4h()
    if len(hourly)<50 or len(fourhour)<45 or entry is None or stop is None or entry<=0 or stop<=0:
        return {"ok":False,"why":"INSUFFICIENT_CONFIRMED_HTF_DATA","structural_anchor":None}
    recent=hourly[-80:]
    atr=_atr_hourly(recent)
    if atr is None:
        return {"ok":False,"why":"INVALID_HOURLY_ATR","structural_anchor":None}
    is_long=direction=="LONG"
    if direction not in {"LONG","SHORT"}:
        return {"ok":False,"why":"INVALID_DIRECTION","structural_anchor":None}
    pivot=_recent_pivot(recent,"low" if is_long else "high")
    if pivot is None or (pivot>=entry if is_long else pivot<=entry):
        return {"ok":False,"why":"NO_RELEVANT_1H_SWING_INVALIDATION","structural_anchor":pivot}
    # Stop beyond the structural pivot, with a volatility/noise buffer.
    buffer=max(0.25*atr,0.0010*entry)
    anchor=pivot
    relevant=[]
    for tf in ("1h","4h"):
        ob=(features.order_blocks or {}).get(tf) or {}
        side=str(ob.get("direction") or "").upper()
        bound=number(ob.get("zone_low" if is_long else "zone_high"))
        if side!=("BULLISH" if is_long else "BEARISH") or bound is None:
            continue
        # Only a nearby, correct-side invalidation zone can widen this anchor.
        if 0 < (entry-bound if is_long else bound-entry) <= 3.5*atr:
            relevant.append((tf,bound))
            anchor = min(anchor,bound) if is_long else max(anchor,bound)
    required=anchor-buffer if is_long else anchor+buffer
    valid = stop <= required if is_long else stop >= required
    return {
        "ok": valid,
        "why": "STRUCTURAL_STOP_CONFIRMED" if valid else "STOP_INSIDE_LIQUIDITY_NOISE_OR_INVALIDATION",
        "structural_anchor": round(anchor,4),
        "required_stop_boundary": round(required,4),
        "noise_buffer": round(buffer,4),
        "hourly_atr": round(atr,4),
        "nearby_order_blocks": [{"timeframe": tf,"boundary":bound} for tf,bound in relevant],
    }


def derivatives_context(state, now_ms: int) -> dict:
    oi=list(state.oi_window or [])
    oi=sorted((int(t),float(v)) for t,v in oi if number(v) is not None and v>0 and int(t)<=now_ms+1000)
    oi_5m=None
    if oi and now_ms-oi[-1][0] <= 120_000:
        end_ts,end_value=oi[-1]
        eligible=[(t,v) for t,v in oi if 240_000<=end_ts-t<=360_000]
        if eligible:
            prior=min(eligible,key=lambda x:abs((end_ts-x[0])-300_000))[1]
            oi_5m=round((end_value-prior)/prior*100,4)
    fresh_liqs=[]
    for raw in (state.liquidation_window or [])[-240:]:
        try:
            if 0<=now_ms-int(raw[0])<=300_000:
                fresh_liqs.append(raw)
        except (ValueError, TypeError, IndexError):
            continue
    funding=number(state.funding_rate)
    # MarketState currently has no venue-specific funding update timestamp;
    # a cached rate cannot certify an imminent squeeze.
    funding_status="SNAPSHOT_AGE_UNVERIFIED" if funding is not None else "UNAVAILABLE"
    context={
        "funding_rate": funding,
        "funding_status": funding_status,
        "oi_5m_pct": oi_5m,
        "oi_status": "OBSERVED_RECENT_5M_CHANGE" if oi_5m is not None else "UNVERIFIED",
        "fresh_liquidation_events": len(fresh_liqs),
        "long_liquidations_5m": round(float(state.liquidation_long_5m or 0),4) if fresh_liqs else None,
        "short_liquidations_5m": round(float(state.liquidation_short_5m or 0),4) if fresh_liqs else None,
        "squeeze_hypothesis": "NO_CONFIRMED_SQUEEZE",
        "squeeze_reliability": "INSUFFICIENT_FUNDING_FRESHNESS",
    }
    # Never upgrade this to a trade catalyst until funding freshness is verified.
    if oi_5m is not None and oi_5m>=0.5 and fresh_liqs:
        context["squeeze_hypothesis"]="OI_SPIKE_AND_LIQUIDATION_ACTIVITY_REQUIRES_DIRECTIONAL_VALIDATION"
    return context


def evaluate_htf_policy(state, signal: dict, features, now_ms: int) -> dict:
    """Explicit decision, with exact plan only if an existing signal is eligible."""
    direction=str(signal.get("direction") or "").upper()
    entry=number(signal.get("entry"))
    stop=number(signal.get("stop"))
    target1=number(signal.get("target1"))
    target2=number(signal.get("target2"))
    blocked=[]
    if not state.ws_connected or state.data_health!="HEALTHY":
        blocked.append("MARKET_DATA_UNHEALTHY")
    quote=int(state.last_market_update_ts or 0)
    if not quote or not -1000<=now_ms-quote<=3000:
        blocked.append("MARKET_QUOTE_STALE")
    if direction not in {"LONG","SHORT"} or any(x is None or x<=0 for x in (entry,stop,target2)):
        blocked.append("INVALID_PLAN")
    elif (direction=="LONG" and not stop<entry<target2) or (direction=="SHORT" and not target2<entry<stop):
        blocked.append("INVALID_PRICE_GEOMETRY")
    hourly=[c for c in state.candles_60 if c.confirmed]
    fourhour=state.candles_4h()
    if len(hourly)<50 or len(fourhour)<45:
        blocked.append("INSUFFICIENT_1H_4H_HISTORY")
    else:
        if now_ms-int(hourly[-1].end)>2*3_600_000 or now_ms-int(fourhour[-1].end)>5*3_600_000:
            blocked.append("STALE_CONFIRMED_HTF_BARS")
    hourly_macd=volume_weighted_macd(hourly)
    fourhour_macd=volume_weighted_macd(fourhour)
    hourly_rsi=rsi_divergence(hourly,rsi_series([c.close for c in hourly])) if len(hourly)>=25 else "UNKNOWN"
    fourhour_rsi=rsi_divergence(fourhour,rsi_series([c.close for c in fourhour])) if len(fourhour)>=25 else "UNKNOWN"
    if direction in {"LONG","SHORT"}:
        wanted="BULLISH" if direction=="LONG" else "BEARISH"
        trend_wanted="UP" if direction=="LONG" else "DOWN"
        if features.trend_60!=trend_wanted or features.trend_240!=trend_wanted:
            blocked.append("1H_4H_TREND_NOT_ALIGNED")
        if hourly_macd.get("direction")!=wanted or fourhour_macd.get("direction")!=wanted:
            blocked.append("1H_4H_VOLUME_WEIGHTED_MACD_NOT_ALIGNED")
        if hourly_rsi in {"BULLISH","BEARISH"} and hourly_rsi!=wanted:
            blocked.append("OPPOSING_1H_RSI_DIVERGENCE")
    structural=structural_stop(state,signal,features)
    if not structural["ok"]:
        blocked.append(structural["why"])
    gross_rr=0.0
    net_rr=0.0
    if entry is not None and stop is not None and target2 is not None and stop!=entry:
        is_long=direction=="LONG"
        reward=(target2-entry) if is_long else (entry-target2)
        risk=abs(entry-stop)
        gross_rr=reward/risk
        # Conservative estimate: taker entry+exit fees, plus 3bps estimated
        # adverse slippage on both ends. Exchange final quote rechecks later.
        friction=(entry+stop)*(0.0006+0.0003)
        net_rr=(reward-(entry+target2)*(0.0006+0.0003))/(risk+friction)
    if gross_rr<MIN_GROSS_RR or net_rr<MIN_NET_RR:
        blocked.append("REWARD_RISK_BELOW_2_5_AFTER_ESTIMATED_COSTS")
    derivatives=derivatives_context(state,now_ms)
    structural_catalyst=str(signal.get("setup") or "UNVERIFIED")
    rationale=[
        "1H/4H confirmed structure and adaptive volume-weighted MACD"
        if features.trend_60 in {"UP","DOWN"} and features.trend_240 in {"UP","DOWN"}
        else "1H/4H structure not yet confirmed",
        "Structural catalyst: "+structural_catalyst[:90],
        "RSI divergence: 1H="+hourly_rsi+", 4H="+fourhour_rsi,
        "Derivatives: OI="+derivatives["oi_status"]+", funding="+derivatives["funding_status"],
        "Macroeconomic catalyst: NOT VERIFIED (no timestamped macro event feed)",
    ]
    approved=not blocked
    return {
        "policy_version": POLICY_VERSION,
        "decision": ("BUY/LONG" if direction=="LONG" else "SELL/SHORT") if approved else "HOLD/WAIT",
        "eligible": approved,
        "reasons": list(dict.fromkeys(blocked))[:12],
        "direction_reviewed": direction,
        "entry": entry if approved else None,
        "stop_loss": stop if approved else None,
        "take_profit_1": target1 if approved else None,
        "take_profit_2": target2 if approved else None,
        "planned_entry_reference": entry,
        "planned_stop_reference": stop,
        "planned_target_reference": target2,
        "gross_rr": round(gross_rr,3),
        "estimated_net_rr": round(net_rr,3),
        "max_leverage": MAX_LEVERAGE,
        "max_equity_risk_pct": MAX_RISK_PCT,
        "structural_stop":structural,
        "indicators": {
            "trend_1h":features.trend_60,"trend_4h":features.trend_240,
            "rsi_divergence_1h":hourly_rsi,"rsi_divergence_4h":fourhour_rsi,
            "vw_macd_1h":hourly_macd,"vw_macd_4h":fourhour_macd,
        },
        "derivatives": derivatives,
        "rationale": rationale,
        "macro_feed_verified": False,
        "orders_submitted": False,
        "meaning": "CANDIDATE_ADMISSION_NOT_A_MARKET_ORDER",
    }
