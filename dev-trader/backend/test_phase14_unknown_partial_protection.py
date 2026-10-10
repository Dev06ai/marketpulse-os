"""Original Phase 7/11/14: unknown-size partial demo positions fail closed.

Simulated Bitget responses only; does not place real or demo exchange orders.
"""
import asyncio
import time

from app.execution import DemoExecutionEngine
from test_execution import FakeClient, FakeLearning


def pending_trade():
    return {
        "execution_id": "DTDEMO-UNKNOWN-PARTIAL", "client_oid": "DTDEMO-UNKNOWN-PARTIAL",
        "signal_id": "SFP-UNKNOWN", "symbol": "BTCUSDT", "direction": "LONG",
        "status": "ORDER_PENDING", "opened_ts": int(time.time() * 1000)-30_000,
        "entry_plan": 100000, "entry_price": 0, "stop_loss": 99000,
        "take_profit": 103000, "requested_qty": 0.1, "filled_qty": 0,
        "actual_fill_confirmed": False,
    }


class UnknownPartialClient(FakeClient):
    def __init__(self, protected):
        self.protected = protected
        self.close_calls = []

    def positions(self, symbol):
        return [{"holdSide": "long", "total": "0.05",
                 "openPriceAvg": "100000", "posId": "partial-1"}]

    def strategy_orders(self, symbol):
        return super().strategy_orders(symbol) if self.protected else []

    def place_market_close(self, *args):
        self.close_calls.append(args)
        raise AssertionError("unknown fill quantity must never trigger blind market close")


def executor(monkeypatch, tmp_path, *, protected):
    monkeypatch.setenv("BITGET_DEMO_TRADING", "true")
    monkeypatch.setenv("BITGET_EXECUTION_STATE_FILE", str(tmp_path / "phase14.json"))
    model = DemoExecutionEngine(FakeLearning())
    model.client = UnknownPartialClient(protected)
    model.data["trades"] = [pending_trade()]
    async def no_poll(_execution_id):
        return None
    model._poll_fill = no_poll
    return model


def test_uncovered_unknown_partial_halts_new_risk_and_never_blind_closes(monkeypatch, tmp_path):
    model = executor(monkeypatch, tmp_path, protected=False)
    asyncio.run(model.sync())
    trade = model.data["trades"][0]
    assert trade["status"] == "ORDER_PENDING"
    assert trade["partial_position_detected"] is True
    assert trade["actual_fill_confirmed"] is False
    assert model.data["protection_halt"]
    assert "fill quantity" in model.data["protection_halt"]
    assert model.data["client_status"]["history_reconciliation"] == "DEGRADED"
    assert model.client.close_calls == []
    allowed, reason = model._signal_allowed({
        "id": "ANOTHER", "direction": "LONG", "grade": "A",
        "confidence": .9, "rr": 3.0,
    })
    assert not allowed
    assert "protection" in reason.lower()


def test_protected_partial_does_not_claim_full_fill(monkeypatch, tmp_path):
    model = executor(monkeypatch, tmp_path, protected=True)
    asyncio.run(model.sync())
    trade = model.data["trades"][0]
    assert trade["status"] == "ORDER_PENDING"
    assert trade.get("actual_fill_confirmed") is False
    assert trade.get("partial_position_detected") is True
    assert not model.data.get("protection_halt")
    assert model.client.close_calls == []
