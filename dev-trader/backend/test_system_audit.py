"""Offline system audit regressions; no credentials or exchange submissions."""
import asyncio
import json
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.ledger import build_fill_ledger
from app.models import MarketState
from app.stream import BitgetMarketStream
from test_execution import audit_executor, audit_signal
from test_ledger import fill


@pytest.mark.parametrize('connected,firebase', [(True, False), (False, False), (True, True), (False, True)])
def test_healthy_opportunity_reaches_in_app_radar_without_developing_fcm(monkeypatch, connected, firebase):
    from app import main
    sent = []
    fake_engine = SimpleNamespace(
        evaluate=lambda _: None, shadow_candidates=[], active_signal=None,
        opportunity_radar_state=[dict(tier='CONFIRMED', direction='LONG', setup='SFP', score=8, max_score=8)],
        last_diagnostics={}, last_lifecycle_events=[],
        journal=SimpleNamespace(tick=lambda *args: None),
    )
    monkeypatch.setattr(main, 'engine', fake_engine)
    monkeypatch.setattr(main, 'shadow', SimpleNamespace(tick=lambda *args: None))
    monkeypatch.setattr(main, 'execution', SimpleNamespace(snapshot=lambda: {}, data={}))
    monkeypatch.setattr(main, 'push', SimpleNamespace(ready=firebase, send_opportunity=sent.append))
    monkeypatch.setattr(main, 'clients', {object()} if connected else set())
    monkeypatch.setattr(main, 'last_engine_eval_ms', 0)
    monkeypatch.setattr(main, 'last_opportunity_alert', dict(key='', ts=0))
    monkeypatch.setattr(main, 'last_trade_event', {})
    healthy = MarketState()
    healthy.data_health = 'HEALTHY'
    monkeypatch.setattr(main, 'state', healthy)
    asyncio.run(main.on_state(main.state))
    assert main.current_alerts()['opportunity_alert']['key'] == 'radar:LONG:CONFIRMED:SFP'
    # Developing / watch alerts are in-app only; never priority FCM.
    assert sent == []


@pytest.mark.parametrize('fee', [None, 'NaN', 'Infinity', 'broken'])
def test_unknown_fee_cannot_claim_complete_accounting(fee):
    ledger = build_fill_ledger([fill('x', 1000, 'buy', 'open', .001, fee=fee)], [], 'BTCUSDT', 0, 2000, True)
    assert not ledger['fee_accounting_complete']


@pytest.mark.parametrize('pnl', [None, 'NaN', 'Infinity', 'broken'])
def test_unknown_pnl_cannot_claim_complete_window(pnl):
    ledger = build_fill_ledger([fill('x', 1000, 'sell', 'close', .001, pnl=pnl)], [], 'BTCUSDT', 0, 2000, True)
    assert not ledger['complete_window']


def feed():
    async def consume(_):
        pass
    return BitgetMarketStream('BTCUSDT', consume)


def test_delayed_and_duplicate_depth_cannot_refresh_freshness():
    stream = feed()
    now = int(time.time()*1000)
    stream.state = MarketState(ws_connected=True, last_market_update_ts=now,
        last_trade_ts=now, last_kline_15_ts=now)
    stream.last_data_source = 'BITGET_WS'
    def book(ts, seq):
        return json.dumps(dict(arg=dict(topic='books5'), ts=ts, action='snapshot',
                              data=[dict(seq=seq, b=[['100', '2']], a=[['101', '1']])]))
    asyncio.run(stream.handle(book(now-20000, 10)))
    assert stream.state.data_health != 'HEALTHY'
    asyncio.run(stream.handle(book(now, 10)))
    assert stream.state.last_book_ts == now-20000
    asyncio.run(stream.handle(book(now, 11)))
    assert stream.state.data_health == 'HEALTHY'


def test_delayed_ticker_keeps_its_exchange_age():
    stream = feed()
    now = int(time.time()*1000)
    stream.state = MarketState(ws_connected=True, last_trade_ts=now,
        last_kline_15_ts=now, last_book_ts=now)
    stream.last_data_source = 'BITGET_WS'
    stream._apply_ticker({'lastPrice': '100'}, now-20000)
    stream._refresh_data_health(now)
    assert stream.state.last_market_update_ts == now-20000
    assert stream.state.data_health != 'HEALTHY'


@pytest.mark.parametrize('field', ['last_market_update_ts', 'last_trade_ts', 'last_book_ts', 'last_kline_15_ts'])
def test_future_feed_timestamp_cannot_be_healthy(field):
    stream = feed()
    now = int(time.time()*1000)
    stream.state = MarketState(ws_connected=True, last_market_update_ts=now,
        last_trade_ts=now, last_book_ts=now, last_kline_15_ts=now)
    stream.last_data_source = 'BITGET_WS'
    setattr(stream.state, field, now+10000)
    stream._refresh_data_health(now)
    assert stream.state.data_health != 'HEALTHY'


@pytest.mark.parametrize('packet', [[], 1, None, {'arg': 'invalid'},
    {'arg': {'topic': 'ticker'}, 'ts': 'bad'},
    {'arg': {'topic': 'publicTrade'}, 'data': 'bad'},
    {'arg': {'topic': 'books5'}, 'data': [{'seq': 'bad'}]},
    {'arg': {'topic': 'liquidation'}, 'data': [None, {'side': 'buy', 'amount': 'NaN'}, {'side': 'buy', 'amount': 'bad'}]}])
def test_malformed_packet_does_not_interrupt_feed(packet):
    stream = feed()
    asyncio.run(stream.handle(json.dumps(packet)))
    assert not stream.state.liquidation_window
    assert stream.state.last_book_ts is None


def test_rest_backfill_rejects_bad_geometry_and_keeps_valid_rows(monkeypatch):
    stream = feed()
    start = int(time.time()*1000)//900000*900000-900000
    async def response(*_):
        return [[start, '100', '101', '99', '100', '10'],
                [start-900000, '100', '101', '99', 'NaN', '10'],
                [start+1, '100', '101', '99', '100', '10'], ['bad']]
    monkeypatch.setattr('app.stream.asyncio.to_thread', response)
    asyncio.run(stream._backfill_interval('15m', 'candles_15', 240))
    assert [c.start for c in stream.state.candles_15] == [start]
    assert stream.state.last_kline_15_ts is None


def test_feed_loss_during_leverage_verification_blocks_submission(monkeypatch, tmp_path):
    executor = audit_executor(monkeypatch, tmp_path)
    ready = [True]
    submitted = []
    executor.entry_guard = lambda _: (ready[0], '' if ready[0] else 'feed expired during leverage')
    executor.client.set_leverage = lambda *args: ready.__setitem__(0, False)
    executor.client.place_market_order = lambda *args: submitted.append(args)
    result = asyncio.run(executor.handle_signal(audit_signal()))
    assert result['skipped'] and 'leverage' in result['reason']
    assert not submitted and not executor.data['trades'] and not executor.data.get('pending_submission')


@pytest.mark.parametrize('query', ['entry=nan&stop=99', 'entry=100&stop=inf',
    'entry=100&stop=100', 'entry=-100&stop=99', 'entry=100&stop=99&target=98',
    'entry=100&stop=99&risk_pct=-1', 'entry=100&stop=99&account_balance=nan'])
def test_invalid_risk_input_returns_validation_error(query, monkeypatch):
    from app.main import app
    secret = 'example-risk-test-only-' + 'x' * 40
    monkeypatch.setenv('KYVORIQ_API_OWNER_TOKEN', secret)
    assert TestClient(app).get('/risk?'+query, headers={'Authorization': 'Bearer ' + secret}).status_code == 422


def test_valid_short_risk_geometry_retains_risk_cap(monkeypatch):
    from app.main import app
    secret = 'example-risk-test-only-' + 'x' * 40
    monkeypatch.setenv('KYVORIQ_API_OWNER_TOKEN', secret)
    result = TestClient(app).get('/risk?entry=100&stop=102&target=94&account_balance=5000&risk_pct=2', headers={'Authorization': 'Bearer ' + secret}).json()
    assert result['ready'] and result['risk_capped'] and result['rr'] == 3
    assert result['risk_amount'] == 50
