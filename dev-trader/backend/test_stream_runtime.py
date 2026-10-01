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
