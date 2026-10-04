"""Mobile delivery profiles. Exchange ingestion and execution never use these limits."""
from __future__ import annotations

import json
from dataclasses import dataclass


def compact_signal(signal):
    if not signal:
        return None
    result = dict(signal)
    evidence = signal.get("evidence") or {}
    result["evidence"] = {k: evidence[k] for k in
        ("position_management", "style_reason", "risk_distance") if k in evidence}
    return result


def alert_payload(signal, opportunity, trade_event, server_ts):
    return dict(type="state", profile="alerts", server_ts=server_ts,
                signal=compact_signal(signal), opportunity_alert=dict(opportunity),
                trade_event=dict(trade_event or {}))


def event_key(payload):
    """Urgent changes bypass periodic dashboard delivery; quotes do not spam alerts."""
    signal = payload.get("signal") or {}
    fields = ("id", "direction", "entry", "stop", "target1", "target2", "lifecycle",
              "lifecycle_stage", "execution_status", "execution_reason")
    return json.dumps([
        {k: signal.get(k) for k in fields},
        (payload.get("opportunity_alert") or {}).get("key"),
        (payload.get("trade_event") or {}).get("key"),
    ], sort_keys=True, separators=(",", ":"))


def dashboard_payload(payload):
    """Keep the displayed account, fills and position truth; omit research archives."""
    result = dict(payload, profile="dashboard")
    result["signal"] = compact_signal(payload.get("signal"))
    result["engine"] = {k: v for k, v in payload.get("engine", {}).items() if k not in {
        "structure_map", "candidate_decisions", "evidence_matrix", "setups", "setup_watch",
    }}
    result["features"] = {k: v for k, v in payload.get("features", {}).items()
                          if k != "volume_context"}
    result.pop("evaluation", None)
    result.pop("learning_context", None)
    execution = dict(payload.get("execution") or {})
    execution["recent_trades"] = [
        {k: v for k, v in row.items() if k not in {"signal_snapshot", "learning_review", "raw"}}
        for row in execution.get("recent_trades", [])
    ]
    result["execution"] = execution
    return result


@dataclass
class Subscription:
    profile: str = "legacy"
    last_state_at: float = float("-inf")
    last_event: str | None = None

    def next_kind(self, now, key, dashboard_seconds=5.0):
        if self.profile == "legacy":
            return "legacy"
        if key != self.last_event:
            return self.profile
        if self.profile == "alerts":
            return None  # Keepalive acknowledgements maintain the quiet socket.
        if now - self.last_state_at >= dashboard_seconds:
            return "dashboard"
        return "market_tick"

    def delivered(self, kind, now, key):
        if kind != "market_tick":
            self.last_state_at = now
            self.last_event = key
