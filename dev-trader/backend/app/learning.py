import json
import os
import threading
import time
from pathlib import Path
from typing import Any


class AdaptiveLearning:
    """Small, bounded adaptive learner for Dev Trader setup outcomes.

    It never auto-trades. It only learns which setup/context combinations have
    worked or failed and feeds bounded advisory adjustments back into analysis.
    """

    def __init__(self):
        self.path = Path(os.getenv("LEARNING_STATE_FILE", "/tmp/dev_trader_learning.json"))
        self.lock = threading.RLock()
        self.data: dict[str, Any] = {
            "version": 1,
            "trades": [],
            "profiles": {},
            "conditions": {},
            "lessons": [],
        }
        self._load()

    def _load(self):
        try:
            if self.path.exists():
                parsed = json.loads(self.path.read_text())
                if isinstance(parsed, dict):
                    self.data.update(parsed)
        except Exception:
            pass

    def _save(self):
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, separators=(",", ":"), ensure_ascii=False))
            tmp.replace(self.path)
        except Exception:
            pass

    @staticmethod
    def _key(signal: dict[str, Any]) -> str:
        return "|".join([
            str(signal.get("setup", "UNKNOWN")).upper(),
            str(signal.get("direction", "UNKNOWN")).upper(),
            str(signal.get("timeframe", "UNKNOWN")).upper(),
            str(signal.get("regime") or signal.get("evidence", {}).get("regime") or "UNKNOWN").upper(),
        ])

    @staticmethod
    def _tags(signal: dict[str, Any]) -> list[str]:
        evidence = signal.get("evidence") or {}
        tags = []
        for name, value in (
            ("trend_15", evidence.get("trend_15")),
            ("trend_60", evidence.get("trend_60")),
            ("trend_240", evidence.get("trend_240")),
            ("market_structure", evidence.get("market_structure")),
            ("cvd", evidence.get("cvd_price_divergence")),
            ("fvg", evidence.get("fvg_direction")),
            ("order_block", evidence.get("order_block_direction")),
            ("golden_pocket", evidence.get("golden_pocket")),
        ):
            if value not in (None, "", "NONE"):
                tags.append(f"{name}:{str(value).upper()}")
        if evidence.get("memory_match"):
            tags.append("setup_memory:matched")
        rr = signal.get("rr")
        try:
            if float(rr) >= 3:
                tags.append("rr:elite")
            elif float(rr) >= 2:
                tags.append("rr:strong")
        except (TypeError, ValueError):
            pass
        return tags[:20]

    def recent_trades(self) -> list[dict[str, Any]]:
        """Return a bounded copy of persisted trade records for engine rehydration."""
        with self.lock:
            return [dict(row) for row in self.data.get("trades", [])[:250]]

    def context(self, signal: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            key = self._key(signal)
            profile = self.data["profiles"].get(key, {})
            total = int(profile.get("trades", 0))
            wins = int(profile.get("wins", 0))
            losses = int(profile.get("losses", 0))
            win_rate = wins / total if total else None
            delta = 0.0
            if total >= 3 and win_rate is not None:
                if win_rate >= 0.70:
                    delta = 0.06
                elif win_rate >= 0.60:
                    delta = 0.035
                elif win_rate <= 0.30:
                    delta = -0.06
                elif win_rate <= 0.40:
                    delta = -0.035

            favorable = []
            caution = []
            for tag in self._tags(signal):
                s = self.data["conditions"].get(tag, {})
                n = int(s.get("trades", 0))
                w = int(s.get("wins", 0))
                if n < 3:
                    continue
                wr = w / n if n else 0
                row = {"tag": tag, "samples": n, "win_rate": round(wr, 3)}
                if wr >= 0.65:
                    favorable.append(row)
                elif wr <= 0.35:
                    caution.append(row)

            return {
                "profile_key": key,
                "samples": total,
                "wins": wins,
                "losses": losses,
                "win_rate": round(win_rate, 3) if win_rate is not None else None,
                "confidence_delta": delta,
                "favorable_conditions": sorted(favorable, key=lambda x: (-x["win_rate"], -x["samples"]))[:3],
                "caution_conditions": sorted(caution, key=lambda x: (x["win_rate"], -x["samples"]))[:3],
            }

    def record_open(self, signal: dict[str, Any]):
        with self.lock:
            sid = str(signal.get("id", ""))
            if not sid:
                return
            existing = next((t for t in self.data["trades"] if t.get("id") == sid), None)
            if existing:
                return
            self.data["trades"].insert(0, {
                "id": sid,
                "setup": signal.get("setup"),
                "direction": signal.get("direction"),
                "timeframe": signal.get("timeframe"),
                "entry": signal.get("entry"),
                "stop": signal.get("stop"),
                "target1": signal.get("target1"),
                "target2": signal.get("target2"),
                "rr": signal.get("rr"),
                "opened_ts": int(time.time() * 1000),
                "tags": self._tags(signal),
                "events": [],
                "status": "ACTIVE",
            })
            self.data["trades"] = self.data["trades"][:250]
            self._save()

    def record_event(self, signal: dict[str, Any], event_type: str, price: float, note: str = ""):
        with self.lock:
            sid = str(signal.get("id", ""))
            trade = next((t for t in self.data["trades"] if t.get("id") == sid), None)
            if not trade:
                self.record_open(signal)
                trade = next((t for t in self.data["trades"] if t.get("id") == sid), None)
            if not trade:
                return
            key = f"{event_type}:{sid}"
            if any(e.get("key") == key for e in trade.get("events", [])):
                return
            trade.setdefault("events", []).append({
                "key": key,
                "type": event_type,
                "price": price,
                "ts": int(time.time() * 1000),
                "note": note,
            })
            if event_type == "TP1_HIT":
                trade["tp1_hit"] = True
            elif event_type == "TP2_HIT":
                trade["status"] = "WIN"
                trade["result_r"] = float(signal.get("rr") or 0)
            elif event_type == "SL_HIT":
                trade["status"] = "SL_AFTER_TP1" if trade.get("tp1_hit") else "LOSS"
                trade["result_r"] = 0.0 if trade.get("tp1_hit") else -1.0

            self._save()

    def resolve(self, signal: dict[str, Any], outcome: str, result_r: float) -> dict[str, Any]:
        with self.lock:
            sid = str(signal.get("id", ""))
            trade = next((t for t in self.data["trades"] if t.get("id") == sid), None)
            if not trade:
                self.record_open(signal)
                trade = next((t for t in self.data["trades"] if t.get("id") == sid), None)
            if not trade:
                return {"what_worked": [], "do_next_time": [], "avoid_next_time": []}

            win = outcome in {"TP2_REACHED", "TARGET_REACHED"} and result_r > 0
            trade["status"] = "WIN" if win else outcome
            trade["result_r"] = float(result_r)
            trade["resolved_ts"] = int(time.time() * 1000)

            key = self._key(signal)
            profile = self.data["profiles"].setdefault(key, {"trades": 0, "wins": 0, "losses": 0, "total_r": 0.0, "tp1_hits": 0})
            profile["trades"] += 1
            profile["total_r"] += float(result_r)
            if win:
                profile["wins"] += 1
            else:
                profile["losses"] += 1
            if trade.get("tp1_hit"):
                profile["tp1_hits"] += 1

            for tag in self._tags(signal):
                s = self.data["conditions"].setdefault(tag, {"trades": 0, "wins": 0, "losses": 0, "total_r": 0.0})
                s["trades"] += 1
                s["total_r"] += float(result_r)
                if win:
                    s["wins"] += 1
                else:
                    s["losses"] += 1

            ctx = self.context(signal)
            worked = [x["tag"] for x in ctx["favorable_conditions"]]
            avoid = [x["tag"] for x in ctx["caution_conditions"]]
            do_next = []
            avoid_next = list(avoid)
            if win:
                do_next.append("Repeat the same setup/context only when its structural trigger is present.")
                if trade.get("tp1_hit"):
                    do_next.append("Preserve the staged TP1 → TP2 management path; TP1 confirmation preceded the final target.")
            else:
                do_next.append("Require an independent confirmation before trusting this setup/context again.")
                if trade.get("tp1_hit"):
                    do_next.append("After TP1, protect the remaining position more aggressively because the trade later reversed.")
                else:
                    do_next.append("Do not treat a near-trigger or weak continuation as equivalent to a confirmed setup.")

            lesson = {
                "ts": int(time.time() * 1000),
                "signal_id": sid,
                "setup": signal.get("setup"),
                "direction": signal.get("direction"),
                "outcome": outcome,
                "result_r": round(float(result_r), 3),
                "what_worked": worked[:3],
                "do_next_time": do_next[:3],
                "avoid_next_time": avoid_next[:3],
            }
            self.data["lessons"].insert(0, lesson)
            self.data["lessons"] = self.data["lessons"][:100]
            self._save()
            return lesson

    def rehydrate(self, rows: list[dict[str, Any]] | None):
        """Merge durable resolved predictions without generating duplicate lessons."""
        with self.lock:
            for row in reversed(list(rows or [])):
                sid = str(row.get("fingerprint") or row.get("id") or "")
                outcome = str(row.get("outcome") or "").upper()
                if not sid or outcome not in {"WIN", "LOSS"}:
                    continue
                if any(t.get("id") == sid for t in self.data["trades"]):
                    continue

                features = row.get("features") or {}
                evidence = features.get("evidence") if isinstance(features, dict) else {}
                if not isinstance(evidence, dict):
                    evidence = {}
                signal = {
                    "id": sid,
                    "setup": row.get("type") or features.get("type") or "DEV TRADER SIGNAL",
                    "direction": row.get("side") or features.get("side") or "WAIT",
                    "timeframe": row.get("interval") or "15m",
                    "entry": row.get("price"),
                    "stop": row.get("stop"),
                    "target2": row.get("target"),
                    "rr": row.get("resultR") if outcome == "WIN" else 1.0,
                    "regime": row.get("regime") or features.get("regime") or "UNKNOWN",
                    "evidence": {
                        "trend_15": evidence.get("trend_15"),
                        "trend_60": evidence.get("trend_60"),
                        "trend_240": evidence.get("trend_240"),
                        "market_structure": evidence.get("market_structure") or features.get("structure"),
                        "cvd_price_divergence": evidence.get("cvd_price_divergence"),
                        "fvg_direction": evidence.get("fvg_direction"),
                        "order_block_direction": evidence.get("order_block_direction"),
                        "golden_pocket": evidence.get("golden_pocket"),
                    },
                }
                tags = self._tags(signal)
                self.data["trades"].append({
                    "id": sid,
                    "setup": signal["setup"],
                    "direction": signal["direction"],
                    "timeframe": signal["timeframe"],
                    "entry": signal["entry"],
                    "stop": signal["stop"],
                    "target2": signal["target2"],
                    "rr": signal["rr"],
                    "opened_ts": row.get("candleTs") or row.get("createdAt") or int(time.time() * 1000),
                    "tags": tags,
                    "events": [],
                    "status": "WIN" if outcome == "WIN" else "LOSS",
                    "result_r": float(row.get("resultR") or (1.0 if outcome == "WIN" else -1.0)),
                    "resolved_ts": row.get("resolvedAt") or int(time.time() * 1000),
                    "rehydrated": True,
                })
                key = self._key(signal)
                profile = self.data["profiles"].setdefault(key, {"trades": 0, "wins": 0, "losses": 0, "total_r": 0.0, "tp1_hits": 0})
                profile["trades"] += 1
                result_r = float(row.get("resultR") or (1.0 if outcome == "WIN" else -1.0))
                profile["total_r"] += result_r
                if outcome == "WIN":
                    profile["wins"] += 1
                else:
                    profile["losses"] += 1
                for tag in tags:
                    cs = self.data["conditions"].setdefault(tag, {"trades": 0, "wins": 0, "losses": 0, "total_r": 0.0})
                    cs["trades"] += 1
                    cs["total_r"] += result_r
                    if outcome == "WIN":
                        cs["wins"] += 1
                    else:
                        cs["losses"] += 1

            self.data["trades"] = self.data["trades"][-250:]
            self._save()

    def summary(self) -> dict[str, Any]:
        with self.lock:
            total = sum(int(v.get("trades", 0)) for v in self.data["profiles"].values())
            wins = sum(int(v.get("wins", 0)) for v in self.data["profiles"].values())
            losses = sum(int(v.get("losses", 0)) for v in self.data["profiles"].values())
            return {
                "trades_learned": total,
                "wins": wins,
                "losses": losses,
                "win_rate": round(wins / total, 3) if total else None,
                "profiles": len(self.data["profiles"]),
                "conditions": len(self.data["conditions"]),
                "latest_lesson": self.data["lessons"][0] if self.data["lessons"] else None,
                "storage": str(self.path),
            }
