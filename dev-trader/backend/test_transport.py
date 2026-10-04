import asyncio
import copy
import json
import time
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.transport import Subscription, alert_payload, dashboard_payload, event_key


def test_quiet_alerts_send_changes_and_retry_failed_delivery():
    sub = Subscription("alerts")
    alert = alert_payload({"id": "s1", "stop": 100}, {"key": "a1"}, {"key": "t1"}, 1)
    key = event_key(alert)
    assert sub.next_kind(1, key) == "alerts"
    # A failed send must not mark the event delivered.
    assert sub.next_kind(2, key) == "alerts"
    sub.delivered("alerts", 2, key)
    alert["server_ts"] = 999
    assert sub.next_kind(3, event_key(alert)) is None
    alert["signal"]["stop"] = 101
    assert sub.next_kind(3, event_key(alert)) == "alerts"
    alert["signal"] = None
    assert sub.next_kind(3, event_key(alert)) == "alerts"


def test_dashboard_ticks_do_not_delay_urgent_trade_events():
    sub = Subscription("dashboard")
    sub.delivered("dashboard", 10, "old")
    assert sub.next_kind(11, "old") == "market_tick"
    sub.delivered("market_tick", 11, "old")
    assert sub.next_kind(15, "old") == "dashboard"
    assert sub.next_kind(11, "new") == "dashboard"
    assert Subscription().next_kind(11, "old") == "legacy"


def test_compaction_preserves_account_and_position_truth_without_mutation():
    full = {
        "type": "state", "received_ts": 10, "ws_connected": False,
        "signal": {"id": "s1", "stop": 90, "evidence": {
            "position_management": {"action": "protect"}, "risk_distance": 10,
            "structure_map": "large report"}},
        "engine": {"structure_map": "large report", "trade_governor": {"paused": True}},
        "features": {"trend_15": "DOWN", "volume_context": "large report"},
        "execution": {"account": {"equity_usdt": 100}, "summary": {"unknown_submissions": 1},
            "performance": {"ledger": {"complete_window": False, "curve": [{"net_usdt": -5}]}},
            "recent_trades": [{"signal_id": "s1", "status": "OPEN", "entry_price": 99,
                               "signal_snapshot": {"evidence": "large report"}}]},
        "evaluation": "research", "learning_context": "research",
    }
    original = copy.deepcopy(full)
    compact = dashboard_payload(full)
    assert full == original
    assert compact["execution"]["account"] == full["execution"]["account"]
    assert compact["execution"]["performance"] == full["execution"]["performance"]
    assert compact["execution"]["summary"]["unknown_submissions"] == 1
    assert compact["execution"]["recent_trades"][0]["status"] == "OPEN"
    assert compact["signal"]["evidence"]["position_management"]["action"] == "protect"
    assert "signal_snapshot" not in compact["execution"]["recent_trades"][0]
    assert "structure_map" not in compact["engine"]
    assert compact["received_ts"] == 10 and compact["ws_connected"] is False


def test_profiles_bootstrap_and_keepalive_use_real_asgi_routes(monkeypatch):
    from app import main
    monkeypatch.setattr(main, "stream", None)
    client = TestClient(main.app)  # No lifespan: never contact the exchange in tests.
    with client.websocket_connect("/ws?profile=alerts") as ws:
        first = ws.receive_json()
        assert first["profile"] == "alerts"
        assert "execution" not in first and "engine" not in first
        ws.send_json({"type": "keepalive"})
        assert ws.receive_json()["type"] == "ack"
    with client.websocket_connect("/ws?profile=dashboard") as ws:
        assert ws.receive_json()["profile"] == "dashboard"
    with client.websocket_connect("/ws?profile=unknown") as ws:
        assert "structure_map" in ws.receive_json()["engine"]
    response = client.get("/bootstrap?profile=dashboard", headers={"Accept-Encoding": "gzip"})
    assert response.status_code == 200
    assert response.headers["content-encoding"] == "gzip"
    assert "chart" in response.json() and "structure_map" not in response.json()["engine"]
    assert not main.clients and not main.subscriptions


def test_tick_keeps_exchange_age_when_server_is_alive(monkeypatch):
    from app import main
    monkeypatch.setattr(main.state, "received_ts", 1)
    monkeypatch.setattr(main.state, "last_market_update_ts", 2)
    monkeypatch.setattr(main.state, "data_health", "DEGRADED")
    tick = main.market_tick()
    assert tick["received_ts"] == 1 and tick["last_market_update_ts"] == 2
    assert tick["server_ts"] > 2 and tick["data_health"] == "DEGRADED"


def test_broadcast_delivers_event_to_quiet_background_and_dashboard(monkeypatch):
    from app import main

    class Socket:
        def __init__(self):
            self.frames = []

        async def send_text(self, text):
            self.frames.append(json.loads(text))

    async def run():
        dashboard, background = Socket(), Socket()
        monkeypatch.setattr(main, "clients", {dashboard, background})
        monkeypatch.setattr(main, "subscriptions", {
            dashboard: Subscription("dashboard"), background: Subscription("alerts")})
        monkeypatch.setattr(main, "client_failures", {})
        monkeypatch.setattr(main, "SNAPSHOT", .5)
        monkeypatch.setattr(main, "reconcile_execution_truth", lambda: None)
        monkeypatch.setattr(main, "last_trade_event", {"key": "initial"})
        task = asyncio.create_task(main.broadcast_loop())
        try:
            async def until(predicate):
                while not predicate():
                    await asyncio.sleep(.01)
            await asyncio.wait_for(until(lambda: len(dashboard.frames) >= 2), 3)
            assert dashboard.frames[-1]["type"] == "market_tick"
            assert len(background.frames) == 1
            monkeypatch.setattr(main, "last_trade_event", {"key": "close", "type": "EXECUTION_CLOSED"})
            await asyncio.wait_for(until(lambda: len(background.frames) == 2), 2)
            assert background.frames[-1]["trade_event"]["key"] == "close"
            assert dashboard.frames[-1]["type"] == "state"
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    asyncio.run(run())


def test_free_journal_enforces_byte_budget_and_retention(monkeypatch, tmp_path):
    from app.journal import DecisionJournal
    import random
    monkeypatch.setenv("DECISION_JOURNAL_RETENTION_DAYS", "1")
    monkeypatch.setenv("DECISION_JOURNAL_MAX_RECORDS", "3")
    monkeypatch.setenv("DECISION_JOURNAL_MAX_BLOB_MB", "1")
    journal = DecisionJournal(tmp_path / "journal.sqlite3")
    rng = random.Random(42)
    # Poorly compressible data catches real byte growth, unlike repeated strings.
    payload = {"data": rng.randbytes(700_000).hex()}
    now = int(time.time()*1000)
    assert journal.record("DECISION", payload, now, "old")
    assert journal.record("DECISION", payload, now + 1, "new")
    assert journal.status()["records"] == 1
    assert journal.records()[0]["id"] == "new"
    journal.tick(now, 100)
    journal.tick(now + 2 * 86_400_000, 110)
    assert journal.prices(0, now + 1) == []
    assert journal.status()["records"] == 0
    journal.db.close()
    assert (tmp_path / "journal.sqlite3").stat().st_size < 1_100_000
