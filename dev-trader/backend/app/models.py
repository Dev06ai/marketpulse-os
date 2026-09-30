from dataclasses import dataclass, asdict, field
from typing import Any


@dataclass
class Candle:
    start: int
    end: int
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0
    confirmed: bool = False

    def to_dict(self):
        return asdict(self)


def aggregate_candles(candles: list[Candle], multiplier: int) -> list[Candle]:
    cs = [c for c in candles if c.confirmed]
    if not cs:
        return []
    bucket_ms = multiplier * 60 * 60_000
    groups: dict[int, list[Candle]] = {}
    for c in cs:
        groups.setdefault(c.start // bucket_ms, []).append(c)

    out: list[Candle] = []
    for _, group in sorted(groups.items()):
        if len(group) < multiplier:
            continue
        out.append(Candle(
            start=group[0].start,
            end=group[-1].end,
            open=group[0].open,
            high=max(x.high for x in group),
            low=min(x.low for x in group),
            close=group[-1].close,
            volume=sum(x.volume for x in group),
            confirmed=all(x.confirmed for x in group),
        ))
    return out


@dataclass
class MarketState:
    symbol: str = "BTCUSDT"
    last_price: float | None = None
    mark_price: float | None = None
    index_price: float | None = None
    open_interest: float | None = None
    open_interest_value: float | None = None
    funding_rate: float | None = None
    bid: float | None = None
    ask: float | None = None
    cvd: float = 0.0
    delta_1m: float = 0.0
    orderbook_seq: int | None = None
    book_bid_qty: float = 0.0
    book_ask_qty: float = 0.0
    book_imbalance: float = 0.0
    spread_bps: float = 0.0
    liquidation_long_5m: float = 0.0
    liquidation_short_5m: float = 0.0
    exchange_ts: int | None = None
    received_ts: int | None = None
    last_trade_ts: int | None = None
    last_kline_15_ts: int | None = None
    last_kline_60_ts: int | None = None
    data_health: str = "STARTING"
    ws_connected: bool = False
    oi_window: list[tuple[int, float]] = field(default_factory=list)
    cvd_history: list[tuple[int, float]] = field(default_factory=list)
    liquidation_window: list[tuple[int, str, float]] = field(default_factory=list)
    candles_5: list[Candle] = field(default_factory=list)
    candles_15: list[Candle] = field(default_factory=list)
    candles_60: list[Candle] = field(default_factory=list)

    def candles_4h(self) -> list[Candle]:
        return aggregate_candles(self.candles_60, 4)

    def snapshot(self) -> dict[str, Any]:
        d = asdict(self)
        d["candles_5"] = [c.to_dict() for c in self.candles_5[-180:]]
        d["candles_15"] = [c.to_dict() for c in self.candles_15[-120:]]
        d["candles_60"] = [c.to_dict() for c in self.candles_60[-120:]]
        d["candles_4h"] = [c.to_dict() for c in self.candles_4h()[-80:]]
        d["oi_window"] = self.oi_window[-120:]
        d["cvd_history"] = self.cvd_history[-120:]
        d["liquidation_window"] = self.liquidation_window[-240:]
        return d
