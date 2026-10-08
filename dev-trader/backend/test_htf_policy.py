"""System policy: hard capital rules with advisory, not unanimous, indicators."""
import math
import time

import pytest

from app.analytics import MarketFeatures
from app.bitget import BitgetDemoClient, BitgetDemoError
from app.execution import DemoExecutionEngine
from app.htf_policy import evaluate_htf_policy, rsi_series, volume_weighted_macd, structural_stop
from app.models import Candle, MarketState


def scenario():
    now=int(time.time()*1000)
    hour=now//3_600_000*3_600_000
    candles=[]
    for i in range(200):
        begin=hour-(200-i)*3_600_000
        price=100000+math.sin(i*math.pi/4)*420
        candles.append(Candle(start=begin,end=begin+3_600_000-1,open=price-40,
                              high=price+270,low=price-270,close=price,
                              volume=100+i%7,confirmed=True))
    # 15m provides an independent, recently confirmed possible stop anchor.
    candles15=[]
    for j in range(80):
        start=hour-80*900_000+j*900_000
        p=100000+math.sin(j*math.pi/4)*300
        candles15.append(Candle(start=start,end=start+900_000-1,open=p-20,
                                high=p+160,low=p-160,close=p,volume=50,confirmed=True))
    return now,MarketState(
        last_price=100000,data_health="HEALTHY",ws_connected=True,
        last_market_update_ts=now,candles_60=candles,candles_15=candles15,
        funding_rate=0.0003,
    )


def signal(direction="LONG",stop=99000, target=108000):
    return {
        "id":"countertrend-sfp","direction":direction,
        "entry":100000,"stop":stop,"target1":103000,
        "target2":target,"rr":8,"setup":"Daily Low Level Reaction",
        "evidence":{
            "level_reaction_age_ms":1000,
            "level_reaction":{
                "direction":direction,"reaction_status":"READY",
                "reaction_score":5,"reaction_candle_low":99500,
                "reaction_candle_high":100600,
            },
        },
    }


def features(trend="DOWN"):
    return MarketFeatures(trend_60=trend,trend_240=trend,
                          market_structure="BEARISH",order_blocks={})


def test_countertrend_reversal_not_blocked_by_macd_rsi_or_trend_votes():
    now,state=scenario()
    report=evaluate_htf_policy(state,signal(),features(),now)
    assert report["decision"]=="BUY/LONG",report
    assert report["eligible"]
    assert "1H_COUNTERTREND" in report["cautionary_evidence"]
    assert report["structural_stop"]["ok"]
    assert report["estimated_net_rr"]>=2.5


def test_stop_inside_nearest_credible_invalidation_is_rejected():
    now,state=scenario()
    report=evaluate_htf_policy(state,signal(stop=99900,target=104000),features(),now)
    assert report["decision"]=="HOLD/WAIT",report
    assert "STOP_INSIDE_LIQUIDITY_NOISE_OR_INVALIDATION" in report["reasons"]
    assert report["stop_loss"] is None


def test_two_and_half_to_one_reward_after_costs_is_absolute():
    now,state=scenario()
    report=evaluate_htf_policy(state,signal(stop=99000,target=102700),features(),now)
    assert not report["eligible"]
    assert "REWARD_RISK_BELOW_2_5_AFTER_ESTIMATED_COSTS" in report["reasons"]


def test_short_reversal_can_qualify_against_higher_timeframe_trend():
    now,state=scenario()
    sig=signal(direction="SHORT",stop=101000,target=91000)
    sig["target1"]=97000
    report=evaluate_htf_policy(state,sig,features("UP"),now)
    assert report["decision"]=="SELL/SHORT",report
    assert report["estimated_net_rr"]>=2.5


def test_missing_or_stale_market_inputs_always_wait():
    now,state=scenario()
    state.last_market_update_ts=now-10000
    report=evaluate_htf_policy(state,signal(),features(),now)
    assert report["decision"]=="HOLD/WAIT"
    assert "MARKET_QUOTE_STALE" in report["reasons"]
    state.last_market_update_ts=now
    state.ws_connected=False
    assert "MARKET_DATA_UNHEALTHY" in evaluate_htf_policy(state,signal(),features(),now)["reasons"]


def test_funding_missing_does_not_create_imaginary_squeeze_or_entry_block():
    now,state=scenario()
    state.funding_rate=None
    report=evaluate_htf_policy(state,signal(),features(),now)
    assert report["eligible"]
    assert report["derivatives"]["funding_status"]=="UNAVAILABLE"
    assert report["derivatives"]["squeeze_hypothesis"]=="NO_CONFIRMED_SQUEEZE"
    assert report["macro_feed_verified"] is False
    assert report["orders_submitted"] is False


def test_rsi_and_volume_weighted_macd_are_confirmed_only():
    now,state=scenario()
    assert all(x is None for x in rsi_series([c.close for c in state.candles_60[:10]]))
    macd=volume_weighted_macd(state.candles_60)
    assert macd["status"]=="CONFIRMED_CANDLES_ONLY"
    state.candles_60[-1].volume=0
    assert volume_weighted_macd(state.candles_60)["direction"]=="UNKNOWN"


def test_user_selected_20x_is_respected_but_risk_3_clamps_to_2(monkeypatch,tmp_path):
    monkeypatch.setenv("BITGET_DEMO_LEVERAGE","20")
    monkeypatch.setenv("BITGET_DEMO_MAX_PLANNED_LOSS_PCT","3")
    monkeypatch.setenv("BITGET_EXECUTION_STATE_FILE",str(tmp_path/"execution.json"))
    executor=DemoExecutionEngine(learning=None)
    assert executor.leverage==20
    assert executor.max_planned_loss_pct==2.0
    assert executor.risk_pct==2.0


def test_exchange_client_rejects_any_direct_request_above_20x():
    client=BitgetDemoClient("k","s","p")
    with pytest.raises(BitgetDemoError,match="1x-20x"):
        client.set_leverage("BTCUSDT","LONG",25,"isolated")


def test_unknown_structure_never_generates_an_invented_stop():
    now,state=scenario()
    state.candles_60=[]
    state.candles_15=[]
    report=structural_stop(state,signal(),features())
    assert not report["ok"]
    assert report["structural_anchor"] is None
