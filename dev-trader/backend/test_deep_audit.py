import asyncio
import json
import time

import pytest

from app.execution import DemoExecutionEngine
from app.models import MarketState
from app.stream import BitgetMarketStream
from test_execution import FakeLearning, audit_executor, audit_signal


def test_price_moves_past_guard_during_sizing_never_submit(monkeypatch, tmp_path):
    executor = audit_executor(monkeypatch, tmp_path)
    prices = iter([100000, 102100, 102100])
    executor.client.market_ticker = lambda _: dict(lastPrice=str(next(prices)))
    result = asyncio.run(executor.handle_signal(audit_signal()))
    assert result['skipped'] and 'drift' in result['reason']
    assert not executor.data['trades']


def test_price_move_after_leverage_verification_never_submits(monkeypatch, tmp_path):
    executor = audit_executor(monkeypatch, tmp_path)
    prices = iter([100000, 100050, 102100])
    executor.client.market_ticker = lambda _: dict(lastPrice=str(next(prices)))
    submitted = []
    executor.client.place_market_order = lambda *args: submitted.append(args) or {"code":"00000","data":{"orderId":"bad"}}
    result = asyncio.run(executor.handle_signal(audit_signal()))
    assert result["skipped"] and "drift" in result["reason"].lower()
    assert submitted == []
    assert executor.data["trades"] == []


def test_updated_quote_keeps_confidence_margin_and_loss_guard_within_caps(monkeypatch, tmp_path):
    executor = audit_executor(monkeypatch, tmp_path)
    prices = iter([100000, 100140, 100140])
    executor.client.market_ticker = lambda _: dict(lastPrice=str(next(prices)))
    result = asyncio.run(executor.handle_signal(audit_signal()))
    assert result['ok']
    trade = result['trade']
    risk = trade['requested_qty'] * (100140 - 99500 + (100140 + 99500) * .0006)
    margin = trade['requested_qty'] * 100140 / executor.leverage
    assert trade['execution_reference_price'] == 100140
    assert trade['leverage'] == 5
    assert trade['confidence_band'] == 'HIGH'
    assert 76 <= margin <= 100
    assert risk <= 1000 * executor.max_planned_loss_pct / 100
    assert trade['requested_qty'] * 100140 <= executor.max_notional
    assert abs(trade['planned_risk_usdt'] - risk) < 1e-8


def test_feed_can_fail_after_initial_gate_and_blocks_order(monkeypatch, tmp_path):
    executor = audit_executor(monkeypatch, tmp_path)
    ready = [True]
    executor.entry_guard = lambda _: (ready[0], '' if ready[0] else 'feed expired')
    size = executor._risk_size
    async def delayed_size(signal):
        result = await size(signal)
        ready[0] = False
        return result
    monkeypatch.setattr(executor, '_risk_size', delayed_size)
    result = asyncio.run(executor.handle_signal(audit_signal()))
    assert result['skipped'] and result['reason'] == 'feed expired'
    assert not executor.data['trades']


def test_post_has_durable_intent_before_exchange_can_accept(monkeypatch, tmp_path):
    executor = audit_executor(monkeypatch, tmp_path)
    def interrupted_post(*args):
        restarted = DemoExecutionEngine(FakeLearning())
        trade = restarted.data['trades'][0]
        assert trade['status'] == 'SUBMISSION_UNKNOWN'
        assert trade['client_oid'] == args[-1]
        assert trade['stop_loss'] == float(args[3])
        assert trade['take_profit'] == float(args[4])
        assert trade['requested_qty'] == float(args[2])
        raise TimeoutError('accepted response lost')
    executor.client.place_market_order = interrupted_post
    result = asyncio.run(executor.handle_signal(audit_signal()))
    assert not result['ok']
    trade = executor.data['trades'][0]
    assert trade['status'] == 'SUBMISSION_UNKNOWN' and trade['stop_loss'] == 99500
    executor._merge_exchange_open_orders([dict(clientOid=trade['client_oid'], orderId='accepted',
        avgPrice='100110', stopLoss='', takeProfit='', qty='', orderStatus='filled')])
    assert trade['entry_plan'] == 100000 and trade['stop_loss'] == 99500
    assert trade['take_profit'] == 103000 and trade['requested_qty'] > 0
    assert len(executor.data['trades']) == 1


def test_failed_intent_storage_never_submits(monkeypatch, tmp_path):
    executor = audit_executor(monkeypatch, tmp_path)
    monkeypatch.setattr(executor, '_save', lambda: False)
    result = asyncio.run(executor.handle_signal(audit_signal()))
    assert result['skipped'] and 'persist' in result['reason']
    assert not executor.data['trades'] and not executor.data.get('pending_submission')


@pytest.mark.parametrize('qty,price', [('0','100000'), ('.001','0')])
def test_recovered_filled_label_requires_actual_quantity_and_price(monkeypatch, tmp_path, qty, price):
    executor = audit_executor(monkeypatch, tmp_path)
    executor._merge_exchange_open_orders([dict(clientOid='DTDEMO-recovered', orderId='known',
        side='buy', orderStatus='filled', cumExecQty=qty, avgPrice=price, createdTime=int(time.time()*1000))])
    trade = executor.data['trades'][0]
    assert trade['status'] == 'ORDER_PENDING' and not trade['actual_fill_confirmed']


def test_position_api_failure_cannot_close_trade_or_verify_empty_stop_coverage(monkeypatch, tmp_path):
    executor = audit_executor(monkeypatch, tmp_path)
    now = int(time.time()*1000)
    trade = dict(execution_id='known', signal_id='AUDIT', client_oid='known', status='OPEN',
        direction='LONG', opened_ts=now-5000, filled_qty=.001, entry_price=100000,
        actual_fill_confirmed=True, signal_snapshot=audit_signal())
    executor.data['trades'] = [trade]
    def outage(*args):
        raise TimeoutError('position API unavailable')
    executor.client.positions = outage
    executor.client.position_history = lambda *args: [dict(symbol='BTCUSDT', holdSide='long',
        ctime=now-10000, utime=now, netProfit='5', closeAvgPrice='102000')]
    asyncio.run(executor.sync())
    assert trade['status'] == 'OPEN' and not executor.learning.resolved
    assert not executor.data['stop_protection']['verified']
    assert executor.data['client_status']['history_reconciliation'] == 'DEGRADED'


@pytest.mark.parametrize('field', ['last_market_update_ts', 'last_trade_ts', 'last_book_ts'])
def test_runtime_entry_feed_guard_detects_expiry(monkeypatch, field):
    from app import main
    now = int(time.time()*1000)
    state = MarketState(ws_connected=True, data_health='HEALTHY', last_market_update_ts=now,
        last_trade_ts=now, last_book_ts=now)
    monkeypatch.setattr(main, 'state', state)
    assert main.verify_entry_feed({})[0]
    setattr(state, field, now-16000)
    assert not main.verify_entry_feed({})[0]


def stream():
    async def consume(_state):
        pass
    return BitgetMarketStream('BTCUSDT', consume)


@pytest.mark.parametrize('bad', [dict(b=[['102','1']],a=[['101','1']]),
    dict(b=[['NaN','1']],a=[['101','1']]), dict(b=[['100','-1']],a=[['101','1']]),
    dict(b=[['100','1']],a=[]), dict(b=[['100']],a=[['101','1']])])
def test_malformed_depth_never_refreshes_book_health(bad):
    feed = stream()
    asyncio.run(feed.handle(json.dumps(dict(arg=dict(topic='books5'),action='snapshot',data=[bad]))))
    assert feed.state.last_book_ts is None
    assert not feed.bids and not feed.asks and feed.state.book_imbalance == 0


def test_reconnect_discards_old_depth_and_requires_new_book():
    feed = stream()
    feed._apply_book(dict(b=[['100','2']],a=[['101','1']]), 'snapshot')
    feed.state.last_book_ts = int(time.time()*1000)
    feed._invalidate_book()
    assert not feed.bids and not feed.asks and feed.state.last_book_ts is None


def test_nan_market_data_does_not_poison_price_or_cvd():
    feed = stream()
    feed._apply_ticker(dict(lastPrice='100000'), int(time.time()*1000))
    previous = feed.state.last_market_update_ts
    feed._apply_ticker(dict(lastPrice='NaN', openInterest='12'), int(time.time()*1000))
    assert feed.state.last_price == 100000 and feed.state.last_market_update_ts == previous
    asyncio.run(feed.handle(json.dumps(dict(arg=dict(topic='publicTrade'), data=[
        dict(i='bad',p='100001',v='NaN',S='buy',T=int(time.time()*1000))]))))
    assert feed.state.cvd == 0 and not feed.state.flow_history


def test_delayed_kline_cannot_become_latest_candle():
    feed = stream()
    start = int(time.time()*1000)//300000*300000
    def message(ts):
        return json.dumps(dict(arg=dict(topic='kline',interval='5m'), data=[dict(
            start=ts,open=100,high=101,low=99,close=100,volume=10)]))
    asyncio.run(feed.handle(message(start)))
    asyncio.run(feed.handle(message(start-300000)))
    assert [c.start for c in feed.state.candles_5] == [start-300000,start]


@pytest.mark.parametrize('close', ['NaN', '102', '-1', 'not-a-price', None])
def test_invalid_candle_does_not_enter_strategy_history(close):
    feed = stream()
    start = int(time.time()*1000)//300000*300000
    asyncio.run(feed.handle(json.dumps(dict(arg=dict(topic='kline',interval='5m'),
        data=[dict(start=start,open=100,high=101,low=99,close=close,volume=10)]))))
    assert not feed.state.candles_5
    assert feed.state.last_kline_5_ts is None
