"""Phase 7/10/15: unresolved exchange quantity cannot fabricate realized PnL."""
import pytest

from app.execution import DemoExecutionEngine
from test_execution import FakeLearning, FakeClient


@pytest.fixture
def executor(monkeypatch, tmp_path):
    monkeypatch.setenv("BITGET_DEMO_TRADING", "true")
    monkeypatch.setenv("BITGET_EXECUTION_STATE_FILE", str(tmp_path / "fills.json"))
    learning = FakeLearning()
    model = DemoExecutionEngine(learning)
    model.client = FakeClient()
    return model, learning


def pending_trade(qty, confirmed=True):
    return {
        "execution_id": "DTDEMO-TEST-REALIZED", "client_oid": "DTDEMO-TEST-REALIZED",
        "signal_id": "original-long", "direction": "LONG", "status": "OPEN",
        "filled_qty": qty, "requested_qty": .01,
        "actual_fill_confirmed": confirmed, "opened_ts": 1000,
        "entry_price": 100000, "stop_loss": 99000, "take_profit": 104000,
        "planned_risk_usdt": 10.0,
        "signal_snapshot": {"id": "original-long", "direction": "LONG",
                            "setup": "SFP", "entry": 100000},
    }


def exchange_closed(aggregate_qty=".01", net="5"):
    return {"symbol": "BTCUSDT", "holdSide": "long",
            "closeTotalPos": aggregate_qty, "netProfit": net,
            "pnl": net, "openAvgPrice": "100000", "closeAvgPrice": "101000",
            "ctime": 1000, "utime": 3000, "positionId": "closed-1"}


@pytest.mark.parametrize("qty,aggregate,confirmed", [
    (0.0, ".01", True),
    (.005, "", True),
    (.012, ".01", True),
    (.005, ".01", False),
])
def test_incomplete_or_excess_fill_cannot_create_realized_pnl_or_learning(
    executor, qty, aggregate, confirmed
):
    model, learning = executor
    trade = pending_trade(qty, confirmed)
    event = model._finalize_trade(trade, exchange_closed(aggregate), [])
    assert event is None
    assert trade["status"] == "RECONCILIATION_PENDING"
    assert trade["learning_review"] is None
    assert "unverified" in trade["reconciliation_warning"]
    assert not learning.resolved
    assert "net_profit_usdt" not in trade
    assert not model.data.get("last_event")


def test_only_confirmed_partial_fill_earns_its_proportion_of_realized_pnl(executor):
    model, learning = executor
    trade = pending_trade(.005, confirmed=True)
    event = model._finalize_trade(trade, exchange_closed(aggregate_qty=".01", net="8"), [])
    assert event is not None
    assert trade["status"] == "CLOSED"
    assert trade["net_profit_usdt"] == 4.0
    assert len(learning.resolved) == 1
    assert event["net_profit_usdt"] == 4.0
