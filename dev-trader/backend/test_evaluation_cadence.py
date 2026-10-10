import asyncio
from dataclasses import replace

import pytest

from app.evaluation_cadence import confirmed_bar_key, evaluation_due
from app.models import Candle, MarketState


def closed(end=299999):
    return Candle(start=0, end=end, open=100, high=103, low=98, close=102, volume=10, confirmed=True)


@pytest.mark.parametrize("pool", ["candles_5", "candles_15", "candles_60"])
def test_delayed_callback_still_evaluates_new_confirmed_bar_immediately(pool):
    state = MarketState(last_kline_5_ts=300001, last_kline_15_ts=300001, last_kline_60_ts=300001)
    before = confirmed_bar_key(state, 300000)
    setattr(state, pool, [closed()])
    due, key = evaluation_due(state, 300007, 300000, before)
    assert due  # Prior timestamp-equality gate would wait another 993 ms.
    assert not evaluation_due(state, 300008, 300007, key)[0]


def test_open_bar_updates_do_not_bypass_bounded_tick_cadence():
    state = MarketState(candles_5=[closed(), replace(closed(599999), start=300000, confirmed=False)])
    key = confirmed_bar_key(state, 300000)
    for now in range(300001, 301000):
        state.candles_5[-1].close += .001
        state.last_kline_5_ts = now
        assert not evaluation_due(state, now, 300000, key)[0]
    assert evaluation_due(state, 301000, 300000, key)[0]


def test_confirmed_correction_rechecks_once_but_future_bar_does_not():
    state = MarketState(candles_5=[closed()])
    key = confirmed_bar_key(state, 300000)
    state.candles_5[0].high = 104
    due, key = evaluation_due(state, 300002, 300000, key)
    assert due
    state.candles_5.append(replace(closed(599999), start=300000))
    assert not evaluation_due(state, 300003, 300002, key)[0]


def test_clock_rollback_does_not_freeze_periodic_review():
    state = MarketState()
    assert evaluation_due(state, 9000, 10000, confirmed_bar_key(state, 10000))[0]


def test_on_state_uses_closed_bar_identity_instead_of_receipt_clock_equality(monkeypatch):
    from app import main
    state = MarketState(candles_60=[closed()], last_kline_60_ts=300001)
    seen = []
    class EvaluationReached(Exception):
        pass
    def evaluate(observed):
        seen.append(observed)
        raise EvaluationReached
    monkeypatch.setattr(main, "last_engine_eval_ms", 300000)
    monkeypatch.setattr(main, "last_evaluated_bars", (None, None, None))
    monkeypatch.setattr(main.time, "time", lambda: 300.007)
    monkeypatch.setattr(main.engine, "evaluate", evaluate)
    monkeypatch.setattr(main, "state", MarketState())
    with pytest.raises(EvaluationReached):
        asyncio.run(main.on_state(state))
    assert seen == [state]
