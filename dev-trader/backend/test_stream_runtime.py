from app.stream import BybitStream, asyncio


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
