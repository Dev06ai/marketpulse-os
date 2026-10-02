from app.stream import BitgetMarketStream, BybitStream, asyncio



def test_stream_module_has_asyncio_runtime():
    # The stream uses asyncio.wait_for, gather, sleep and create_task at runtime.
    # Keep this import-level regression test so the live feed cannot silently
    # reconnect forever because of a missing module global.
    assert asyncio is not None


def test_stream_can_construct_without_network():
    stream = BybitStream(
        "wss://invalid.example.invalid/ws",
        "BTCUSDT",
        lambda state: None,
    )
    assert stream.symbol == "BTCUSDT"
    assert stream.last_data_source == "NONE"


def test_stream_marks_rest_only_feed_as_degraded():
    stream = BybitStream(
        "wss://invalid.example.invalid/ws",
        "BTCUSDT",
        lambda state: None,
    )
    now = 1_000_000
    stream.last_data_source = "BYBIT_REST"
    stream.last_rest_ok = True
    stream.state.ws_connected = False
    stream.state.last_market_update_ts = now - 100
    stream.state.received_ts = now - 100
    stream._refresh_data_health(now)
    assert stream.state.data_health == "DEGRADED"


def test_bitget_stream_uses_demo_public_endpoint(monkeypatch):
    monkeypatch.setenv("BITGET_DEMO_TRADING", "true")
    async def on_state(_state):
        return None
    stream = BitgetMarketStream("BTCUSDT", on_state)
    assert stream.url == "wss://wspap.bitget.com/v3/ws/public"
    assert stream.product_type == "USDT-FUTURES"


def test_bitget_ticker_and_public_trade_are_authoritative():
    events = []

    async def on_state(state):
        events.append(state)

    stream = BitgetMarketStream("BTCUSDT", on_state)
    ticker = {
        "arg": {"topic": "ticker", "instType": "usdt-futures", "symbol": "BTCUSDT"},
        "data": [{
            "lastPrice": "100100",
            "markPrice": "100090",
            "indexPrice": "100080",
            "openInterest": "12345",
            "fundingRate": "0.0001",
            "bid1Price": "100099",
            "ask1Price": "100101",
        }],
        "ts": 1770000000000,
    }
    import asyncio as _asyncio
    _asyncio.run(stream.handle(__import__("json").dumps(ticker)))

    trade = {
        "arg": {"topic": "publicTrade", "instType": "usdt-futures", "symbol": "BTCUSDT"},
        "data": [
            {"i": "1", "p": "100100", "S": "buy", "T": "1770000000100", "v": "0.2"},
            {"i": "2", "p": "100101", "S": "sell", "T": "1770000000200", "v": "0.05"},
        ],
        "ts": 1770000000200,
    }
    _asyncio.run(stream.handle(__import__("json").dumps(trade)))

    assert stream.state.last_price == 100100.0
    assert stream.state.open_interest == 12345.0
    assert stream.state.bid == 100099.0
    assert stream.state.ask == 100101.0
    assert abs(stream.state.cvd - 0.15) < 1e-9
    assert stream.state.last_trade_ts == 1770000000200
    assert events


def test_bitget_books5_and_liquidation_direction_mapping():
    import asyncio as _asyncio
    async def on_state(_state):
        return None
    stream = BitgetMarketStream("BTCUSDT", on_state)

    books = {
        "arg": {"topic": "books5", "instType": "usdt-futures", "symbol": "BTCUSDT"},
        "action": "snapshot",
        "data": [{
            "seq": 99,
            "b": [["100.0", "5"], ["99.9", "2"]],
            "a": [["100.1", "3"], ["100.2", "1"]],
        }],
        "ts": 1770000000000,
    }
    _asyncio.run(stream.handle(__import__("json").dumps(books)))

    liq = {
        "arg": {"topic": "liquidation", "instType": "usdt-futures"},
        "action": "update",
        "data": [
            {"symbol": "BTCUSDT", "side": "buy", "amount": "4", "ts": "1770000000100"},
            {"symbol": "BTCUSDT", "side": "sell", "amount": "3", "ts": "1770000000200"},
        ],
        "ts": 1770000000200,
    }
    _asyncio.run(stream.handle(__import__("json").dumps(liq)))

    assert stream.state.orderbook_seq == 99
    assert stream.state.book_bid_qty == 7.0
    assert stream.state.book_ask_qty == 4.0
    assert stream.state.book_imbalance == 3.0 / 11.0
    assert stream.state.liquidation_long_5m == 4.0
    assert stream.state.liquidation_short_5m == 3.0
