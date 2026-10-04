import asyncio
import time

import pytest

from app.bitget import BitgetDemoClient, BitgetDemoError
from app.demo_reset import reset_demo_session


class ResetClient:
    demo = True
    configured = True
    numeric = staticmethod(BitgetDemoClient.numeric)
    extract_order_id = staticmethod(BitgetDemoClient.extract_order_id)

    def __init__(self):
        self.exposure = [{"holdSide": "long", "total": "0.010"}, {"holdSide": "short", "total": "0.004"}]
        self.exits = [{"orderId": "protect", "stopLoss": "84000"}]
        self.regular = [{"orderId": "entry"}]
        self.calls = []

    def positions(self, symbol):
        return list(self.exposure)

    def pending_orders(self, symbol):
        return list(self.regular)

    def strategy_orders(self, symbol):
        return list(self.exits)

    def cancel_order(self, oid):
        self.calls.append(("cancel_entry", oid))
        self.regular = []

    def place_market_close(self, symbol, direction, qty, oid):
        self.calls.append(("close", direction, qty, oid))
        self.exposure = [r for r in self.exposure if r["holdSide"].upper() != direction]
        return {"data": {"orderId": direction}}

    def cancel_strategy_order(self, oid):
        assert not self.exposure, "Protective exits must remain until flat"
        self.calls.append(("cancel_exit", oid))
        self.exits = []


def test_reset_closes_exact_exchange_quantities_before_removing_stops():
    c = ResetClient()
    r = asyncio.run(reset_demo_session(c, "BTCUSDT", int(time.time()*1000)))
    assert r["status"] == "VERIFIED_FLAT"
    assert [(x[1],x[2]) for x in c.calls if x[0] == "close"] == [("LONG","0.01"),("SHORT","0.004")]
    assert c.calls[0][0] == "cancel_entry"
    assert c.calls[-1][0] == "cancel_exit"
    assert all(len(x[3]) <= 32 for x in c.calls if x[0] == "close")


def test_reset_recovers_timed_out_close_without_resubmitting():
    c = ResetClient()
    close = c.place_market_close
    def ambiguous(*args):
        close(*args)
        raise TimeoutError("Response lost after exchange fill")
    c.place_market_close = ambiguous
    r = asyncio.run(reset_demo_session(c, "BTCUSDT", int(time.time()*1000)))
    assert r["status"] == "VERIFIED_FLAT"
    assert len([x for x in c.calls if x[0] == "close"]) == 2


@pytest.mark.parametrize("mode", ["live", "expired", "future", "symbol"])
def test_reset_rejects_unsafe_or_expired_requests(mode):
    c = ResetClient()
    ts = int(time.time()*1000)
    symbol = "BTCUSDT"
    if mode == "live": c.demo = False
    if mode == "expired": ts -= 21*60_000
    if mode == "future": ts += 60_000
    if mode == "symbol": symbol = "ETHUSDT"
    with pytest.raises(BitgetDemoError): asyncio.run(reset_demo_session(c, symbol, ts))
    assert c.calls == []


def test_reset_does_not_report_success_with_orphan_exit():
    c = ResetClient()
    c.cancel_strategy_order = lambda oid: None
    with pytest.raises(BitgetDemoError, match="remaining exposure/orders"):
        asyncio.run(reset_demo_session(c, "BTCUSDT", int(time.time()*1000)))
