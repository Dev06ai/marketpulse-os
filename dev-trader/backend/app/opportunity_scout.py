"""Read-only KYVORIQ Opportunity Scout.

Records *observations*, never order instructions or proof of missed profit.
A deterministic 60-minute follow-up uses timestamped price samples, requiring
continuous-enough coverage and a fresh terminal sample. All records use the
existing bounded decision journal; missing evidence is marked unverifiable.
"""
from __future__ import annotations

import hashlib
import math
from collections import Counter
from typing import Any

HORIZON_MS = 60 * 60_000
GRACE_MS = 5 * 60_000
COOLDOWN_MS = 90 * 60_000
MAX_ACTIVE = 16
MAX_NEW_PER_DAY = 24


def finite_positive(value: Any) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) and number > 0 else None
    except (TypeError, ValueError, OverflowError):
        return None


def price_path_outcome(observation: dict, prices: list[tuple[int, float]]) -> dict:
    """Path analysis with no simulated fills, leverage, TP/SL or PnL."""
    open_ts = int(observation["opened_ts"])
    end_ts = open_ts + HORIZON_MS
    entry = finite_positive(observation.get("reference_price"))
    direction = observation.get("direction")
    valid = sorted(
        {(int(ts), float(p)) for ts, p in prices
         if open_ts <= int(ts) <= end_ts + GRACE_MS and finite_positive(p) is not None}
    )
    if not entry or direction not in {"LONG", "SHORT"}:
        return {"status": "UNVERIFIABLE", "why": "INVALID_REFERENCE"}
    if not valid:
        return {"status": "UNVERIFIABLE", "why": "NO_PRICE_SAMPLES"}
    before = [x for x in valid if x[0] <= end_ts]
    terminal = next((x for x in valid if end_ts <= x[0] <= end_ts + GRACE_MS), None)
    # First and last samples, buckets and maximal gap are independently checked.
    if (
        terminal is None or not before or before[0][0] - open_ts > 60_000
        or len({(ts-open_ts)//60_000 for ts, _ in before}) < 40
        or max((right[0]-left[0] for left, right in
                zip(before, before[1:])), default=HORIZON_MS) > 180_000
        or terminal[0] - before[-1][0] > 180_000
    ):
        return {"status": "UNVERIFIABLE", "why": "GAPPED_OR_MISSING_TERMINAL_DATA"}
    polarity = 1 if direction == "LONG" else -1
    directional = [polarity * (price-entry)/entry*100 for _, price in before]
    terminal_move = polarity * (terminal[1]-entry)/entry*100
    return {
        "status": "RESOLVED_PRICE_ONLY",
        "directional_move_pct": round(terminal_move, 5),
        "favorable_excursion_pct": round(max(0.0, *directional), 5),
        "adverse_excursion_pct": round(min(0.0, *directional), 5),
        "terminal_ts": terminal[0],
        "price_samples": len(before),
        "meaning": "POST_OBSERVATION_PRICE_PATH_NOT_AN_EXECUTABLE_TRADE",
    }


class OpportunityScout:
    def __init__(self, journal):
        self.journal = journal
        self.items: dict[str, dict] = {}
        self.last_seen: dict[str, int] = {}
        self.last_resolution_ms = 0
        self.last_error = ""
        # Rehydrate bounded, recent scout evidence on process restart.
        try:
            for row in reversed(journal.records(300, "SCOUT")):
                uid = str(row.get("observation_id") or "")
                key = str(row.get("dedupe_key") or "")
                if uid and key:
                    self.items[uid] = dict(row)
                    self.last_seen[key] = max(
                        self.last_seen.get(key, 0), int(row.get("opened_ts") or 0)
                    )
        except Exception as exc:
            self.last_error = type(exc).__name__
        self._bound()

    def _bound(self):
        self.items = dict(sorted(
            self.items.items(), key=lambda pair: int(pair[1].get("opened_ts") or 0),
            reverse=True,
        )[:160])

    def _admit(self, *, now_ms: int, price: float, direction: str,
               setup: str, source: str, reason: str, signal_id: str = "",
               tier: str = "") -> dict | None:
        direction = direction.upper()
        if direction not in {"LONG", "SHORT"} or not setup:
            return None
        pending = sum(x.get("status") == "OPEN" for x in self.items.values())
        if pending >= MAX_ACTIVE:
            return None
        today = now_ms // 86_400_000
        created_today = sum(int(x.get("opened_ts") or 0)//86_400_000 == today
                            for x in self.items.values())
        if created_today >= MAX_NEW_PER_DAY:
            return None
        key = "|".join((source, direction, setup[:80]))
        if now_ms - self.last_seen.get(key, -COOLDOWN_MS*2) < COOLDOWN_MS:
            return None
        uid = hashlib.sha256(f"{key}|{now_ms}|{signal_id}".encode()).hexdigest()[:20]
        row = {
            "observation_id": uid,
            "dedupe_key": key,
            "status": "OPEN",
            "source": source,
            "direction": direction,
            "setup": setup[:80],
            "signal_id": signal_id[:96],
            "tier": tier[:24],
            "reason": reason[:200],
            "opened_ts": now_ms,
            "reference_price": price,
            "horizon_minutes": 60,
            "interpretation": "WATCH_OR_REJECTED_SETUPS_ARE_NOT_TRADES",
        }
        if not self.journal.record("SCOUT", row, ts=now_ms, identity="scout:" + uid):
            self.last_error = "JOURNAL_WRITE_FAILED"
            return None
        self.items[uid] = row
        self.last_seen[key] = now_ms
        self._bound()
        return row

    def observe(self, state, candidate_decisions, radar, selected_id=None,
                now_ms: int | None = None) -> list[dict]:
        """Called after the regular strategy evaluation, without affecting it."""
        now_ms = int(now_ms if now_ms is not None else 0)
        price = finite_positive(getattr(state, "last_price", None))
        last_quote = int(getattr(state, "last_market_update_ts", 0) or 0)
        if (
            not price or not getattr(state, "ws_connected", False)
            or getattr(state, "data_health", "") != "HEALTHY"
            or not last_quote or not -1000 <= now_ms-last_quote <= 3000
        ):
            return []
        created = []
        # Rejected detector candidates are an actual gate decision, not an
        # inferred one based on later movement.
        for decision in (candidate_decisions or [])[:16]:
            sid = str(decision.get("id") or "")
            if sid and sid == selected_id:
                continue
            signal = decision.get("signal") or {}
            source = "UNSELECTED_QUALIFIED" if decision.get("allow") else "REJECTED_CANDIDATE"
            row = self._admit(
                now_ms=now_ms, price=price,
                direction=str(decision.get("direction") or ""),
                setup=str(decision.get("setup") or ""),
                source=source,
                reason=str(decision.get("reason") or "Not selected by existing strategy"),
                signal_id=sid,
            )
            if row:
                created.append(row)
        # Radar is contextual: it has no executable entry/SL/TP; never infer
        # that a developing radar opportunity was a valid missed order.
        for lead in (radar or [])[:2]:
            tier = str(lead.get("tier") or "").upper()
            if tier not in {"DEVELOPING", "CONFIRMED"}:
                continue
            row = self._admit(
                now_ms=now_ms, price=price,
                direction=str(lead.get("direction") or ""),
                setup=str(lead.get("setup") or ""),
                source="RADAR_WATCH", tier=tier,
                reason="Context-only radar; no executable entry confirmed",
            )
            if row:
                created.append(row)
        return created

    def resolve_due(self, now_ms: int) -> list[dict]:
        now_ms = int(now_ms)
        if now_ms - self.last_resolution_ms < 30_000:
            return []
        self.last_resolution_ms = now_ms
        resolved = []
        for uid, original in list(self.items.items()):
            if original.get("status") != "OPEN":
                continue
            horizon = int(original.get("opened_ts") or 0) + HORIZON_MS
            if now_ms < horizon + GRACE_MS:
                continue
            try:
                observations = self.journal.prices(int(original["opened_ts"]), horizon+GRACE_MS)
                outcome = price_path_outcome(original, observations)
                updated = dict(original, **outcome, resolved_ts=now_ms)
                if self.journal.record("SCOUT", updated, ts=now_ms, identity="scout:"+uid):
                    self.items[uid] = updated
                    resolved.append(updated)
                else:
                    self.last_error = "JOURNAL_WRITE_FAILED"
            except Exception as exc:
                self.last_error = type(exc).__name__
            if len(resolved) >= 4:
                break
        return resolved

    def summary(self) -> dict:
        rows = list(self.items.values())
        counts = Counter(row.get("status") for row in rows)
        return {
            "mode": "ADVISORY_ONLY",
            "tracked": len(rows),
            "status_counts": dict(counts),
            "pending": counts.get("OPEN", 0),
            "last_error": self.last_error or None,
            "latest": [
                {k: v for k, v in row.items() if k not in {"dedupe_key"}}
                for row in sorted(rows, key=lambda r:r.get("opened_ts",0), reverse=True)[:10]
            ],
            "meaning": "A favorable market move does not establish executable profit or a missed trade.",
            "execution_capable": False,
        }
