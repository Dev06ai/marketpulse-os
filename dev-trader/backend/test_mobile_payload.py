import asyncio
from types import SimpleNamespace


def test_bootstrap_preserves_authoritative_feed_source(monkeypatch):
    from app import main
    monkeypatch.setattr(main, 'stream', SimpleNamespace(last_data_source='BITGET_WS',
        last_rest_ok=True, last_upstream_error='', last_rest_sync_ms=1234))
    payload = asyncio.run(main.bootstrap())
    assert payload['upstream']['source'] == 'BITGET_WS'
    assert payload['upstream']['last_rest_sync_ts'] == 1234


def test_chart_overlay_payload_exposes_only_auditable_levels():
    from app import main
    f = SimpleNamespace(
        order_block_mid=101.25,
        order_block_direction='BULLISH',
        volume_context={'exact_npoc': True, 'untouched_poc': 99.75},
    )
    diag = {
        'sfp_hunter': {'target_level': 103.0, 'status': 'NEAR_TRIGGER', 'direction': 'SHORT'},
        'setups': {'D-Line': {'projected_line': 98.5, 'status': 'WAITING', 'direction': 'LONG'}},
        'liquidity_map': {
            'above': [{'title': 'previous day high', 'price': 105.0}],
            'below': [{'title': 'previous day low', 'price': 95.0}],
        },
    }
    rows = main.chart_overlay_payload(f, diag)
    kinds = {row['kind'] for row in rows}
    assert {'SFP', 'DLINE', 'OB', 'NPOC'}.issubset(kinds)
    assert len(rows) <= 6


def test_chart_overlay_payload_does_not_claim_npoc_without_exact_profile():
    from app import main
    f = SimpleNamespace(
        order_block_mid=None,
        order_block_direction='NONE',
        volume_context={'exact_npoc': False, 'untouched_poc': 99.75},
    )
    rows = main.chart_overlay_payload(f, {'sfp_hunter': {}, 'setups': {}, 'liquidity_map': {}})
    assert all(row['kind'] != 'NPOC' for row in rows)
