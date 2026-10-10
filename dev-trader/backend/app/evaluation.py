"""Versioned shadow exit experiments. Outcomes never enter execution learning."""
from __future__ import annotations

import math
import os
from .journal import ENGINE_REVISION

EXIT_VARIANTS=("FIXED_TARGET","PARTIAL_AND_STRUCTURE","TIME_EXIT")


def exit_observation(signal,now,variant,fee_rate=.0006,slippage_bps=1.0):
    side=1 if signal["direction"]=="LONG" else -1
    entry=float(signal["entry"])*(1+side*slippage_bps/10000)
    stop=float(signal["stop"])
    distance=side*(entry-stop)
    if variant not in EXIT_VARIANTS or distance <= 0 or not math.isfinite(distance):
        raise ValueError("Invalid shadow exit plan")
    return dict(signal_id=signal["id"],direction=signal["direction"],setup=signal.get("setup"),
                variant=variant,entry=entry,initial_stop=stop,stop=stop,risk_distance=distance,
                target1=float(signal["target1"]),target2=float(signal["target2"]),
                created_ts=now,last_ts=now,remaining=1.0,partial=False,realized_points=-entry*fee_rate,
                fee_rate=fee_rate,slippage_bps=slippage_bps,status="OPEN",max_gap_ms=0,
                style=signal.get("trade_style","SCALP"),engine_revision=ENGINE_REVISION)


def advance_exit(row,price,now,structure=None,healthy=True):
    if row["status"]!="OPEN" or now<row["last_ts"]:
        return
    gap=now-row["last_ts"]
    row["max_gap_ms"]=max(row["max_gap_ms"],gap)
    row["last_ts"]=now
    if not healthy or gap>15_000:
        row["coverage_degraded"]=True
    sign=1 if row["direction"]=="LONG" else -1
    stop_hit=sign*(price-row["stop"])<=0
    target_hit=sign*(price-row["target2"])>=0
    expired=now-row["created_ts"] >= (12*3_600_000 if row["style"]=="SWING" else 2*3_600_000)

    def realize(quantity,observed):
        fill=observed*(1-sign*row["slippage_bps"]/10000)
        row["realized_points"]+=quantity*(sign*(fill-row["entry"])-fill*row["fee_rate"])
        row["remaining"]-=quantity

    reason="STOP" if stop_hit else "TARGET" if target_hit else "TIME" if expired and row["variant"]=="TIME_EXIT" else ""
    if reason:
        # Use observed prices, including adverse gaps; stops are never guaranteed.
        realize(row["remaining"],price)
        row.update(status="CLOSED",closed_ts=now,reason=reason,
                   net_r=row["realized_points"]/(row["risk_distance"]+(row["entry"]+row["initial_stop"])*row["fee_rate"]),
                   evidence_status="INCOMPLETE_PATH" if row.get("coverage_degraded") else "SHADOW_ESTIMATE")
        return
    if now-row["created_ts"] >= (48*3_600_000 if row["style"]=="SWING" else 8*3_600_000):
        row.update(status="CENSORED",closed_ts=now,evidence_status="UNRESOLVED_AT_OBSERVATION_HORIZON")
        return
    if row["variant"]=="PARTIAL_AND_STRUCTURE":
        if not row["partial"] and sign*(price-row["target1"])>=0:
            realize(.5,price);row["partial"]=True
        # Trail only behind newly CONFIRMED 1h swings, after a partial target.
        if row["partial"] and structure:
            kind="LOW" if sign==1 else "HIGH"
            levels=[l["price"] for l in structure.get("1h",{}).get("levels",[])
                    if l["kind"]==kind and l["status"] in {"ACTIVE","TOUCHED"}
                    and l["confirmed_at"]>row["created_ts"]
                    and sign*(price-l["price"])>.1*row["risk_distance"]]
            if levels:
                candidate=max(levels) if sign==1 else min(levels)
                row["stop"]=max(row["stop"],candidate) if sign==1 else min(row["stop"],candidate)


class ShadowEvaluator:
    def __init__(self,journal):
        self.journal=journal
        self.rows={}
        self.seen=[]
        self.last_checkpoint=0
        self.fee_rate=float(os.getenv("BITGET_DEMO_TAKER_FEE_RATE","0.0006"))
        self.slippage_bps=float(os.getenv("SHADOW_SLIPPAGE_BPS","1"))
        if not (math.isfinite(self.fee_rate) and 0<=self.fee_rate<=.01
                and math.isfinite(self.slippage_bps) and 0<=self.slippage_bps<=100):
            raise ValueError("Invalid shadow cost assumptions")
        records=journal.records(1,"SHADOW_CHECKPOINT")
        if records:
            self.rows=records[0].get("rows",{})
            self.seen=records[0].get("seen",[])

    def observe_candidate(self,signal,now,selected=False,legacy_allow=False):
        if signal["id"] in self.seen:
            return
        if not selected and not legacy_allow:
            return
        if sum(r["status"]=="OPEN" for r in self.rows.values())>=30:
            return
        self.seen.append(signal["id"])
        self.seen=self.seen[-1000:]
        for variant in EXIT_VARIANTS:
            row=exit_observation(signal,now,variant,self.fee_rate,self.slippage_bps)
            row.update(selected_by_v3=selected,legacy_gate_allow=legacy_allow,
                       scope="SAME_SIGNAL_EXIT_COMPARISON")
            self.rows[signal["id"]+":"+variant]=row
        self.checkpoint(now,force=True)

    def tick(self,state,now,structure):
        if not state.last_price or not math.isfinite(state.last_price):
            return
        closed_before=sum(r["status"]=="CLOSED" for r in self.rows.values())
        for row in self.rows.values():
            prior=row["status"]
            advance_exit(row,state.last_price,now,structure,state.data_health=="HEALTHY")
            if prior=="OPEN" and row["status"]=="CLOSED":
                self.journal.record("SHADOW_OUTCOME",row,now,identity="shadow:"+row["signal_id"]+":"+row["variant"])
        changed=closed_before!=sum(r["status"]=="CLOSED" for r in self.rows.values())
        self.checkpoint(now,force=changed)

    def checkpoint(self,now,force=False):
        if not force and now-self.last_checkpoint<60_000:
            return
        closed=sorted([r for r in self.rows.values() if r["status"] in {"CLOSED","CENSORED"}],key=lambda r:r["closed_ts"],reverse=True)[:300]
        keep={r["signal_id"]+":"+r["variant"]:r for r in closed}
        keep.update({k:r for k,r in self.rows.items() if r["status"]=="OPEN"})
        self.rows=keep
        self.journal.record("SHADOW_CHECKPOINT",dict(rows=self.rows,seen=self.seen),now,identity="shadow-checkpoint")
        self.last_checkpoint=now

    def summary(self):
        variants={}
        for variant in EXIT_VARIANTS:
            rows=[r for r in self.rows.values() if r["variant"]==variant and r["status"]=="CLOSED"]
            clean=[r for r in rows if r.get("evidence_status")=="SHADOW_ESTIMATE"]
            variants[variant]=dict(closed=len(rows),usable_observations=len(clean),
                excluded_incomplete_paths=len(rows)-len(clean),
                average_net_r=sum(r["net_r"] for r in clean)/len(clean) if clean else None)
        return dict(mode="SHADOW_ONLY",scope="SAME_SIGNAL_EXIT_COMPARISON_NOT_PORTFOLIO_BACKTEST",
                    variants=variants,open_observations=sum(r["status"]=="OPEN" for r in self.rows.values()),
                    censored_observations=sum(r["status"]=="CENSORED" for r in self.rows.values()),
                    costs="Estimated entry/exit taker fees plus adverse slippage",
                    promotion="MANUAL_REVIEW_AFTER_UNSEEN_PERIODS_AND_FORWARD_DEMO_EVIDENCE",
                    profitability_proven=False)


def chronological_split(records,train_fraction=.6):
    """Freeze chronological windows; never randomly shuffle time-series evidence."""
    if not .2<=train_fraction<=.8:
        raise ValueError("Train fraction must be between .2 and .8")
    rows=sorted([r for r in records if r.get("kind")=="DECISION"],key=lambda r:r["ts"])
    if len(rows)<20:
        return dict(available=False,reason="Need at least 20 recorded decisions; this is a coverage check, not a sufficient profitability sample.")
    boundary=rows[int(len(rows)*train_fraction)]["ts"]
    train=[r for r in rows if r["ts"]<boundary]
    test=[r for r in rows if r["ts"]>=boundary]
    return dict(available=bool(train and test),training_records=len(train),unseen_records=len(test),
                training_end_exclusive=boundary,unseen_start_inclusive=boundary,
                use="Freeze the strategy before evaluating the unseen period",profitability_proven=False)


def _causal_confirmed_candles(raw_candles, cutoff, candle_type):
    """Keep only candles fully finished *before* a recorded decision.

    Historical OPEN bars can be revised after the decision; replaying their
    final high/low/close is look-ahead contamination. Never pass them through.
    A malformed stored row is excluded rather than crashing an audit view.
    """
    import math
    if not isinstance(raw_candles, list):
        return []
    selected = {}
    for row in raw_candles[-1000:]:
        if not isinstance(row, dict) or row.get("confirmed") is not True:
            continue
        try:
            start, end = row["start"], row["end"]
            if (isinstance(start, bool) or isinstance(end, bool)
                    or not isinstance(start, int) or not isinstance(end, int)
                    or not 0 < start <= end < cutoff):
                continue
            values = [float(row[k]) for k in ("open", "high", "low", "close", "volume")]
            op, high, low, close, volume = values
            if (not all(math.isfinite(x) for x in values) or
                    min(op, low, close) <= 0 or high < max(op, close, low) or
                    low > min(op, close) or volume < 0):
                continue
            selected[start] = candle_type(start=start, end=end, open=op,
                high=high, low=low, close=close, volume=volume, confirmed=True)
        except (KeyError, ValueError, TypeError, OverflowError):
            continue
    return [selected[k] for k in sorted(selected)]


def replay_decisions(records):
    """Inspect confirmed structure causally; never imply a fill backtest."""
    from dataclasses import fields
    from .models import MarketState,Candle
    from .structure import structure_map
    allowed={f.name for f in fields(MarketState)}
    results=[]
    skipped=0
    ordered = sorted((r for r in records if isinstance(r, dict)),
                     key=lambda r: r.get("ts") if isinstance(r.get("ts"),int)
                     and not isinstance(r.get("ts"),bool) else -1)
    for record in ordered:
        if record.get("kind")!="DECISION":
            continue
        ts=record.get("ts")
        if isinstance(ts,bool) or not isinstance(ts,int) or ts<=0:
            skipped+=1
            continue
        market=record.get("market")
        if not isinstance(market,dict):
            skipped+=1
            continue
        raw={k:v for k,v in market.items() if k in allowed}
        for name in ("candles_5","candles_15","candles_60"):
            raw[name]=_causal_confirmed_candles(raw.get(name),ts,Candle)
        state=MarketState(**raw)
        mapping=structure_map(state,ts)
        results.append(dict(ts=ts,decision=record.get("report"),structure_map=mapping,
                            candidates=record.get("candidates",[])))
    return dict(scope="CAUSAL_DECISION_INSPECTION",records=results,
                skipped_invalid_decisions=skipped, profitability_backtest_available=False,
                limitation="Unconfirmed/future bars are excluded; recorded snapshots and sampled prices cannot prove exchange fills.")
