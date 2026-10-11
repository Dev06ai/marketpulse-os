"""Real exchange generation time, not delivery time, governs depth freshness."""
import asyncio
import json

import pytest

from app.stream import BitgetMarketStream


NOW=1791599400000


@pytest.fixture
def feed(monkeypatch):
    monkeypatch.setattr("app.stream.time.time", lambda:NOW/1000)
    async def consume(state):
        pass
    stream=BitgetMarketStream("BTCUSDT", consume)
    stream.state.ws_connected=True
    stream.last_data_source="BITGET_WS"
    stream.state.last_market_update_ts=NOW
    stream.state.last_trade_ts=NOW
    stream.state.last_kline_15_ts=NOW
    return stream


def packet(seq=10, generated=NOW, pushed=NOW):
    row={"seq":seq,"b":[["100","2"]],"a":[["101","3"]]}
    if generated is not None:
        row["ts"]=str(generated)
    message={"arg":{"topic":"books5"},"action":"snapshot","data":[row]}
    if pushed is not None:
        message["ts"]=pushed
    return json.dumps(message)


def test_delayed_book_cannot_use_newer_push_timestamp_as_freshness(feed):
    asyncio.run(feed.handle(packet(generated=NOW-20000)))
    assert feed.state.last_book_ts==NOW-20000
    assert feed.state.data_health=="DEGRADED"


@pytest.mark.parametrize("generated", [None, "NaN", 0, -1, NOW+5000])
def test_unverifiable_book_timestamp_cannot_authorize_depth(feed,generated):
    asyncio.run(feed.handle(packet(generated=generated,pushed=None)))
    assert feed.state.last_book_ts is None
    assert not feed.bids and not feed.asks
    assert feed.state.data_health!="HEALTHY"


def test_legacy_packet_timestamp_remains_supported_without_row_timestamp(feed):
    asyncio.run(feed.handle(packet(generated=None)))
    assert feed.state.last_book_ts==NOW
    assert feed.state.data_health=="HEALTHY"


def test_duplicate_sequence_does_not_refresh_with_newer_delivery(feed):
    asyncio.run(feed.handle(packet(generated=NOW-20000,pushed=NOW-20000)))
    asyncio.run(feed.handle(packet(generated=NOW)))
    assert feed.state.last_book_ts==NOW-20000
    assert feed.state.data_health=="DEGRADED"


def test_regressing_generation_timestamp_does_not_replace_newer_depth(feed):
    asyncio.run(feed.handle(packet(generated=NOW-1000)))
    asyncio.run(feed.handle(packet(seq=11,generated=NOW-20000)))
    assert feed.state.last_book_ts==NOW-1000
    assert feed.state.orderbook_seq==10
