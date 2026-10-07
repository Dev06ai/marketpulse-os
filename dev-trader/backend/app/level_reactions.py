"""Auditable reaction-aware chart levels shared by diagnostics and signal readiness.

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

    # Preserve higher-priority structural levels when two references nearly overlap.
    priority = {"SFP": 0, "NPOC": 1, "DAILY": 2, "WEEKLY_OPEN": 3, "OB": 4}
    rows.sort(key=lambda row: priority.get(row["kind"], 9))
    unique: list[dict] = []
    for row in rows:
        if any(abs(row["price"] - old["price"]) / max(row["price"], 1.0) < 0.00010 for old in unique):
            continue
        unique.append(row)
    return unique[:14]


class LevelReactionTracker:
    def __init__(self):
        self.played: dict[str, dict] = {}
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

        # Retain played state for as long as the same structural level still
        # exists. After its grace period the level stays retired/hidden instead
        # of immediately re-arming on the same candle. A changed daily/OB/NPOC
        # price naturally creates a new id and becomes eligible again.
        active_ids = {row["id"] for row in raw_levels}
        self.played = {key: value for key, value in self.played.items() if key in active_ids}
        self.seen_levels = {key: value for key, value in self.seen_levels.items() if key in active_ids}
        previously_seen = set(self.seen_levels)
        for row in raw_levels:
            self.seen_levels.setdefault(
                row["id"],
                {"first_seen_ms": now, "first_seen_candle_start": int(candle.start) if candle else None},
            )

        if price is None:
            levels = []
            for row in raw_levels:
                played = self.played.get(row["id"])
                if played and now >= int(played.get("hide_after_ms") or 0):
                    continue
                if played:
                    row = dict(row, **played, state="PLAYED")
                else:
                    row = dict(row, state="WATCH")
                levels.append(row)
            self.last_state = {"status": "WATCH", "levels": levels, "armed": [], "trigger": None}
            return self.last_state

        atr = max(float(features.atr_15 or 0.0), price * 0.0005)
        touch_tolerance = max(1.0, atr * 0.08, price * 0.00018)
        reclaim = max(1.0, atr * 0.12, price * 0.00012)
        arm_distance = max(touch_tolerance * 3.0, atr * 0.35)

        can_trigger = candle is not None
        high = max(float(candle.high), price) if candle else price
        low = min(float(candle.low), price) if candle else price
        open_price = float(candle.open) if candle else price
        armed: list[dict] = []
        levels: list[dict] = []
        fresh_triggers: list[dict] = []

        for base in raw_levels:
            row = dict(base)
            level = float(row["price"])
            played = self.played.get(row["id"])
            if played:
                if now >= int(played.get("hide_after_ms") or 0):
                    continue
                row.update(played)
                row["state"] = "PLAYED"
                levels.append(row)
                if now - int(played.get("played_at_ms") or 0) <= TRIGGER_FRESH_MS:
                    fresh_triggers.append(row)
                continue

            distance = abs(price - level)
            touched = low <= level + touch_tolerance and high >= level - touch_tolerance
            native = row.get("direction", "BOTH")
            allow_long = native in {"BOTH", "LONG", "BULLISH"}
            allow_short = native in {"BOTH", "SHORT", "BEARISH"}

            # A reaction requires actual interaction plus displacement away from
            # the level. Proximity alone is only ARMED and can never create a trade.
            bullish = (
                can_trigger
                and row["id"] in previously_seen
                and allow_long
                and touched
                and price >= level + reclaim
                and price >= open_price
                and (low <= level or abs(low - level) <= touch_tolerance)
            )
            bearish = (
                can_trigger
                and row["id"] in previously_seen
                and allow_short
                and touched
                and price <= level - reclaim
                and price <= open_price
                and (high >= level or abs(high - level) <= touch_tolerance)
            )

            direction = ""
            reaction = ""
            if bullish and not bearish:
                direction, reaction = "LONG", "RECLAIM_REJECTION"
            elif bearish and not bullish:
                direction, reaction = "SHORT", "REJECTION_RECLAIM"

            if direction:
                played_at = now
                hide_after = played_at + (FIFTEEN_MIN_MS if row["kind"] == "SFP" else THIRTY_MIN_MS)
                meta = {
                    "state": "PLAYED",
                    "direction": direction,
                    "reaction": reaction,
                    "played_at_ms": played_at,
                    "hide_after_ms": hide_after,
                    "reaction_candle_start": int(candle.start),
                    "reaction_candle_end": int(candle.end),
                    "reaction_candle_high": round(high, 2),
                    "reaction_candle_low": round(low, 2),
                    "distance_at_trigger": round(distance, 2),
                }
                self.played[row["id"]] = meta
                row.update(meta)
                fresh_triggers.append(row)
            elif distance <= arm_distance or touched:
                row["state"] = "ARMED"
                row["distance"] = round(distance, 2)
                row["arm_distance"] = round(arm_distance, 2)
                if row["id"] not in previously_seen:
                    row["arming_reason"] = "LEVEL_FIRST_OBSERVED"
                elif not can_trigger:
                    row["arming_reason"] = "WAITING_FOR_FRESH_REACTION_CANDLE"
                armed.append(row)
            else:
                row["state"] = "WATCH"
            levels.append(row)

        trigger = None
        if fresh_triggers:
            # Prefer a trigger that happened on this update, otherwise keep the
            # freshest played reaction for only three minutes.
            fresh_triggers.sort(key=lambda row: int(row.get("played_at_ms") or 0), reverse=True)
            trigger = fresh_triggers[0]

        status = "TRIGGERED" if trigger else "ARMED" if armed else "WATCH"
        self.last_state = {
            "status": status,
            "levels": levels,
            "armed": sorted(armed, key=lambda row: float(row.get("distance") or 1e18))[:5],
            "trigger": trigger,
            "touch_tolerance": round(touch_tolerance, 2),
            "reclaim_distance": round(reclaim, 2),
            "reaction_candle_fresh": bool(can_trigger),
            "rule": "Proximity only arms a level; the level must already be mapped and a fresh sweep/reclaim or rejection with displacement is required before signal evaluation.",
        }
        return self.last_state
