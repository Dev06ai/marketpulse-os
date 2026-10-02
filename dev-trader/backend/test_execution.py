import asyncio
import os

from app.execution import DemoExecutionEngine


class FakeLearning:
    def __init__(self):
        self.events = []
        self.resolved = []

    def record_event(self, signal, event_type, price, note=""):
        self.events.append((event_type, price, note))

    def resolve(self, signal, outcome, result_r):
        self.resolved.append((signal.get("id"), outcome, result_r))
        return {"outcome": outcome, "result_r": result_r}

    def context(self, signal):
        return {}


class FakeClient:
    demo = True
    api_key = "demo"
    api_secret = "demo"
    passphrase = "demo"
    product_type = "USDT-FUTURES"
    margin_coin = "USDT"

    @property
    def configured(self):
        return True

    def positions(self, symbol):
        return []

    def available_balance(self, symbol):
        return 1000.0

    def market_ticker(self, symbol):
        return {"lastPrice": "100000"}

    def contract_config(self, symbol):
        return {
            "sizeMultiplier": "0.001",
            "volumePlace": 3,
            "minTradeNum": "0.001",
            "minTradeUSDT": "5",
            "priceEndStep": "0.1",
            "pricePlace": "1",
        }

    def place_market_order(self, *args):
        return {"code": "00000", "data": {"orderId": "123", "clientOid": args[-1]}}

    def extract_order_id(self, result):
        return str(result["data"]["orderId"])

    def order_detail(self, symbol, order_id):
        return {
            "orderStatus": "filled",
            "baseVolume": "0.1",
            "priceAvg": "100000",
        }


def test_demo_executor_sizes_from_stop_distance_and_opens_once(monkeypatch):
    monkeypatch.setenv("BITGET_DEMO_TRADING", "true")
    monkeypatch.setenv("BITGET_EXECUTION_STATE_FILE", "/tmp/dev-trader-test-execution.json")
    try:
        os.remove("/tmp/dev-trader-test-execution.json")
    except FileNotFoundError:
        pass

    learner = FakeLearning()
    executor = DemoExecutionEngine(learner)
    executor.client = FakeClient()

    signal = {
        "id": "SIG-1",
        "direction": "LONG",
        "setup": "TEST",
        "entry": 100000,
        "stop": 99900,
        "target1": 100300,
        "target2": 100300,
        "rr": 3.0,
        "confidence": 0.80,
        "grade": "A",
        "trade_style": "SCALP",
        "evidence": {},
    }

    result = asyncio.run(executor.handle_signal(signal))
    assert result["ok"] is True
    trade = executor.history(1)[0]
    assert trade["status"] == "OPEN"
    assert trade["filled_qty"] == 0.1
    assert trade["entry_price"] == 100000
    assert trade["direction"] == "LONG"
    assert learner.events[-1][0] == "EXECUTION_OPEN"

    duplicate = asyncio.run(executor.handle_signal(signal))
    assert duplicate["ok"] is False
    assert duplicate["skipped"] is True


def test_close_reason_and_r_math():
    reason = DemoExecutionEngine._infer_close_reason(
        {
            "direction": "LONG",
            "take_profit": 103000,
            "stop_loss": 99000,
            "symbol": "BTCUSDT",
        },
        {"closeAvgPrice": "103005", "utime": "1730000000000"},
        [],
    )
    assert reason == "TP"

    reason = DemoExecutionEngine._infer_close_reason(
        {
            "direction": "SHORT",
            "take_profit": 97000,
            "stop_loss": 101000,
            "symbol": "BTCUSDT",
        },
        {"closeAvgPrice": "100995", "utime": "1730000000000"},
        [],
    )
    assert reason == "SL"


def test_demo_execution_rejects_zero_futures_balance(monkeypatch):
    monkeypatch.setenv("BITGET_DEMO_TRADING", "true")
    monkeypatch.setenv("BITGET_EXECUTION_STATE_FILE", "/tmp/dev-trader-test-zero-balance.json")
    try:
        os.remove("/tmp/dev-trader-test-zero-balance.json")
    except FileNotFoundError:
        pass

    class ZeroBalanceClient(FakeClient):
        def available_balance(self, symbol):
            return 0.0

    executor = DemoExecutionEngine(FakeLearning())
    executor.client = ZeroBalanceClient()

    signal = {
        "id": "SIG-ZERO",
        "direction": "SHORT",
        "setup": "TEST",
        "entry": 100000,
        "stop": 101000,
        "target1": 97000,
        "target2": 97000,
        "rr": 3.0,
        "confidence": 0.80,
        "grade": "A",
        "trade_style": "SCALP",
        "evidence": {},
    }

    result = asyncio.run(executor.handle_signal(signal))
    assert result["ok"] is False
    assert "balance is 0 USDT" in result["reason"]



def test_price_normalization_uses_bitget_price_step():
    config = {"priceEndStep": "0.1", "pricePlace": "1"}

    assert DemoExecutionEngine._format_price(
        83966.14, config, "LONG", "sl"
    ) == "83966.1"
    assert DemoExecutionEngine._format_price(
        85200.01, config, "LONG", "tp"
    ) == "85200.1"
    assert DemoExecutionEngine._format_price(
        84300.14, config, "SHORT", "sl"
    ) == "84300.2"
    assert DemoExecutionEngine._format_price(
        82400.16, config, "SHORT", "tp"
    ) == "82400.1"


class MultiSignalClient(FakeClient):
    def __init__(self):
        self.close_calls = []

    def positions(self, symbol):
        return []

    def position_history(self, symbol, start_ms, end_ms, limit):
        return []

    def market_ticker(self, symbol):
        return {"lastPrice": "100100"}

    def orders_history(self, symbol, limit, start_ms, end_ms):
        return []

    def status(self, symbol):
        return {
            "ready": True,
            "available_balance_usdt": 1000.0,
            "open_positions": [],
        }

    def place_market_close(self, symbol, direction, size, client_oid):
        self.close_calls.append((symbol, direction, size, client_oid))
        return {"code": "00000", "data": {"orderId": "close-123", "clientOid": client_oid}}


def test_every_new_signal_is_submitted_without_replacing_existing_position(monkeypatch):
    monkeypatch.setenv("BITGET_DEMO_TRADING", "true")
    monkeypatch.setenv("BITGET_EXECUTION_STATE_FILE", "/tmp/dev-trader-test-multi.json")
    monkeypatch.setenv("BITGET_DEMO_MAX_DAILY_TRADES", "3")
    try:
        os.remove("/tmp/dev-trader-test-multi.json")
    except FileNotFoundError:
        pass

    learner = FakeLearning()
    executor = DemoExecutionEngine(learner)
    executor.client = MultiSignalClient()

    base = {
        "setup": "TEST",
        "entry": 100000,
        "stop": 99900,
        "target1": 100300,
        "target2": 100300,
        "rr": 3.0,
        "confidence": 0.80,
        "grade": "A",
        "trade_style": "SCALP",
        "evidence": {},
    }

    first = dict(base, id="SIG-1", direction="LONG")
    second = dict(base, id="SIG-2", direction="LONG", entry=100100, stop=100000)

    assert asyncio.run(executor.handle_signal(first))["ok"] is True
    result = asyncio.run(executor.handle_signal(second))

    assert result["ok"] is True
    assert len(executor.history(5)) >= 2
    assert executor.client.close_calls == []


def test_execution_rejects_large_bitget_price_drift(monkeypatch):
    monkeypatch.setenv("BITGET_DEMO_TRADING", "true")
    monkeypatch.setenv("BITGET_EXECUTION_STATE_FILE", "/tmp/dev-trader-test-drift.json")
    monkeypatch.setenv("BITGET_MAX_ENTRY_DRIFT_PCT", "0.15")
    try:
        os.remove("/tmp/dev-trader-test-drift.json")
    except FileNotFoundError:
        pass

    class DriftClient(FakeClient):
        def market_ticker(self, symbol):
            return {"lastPrice": "100250"}

    executor = DemoExecutionEngine(FakeLearning())
    executor.client = DriftClient()

    signal = {
        "id": "SIG-DRIFT",
        "direction": "LONG",
        "setup": "TEST",
        "entry": 100000,
        "stop": 99500,
        "target1": 101500,
        "target2": 101500,
        "rr": 3.0,
        "confidence": 0.80,
        "grade": "A",
        "trade_style": "SCALP",
        "evidence": {},
    }

    result = asyncio.run(executor.handle_signal(signal))
    assert result["ok"] is False
    assert result["skipped"] is True
    assert "price drift" in result["reason"].lower()


def test_partial_bitget_fill_does_not_become_open(monkeypatch):
    monkeypatch.setenv("BITGET_DEMO_TRADING", "true")
    monkeypatch.setenv("BITGET_EXECUTION_STATE_FILE", "/tmp/dev-trader-test-partial.json")
    try:
        os.remove("/tmp/dev-trader-test-partial.json")
    except FileNotFoundError:
        pass

    class PartialFillClient(FakeClient):
        def __init__(self):
            self.calls = 0

        def order_detail(self, symbol, order_id):
            self.calls += 1
            return {
                "orderStatus": "partially_filled" if self.calls < 3 else "filled",
                "baseVolume": "0.05" if self.calls < 3 else "0.1",
                "priceAvg": "100000",
            }

    learner = FakeLearning()
    executor = DemoExecutionEngine(learner)
    client = PartialFillClient()
    executor.client = client

    signal = {
        "id": "SIG-PARTIAL",
        "direction": "LONG",
        "setup": "TEST",
        "entry": 100000,
        "stop": 99900,
        "target1": 100300,
        "target2": 100300,
        "rr": 3.0,
        "confidence": 0.80,
        "grade": "A",
        "trade_style": "SCALP",
        "evidence": {},
    }

    result = asyncio.run(executor.handle_signal(signal))
    assert result["ok"] is True
    trade = executor.history(1)[0]
    assert trade["status"] == "OPEN"
    assert trade["filled_qty"] == 0.1
    assert trade["actual_fill_confirmed"] is True
    assert client.calls >= 3
    assert [event[0] for event in learner.events].count("EXECUTION_OPEN") == 1


def test_sync_does_not_promote_partial_exchange_position(monkeypatch):
    monkeypatch.setenv("BITGET_DEMO_TRADING", "true")
    monkeypatch.setenv("BITGET_EXECUTION_STATE_FILE", "/tmp/dev-trader-test-sync-partial.json")
    try:
        os.remove("/tmp/dev-trader-test-sync-partial.json")
    except FileNotFoundError:
        pass

    class PartialPositionClient(FakeClient):
        def positions(self, symbol):
            return [{"holdSide": "long", "total": "0.05", "openPriceAvg": "100000", "posId": "p1"}]

        def position_history(self, symbol, start_ms, end_ms, limit):
            return []

        def orders_history(self, symbol, limit, start_ms, end_ms):
            return []

        def status(self, symbol):
            return {"ready": True, "available_balance_usdt": 1000.0}

    executor = DemoExecutionEngine(FakeLearning())
    executor.client = PartialPositionClient()
    trade = {
        "execution_id": "DTDEMO-PARTIAL",
        "client_oid": "DTDEMO-PARTIAL",
        "signal_id": "SIG-PARTIAL-SYNC",
        "symbol": "BTCUSDT",
        "direction": "LONG",
        "setup": "TEST",
        "status": "ORDER_PENDING",
        "opened_ts": 1770000000000,
        "entry_plan": 100000,
        "entry_price": 0.0,
        "stop_loss": 99900,
        "take_profit": 100300,
        "requested_qty": 0.1,
        "filled_qty": 0.05,
        "actual_fill_confirmed": False,
    }
    executor.data["trades"] = [trade]

    async def no_poll(_execution_id):
        return None

    executor._poll_fill = no_poll
    asyncio.run(executor.sync())

    assert trade["status"] == "ORDER_PENDING"
    assert trade.get("partial_position_detected") is True
    assert trade.get("actual_fill_confirmed") is False
