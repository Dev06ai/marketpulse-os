from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .models import Candle, MarketState
from .strategy import StrategyEngine


@dataclass
class BacktestTrade:
    direction: str
    entry: float
    stop: float
    target: float
    rr: float
    result_r: float


@dataclass
class BacktestReport:
    trades: list[BacktestTrade]
    total_r: float
    win_rate: float
    max_drawdown_r: float


def run_walk_forward(candles_15: Iterable[Candle], candles_60: Iterable[Candle]) -> BacktestReport:
    c15 = list(candles_15)
    c60 = list(candles_60)
    engine = StrategyEngine()
    trades: list[BacktestTrade] = []
    equity_r = 0.0
    peak = 0.0
    max_dd = 0.0

    for i in range(30, len(c15)):
        hist15 = c15[: i + 1]
        end_ts = hist15[-1].end
        hist60 = [c for c in c60 if c.end <= end_ts]
        state = MarketState(candles_15=hist15, candles_60=hist60, last_price=hist15[-1].close, data_health="HEALTHY")
        sig = engine.evaluate(state)
        if not sig:
            continue

        future = [c for c in c15[i + 1 : i + 13] if c.confirmed]
        result_r = 0.0
        for c in future:
            if sig.direction == "LONG":
                if c.low <= sig.stop:
                    result_r = -1.0
                    break
                if c.high >= sig.target2:
                    result_r = sig.rr
                    break
            else:
                if c.high >= sig.stop:
                    result_r = -1.0
                    break
                if c.low <= sig.target2:
                    result_r = sig.rr
                    break

        if result_r == 0.0:
            continue
        trades.append(BacktestTrade(sig.direction, sig.entry, sig.stop, sig.target2, sig.rr, result_r))
        equity_r += result_r
        peak = max(peak, equity_r)
        max_dd = max(max_dd, peak - equity_r)

    wins = sum(1 for t in trades if t.result_r > 0)
    return BacktestReport(
        trades=trades,
        total_r=equity_r,
        win_rate=(wins / len(trades) * 100.0) if trades else 0.0,
        max_drawdown_r=max_dd,
    )
