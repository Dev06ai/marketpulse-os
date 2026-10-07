"""Auditable reaction-aware chart levels shared by diagnostics and signal readiness.

Build 125: five-minute consumed-level retirement.

The tracker never emits a trade by itself. It only marks levels ARMED/PLAYED and
exposes a short-lived confirmed reaction to StrategyEngine, which must still
pass the existing quality, freshness, playbook, execution and risk gates.
"""
from __future__ import annotations

import math
import time
from typing import Any

from .analytics import MarketFeatures
from .models import Candle, MarketState
from .manual_levels import manual_engine_rules, manual_level_pack_summary, manual_reaction_levels

FIVE_MIN_MS = 5 * 60_000
FIFTEEN_MIN_MS = 15 * 60_000
THIRTY_MIN_MS = 30 * 60_000
TRIGGER_FRESH_MS = 3 * 60_000


def _finite(value: Any) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) and out > 0 else None


def _level_key(kind: str, label: str, price: float) -> str:
    return f"{kind}:{label}:{price:.2f}"


def collect_reaction_levels(features: MarketFeatures, sfp_hunter: dict | None = None) -> list[dict]:
    """Build the exact level set shown on the chart and watched by the engine."""
    rows: list[dict] = []

    def add(kind: str, label: str, price: Any, direction: str = "BOTH", source: str = ""):
        value = _finite(price)
        if value is None:
            return
        rows.append({
            "id": _level_key(kind, label, value),
            "kind": kind,
            "label": label,
            "price": round(value, 2),
            "direction": str(direction or "BOTH").upper(),
            "source": source or kind,
        })

    # Daily references replace the noisy recent-15m H/L display levels.
    add("DAILY", "D HIGH", features.previous_day_high, source="PREVIOUS_DAY_HIGH")
    add("DAILY", "D LOW", features.previous_day_low, source="PREVIOUS_DAY_LOW")
    add("WEEKLY_OPEN", "W OPEN", features.weekly_open, source="WEEKLY_OPEN")

    volume = features.volume_context or {}
    if bool(volume.get("exact_npoc")) and volume.get("untouched_poc") is not None:
        add("NPOC", "NPOC", volume.get("untouched_poc"), source="EXECUTED_TRADE_PROFILE")

    labels = {"15m": "15M OB", "1h": "1H OB", "4h": "4H OB", "1D": "1D OB", "2D": "2D OB"}
    for timeframe in ("15m", "1h", "4h", "1D", "2D"):
        detail = (features.order_blocks or {}).get(timeframe) or {}
        direction = str(detail.get("direction") or "NONE").upper()
        if direction == "NONE":
            continue
        add(
            "OB",
            labels[timeframe],
            detail.get("mid"),
            direction="LONG" if direction == "BULLISH" else "SHORT",
            source=f"{timeframe}_ORDER_BLOCK",
        )

    sfp = sfp_hunter or {}
    if sfp.get("target_level") is not None:
        raw_direction = str(sfp.get("direction") or "BOTH").upper()
        add(
            "SFP",
            "SFP",
            sfp.get("target_level"),
            direction=raw_direction if raw_direction in {"LONG", "SHORT"} else "BOTH",
            source="SFP_HUNTER",
        )

    # Manual rows are first-class structural references. They are the exact
    # map rendered on Android and watched by this tracker.
    rows.extend(manual_reaction_levels())

    priority = {"SFP": 0, "NPOC": 1, "WEEKLY_NPOC": 1, "RANGE_POC": 1,
                "DAILY": 2, "WEEKLY_OPEN": 3, "OB_ZONE": 4, "SUPPLY_ZONE": 4, "OB": 5}
    rows.sort(key=lambda row: (0 if row.get("manual") else 1, -int(row.get("priority") or 0),
                               priority.get(str(row.get("kind") or "").upper(), 9)))
    unique: list[dict] = []
    for row in rows:
        if any(abs(row["price"] - old["price"]) / max(row["price"], 1.0) < 0.00010 for old in unique):
            continue
        unique.append(row)
    return unique[:24]


class LevelReactionTracker:
    def __init__(self):
        self.played: dict[str, dict] = {}
        self.tapped: dict[str, dict] = {}
        self.seen_levels: dict[str, dict] = {}
        self.last_state: dict = {"status": "IDLE", "levels": [], "armed": [], "trigger": None}

    @staticmethod
    def _live_candle(state: MarketState, now_ms: int) -> Candle | None:
        """Return only a candle that can legitimately describe a reaction now.

        A stale closed candle plus a new live price must never be merged into a
        synthetic sweep/reclaim. Closed bars are accepted only briefly after
        their close; an open bar must actually contain the current as-of time.
        """
        if state.candles_5:
            last = state.candles_5[-1]
            if not last.confirmed:
                if int(last.start) - 1_000 <= now_ms <= int(last.end) + 90_000:
                    return last
                return None
            confirmed = [c for c in state.candles_5 if c.confirmed]
            recent = confirmed[-1] if confirmed else last
            if 0 <= now_ms - int(recent.end) <= 90_000:
                return recent
            return None
        confirmed15 = [c for c in state.candles_15 if c.confirmed]
        if not confirmed15:
            return None
        recent = confirmed15[-1]
        return recent if 0 <= now_ms - int(recent.end) <= 90_000 else None

    def update(
        self,
        state: MarketState,
        features: MarketFeatures,
        sfp_hunter: dict | None = None,
        now_ms: int | None = None,
    ) -> dict:
        now = int(now_ms if now_ms is not None else getattr(state, "_as_of_ms", time.time() * 1000))
        price = _finite(state.last_price)
        candle = self._live_candle(state, now)
        raw_levels = collect_reaction_levels(features, sfp_hunter)
        rules = manual_engine_rules()
        min_score = max(3, int(rules.get("min_confirmation_score", 3) or 3))
        configured_arm_pct = max(0.0001, float(rules.get("arm_distance_pct_line", 0.0012) or 0.0012))

        active_ids = {row["id"] for row in raw_levels}
        self.played = {k: v for k, v in self.played.items() if k in active_ids}
        self.tapped = {k: v for k, v in self.tapped.items() if k in active_ids}
        self.seen_levels = {k: v for k, v in self.seen_levels.items() if k in active_ids}
        previously_seen = set(self.seen_levels)
        for row in raw_levels:
            self.seen_levels.setdefault(row["id"], {
                "first_seen_ms": now,
                "first_seen_candle_start": int(candle.start) if candle else None,
            })

        if price is None:
            levels=[]
            for base in raw_levels:
                row=dict(base)
                tap=self.tapped.get(row["id"])
                if tap and now >= int(tap.get("hide_after_ms") or 0):
                    continue
                played=self.played.get(row["id"])
                if played and now >= int(played.get("hide_after_ms") or 0):
                    continue
                if played:
                    row.update(played); row["state"]="PLAYED"
                elif tap:
                    row.update(tap); row["state"]="TAPPED"
                else:
                    row["state"]="WATCH"
                levels.append(row)
            self.last_state={"status":"WATCH","levels":levels,"armed":[],"trigger":None,
                             "manual_pack":manual_level_pack_summary(),"min_confirmation_score":min_score}
            return self.last_state

        atr=max(float(features.atr_15 or 0.0), price*0.0005)
        touch_tolerance=max(1.0,atr*0.08,price*0.00018)
        reclaim=max(1.0,atr*0.12,price*0.00012)
        arm_distance=max(touch_tolerance*3.0,atr*0.35,price*configured_arm_pct)
        can_trigger=candle is not None
        high=max(float(candle.high),price) if candle else price
        low=min(float(candle.low),price) if candle else price
        open_price=float(candle.open) if candle else price
        armed=[]; levels=[]; fresh=[]

        for base in raw_levels:
            row=dict(base); level=float(row["price"])
            zl=_finite(row.get("zone_low")); zh=_finite(row.get("zone_high"))
            if zl is not None and zh is not None: zl,zh=sorted((zl,zh))
            else: zl=zh=None
            is_zone=zl is not None and zh is not None
            lower=float(zl if is_zone else level); upper=float(zh if is_zone else level)
            long_anchor=upper; short_anchor=lower
            seen=self.seen_levels[row["id"]]
            seen.setdefault("initial_low",low); seen.setdefault("initial_high",high)
            touched=low <= upper+touch_tolerance and high >= lower-touch_tolerance
            seen["observed_long_touch"]=bool(seen.get("observed_long_touch") or (touched and price <= long_anchor+touch_tolerance))
            seen["observed_short_touch"]=bool(seen.get("observed_short_touch") or (touched and price >= short_anchor-touch_tolerance))
            newer=bool(candle is not None and int(candle.start) > int(seen.get("first_seen_candle_start") or candle.start))
            long_interaction=bool(newer or seen["observed_long_touch"] or (low < float(seen["initial_low"]) and low <= long_anchor+touch_tolerance))
            short_interaction=bool(newer or seen["observed_short_touch"] or (high > float(seen["initial_high"]) and high >= short_anchor-touch_tolerance))

            tap=self.tapped.get(row["id"])
            if tap and now >= int(tap.get("hide_after_ms") or 0):
                # A fully consumed structural level remains retired until its
                # upstream price/id changes. This keeps stale levels from
                # immediately reappearing after the requested grace period.
                continue

            played=self.played.get(row["id"])
            if played:
                if now >= int(played.get("hide_after_ms") or 0): continue
                row.update(played); row["state"]="PLAYED"; levels.append(row)
                if now-int(played.get("played_at_ms") or 0) <= TRIGGER_FRESH_MS: fresh.append(row)
                continue

            distance=0.0 if lower <= price <= upper else min(abs(price-lower),abs(price-upper))
            # A line is consumed once price trades through the line. A zone is
            # only "fully tapped" after the candle spans the entire zone; using
            # the midpoint for zones retired valid OB/supply reactions too early.
            fully_tapped=bool(
                can_trigger
                and row["id"] in previously_seen
                and (
                    (not is_zone and low <= level <= high)
                    or (is_zone and low <= lower and high >= upper)
                )
            )
            if fully_tapped and tap is None:
                tap={
                    "state":"TAPPED",
                    "tapped_at_ms":now,
                    "hide_after_ms":now+FIVE_MIN_MS,
                    "tap_reason":"PRICE_FULLY_TOUCHED_LEVEL",
                }
                self.tapped[row["id"]]=tap
            native=str(row.get("direction","BOTH")).upper()
            allow_long=native in {"BOTH","LONG","BULLISH"}
            allow_short=native in {"BOTH","SHORT","BEARISH"}
            bullish=(can_trigger and row["id"] in previously_seen and long_interaction and allow_long and touched
                     and price >= long_anchor+reclaim and price >= open_price)
            bearish=(can_trigger and row["id"] in previously_seen and short_interaction and allow_short and touched
                     and price <= short_anchor-reclaim and price <= open_price)
            direction="LONG" if bullish and not bearish else "SHORT" if bearish and not bullish else ""
            reaction="RECLAIM_REJECTION" if direction=="LONG" else "REJECTION_RECLAIM" if direction=="SHORT" else ""

            if direction:
                score=2; confirms=["LEVEL_INTERACTION","DIRECTIONAL_RECLAIM"]
                wick_ok=(direction=="LONG" and low < min(open_price,price) and price>open_price) or                         (direction=="SHORT" and high > max(open_price,price) and price<open_price)
                if wick_ok: score+=1; confirms.append("WICK_REJECTION")
                expected_structure="BULLISH" if direction=="LONG" else "BEARISH"
                if str(features.market_structure).upper()==expected_structure: score+=1; confirms.append("MARKET_STRUCTURE")
                expected_cvd="BULLISH" if direction=="LONG" else "BEARISH"
                if str(features.cvd_price_divergence).upper()==expected_cvd: score+=1; confirms.append("CVD")
                if (direction=="LONG" and float(features.book_imbalance or 0)>0.10) or (direction=="SHORT" and float(features.book_imbalance or 0)<-0.10):
                    score+=1; confirms.append("ORDER_BOOK")
                if abs(float(features.oi_change_5m_pct or 0))>=0.15: score+=1; confirms.append("OI_EXPANSION")
                sfp=sfp_hunter or {}; sfp_target=_finite(sfp.get("target_level")); sfp_dir=str(sfp.get("direction") or "").upper()
                if sfp_target is not None and lower-touch_tolerance <= sfp_target <= upper+touch_tolerance and sfp_dir in {"","BOTH",direction}:
                    score+=2; confirms.append("SFP")

                if score < min_score:
                    if tap:
                        row.update(tap)
                    row.update({"state":"CONFIRMING","direction":direction,"reaction":reaction,"reaction_score":score,
                                "reaction_confirmations":confirms,"required_confirmation_score":min_score,
                                "distance":round(distance,2),"arm_distance":round(arm_distance,2)})
                    armed.append(row); levels.append(row); continue

                played_at=now
                default_hide=played_at+(FIFTEEN_MIN_MS if row["kind"]=="SFP" else THIRTY_MIN_MS)
                hide_after=min(default_hide,int(tap.get("hide_after_ms"))) if tap else default_hide
                meta={"state":"PLAYED","reaction_status":"READY","direction":direction,"reaction":reaction,
                      "reaction_score":score,"reaction_confirmations":confirms,"required_confirmation_score":min_score,
                      "played_at_ms":played_at,"hide_after_ms":hide_after,"reaction_candle_start":int(candle.start),
                      "reaction_candle_end":int(candle.end),"reaction_candle_high":round(high,2),
                      "reaction_candle_low":round(low,2),"distance_at_trigger":round(distance,2)}
                if tap:
                    meta["tapped_at_ms"]=int(tap.get("tapped_at_ms") or played_at)
                    meta["tap_reason"]=str(tap.get("tap_reason") or "PRICE_FULLY_TOUCHED_LEVEL")
                if is_zone: meta.update(zone_low=round(lower,2),zone_high=round(upper,2))
                self.played[row["id"]]=meta; row.update(meta); fresh.append(row)
            elif distance <= arm_distance or touched:
                was_seen = row["id"] in previously_seen
                if tap:
                    row.update(tap)
                    row["state"]="TAPPED"
                else:
                    row["state"] = "CONFIRMING" if (touched and was_seen and can_trigger) else "ARMED"
                row["distance"]=round(distance,2)
                row["arm_distance"]=round(arm_distance,2); row["required_confirmation_score"]=min_score
                row["arming_reason"]="LEVEL_FULLY_TAPPED_RETIRING_SOON" if tap else                     "LEVEL_FIRST_OBSERVED" if not was_seen else                     "WAITING_FOR_FRESH_REACTION_CANDLE" if not can_trigger else                     "TOUCHED_WAITING_FOR_RECLAIM" if touched else "PRICE_APPROACHING_LEVEL"
                armed.append(row)
            else:
                row["state"]="WATCH"
            levels.append(row)

        trigger=None
        if fresh:
            fresh.sort(key=lambda row:int(row.get("played_at_ms") or 0),reverse=True); trigger=fresh[0]
        confirming=[r for r in armed if r.get("state")=="CONFIRMING"]
        status="TRIGGERED" if trigger else "CONFIRMING" if confirming else "ARMED" if armed else "WATCH"
        self.last_state={"status":status,"levels":levels,"armed":sorted(armed,key=lambda r:float(r.get("distance") or 1e18))[:6],
                         "trigger":trigger,"touch_tolerance":round(touch_tolerance,2),"reclaim_distance":round(reclaim,2),
                         "reaction_candle_fresh":bool(can_trigger),"min_confirmation_score":min_score,
                         "manual_pack":manual_level_pack_summary(),
                         "rule":"Proximity/touch only arms. A fresh directional reclaim/rejection plus confirmation score is required before signal evaluation."}
        return self.last_state
