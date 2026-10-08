"""Independent, forward-only SMC *observer*, not a third-party signal engine.

Ideas: swing breaks, BOS/CHoCH and 3-candle FVG. Designed to cross-check
KYVORIQ's existing order-block/structure analysis. It never creates fills,
levels, new signals or executable trading advice. Confirmed bars only.
No smart-money-concepts library code is vendored/copied.
"""
from __future__ import annotations

import math
from typing import Any

VERSION = "smc-crosscheck-shadow-v1"
PIVOT_RADIUS = 2


def _valid(bar: Any) -> bool:
    try:
        prices=[float(getattr(bar,k)) for k in ("open","high","low","close")]
        return bool(getattr(bar,"confirmed",False)) and all(math.isfinite(v) and v>0 for v in prices) and prices[1]>=max(prices[0],prices[3]) and prices[2]<=min(prices[0],prices[3])
    except (ValueError,TypeError,AttributeError):
        return False


def confirmed_swing_analysis(candles: list, *, as_of_ms: int | None = None) -> dict:
    bars=sorted((c for c in candles if _valid(c) and
                 (as_of_ms is None or int(c.end)<=as_of_ms)), key=lambda c:int(c.start))[-120:]
    if len(bars)<9:
        return {"status":"INSUFFICIENT_CONFIRMED_BARS","bars":len(bars),
                "break":"NONE","swing_direction":"UNKNOWN","fvg":"NONE",
                "execution_capable":False}
    pivots_high=[]
    pivots_low=[]
    # The final 2 bars MUST NOT be used as pivots: right-hand confirmation is
    # required before a historical swing can influence the current verdict.
    for i in range(PIVOT_RADIUS,len(bars)-PIVOT_RADIUS):
        high=float(bars[i].high)
        low=float(bars[i].low)
        neigh=bars[i-PIVOT_RADIUS:i+PIVOT_RADIUS+1]
        if all(high>float(other.high) for j,other in enumerate(neigh) if j!=PIVOT_RADIUS):
            pivots_high.append((i,high))
        if all(low<float(other.low) for j,other in enumerate(neigh) if j!=PIVOT_RADIUS):
            pivots_low.append((i,low))
    curr=bars[-1]
    prev=bars[-2]
    broken_up=next(((i,v) for i,v in reversed(pivots_high)
                    if i<len(bars)-3 and float(prev.close)<=v<float(curr.close)),None)
    broken_down=next(((i,v) for i,v in reversed(pivots_low)
                      if i<len(bars)-3 and float(prev.close)>=v>float(curr.close)),None)
    if broken_up and broken_down:
        direction="AMBIGUOUS"
        level=None
    elif broken_up:
        direction="BULLISH"
        level=broken_up[1]
    elif broken_down:
        direction="BEARISH"
        level=broken_down[1]
    else:
        direction="NONE"
        level=None
    # The category BOS/CHoCH needs a *known previous structure trend*, not
    # simply an arbitrary price break. UNKNOWN means no honest classification.
    structural_trend="UNKNOWN"
    if len(pivots_high)>=2 and len(pivots_low)>=2:
        hi_up=pivots_high[-1][1]>pivots_high[-2][1]
        lo_up=pivots_low[-1][1]>pivots_low[-2][1]
        hi_down=pivots_high[-1][1]<pivots_high[-2][1]
        lo_down=pivots_low[-1][1]<pivots_low[-2][1]
        if hi_up and lo_up:structural_trend="BULLISH"
        elif hi_down and lo_down:structural_trend="BEARISH"
        else:structural_trend="RANGE"
    category="NONE"
    if direction in {"BULLISH","BEARISH"}:
        if structural_trend in {"BULLISH","BEARISH"}:
            category="BOS" if direction==structural_trend else "CHOCH"
        else:category="UNCLASSIFIED_SWING_BREAK"
    a,_,c=bars[-3:]
    fvg="BULLISH" if float(c.low)>float(a.high) else "BEARISH" if float(c.high)<float(a.low) else "NONE"
    return {
        "status":"CONFIRMED_ONLY",
        "bars":len(bars),
        "last_confirmed_end":int(curr.end),
        "break":direction,"break_category":category,
        "break_level":level,
        "swing_direction":structural_trend,
        "last_pivot_high":pivots_high[-1][1] if pivots_high else None,
        "last_pivot_low":pivots_low[-1][1] if pivots_low else None,
        "fvg":fvg,
        "execution_capable":False,
        "lookahead_prevention":"RIGHT_CONFIRMED_PIVOTS_ONLY",
    }


def compare_structure(state, features, as_of_ms: int) -> dict:
    groups={
        "15m":getattr(state,"candles_15",[]),
        "1h":getattr(state,"candles_60",[]),
        "4h":state.candles_4h(),
    }
    output={name:confirmed_swing_analysis(bars,as_of_ms=as_of_ms)
            for name,bars in groups.items()}
    chosen=output["1h"]
    existing=str(getattr(features,"market_structure","UNKNOWN") or "UNKNOWN").upper()
    observed=chosen.get("swing_direction")
    return {
        "version":VERSION,"mode":"SHADOW_ONLY",
        "timeframes":output,
        "existing_structure":existing,
        "independent_1h_structure":observed,
        "structure_disagreement": (
            observed in {"BULLISH","BEARISH"} and
            existing in {"BULLISH","BEARISH"} and observed != existing
        ),
        "execution_capable":False,
        "trade_signal":None,
        "profitability_proven":False,
        "method_note":"Independent confirmed-swing comparison; not the third-party SMC package.",
    }
