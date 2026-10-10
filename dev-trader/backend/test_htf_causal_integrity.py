"""HTF risk-policy causality and malformed-data safety regressions.

No exchange credentials, orders, live data, or strategy-gate relaxations.
"""
from app.agent_orchestration import data_sentinel
from app.htf_policy import derivatives_context, evaluate_htf_policy, structural_stop
from app.models import Candle
from test_htf_policy import scenario, signal, features


def future_hour(now, price=250000):
    hour = now // 3_600_000 * 3_600_000
    return Candle(start=hour + 3_600_000,
                  end=hour + 7_200_000 - 1,
                  open=price, high=price + 1000, low=price - 1000,
                  close=price, volume=1000, confirmed=True)


def test_future_confirmed_hour_cannot_change_htf_decision():
    now, state = scenario()
    baseline = evaluate_htf_policy(state, signal(), features(), now)
    assert baseline["eligible"]
    state.candles_60.append(future_hour(now))
    replay = evaluate_htf_policy(state, signal(), features(), now)
    assert replay["eligible"] == baseline["eligible"]
    assert replay["estimated_net_rr"] == baseline["estimated_net_rr"]
    assert replay["structural_stop"] == baseline["structural_stop"]


def test_future_confirmed_hour_cannot_create_missing_htf_context():
    now, state = scenario()
    state.candles_60 = state.candles_60[:10]
    # Missing 1H/4H history must remain missing even if a future full bar arrives.
    state.candles_60.append(future_hour(now))
    result = evaluate_htf_policy(state, signal(), features(), now)
    assert not result["eligible"]
    assert "INSUFFICIENT_CONFIRMED_1H_4H_CONTEXT" in result["reasons"]


def test_future_fifteen_minute_swings_cannot_change_protective_stop():
    now, state = scenario()
    baseline = structural_stop(state, signal(), features(), now_ms=now)
    hour=now // 3_600_000 * 3_600_000
    state.candles_15.append(Candle(
        start=hour+3_600_000, end=hour+3_900_000, open=100000,
        high=100100, low=97500, close=100000, volume=200, confirmed=True))
    candidate = structural_stop(state, signal(), features(), now_ms=now)
    assert candidate == baseline


def test_invalid_score_cannot_crash_structural_stop_review():
    now, state = scenario()
    plan = signal()
    plan["evidence"]["level_reaction"]["reaction_score"] = "not-an-int"
    result = structural_stop(state, plan, features(), now_ms=now)
    assert result["why"] in {"STRUCTURAL_STOP_CONFIRMED",
                              "STOP_INSIDE_LIQUIDITY_NOISE_OR_INVALIDATION",
                              "NO_VERIFIABLE_STRUCTURAL_INVALIDATION"}


def test_malformed_derivatives_do_not_raise_or_fabricate_squeeze():
    now, state = scenario()
    state.oi_window = [
        {"timestamp": now, "value": 1000},
        ("invalid", 200),
        (now-300_000, float("nan")),
        (now+5_000, 10000),
        (now-300_000, 100.0),
        (now, 102.0),
    ]
    state.liquidation_window = [None, {}, ("garbage", "LONG", 100),
                                (now+1_000, "LONG", 100)]
    state.liquidation_long_5m = float("nan")
    report = derivatives_context(state, now)
    assert report["oi_status"] == "OBSERVED_RECENT_5M_CHANGE"
    assert report["oi_5m_pct"] == 2.0
    assert report["fresh_liquidation_events"] == 0
    assert report["squeeze_hypothesis"] == "NO_CONFIRMED_SQUEEZE"
    assert report["long_liquidations_5m"] is None


def test_malformed_sentinel_timestamps_fail_closed():
    raw={"now_ms": 200_000, "market_update_ms": "bad",
         "book_update_ms": float("nan"), "trade_update_ms": True}
    report=data_sentinel(raw)
    assert report["quote"]["status"] == "UNKNOWN"
    assert report["orderbook"]["status"] == "UNKNOWN"
    assert report["trades"]["status"] == "UNKNOWN"
    assert "MARKET_QUOTE_UNVERIFIED" in report["critical_blockers"]


def test_one_second_future_exchange_clock_tolerance_is_preserved():
    now,state=scenario()
    state.last_market_update_ts=now+500
    assert evaluate_htf_policy(state, signal(), features(), now)["eligible"]
    state.last_market_update_ts=now+1001
    assert not evaluate_htf_policy(state, signal(), features(), now)["eligible"]
