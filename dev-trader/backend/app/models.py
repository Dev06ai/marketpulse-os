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
    exchange_ts: int | None = None
    received_ts: int | None = None
    last_trade_ts: int | None = None
    last_kline_15_ts: int | None = None
    last_kline_60_ts: int | None = None
    data_health: str = "STARTING"
    ws_connected: bool = False
    oi_window: list[tuple[int, float]] = field(default_factory=list)
    candles_15: list[Candle] = field(default_factory=list)
    candles_60: list[Candle] = field(default_factory=list)

    def snapshot(self) -> dict[str, Any]:
        d = asdict(self)
        d["candles_15"] = [c.to_dict() for c in self.candles_15[-120:]]
        d["candles_60"] = [c.to_dict() for c in self.candles_60[-120:]]
        return d
