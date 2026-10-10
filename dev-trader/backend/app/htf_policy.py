"""KYVORIQ higher-timeframe futures risk policy (read-only evaluation).

Uses only confirmed 1H and *complete* 4H candles. A policy-APPROVE means a
pre-existing strategy candidate passed additional checks, never an order.
No missing derivative, macro, liquidation or indicator value is manufactured.
"""
from __future__ import annotations

import math
from typing import Any
from .risk import MAX_RISK_PCT
from .models import aggregate_candles

MAX_LEVERAGE = 20
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


def structural_stop(state, signal: dict, features, now_ms: int | None = None) -> dict:
    """Require a nearby, observed invalidation; preserve 15m reversal stops."""
    direction=str(signal.get("direction") or "").upper()
    entry,stop=number(signal.get("entry")),number(signal.get("stop"))
    if direction not in {"LONG","SHORT"} or entry is None or stop is None or entry<=0 or stop<=0:
        return {"ok":False,"why":"INVALID_PLAN","structural_anchor":None}
    long=direction=="LONG"
    # A future-stamped "confirmed" bar cannot anchor a live protective stop.
    # Direct callers retain the old snapshot contract when no cutoff is passed.
    eligible = lambda c: c.confirmed and (now_ms is None or c.end < now_ms)
    hourly=sorted((c for c in state.candles_60 if eligible(c)), key=lambda c:c.start)
    atr=_atr_hourly(hourly)
    if atr is None:
        return {"ok":False,"why":"INSUFFICIENT_CONFIRMED_ATR","structural_anchor":None}
    # Not a mandatory distant 4h pivot: the nearest observed swing, OB or
    # mapped reaction can be a valid invalidation even against the macro trend.
    buffer=max(0.08*atr,0.00025*entry)
    bounds=[]
    def add(source,raw):
        value=number(raw)
        if value is None or value<=0: return
        distance=(entry-value) if long else (value-entry)
        if 0<distance<=4*atr: bounds.append((distance,source,value))
    add("1H_CONFIRMED_SWING",_recent_pivot(hourly[-80:],"low" if long else "high"))
    add("4H_CONFIRMED_SWING",_recent_pivot(aggregate_candles(hourly,4)[-35:],"low" if long else "high"))
    add("15M_CONFIRMED_SWING",_recent_pivot(sorted(
        (c for c in state.candles_15 if eligible(c)), key=lambda c:c.start)[-80:],
                                           "low" if long else "high"))
    for tf in ("15m","1h","4h"):
        ob=(features.order_blocks or {}).get(tf) or {}
        if str(ob.get("direction") or "").upper()==("BULLISH" if long else "BEARISH"):
            add(tf+"_CONFIRMED_OB",ob.get("zone_low" if long else "zone_high"))
    evidence=signal.get("evidence") or {}
    reaction=evidence.get("level_reaction") or {}
    age=number(evidence.get("level_reaction_age_ms"))
    if (str(reaction.get("direction") or "").upper()==direction
            and str(reaction.get("reaction_status") or "").upper()=="READY"
            and int(reaction.get("reaction_score") or 0)>=3
            and age is not None and 0<=age<=120_000):
        values=[number(reaction.get(key)) for key in (
            ("reaction_candle_low","zone_low") if long else
            ("reaction_candle_high","zone_high"))]
        valid=[v for v in values if v is not None and v>0]
        if valid: add("FRESH_LEVEL_REACTION",min(valid) if long else max(valid))
    if not bounds:
        return {"ok":False,"why":"NO_VERIFIABLE_STRUCTURAL_INVALIDATION",
                "structural_anchor":None,"hourly_atr":round(atr,4)}
    bounds.sort(key=lambda row:row[0])
    _,source,anchor=bounds[0]
    required=anchor-buffer if long else anchor+buffer
    valid=stop<=required if long else stop>=required
    return {
        "ok":valid,
        "why":"STRUCTURAL_STOP_CONFIRMED" if valid else "STOP_INSIDE_LIQUIDITY_NOISE_OR_INVALIDATION",
        "source":source,
        "structural_anchor":round(anchor,4),
        "required_stop_boundary":round(required,4),
        "noise_buffer":round(buffer,4),
        "hourly_atr":round(atr,4),
        "alternative_anchor_count":len(bounds)-1,
    }


def derivatives_context(state, now_ms: int) -> dict:
    oi=[]
    # Malformed optional derivatives telemetry must not interrupt price/structure
    # admission, nor fabricate a current 5-minute OI observation.
    for row in (state.oi_window or [])[-500:]:
        if not isinstance(row,(tuple,list)) or len(row)<2:
            continue
        timestamp, value = number(row[0]), number(row[1])
        if (timestamp is not None and timestamp.is_integer() and
                0 < timestamp <= now_ms and value is not None and value > 0):
            oi.append((int(timestamp), value))
    oi.sort()
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
            timestamp=number(raw[0])
            if timestamp is not None and timestamp.is_integer() and 0 <= now_ms-timestamp <= 300_000:
                fresh_liqs.append(raw)
        except (ValueError, TypeError, IndexError, KeyError):
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
        "long_liquidations_5m": round(number(state.liquidation_long_5m),4) if fresh_liqs and number(state.liquidation_long_5m) is not None else None,
        "short_liquidations_5m": round(number(state.liquidation_short_5m),4) if fresh_liqs and number(state.liquidation_short_5m) is not None else None,
        "squeeze_hypothesis": "NO_CONFIRMED_SQUEEZE",
        "squeeze_reliability": "INSUFFICIENT_FUNDING_FRESHNESS",
    }
    # Never upgrade this to a trade catalyst until funding freshness is verified.
    if oi_5m is not None and oi_5m>=0.5 and fresh_liqs:
        context["squeeze_hypothesis"]="OI_SPIKE_AND_LIQUIDATION_ACTIVITY_REQUIRES_DIRECTIONAL_VALIDATION"
    return context


def evaluate_htf_policy(state, signal: dict, features, now_ms: int) -> dict:
    """Hard risk/structure admission, flexible evidence scored as information."""
    direction=str(signal.get("direction") or "").upper()
    entry,stop=number(signal.get("entry")),number(signal.get("stop"))
    target1,target2=number(signal.get("target1")),number(signal.get("target2"))
    blocked=[]
    if not state.ws_connected or state.data_health!="HEALTHY":
        blocked.append("MARKET_DATA_UNHEALTHY")
    quote=number(state.last_market_update_ts)
    if quote is None or not 0 < quote <= now_ms or now_ms-quote > 3000:
        blocked.append("MARKET_QUOTE_STALE")
    if direction not in {"LONG","SHORT"} or any(x is None or x<=0 for x in (entry,stop,target2)):
        blocked.append("INVALID_PLAN")
    elif (direction=="LONG" and not stop<entry<target2) or (direction=="SHORT" and not target2<entry<stop):
        blocked.append("INVALID_PRICE_GEOMETRY")
    # Only fully ended, confirmed context existing at the decision timestamp
    # is admissible. Derived 4H bars must come from the same causal 1H prefix.
    hourly=sorted((c for c in state.candles_60
                   if c.confirmed and 0 < c.start <= c.end < now_ms),
                  key=lambda c:c.start)
    fourhour=aggregate_candles(hourly,4)
    if len(hourly)<20 or len(fourhour)<6:
        blocked.append("INSUFFICIENT_CONFIRMED_1H_4H_CONTEXT")
    else:
        if now_ms-int(hourly[-1].end)>2*3_600_000 or now_ms-int(fourhour[-1].end)>6*3_600_000:
            blocked.append("STALE_HTF_CANDLES")
    hourly_macd=volume_weighted_macd(hourly)
    fourhour_macd=volume_weighted_macd(fourhour)
    hourly_rsi=rsi_divergence(hourly,rsi_series([c.close for c in hourly]))
    fourhour_rsi=rsi_divergence(fourhour,rsi_series([c.close for c in fourhour]))
    wanted="BULLISH" if direction=="LONG" else "BEARISH"
    trend_wanted="UP" if direction=="LONG" else "DOWN"
    # Crucial distinction: indicators are supporting evidence, not 4 vetoes.
    # The existing strategy/playbook has already established a candidate.
    support=[]
    caution=[]
    for label,trend in (("1H",features.trend_60),("4H",features.trend_240)):
        if trend==trend_wanted: support.append(label+"_TREND")
        elif trend in {"UP","DOWN"}: caution.append(label+"_COUNTERTREND")
    for label,macd in (("1H",hourly_macd),("4H",fourhour_macd)):
        if macd.get("direction")==wanted: support.append(label+"_VOLUME_WEIGHTED_MACD")
        elif macd.get("direction") in {"BULLISH","BEARISH"}:
            caution.append(label+"_MACD_LAG_OR_CONFLICT")
    for label,divergence in (("1H",hourly_rsi),("4H",fourhour_rsi)):
        if divergence==wanted: support.append(label+"_RSI_DIVERGENCE")
        elif divergence in {"BULLISH","BEARISH"}:
            caution.append(label+"_OPPOSING_RSI_DIVERGENCE")
    # A measured SFP/level reaction with 1H/4H resistance against it is still
    # eligible when the existing strategy confirmed the reversal. No votes
    # are added to the existing confidence score.
    structure=structural_stop(state,signal,features,now_ms=now_ms)
    if not structure["ok"]: blocked.append(structure["why"])
    gross_rr=net_rr=0.0
    if direction in {"LONG","SHORT"} and all(v is not None and v>0 for v in (entry,stop,target2)) and entry!=stop:
        reward=(target2-entry) if direction=="LONG" else (entry-target2)
        risk=abs(entry-stop)
        gross_rr=reward/risk
        fee_slip=0.0006+0.0003  # taker estimate + adverse-slippage allowance, each side
        net_rr=(reward-(entry+target2)*fee_slip)/(risk+(entry+stop)*fee_slip)
    if gross_rr<MIN_GROSS_RR or net_rr<MIN_NET_RR:
        blocked.append("REWARD_RISK_BELOW_2_5_AFTER_ESTIMATED_COSTS")
    derivatives=derivatives_context(state,now_ms)
    if derivatives.get("oi_5m_pct") is not None and abs(derivatives["oi_5m_pct"])>=0.5:
        support.append("OPEN_INTEREST_VOLATILITY_CONTEXT_ONLY")
    catalyst=str(signal.get("setup") or "UNVERIFIED")
    approved=not blocked
    return {
        "policy_version":POLICY_VERSION,
        "decision":("BUY/LONG" if direction=="LONG" else "SELL/SHORT") if approved else "HOLD/WAIT",
        "eligible":approved,"reasons":list(dict.fromkeys(blocked))[:12],
        "direction_reviewed":direction,
        "entry":entry if approved else None,
        "stop_loss":stop if approved else None,
        "take_profit_1":target1 if approved else None,
        "take_profit_2":target2 if approved else None,
        "planned_entry_reference":entry,
        "planned_stop_reference":stop,
        "planned_target_reference":target2,
        "gross_rr":round(gross_rr,3),"estimated_net_rr":round(net_rr,3),
        "max_leverage":MAX_LEVERAGE,"max_equity_risk_pct":MAX_RISK_PCT,
        "structural_stop":structure,
        "indicators":{"trend_1h":features.trend_60,"trend_4h":features.trend_240,
                      "rsi_divergence_1h":hourly_rsi,"rsi_divergence_4h":fourhour_rsi,
                      "vw_macd_1h":hourly_macd,"vw_macd_4h":fourhour_macd},
        "derivatives":derivatives,
        "supporting_evidence":support[:12],"cautionary_evidence":caution[:12],
        "evidence_policy":"INDICATOR_DISAGREEMENT_ADVISORY_NOT_HARD_VETO",
        "rationale":[
            "Structural catalyst: "+catalyst[:90],
            "1H/4H trend and indicator conflicts are advisory, not automatic rejections",
            "SFP and level reversals remain eligible with confirmed invalidation and enough net reward/risk",
            "Derivatives OI: "+derivatives["oi_status"]+"; funding: "+derivatives["funding_status"],
            "Macro catalyst: NOT VERIFIED (no timestamped macroeconomic feed)",
        ],
        "macro_feed_verified":False,
        "orders_submitted":False,
        "meaning":"CANDIDATE_ADMISSION_NOT_A_MARKET_ORDER",
    }
