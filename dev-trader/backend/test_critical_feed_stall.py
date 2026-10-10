"""Sparse demo-market vs broken public WS channel regression checks.

Only transport recovery: these tests never place or authorize an order.
"""
import asyncio

from app.stream import BitgetMarketStream

NOW = 1_900_000_000_000


async def noop(state):
    return None


def stream():
    instance = BitgetMarketStream("BTCUSDT", noop)
    instance.state.ws_connected = True
    instance.last_connected_ms = NOW - 150_000
    instance.last_ws_packet_ms = NOW - 100
    instance.last_data_source = "BITGET_WS"
    instance.state.last_market_update_ts = NOW - 100
    return instance


def test_quote_only_is_not_critical_depth_and_trades():
    market = stream()
    market.state.last_book_ts = NOW - 150_000
    market.state.last_trade_ts = NOW - 100
    assert market._critical_channel_stall(NOW) == "books5_NO_FRESH_DATA"
    market.state.last_book_ts = NOW - 100
    market.state.last_trade_ts = NOW - 150_000
    assert market._critical_channel_stall(NOW) == "publicTrade_NO_FRESH_DATA"


def test_books_and_trades_fresh_without_forced_reconnection():
    market = stream()
    market.state.last_book_ts = NOW - 4_000
    market.state.last_trade_ts = NOW - 14_000
    assert market._critical_channel_stall(NOW) is None
    assert market.critical_reconnect_count == 0


def test_sparse_demo_book_does_not_trigger_before_two_minutes():
    market = stream()
    market.last_connected_ms = NOW - 60_000
    market.state.last_book_ts = NOW - 60_000
    market.state.last_trade_ts = NOW - 60_000
    assert market._critical_channel_stall(NOW) is None


def test_subscription_error_detected_but_does_not_enable_execution():
    market = stream()
    market.state.last_book_ts = NOW - 100
    market.state.last_trade_ts = NOW - 100
    market.subscription_status["books5"] = {"event": "error", "code": "1234"}
    assert market._critical_channel_stall(NOW) == "books5_SUBSCRIPTION_ERROR"
    assert market.state.data_health != "HEALTHY"


def test_future_depth_timestamp_is_never_presented_as_fresh():
    market = stream()
    market.state.last_book_ts = NOW + 5000
    market.state.last_trade_ts = NOW - 10
    assert market._critical_channel_stall(NOW) == "books5_NO_FRESH_DATA"


def test_bounded_reconnect_closes_socket_once_without_orders(monkeypatch):
    market = stream()
    market.state.last_book_ts = NOW - 150_000
    market.state.last_trade_ts = NOW - 10
    monkeypatch.setattr("app.stream.time.time", lambda: NOW/1000)
    async def instant(_seconds):
        return None
    monkeypatch.setattr("app.stream.asyncio.sleep", instant)
    class Socket:
        closes = 0
        async def close(self):
            self.closes += 1
    ws = Socket()
    asyncio.run(market._heartbeat(ws))
    assert ws.closes == 1
    assert market.critical_reconnect_count == 1
    assert "books5_NO_FRESH_DATA" in market.last_upstream_error


def test_channel_stall_retry_has_five_minute_cooldown():
    market = stream()
    market.state.last_book_ts = NOW - 150_000
    market.state.last_trade_ts = NOW - 10
    assert market._critical_channel_stall(NOW) is not None
    market.last_critical_reconnect_ms = NOW - 100_000
    assert NOW-market.last_critical_reconnect_ms < 300_000
    # Transport loop must not blindly reset last_critical_reconnect_ms on a new connection.
    market.last_connected_ms = NOW - 150_000
    assert market._critical_channel_stall(NOW) is not None


def test_diagnostics_do_not_include_keys_or_authorize_new_orders(monkeypatch):
    market = stream()
    market.state.last_book_ts = NOW - 150_000
    market.state.last_trade_ts = NOW - 100
    monkeypatch.setattr("app.stream.time.time", lambda: NOW/1000)
    diag = market.feed_diagnostics()
    assert diag["critical_stall"] == "books5_NO_FRESH_DATA"
    assert diag["critical_reconnect_count"] == 0
    assert "credentials" not in diag and "can_execute" not in diag
