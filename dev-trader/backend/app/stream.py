import asyncio
import json
import time
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest, urlopen

import websockets

from .models import Candle, MarketState


class BybitStream:
    def __init__(self, url, symbol, on_state):
        self.url = url
        self.symbol = symbol
        self.on_state = on_state
        self.state = MarketState(symbol=symbol)
        self.stop = False
        self.subs = [
            f"tickers.{symbol}",
            f"publicTrade.{symbol}",
            f"orderbook.50.{symbol}",
            f"allLiquidation.{symbol}",
            f"kline.5.{symbol}",
            f"kline.15.{symbol}",
            f"kline.60.{symbol}",
        ]
        self.last_trade_minute = None
        self.delta_base = 0.0
        self.bids: dict[float, float] = {}
        self.asks: dict[float, float] = {}

    async def run(self):
        while not self.stop:
            try:
                # Live WebSocket first; historical warm-up must never block startup.
                async with websockets.connect(
                    self.url,
                    ping_interval=20,
                    ping_timeout=10,
                    max_queue=10000,
                    open_timeout=6,
                    close_timeout=3,
                ) as ws:
                    self.state.ws_connected = True
                    self.state.data_health = "CONNECTING"
                    await ws.send(json.dumps({"op": "subscribe", "args": self.subs}))
                    asyncio.create_task(self.backfill())
                    await self.on_state(self.state)
                    async for raw in ws:
                        await self.handle(raw)
                        if self.stop:
                            break
            except Exception:
                self.state.ws_connected = False
                self.state.data_health = "RECONNECTING"
                await self.on_state(self.state)
                await asyncio.sleep(1)

    async def backfill(self):
        intervals = [
            ("5", "candles_5", 180),
            ("15", "candles_15", 180),
            ("60", "candles_60", 240),
        ]

        async def fetch(item):
            interval, dest_name, limit = item
            try:
                rows = await asyncio.wait_for(
                    asyncio.to_thread(self._rest_kline, interval, limit),
                    timeout=4.5,
                )
                dest = getattr(self.state, dest_name)
                merged = {c.start: c for c in dest}
                for idx, row in enumerate(rows):
                    candle = Candle(
                        start=int(row[0]),
                        end=int(row[0]) + int(interval) * 60_000 - 1,
                        open=float(row[1]),
                        high=float(row[2]),
                        low=float(row[3]),
                        close=float(row[4]),
                        volume=float(row[5]),
                        confirmed=(idx < len(rows) - 1),
                    )
                    merged[candle.start] = candle
                values = sorted(merged.values(), key=lambda x: x.start)
                dest.clear()
                dest.extend(values[-240:])
                return interval, True
            except Exception:
                return interval, False

        results = await asyncio.gather(*(fetch(x) for x in intervals))
        if self.state.ws_connected:
            now = int(time.time() * 1000)
            self._refresh_data_health(now)
            await self.on_state(self.state)


    def _refresh_data_health(self, now: int):
        recent = [
            x for x in (
                self.state.exchange_ts,
                self.state.last_trade_ts,
                self.state.last_kline_5_ts,
                self.state.last_kline_15_ts,
            ) if x
        ]
        if self.state.ws_connected and recent and max(now - x for x in recent) < 5000:
            self.state.data_health = "HEALTHY"
        elif self.state.ws_connected:
            self.state.data_health = "STALE"

    def _rest_kline(self, interval: str, limit: int) -> list[list]:
        query = urlencode({
            "category": "linear",
            "symbol": self.symbol,
            "interval": interval,
            "limit": str(limit),
        })
        req = UrlRequest(
            "https://api.bybit.com/v5/market/kline?" + query,
            headers={"User-Agent": "Dev-Trader/0.5"},
        )
        with urlopen(req, timeout=4) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if payload.get("retCode") != 0:
            raise RuntimeError(f"Bybit kline error: {payload.get('retMsg')}")
        rows = payload.get("result", {}).get("list", []) or []
        rows.reverse()
        return rows

    def _apply_book(self, d: dict):
        if d.get("type") == "snapshot":
            self.bids.clear()
            self.asks.clear()
        for row in d.get("b", []) or []:
            p, q = float(row[0]), float(row[1])
            if q == 0:
                self.bids.pop(p, None)
            else:
                self.bids[p] = q
        for row in d.get("a", []) or []:
            p, q = float(row[0]), float(row[1])
            if q == 0:
                self.asks.pop(p, None)
            else:
                self.asks[p] = q

        bids = sorted(self.bids.items(), reverse=True)[:10]
        asks = sorted(self.asks.items())[:10]
        bid_qty = sum(q for _, q in bids)
        ask_qty = sum(q for _, q in asks)
        total = bid_qty + ask_qty
        self.state.book_bid_qty = bid_qty
        self.state.book_ask_qty = ask_qty
        self.state.book_imbalance = ((bid_qty - ask_qty) / total) if total else 0.0
        if bids and asks:
            mid = (bids[0][0] + asks[0][0]) / 2.0
            self.state.spread_bps = ((asks[0][0] - bids[0][0]) / mid * 10_000) if mid else 0.0

    def _trim_windows(self, now: int):
        cutoff = now - 15 * 60_000
        self.state.oi_window = [(ts, v) for ts, v in self.state.oi_window if ts >= cutoff]
        self.state.cvd_history = [(ts, v) for ts, v in self.state.cvd_history if ts >= cutoff]
        self.state.liquidation_window = [
            (ts, side, size) for ts, side, size in self.state.liquidation_window if ts >= cutoff
        ]
        self.state.liquidation_long_5m = sum(
            v for ts, side, v in self.state.liquidation_window
            if side == "LONG" and ts >= now - 5 * 60_000
        )
        self.state.liquidation_short_5m = sum(
            v for ts, side, v in self.state.liquidation_window
            if side == "SHORT" and ts >= now - 5 * 60_000
        )

    async def handle(self, raw):
        now = int(time.time() * 1000)
        msg = json.loads(raw)
        topic = msg.get("topic", "")
        self.state.received_ts = now
        self.state.exchange_ts = int(msg.get("ts", now))

        if topic.startswith("tickers."):
            d = msg.get("data") or {}
            for attr, key in [
                ("last_price", "lastPrice"),
                ("mark_price", "markPrice"),
                ("index_price", "indexPrice"),
                ("open_interest", "openInterest"),
                ("open_interest_value", "openInterestValue"),
                ("funding_rate", "fundingRate"),
                ("bid", "bid1Price"),
                ("ask", "ask1Price"),
            ]:
                if d.get(key) not in (None, ""):
                    setattr(self.state, attr, float(d[key]))
            if self.state.open_interest is not None:
                self.state.oi_window.append((now, self.state.open_interest))

        elif topic.startswith("publicTrade."):
            for t in msg.get("data") or []:
                size = float(t.get("v", 0))
                self.state.cvd += size if t.get("S") == "Buy" else -size
                self.state.last_trade_ts = int(t.get("T", now))
                minute = self.state.last_trade_ts // 60_000
                if minute != self.last_trade_minute:
                    self.last_trade_minute = minute
                    self.delta_base = self.state.cvd
            self.state.delta_1m = self.state.cvd - self.delta_base
            self.state.cvd_history.append((self.state.last_trade_ts or now, self.state.cvd))

        elif topic.startswith("orderbook."):
            d = msg.get("data") or {}
            self.state.orderbook_seq = int(d.get("u", self.state.orderbook_seq or 0))
            self._apply_book({**d, "type": msg.get("type", "delta")})

        elif topic.startswith("allLiquidation."):
            for liq in msg.get("data") or []:
                size = float(liq.get("v", 0))
                side = "LONG" if liq.get("S") == "Buy" else "SHORT"
                self.state.liquidation_window.append((int(liq.get("T", now)), side, size))

        elif topic.startswith("kline."):
            for k in msg.get("data") or []:
                interval = str(k["interval"])
                c = Candle(
                    int(k["start"]),
                    int(k["end"]),
                    float(k["open"]),
                    float(k["high"]),
                    float(k["low"]),
                    float(k["close"]),
                    float(k.get("volume", 0)),
                    bool(k.get("confirm", False)),
                )
                dest = (
                    self.state.candles_5 if interval == "5"
                    else self.state.candles_15 if interval == "15"
                    else self.state.candles_60
                )
                if dest and dest[-1].start == c.start:
                    dest[-1] = c
                else:
                    dest.append(c)
                del dest[:-240]
                if interval == "5":
                    self.state.last_kline_5_ts = int(k.get("timestamp", now))
                elif interval == "15":
                    self.state.last_kline_15_ts = int(k.get("timestamp", now))
                else:
                    self.state.last_kline_60_ts = int(k.get("timestamp", now))

        self._trim_windows(now)
        recent = [
            x for x in [
                self.state.exchange_ts,
                self.state.last_trade_ts,
                self.state.last_kline_5_ts,
                self.state.last_kline_15_ts,
            ] if x
        ]
        self._refresh_data_health(now)
        await self.on_state(self.state)
