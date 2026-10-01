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
