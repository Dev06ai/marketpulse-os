"""Original phases 3/4: intrabar SFP must not resurrect stale live sweeps."""
from types import SimpleNamespace

import pytest

from app.models import Candle, MarketState
from app import strategy


NOW = 2_000_000_000_000


def _candle(start, end, *, high=103.0, low=99.0, confirmed=True):
    return Candle(start=start, end=end, open=100.0, high=high, low=low,
                  close=100.0, volume=100.0, confirmed=confirmed)


def _state(form_start, *, quote=NOW):
    # Old confirmed candles are not fresh SFP triggers. Only live wick can
    # establish the fresh high sweep in the engineered scenario.
    prior = [_candle(NOW - (15-i)*300_000, NOW-(14-i)*300_000-1)
             for i in range(12)]
    forming = _candle(form_start, form_start+300_000-1,
                      high=110.0, low=99.0, confirmed=False)
    return MarketState(last_price=100.0, candles_5=prior+[forming],
                       last_market_update_ts=quote)


def test_fresh_intrabar_sweep_can_be_seen(monkeypatch):
    monkeypatch.setattr(strategy, "compute_features", lambda _: object())
    monkeypatch.setattr(strategy, "pivots", lambda bars, window: ([(3,105.0)], []))
    monkeypatch.setattr(strategy, "_signal", lambda **kw: SimpleNamespace(**kw))
    sig = strategy.detect_sfp(_state(NOW-60_000))
    assert sig is not None and sig.direction == "SHORT"
    assert sig.id.startswith("sfp-short-5m-")


def test_stale_intrabar_wick_never_retriggered_after_disconnect(monkeypatch):
    monkeypatch.setattr(strategy, "compute_features", lambda _: object())
    monkeypatch.setattr(strategy, "pivots", lambda bars, window: ([(3,105.0)], []))
    monkeypatch.setattr(strategy, "_signal", lambda **kw: SimpleNamespace(**kw))
    stale = _state(NOW - 600_000)  # open candle expired five minutes earlier
    assert strategy.detect_sfp(stale) is None


def test_future_unopened_candle_wick_cannot_trigger_sfp(monkeypatch):
    monkeypatch.setattr(strategy, "compute_features", lambda _: object())
    monkeypatch.setattr(strategy, "pivots", lambda bars, window: ([(3,105.0)], []))
    monkeypatch.setattr(strategy, "_signal", lambda **kw: SimpleNamespace(**kw))
    future = _state(NOW + 30_000)
    assert strategy.detect_sfp(future) is None


@pytest.mark.parametrize("age", [0, 100, 1000])
def test_one_second_exchange_clock_tolerance_preserved(age):
    state = _state(NOW-300_000, quote=NOW+age)
    assert strategy._forming_candle_is_current(state, state.candles_5[-1])


def test_quote_beyond_one_second_clock_tolerance_is_not_current():
    state = _state(NOW-300_000, quote=NOW+1001)
    assert not strategy._forming_candle_is_current(state, state.candles_5[-1])
