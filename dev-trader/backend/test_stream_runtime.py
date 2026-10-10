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


def test_bitget_demo_execution_uses_real_public_ws_market_data_by_default(monkeypatch):
    monkeypatch.setenv("BITGET_DEMO_TRADING", "true")
    monkeypatch.delenv("BITGET_PUBLIC_WS_URL", raising=False)
    async def on_state(_state):
        return None
    stream = BitgetMarketStream("BTCUSDT", on_state)
    assert stream.url == "wss://ws.bitget.com/v3/ws/public"
    assert stream.public_market_venue == "LIVE_PUBLIC_MARKET_DATA"
    assert stream.volume_profile.venue == "BITGET_LIVE_PUBLIC_USDT_FUTURES"
    assert stream.product_type == "USDT-FUTURES"
    assert stream.feed_diagnostics()["public_market_venue"] == "LIVE_PUBLIC_MARKET_DATA"


def test_bitget_demo_endpoint_remains_explicit_reversible_override(monkeypatch):
    monkeypatch.setenv("BITGET_DEMO_TRADING", "true")
    monkeypatch.setenv("BITGET_PUBLIC_WS_URL", "wss://wspap.bitget.com/v3/ws/public")
    stream = BitgetMarketStream("BTCUSDT", lambda _: None)
    assert stream.public_market_venue == "DEMO_PUBLIC_MARKET_DATA"
    assert stream.volume_profile.venue == "BITGET_DEMO_PUBLIC_USDT_FUTURES"


def test_untrusted_bitget_public_market_ws_is_rejected(monkeypatch):
    import pytest
    monkeypatch.setenv("BITGET_PUBLIC_WS_URL", "wss://attacker.invalid/v3/ws/public")
    with pytest.raises(ValueError, match="Untrusted Bitget public market"):
        BitgetMarketStream("BTCUSDT", lambda _: None)


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

    assert stream.state.last_price == 100101.0
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

    now_ms = int(__import__("time").time() * 1000)
    liq = {
        "arg": {"topic": "liquidation", "instType": "usdt-futures"},
        "action": "update",
        "data": [
            {"symbol": "BTCUSDT", "side": "buy", "amount": "4", "ts": str(now_ms - 1000)},
            {"symbol": "BTCUSDT", "side": "sell", "amount": "3", "ts": str(now_ms - 500)},
        ],
        "ts": now_ms,
    }
    _asyncio.run(stream.handle(__import__("json").dumps(liq)))

    assert stream.state.orderbook_seq == 99
    assert stream.state.book_bid_qty == 7.0
    assert stream.state.book_ask_qty == 4.0
    assert stream.state.book_imbalance == 3.0 / 11.0
    assert stream.state.liquidation_long_5m == 4.0
    assert stream.state.liquidation_short_5m == 3.0


def test_bitget_rest_fallback_cannot_report_healthy():
    import time as _time
    import asyncio as _asyncio

    async def on_state(_state):
        return None

    stream = BitgetMarketStream("BTCUSDT", on_state)
    now = int(_time.time() * 1000)
    stream.state.ws_connected = True
    stream.state.last_market_update_ts = now - 100
    stream.state.last_trade_ts = now - 100
    stream.state.last_kline_15_ts = now - 100
    stream.state.last_book_ts = now - 100
    stream.last_rest_ok = True
    stream.last_data_source = "BITGET_REST"

    stream._refresh_data_health(now)
    assert stream.state.data_health == "DEGRADED"

    ticker = {
        "arg": {"topic": "ticker", "instType": "usdt-futures", "symbol": "BTCUSDT"},
        "data": [{"lastPrice": "100100", "bid1Price": "100099", "ask1Price": "100101"}],
        "ts": now,
    }
    _asyncio.run(stream.handle(__import__("json").dumps(ticker)))
    # Ticker alone restores the live source, but trade/kline freshness is still
    # checked independently before the strategy can declare the feed healthy.
    stream.state.last_trade_ts = now
    stream.state.last_kline_15_ts = now
    stream._refresh_data_health(int(_time.time() * 1000))
    assert stream.last_data_source == "BITGET_WS"
    assert stream.state.data_health == "HEALTHY"


def test_bitget_rest_candle_backfill_does_not_mark_live_kline_fresh(monkeypatch):
    import asyncio as _asyncio

    async def on_state(_state):
        return None

    stream = BitgetMarketStream("BTCUSDT", on_state)

    async def fake_to_thread(fn, *args, **kwargs):
        return [["1769999400000", "100000", "100100", "99900", "100050", "12.5"]]

    import app.stream as stream_module
    monkeypatch.setattr(stream_module.asyncio, "to_thread", fake_to_thread)

    _asyncio.run(stream._backfill_interval("15m", "candles_15", 1))

    assert stream.state.candles_15
    assert stream.state.last_kline_15_ts is None


def test_liquidation_message_cannot_restore_healthy_after_rest_fallback():
    import asyncio as _asyncio
    import time as _time

    async def on_state(_state):
        return None

    stream = BitgetMarketStream("BTCUSDT", on_state)
    now = int(_time.time() * 1000)
    stream.state.ws_connected = True
    stream.state.last_market_update_ts = now - 100
    stream.state.last_trade_ts = now - 100
    stream.state.last_kline_15_ts = now - 100
    stream.last_rest_ok = True
    stream.last_data_source = "BITGET_REST"
    stream._refresh_data_health(now)
    assert stream.state.data_health == "DEGRADED"

    liq = {
        "arg": {"topic": "liquidation", "instType": "usdt-futures"},
        "action": "update",
        "data": [{"symbol": "BTCUSDT", "side": "buy", "amount": "1", "ts": str(now)}],
        "ts": now,
    }
    _asyncio.run(stream.handle(__import__("json").dumps(liq)))

    assert stream.last_data_source == "BITGET_REST"
    assert stream.state.data_health == "DEGRADED"
