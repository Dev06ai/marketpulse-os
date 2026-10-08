"""Independent SMC observation cannot turn future candles into current signals."""
import asyncio

from app.models import Candle, MarketState
from app.analytics import MarketFeatures
from app.smc_shadow import confirmed_swing_analysis, compare_structure


def bar(i, close=100, confirmed=True, base=1000):
    return Candle(start=base+i*3_600_000,end=base+(i+1)*3_600_000-1,
                  open=close,high=close+1,low=close-1,close=close,
                  volume=100,confirmed=confirmed)


def test_smc_ignores_unconfirmed_and_future_candles():
    bars=[bar(i,100+i*0.1) for i in range(20)]
    present=bars[-1].end
    before=confirmed_swing_analysis(bars,as_of_ms=present)
    extreme=bar(21,500,confirmed=False)
    future=bar(22,999,confirmed=True)
    result=confirmed_swing_analysis(bars+[extreme,future],as_of_ms=present)
    assert result==before
    assert result["execution_capable"] is False
    assert result["last_confirmed_end"]==present


def test_smc_cannot_use_incomplete_sample_or_fabricate_trade():
    result=confirmed_swing_analysis([bar(i) for i in range(5)])
    assert result["status"]=="INSUFFICIENT_CONFIRMED_BARS"
    assert result["break"]=="NONE"
    assert not result["execution_capable"]


def test_smc_comparison_is_advisory_and_matches_one_hour_context():
    state=MarketState(candles_60=[bar(i,100+i/5) for i in range(60)],
                      candles_15=[bar(i,100-i/5) for i in range(60)])
    report=compare_structure(state,MarketFeatures(market_structure="BULLISH"),
                             state.candles_60[-1].end)
    assert report["mode"]=="SHADOW_ONLY"
    assert report["trade_signal"] is None
    assert report["profitability_proven"] is False
    assert set(report["timeframes"])=={"15m","1h","4h"}


def test_shadow_endpoints_do_not_submit_orders(monkeypatch):
    from app import main
    monkeypatch.setattr(main,"smc_snapshot",{
        "mode":"SHADOW_ONLY","structure_disagreement":False,"execution_capable":False
    })
    response=asyncio.run(main.agent_smc_status())
    assert response["execution_capable"] is False
    met=asyncio.run(main.metrics())
    assert b"kyvoriq_market_evaluations" in met.body
    assert b"API_KEY" not in met.body
