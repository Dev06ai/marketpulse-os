"""Phase 3/4/6/13/14: degraded Bitget input must not generate entry alerts."""
import asyncio
import time
from types import SimpleNamespace

import pytest

from app import main
from app.models import MarketState


@pytest.mark.parametrize("health", ["DEGRADED", "STALE", "CONNECTING", "RECONNECTING"])
def test_stale_depth_or_trade_feed_suppresses_opportunity_and_retires_phantom_signal(
    monkeypatch, health
):
    now = int(time.time() * 1000)
    sent, submitted, retired = [], [], []
    monkeypatch.setattr(main, "evaluation_due", lambda *args: (True, ("5m", 1)))
    monkeypatch.setattr(main, "last_smc_observed_ms", now)
    monkeypatch.setattr(main, "compute_features",
                        lambda _: SimpleNamespace(structure_map={}))
    monkeypatch.setattr(main, "record_eval", lambda _: None)
    monkeypatch.setattr(main, "record_eval_duration", lambda _: None)
    monkeypatch.setattr(main.shadow, "tick", lambda *args: None)
    monkeypatch.setattr(main.scout, "observe", lambda *args, **kwargs: None)
    monkeypatch.setattr(main.scout, "resolve_due", lambda *args: None)
    monkeypatch.setattr(main.engine, "shadow_candidates", [])
    monkeypatch.setattr(main.engine, "opportunity_radar_state", [
        {"direction": "SHORT", "tier": "DEVELOPING", "setup": "SFP",
         "score": 8, "max_score": 10, "reasons": ["near a level"]},
    ])
    monkeypatch.setattr(main.engine, "last_diagnostics", {})
    monkeypatch.setattr(main.engine, "last_lifecycle_events", [])
    signal = SimpleNamespace(id="phantom-setup", to_dict=lambda: {"id": "phantom-setup"})
    monkeypatch.setattr(main.engine, "evaluate", lambda _: signal)
    monkeypatch.setattr(main.engine, "retire_unexecuted_signal",
                        lambda *args: retired.append(args))
    monkeypatch.setattr(main.execution, "snapshot", lambda: {"last_event": {}})
    monkeypatch.setattr(main, "dispatch_signal", lambda payload: submitted.append(payload))
    monkeypatch.setattr(main, "queue_push", lambda sender, payload: sent.append(payload))
    monkeypatch.setattr(main.push, "ready", True)
    monkeypatch.setattr(main, "clients", set())
    monkeypatch.setattr(main, "last_opportunity_alert",
                        {"key":"radar:OLD:DEVELOPING:SFP","ts":now-5000,
                         "title":"Old developing trade","body":"old signal"})

    s = MarketState()
    s.data_health = health
    s.ws_connected = True
    s.last_market_update_ts = None
    asyncio.run(main.on_state(s))
    assert not submitted
    assert not sent
    assert len(retired) == 1
    assert retired[0][0] == "phantom-setup"
    assert main.last_opportunity_alert["key"] == ""
    assert main.current_alerts()["opportunity_alert"]["key"] == ""


def test_healthy_market_retains_radar_alert_and_signal_path(monkeypatch):
    now = int(time.time() * 1000)
    sent, submitted = [], []
    monkeypatch.setattr(main, "evaluation_due", lambda *args: (True, ("5m", 2)))
    monkeypatch.setattr(main, "last_smc_observed_ms", now)
    monkeypatch.setattr(main, "compute_features",
                        lambda _: SimpleNamespace(structure_map={}))
    monkeypatch.setattr(main, "record_eval", lambda _: None)
    monkeypatch.setattr(main, "record_eval_duration", lambda _: None)
    monkeypatch.setattr(main.shadow, "tick", lambda *args: None)
    monkeypatch.setattr(main.scout, "observe", lambda *args, **kwargs: None)
    monkeypatch.setattr(main.scout, "resolve_due", lambda *args: None)
    monkeypatch.setattr(main.engine, "shadow_candidates", [])
    monkeypatch.setattr(main.engine, "opportunity_radar_state", [
        {"direction":"LONG","tier":"DEVELOPING","setup":"Reclaim",
         "score":9,"max_score":10,"reasons":["confirmed level"]},
    ])
    monkeypatch.setattr(main.engine, "last_diagnostics", {})
    monkeypatch.setattr(main.engine, "last_lifecycle_events", [])
    signal = SimpleNamespace(id="approved-setup", to_dict=lambda: {"id":"approved-setup"})
    monkeypatch.setattr(main.engine, "evaluate", lambda _: signal)
    monkeypatch.setattr(main.execution, "snapshot", lambda: {"last_event": {}})
    monkeypatch.setattr(main, "dispatch_signal", lambda payload: submitted.append(payload))
    monkeypatch.setattr(main, "queue_push", lambda sender, payload: sent.append(payload))
    monkeypatch.setattr(main.push, "ready", True)
    monkeypatch.setattr(main, "clients", set())
    monkeypatch.setattr(main, "last_opportunity_alert",
                        {"key":"","ts":0,"title":"","body":""})
    s=MarketState()
    s.data_health="HEALTHY"
    s.last_market_update_ts=None
    asyncio.run(main.on_state(s))
    assert len(submitted)==1
    assert len(sent)==1
    assert sent[0]["key"].startswith("radar:LONG")
