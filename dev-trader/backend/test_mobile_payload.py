import asyncio
from types import SimpleNamespace


def test_bootstrap_preserves_authoritative_feed_source(monkeypatch):
    from app import main
    monkeypatch.setattr(main, 'stream', SimpleNamespace(last_data_source='BITGET_WS',
        last_rest_ok=True, last_upstream_error='', last_rest_sync_ms=1234))
    payload = asyncio.run(main.bootstrap())
    assert payload['upstream']['source'] == 'BITGET_WS'
    assert payload['upstream']['last_rest_sync_ts'] == 1234
