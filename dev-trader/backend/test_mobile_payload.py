import asyncio
from types import SimpleNamespace


def test_bootstrap_preserves_authoritative_feed_source(monkeypatch):
    from app import main
    monkeypatch.setattr(main, 'stream', SimpleNamespace(last_data_source='BITGET_WS',
        last_rest_ok=True, last_upstream_error='', last_rest_sync_ms=1234))
    payload = asyncio.run(main.bootstrap())
    assert payload['upstream']['source'] == 'BITGET_WS'
    assert payload['upstream']['last_rest_sync_ts'] == 1234


def test_chart_overlay_payload_uses_reaction_aware_semantic_levels():
    from app import main
    f = SimpleNamespace(
        previous_day_high=105.0,
        previous_day_low=95.0,
        weekly_open=100.5,
        order_blocks={
            '15m': {'direction': 'BULLISH', 'mid': 101.25},
            '1h': {'direction': 'BEARISH', 'mid': 106.0},
        },
        volume_context={'exact_npoc': True, 'untouched_poc': 99.75},
    )
    diag = {
        'level_reactions': {
            'levels': [
                {'kind': 'DAILY', 'label': 'D HIGH', 'price': 105.0, 'state': 'WATCH'},
                {'kind': 'DAILY', 'label': 'D LOW', 'price': 95.0, 'state': 'ARMED'},
                {'kind': 'WEEKLY_OPEN', 'label': 'W OPEN', 'price': 100.5, 'state': 'WATCH'},
                {'kind': 'NPOC', 'label': 'NPOC', 'price': 99.75, 'state': 'WATCH'},
                {'kind': 'OB', 'label': '15M OB', 'price': 101.25, 'state': 'WATCH'},
                {'kind': 'OB', 'label': '1H OB', 'price': 106.0, 'state': 'WATCH'},
                {'kind': 'SFP', 'label': 'SFP', 'price': 103.0, 'state': 'ARMED'},
            ]
        },
        'setups': {'D-Line': {'projected_line': 98.5, 'status': 'WAITING', 'direction': 'LONG'}},
    }
    rows = main.chart_overlay_payload(f, diag)
    kinds = {row['kind'] for row in rows}
    labels = {row['label'] for row in rows}
    assert {'SFP', 'DLINE', 'OB', 'NPOC', 'DAILY', 'WEEKLY_OPEN'}.issubset(kinds)
    assert {'D HIGH', 'D LOW', 'W OPEN', '15M OB', '1H OB'}.issubset(labels)
    assert '15M H' not in labels and '15M L' not in labels
    assert len(rows) <= 24


def test_chart_overlay_payload_does_not_claim_npoc_without_exact_profile():
    from app import main
    f = SimpleNamespace(
        previous_day_high=None,
        previous_day_low=None,
        weekly_open=None,
        order_blocks={},
        volume_context={'exact_npoc': False, 'untouched_poc': 99.75},
    )
    rows = main.chart_overlay_payload(f, {'sfp_hunter': {}, 'setups': {}, 'liquidity_map': {}})
    assert all(row['kind'] != 'NPOC' for row in rows)
