"""Explicit demo admission rules, separate from experimental pattern context."""
import math


def family(setup):
    name=setup.upper()
    if "LEVEL REACTION" in name: return "LEVEL_REACTION"
    if "SFP" in name: return "SFP_REVERSAL"
    if "RETEST" in name: return "BREAKOUT_RETEST"
    if "PULLBACK" in name: return "TREND_PULLBACK"
    if "MOMENTUM" in name: return "EARLY_MOMENTUM"
    if "D-LINE" in name or "DLINE" in name: return "DLINE_BREAKOUT"
    return "STRUCTURE_CONTINUATION"


def policy(signal, state, features, regime):
    name=family(signal.setup)
    direction=signal.direction
    sign=1 if direction == "LONG" else -1
    expected="UP" if direction == "LONG" else "DOWN"
    reasons=[]
    regime_name=regime["regime"]
    h=features.structure_map.get("1h",{})
    f4=features.structure_map.get("4h",{})
    price=signal.entry
    atr=max(features.atr_15,price*.0005)
    structure_opposed=h.get("bias") == ("BEARISH" if direction == "LONG" else "BULLISH")
    trend_aligned=features.trend_60 == expected
    levels=[features.previous_day_low,features.previous_week_low] if direction == "LONG" else [features.previous_day_high,features.previous_week_high]
    kind="LOW" if direction == "LONG" else "HIGH"
    levels += [l["price"] for tf in (h,f4) for l in tf.get("levels",[]) if l["kind"] == kind and l["status"] in {"ACTIVE","TOUCHED"}]
    at_level=any(level and abs(price-level) <= 1.5*atr for level in levels)
    reaction = signal.evidence.get("level_reaction") or {}
    reaction_kind = str(reaction.get("kind") or "").upper()
    reaction_direction = str(reaction.get("direction") or "").upper()
    reaction_state = str(reaction.get("state") or "").upper()
    valid_level_reaction = (
        name == "LEVEL_REACTION"
        and reaction_kind in {"DAILY","WEEKLY_OPEN","NPOC","OB","SFP"}
        and reaction_direction == direction
        and reaction_state in {"PLAYED","TRIGGERED","REACTION_CONFIRMED"}
    )
    if valid_level_reaction:
        at_level = True
    if regime_name in {"UNKNOWN","HIGH_VOL"}:
        reasons.append("Market condition is warming or unstable")
    if h.get("status") != "READY" or not h.get("contiguous_recent",False):
        reasons.append("Confirmed 1h structure history is incomplete")
    if name == "SFP_REVERSAL":
        if not at_level:
            reasons.append("SFP lacks a nearby daily/weekly/confirmed higher-timeframe swing level")
        if not trend_aligned and regime_name != "RANGE":
            reasons.append("Counter-trend SFP requires a stable range condition")
    elif name == "LEVEL_REACTION":
        if not valid_level_reaction:
            reasons.append("Level-reaction candidate is missing a fresh confirmed mapped-level reaction")
        if reaction_kind == "OB" and not trend_aligned:
            reasons.append("Order-block reaction is counter to the confirmed 1h trend")
        if structure_opposed and reaction_kind == "OB":
            reasons.append("Order-block reaction conflicts with confirmed 1h structure")
        if features.trend_240 in {"UP","DOWN"} and features.trend_240 != expected and reaction_kind == "OB":
            reasons.append("Order-block reaction conflicts with 4h context")
    elif name == "EARLY_MOMENTUM":
        if structure_opposed or features.trend_15 == ("DOWN" if direction == "LONG" else "UP"):
            reasons.append("Early momentum conflicts with confirmed structure")
        if regime_name == "RANGE" and not ((h.get("last_break") or {}).get("confirmed_at") == h.get("last_closed_ts")):
            reasons.append("Range momentum has no confirmed 1h boundary break")
    else:
        if not trend_aligned or structure_opposed:
            reasons.append("Continuation conflicts with 1h bias")
        expected_regimes={"TREND_UP","BREAKOUT_LONG"} if direction=="LONG" else {"TREND_DOWN","BREAKOUT_SHORT"}
        if regime_name not in expected_regimes and not (regime_name=="RANGE" and name=="BREAKOUT_RETEST"):
            reasons.append("Selected market condition does not support this continuation direction")
        if not regime.get("stable",True) and name!="BREAKOUT_RETEST":
            reasons.append("Market-condition transition awaits a second closed 1h observation")
        if regime_name == "RANGE" and name != "BREAKOUT_RETEST":
            reasons.append("Range condition does not support this continuation playbook")
        if features.trend_240 in {"UP","DOWN"} and features.trend_240 != expected:
            reasons.append("Continuation conflicts with 4h context")
    values=(signal.entry,signal.stop,signal.target1,signal.target2,signal.confidence,signal.rr)
    if not all(math.isfinite(x) for x in values) or min(values[:4]) <= 0:
        reasons.append("Invalid trade geometry")
    elif not (sign*(price-signal.stop)>0 and 0 < sign*(signal.target1-price) < sign*(signal.target2-price)):
        reasons.append("Entry, stop and targets are not in execution order")
    if state.last_price is None or abs(state.last_price-price) > .5*atr:
        reasons.append("Entry has moved beyond the confirmed trigger")
    return dict(family=name,version="v3",allow=not reasons,reason="; ".join(reasons),
                regime=regime_name,at_htf_level=at_level,trend_aligned=trend_aligned,
                cancellation="Trigger invalidation, stale data, expired decision or excessive entry drift",
                initial_stop="Structural invalidation plus volatility allowance",
                pattern_context="ELLIOTT_AND_HARMONIC_OBSERVATION_ONLY")


def admission(signal,state,features,now, min_confidence=.78, min_rr=3.0):
    reasons=[]
    direction=signal.direction
    playbook=signal.evidence["playbook"]
    if not playbook["allow"]:
        reasons.append(playbook["reason"])
    ages={"quote":(state.last_market_update_ts,3000),"trade":(state.last_trade_ts,15000),"book":(state.last_book_ts,5000)}
    if state.data_health != "HEALTHY": reasons.append("Primary market feed is not fully healthy")
    for name,(ts,limit) in ages.items():
        if not ts or now-ts > limit or ts-now > 1000:
            reasons.append(f"{name} feed is stale or has an invalid timestamp")
    if features.spread_bps > 4:
        reasons.append("Spread exceeds 4 bps")
    adverse="BEARISH" if direction == "LONG" else "BULLISH"
    if features.cvd_price_divergence == adverse and playbook["family"] != "SFP_REVERSAL":
        reasons.append("Order flow materially conflicts with continuation")
    if (direction == "LONG" and features.book_imbalance < -.16) or (direction == "SHORT" and features.book_imbalance > .16):
        reasons.append("Order book materially opposes the trade")
    flow=((direction == "LONG" and (features.book_imbalance > .1 or features.cvd_price_divergence == "BULLISH"))
          or (direction == "SHORT" and (features.book_imbalance < -.1 or features.cvd_price_divergence == "BEARISH")))
    if playbook["family"] in {"SFP_REVERSAL","EARLY_MOMENTUM","LEVEL_REACTION"} and not flow:
        reasons.append("Early trigger needs independent directional order-flow confirmation")
    if playbook["family"] == "LEVEL_REACTION":
        reaction = signal.evidence.get("level_reaction") or {}
        played_at = int(reaction.get("played_at_ms") or 0)
        if not played_at or now - played_at < 0 or now - played_at > 180_000:
            reasons.append("Mapped-level reaction is stale or has an invalid timestamp")
    # An evidence score is not a win probability. Trigger, location and flow
    # do not multiply into a fictitious probability of success.
    if signal.confidence < float(min_confidence) or signal.grade != "A" or signal.rr < float(min_rr):
        reasons.append(
            f"Setup does not meet retained evidence/grade/reward thresholds "
            f"(confidence >= {float(min_confidence):.0%}, Grade A, R:R >= {float(min_rr):.2f})"
        )
    return not reasons,"; ".join(reasons)


def experimental_pattern_adjustment(features,direction):
    """Remove legacy Elliott score contribution from v3 executable decisions."""
    if features.elliott_direction == direction and features.elliott_confidence >= .55:
        return -.08
    if features.elliott_direction not in {"NEUTRAL","UNKNOWN"} and features.elliott_direction != direction and features.elliott_confidence >= .65:
        return .06
    return 0.0
