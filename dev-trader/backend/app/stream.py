import asyncio
import json
import os
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
        self.last_rest_sync_ms = 0
        self.last_rest_candle_sync_ms = 0
        self.last_rest_ok = False
        self.last_upstream_error = ""
        self.last_data_source = "NONE"
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
            except Exception as exc:
                self.last_upstream_error = str(exc)[:240]
                self.state.ws_connected = False
                self.state.data_health = "RECONNECTING"
                await self.on_state(self.state)
                await asyncio.sleep(1)

    async def refresh_ticker(self):
        now = int(time.time() * 1000)
        errors = []

        # Primary: Bybit, which supplies the orderbook/trade/liquidation stream used
        # by the richer strategy features.
        try:
            payload = await asyncio.wait_for(
                asyncio.to_thread(self._rest_ticker),
                timeout=4.0,
            )
            rows = payload.get("result", {}).get("list", []) or []
            if not rows:
                raise RuntimeError("Bybit ticker returned no rows")
            d = rows[0]
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
            self.last_data_source = "BYBIT_REST"
            self.state.received_ts = now
            self.state.exchange_ts = now
            self.state.last_market_update_ts = now
            if self.state.open_interest is not None:
                self.state.oi_window.append((now, self.state.open_interest))
            self.last_rest_sync_ms = now
            self.last_rest_ok = True
            self.last_upstream_error = ""
            self._trim_windows(now)
            self._refresh_data_health(now)
            await self.on_state(self.state)
            return True
        except Exception as exc:
            errors.append("Bybit: " + str(exc)[:160])

        # Secondary: Binance USD-M public REST. This keeps the dashboard/chart/price/OI
        # alive when Bybit REST is temporarily unreachable from the Render region.
        try:
            payload = await asyncio.wait_for(
                asyncio.to_thread(self._rest_binance_ticker),
                timeout=4.0,
            )
            price = float(payload["price"])
            self.state.last_price = price
            self.state.mark_price = float(payload.get("markPrice", price))
            self.state.index_price = float(payload.get("indexPrice", price))
            self.state.open_interest = float(payload["openInterest"]) if payload.get("openInterest") not in (None, "") else self.state.open_interest
            self.state.funding_rate = float(payload["fundingRate"]) if payload.get("fundingRate") not in (None, "") else self.state.funding_rate
            self.last_data_source = "BINANCE_FALLBACK"
            self.state.received_ts = now
            self.state.exchange_ts = now
            self.state.last_market_update_ts = now
            if self.state.open_interest is not None:
                self.state.oi_window.append((now, self.state.open_interest))
            self.last_rest_sync_ms = now
            self.last_rest_ok = True
            self.last_upstream_error = "Bybit unavailable; Binance REST fallback active."
            self._trim_windows(now)
            self._refresh_data_health(now)
            await self.on_state(self.state)
            return True
        except Exception as exc:
            errors.append("Binance: " + str(exc)[:160])

        self.last_rest_sync_ms = now
        self.last_rest_ok = False
        self.last_upstream_error = " | ".join(errors)[:480]
        self._refresh_data_health(now)
        await self.on_state(self.state)
        return False

    async def rest_fallback_loop(self):
        while not self.stop:
            ok = await self.refresh_ticker()
            now = int(time.time() * 1000)
            if (
                not self.state.candles_15
                or not self.state.candles_60
                or now - self.last_rest_candle_sync_ms > 15_000
            ):
                await self.backfill()
            await asyncio.sleep(3.0 if ok else 2.0)

    async def bootstrap_rest(self):
        await self.refresh_ticker()
        await self.backfill()

    def _rest_binance_ticker(self) -> dict:
        symbol = self.symbol.upper()
        def get_json(url: str) -> dict | list:
            req = UrlRequest(
                url,
                headers={"User-Agent": "Dev-Trader/0.6", "Accept": "application/json"},
            )
            with urlopen(req, timeout=4) as response:
                return json.loads(response.read().decode("utf-8"))

        ticker = get_json("https://fapi.binance.com/fapi/v1/ticker/price?symbol=" + symbol)
        mark = get_json("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=" + symbol)
        oi = get_json("https://fapi.binance.com/fapi/v1/openInterest?symbol=" + symbol)
        return {
            "price": ticker["price"],
            "markPrice": mark.get("markPrice", ticker["price"]),
            "indexPrice": mark.get("indexPrice", ticker["price"]),
            "fundingRate": mark.get("lastFundingRate", 0),
            "openInterest": oi.get("openInterest"),
        }

    def _rest_ticker(self) -> dict:
        query = urlencode({
            "category": "linear",
            "symbol": self.symbol,
        })
        req = UrlRequest(
            "https://api.bybit.com/v5/market/tickers?" + query,
            headers={"User-Agent": "Dev-Trader/0.6"},
        )
        with urlopen(req, timeout=4) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if payload.get("retCode") != 0:
            raise RuntimeError(f"Bybit ticker error: {payload.get('retMsg')}")
        return payload

    async def backfill(self):
        intervals = [
            ("5", "candles_5", 180),
            ("15", "candles_15", 180),
            ("60", "candles_60", 240),
        ]

        async def fetch(item):
            interval, dest_name, limit = item
            try:
                try:
                    rows = await asyncio.wait_for(
                        asyncio.to_thread(self._rest_kline, interval, limit),
                        timeout=4.5,
                    )
                except Exception:
                    rows = await asyncio.wait_for(
                        asyncio.to_thread(self._rest_binance_kline, interval, limit),
                        timeout=4.5,
                    )
                    self.last_data_source = "BINANCE_FALLBACK"
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
        now = int(time.time() * 1000)
        if any(ok for _, ok in results):
            self.last_rest_candle_sync_ms = now
            self.last_rest_ok = True
        self._refresh_data_health(now)
        await self.on_state(self.state)


    def _refresh_data_health(self, now: int):
        recent = [
            x for x in (
                self.state.last_market_update_ts,
                self.state.last_trade_ts,
                self.state.last_kline_5_ts,
                self.state.last_kline_15_ts,
                self.state.received_ts,
            ) if x
        ]
        if recent and min(now - x for x in recent) < 5000:
            if self.last_data_source == "BINANCE_FALLBACK" or not self.state.ws_connected:
                self.state.data_health = "DEGRADED"
            else:
                self.state.data_health = "HEALTHY"
        elif self.state.ws_connected:
            self.state.data_health = "STALE"
        elif self.last_rest_ok and self.state.last_price is not None:
            self.state.data_health = "DEGRADED"

    def _rest_binance_kline(self, interval: str, limit: int) -> list[list]:
        mapping = {"5": "5m", "15": "15m", "60": "1h"}
        symbol = self.symbol.upper()
        query = urlencode({
            "symbol": symbol,
            "interval": mapping.get(interval, "15m"),
            "limit": str(limit),
        })
        req = UrlRequest(
            "https://fapi.binance.com/fapi/v1/klines?" + query,
            headers={"User-Agent": "Dev-Trader/0.6", "Accept": "application/json"},
        )
        with urlopen(req, timeout=4) as response:
            rows = json.loads(response.read().decode("utf-8"))
        if not isinstance(rows, list) or not rows:
            raise RuntimeError("Binance kline returned no rows")
        return rows

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
            self.state.last_market_update_ts = now
            if self.state.open_interest is not None:
                self.state.oi_window.append((now, self.state.open_interest))

        elif topic.startswith("publicTrade."):
            for t in msg.get("data") or []:
                size = float(t.get("v", 0))
                self.state.cvd += size if t.get("S") == "Buy" else -size
                self.state.last_trade_ts = int(t.get("T", now))
                self.state.last_market_update_ts = now
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
                self.state.last_market_update_ts = now
                if interval == "5":
                    self.state.last_kline_5_ts = int(k.get("timestamp", now))
                elif interval == "15":
                    self.state.last_kline_15_ts = int(k.get("timestamp", now))
                else:
                    self.state.last_kline_60_ts = int(k.get("timestamp", now))

        self._trim_windows(now)
        self._refresh_data_health(now)
        await self.on_state(self.state)


class BitgetMarketStream:
    """Bitget UTA public market-data stream used as the execution venue authority.

    Critical execution inputs come from Bitget itself: last/mark/index price,
    open interest, best bid/ask, order book imbalance, public-trade CVD and
    liquidation flow. Candles are also backfilled from Bitget REST and updated
    from the Bitget WebSocket.
    """

    def __init__(self, symbol: str, on_state):
        self.symbol = symbol
        self.on_state = on_state
        self.state = MarketState(symbol=symbol)
        demo = str(os.getenv("BITGET_DEMO_TRADING", "false")).lower() in {"1", "true", "yes", "on"}
        self.url = os.getenv(
            "BITGET_PUBLIC_WS_URL",
            "wss://wspap.bitget.com/v3/ws/public" if demo else "wss://ws.bitget.com/v3/ws/public",
        )
        self.rest_base = os.getenv("BITGET_BASE_URL", "https://api.bitget.com").rstrip("/")
        self.product_type = os.getenv("BITGET_PRODUCT_TYPE", "USDT-FUTURES")
        self.stop = False
        self.last_rest_sync_ms = 0
        self.last_rest_candle_sync_ms = 0
        self.last_rest_ok = False
        self.last_upstream_error = ""
        self.last_data_source = "NONE"
        self.bids: dict[float, float] = {}
        self.asks: dict[float, float] = {}
        self.last_trade_minute: int | None = None
        self.delta_base = 0.0
        self.recent_exec_ids: set[str] = set()

    @staticmethod
    def _interval_ms(interval: str) -> int:
        return {
            "1m": 60_000,
            "3m": 180_000,
            "5m": 300_000,
            "15m": 900_000,
            "30m": 1_800_000,
            "1H": 3_600_000,
            "4H": 14_400_000,
            "6H": 21_600_000,
            "12H": 43_200_000,
            "1D": 86_400_000,
        }.get(interval, 60_000)

    async def run(self):
        while not self.stop:
            try:
                async with websockets.connect(
                    self.url,
                    ping_interval=None,
                    ping_timeout=None,
                    max_queue=10000,
                    open_timeout=8,
                    close_timeout=3,
                ) as ws:
                    self.state.ws_connected = True
                    self.state.data_health = "CONNECTING"
                    self.last_data_source = "BITGET_WS"
                    await ws.send(json.dumps({
                        "op": "subscribe",
                        "args": [
                            {"instType": self.product_type.lower(), "topic": "ticker", "symbol": self.symbol},
                            {"instType": self.product_type.lower(), "topic": "publicTrade", "symbol": self.symbol},
                            {"instType": self.product_type.lower(), "topic": "books5", "symbol": self.symbol},
                            {"instType": self.product_type.lower(), "topic": "liquidation"},
                            {"instType": self.product_type.lower(), "topic": "kline", "symbol": self.symbol, "interval": "5m"},
                            {"instType": self.product_type.lower(), "topic": "kline", "symbol": self.symbol, "interval": "15m"},
                            {"instType": self.product_type.lower(), "topic": "kline", "symbol": self.symbol, "interval": "1H"},
                        ],
                    }))
                    await self.backfill()
                    await self.on_state(self.state)
                    heartbeat = asyncio.create_task(self._heartbeat(ws))
                    try:
                        async for raw in ws:
                            if self.stop:
                                break
                            if raw == "pong":
                                continue
                            if raw == "ping":
                                await ws.send("pong")
                                continue
                            await self.handle(raw)
                    finally:
                        heartbeat.cancel()
                        self.state.ws_connected = False
                        self._refresh_data_health(int(time.time() * 1000))
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.last_upstream_error = f"Bitget WS: {str(exc)[:220]}"
                self.state.ws_connected = False
                self._refresh_data_health(int(time.time() * 1000))
                await self.on_state(self.state)
                await asyncio.sleep(2.0)

    async def _heartbeat(self, ws):
        while not self.stop:
            await asyncio.sleep(30)
            try:
                await ws.send("ping")
            except Exception:
                return

    async def rest_fallback_loop(self):
        while not self.stop:
            try:
                now = int(time.time() * 1000)
                if not self.state.ws_connected or not self.state.last_market_update_ts or now - self.state.last_market_update_ts > 2500:
                    await asyncio.to_thread(self._rest_market_sync)
                    await self.on_state(self.state)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.last_upstream_error = f"Bitget REST: {str(exc)[:220]}"
            await asyncio.sleep(2.0)

    async def backfill(self):
        try:
            await asyncio.gather(
                *(self._backfill_interval(interval, dest_name, 240)
                  for interval, dest_name in (("5m", "candles_5"), ("15m", "candles_15"), ("1H", "candles_60"))),
                self._backfill_trades(),
            )
            self.last_rest_candle_sync_ms = int(time.time() * 1000)
            self.last_rest_ok = True
            self.last_data_source = "BITGET_WS"
        except Exception as exc:
            self.last_upstream_error = f"Bitget backfill: {str(exc)[:220]}"

    async def _backfill_interval(self, interval: str, dest_name: str, limit: int):
        def fetch():
            query = urlencode({
                "category": self.product_type,
                "symbol": self.symbol,
                "interval": interval,
                "limit": str(min(limit, 1000)),
            })
            req = UrlRequest(
                self.rest_base + "/api/v3/market/candles?" + query,
                headers={"User-Agent": "Dev-Trader-Bitget/1.0", "Accept": "application/json"},
            )
            with urlopen(req, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if str(payload.get("code", "")) not in {"", "00000", "0"}:
                raise RuntimeError(f"Bitget candle error: {payload.get('msg')}")
            return payload.get("data") or []

        rows = await asyncio.to_thread(fetch)
        interval_ms = self._interval_ms(interval)
        dest = getattr(self.state, dest_name)
        now = int(time.time() * 1000)
        merged = {c.start: c for c in dest}
        for row in rows:
            start = int(row[0])
            candle = Candle(
                start=start,
                end=start + interval_ms - 1,
                open=float(row[1]),
                high=float(row[2]),
                low=float(row[3]),
                close=float(row[4]),
                volume=float(row[5]) if len(row) > 5 else 0.0,
                confirmed=start < (now // interval_ms) * interval_ms,
            )
            merged[start] = candle
        values = sorted(merged.values(), key=lambda x: x.start)
        dest.clear()
        dest.extend(values[-240:])
        setattr(self.state, {
            "5m": "last_kline_5_ts",
            "15m": "last_kline_15_ts",
            "1H": "last_kline_60_ts",
        }[interval], now)

    async def _backfill_trades(self):
        def fetch():
            query = urlencode({
                "category": self.product_type,
                "symbol": self.symbol,
                "limit": "100",
            })
            req = UrlRequest(
                self.rest_base + "/api/v3/market/fills?" + query,
                headers={"User-Agent": "Dev-Trader-Bitget/1.0", "Accept": "application/json"},
            )
            with urlopen(req, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if str(payload.get("code", "")) not in {"", "00000", "0"}:
                raise RuntimeError(f"Bitget fills error: {payload.get('msg')}")
            return payload.get("data") or []

        rows = await asyncio.to_thread(fetch)
        ordered = sorted(rows, key=lambda x: int(x.get("ts", 0)))
        self.state.cvd = 0.0
        self.state.cvd_history.clear()
        self.recent_exec_ids.clear()
        now = int(time.time() * 1000)
        for row in ordered:
            exec_id = str(row.get("execId") or row.get("i") or "")
            if exec_id:
                self.recent_exec_ids.add(exec_id)
            size = float(row.get("size") or row.get("v") or 0.0)
            side = str(row.get("side") or row.get("S") or "").lower()
            ts = int(row.get("ts") or row.get("T") or now)
            self.state.cvd += size if side == "buy" else -size if side == "sell" else 0.0
            self.state.cvd_history.append((ts, self.state.cvd))
        self.delta_base = self.state.cvd
        self.last_trade_minute = None
        if ordered:
            self.state.last_trade_ts = int(ordered[-1].get("ts") or now)

    def _rest_market_sync(self):
        query = urlencode({
            "category": self.product_type,
            "symbol": self.symbol,
        })
        req = UrlRequest(
            self.rest_base + "/api/v3/market/tickers?" + query,
            headers={"User-Agent": "Dev-Trader-Bitget/1.0", "Accept": "application/json"},
        )
        with urlopen(req, timeout=4) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if str(payload.get("code", "")) not in {"", "00000", "0"}:
            raise RuntimeError(f"Bitget ticker error: {payload.get('msg')}")
        rows = payload.get("data") or []
        if not rows:
            raise RuntimeError("Bitget ticker returned no rows")
        self._apply_ticker(rows[0], int(payload.get("requestTime") or time.time() * 1000))
        self.last_rest_sync_ms = int(time.time() * 1000)
        self.last_rest_ok = True
        # REST is continuity only. Mark it explicitly so the health gate cannot
        # accidentally call a REST-refreshed snapshot "HEALTHY" while WS data
        # is stale.
        self.last_data_source = "BITGET_REST"

    def _apply_ticker(self, d: dict, exchange_ts: int):
        for attr, keys in {
            "last_price": ("lastPrice", "lastPr"),
            "mark_price": ("markPrice",),
            "index_price": ("indexPrice",),
            "open_interest": ("openInterest", "holdingAmount"),
            "funding_rate": ("fundingRate",),
            "bid": ("bid1Price", "bidPr"),
            "ask": ("ask1Price", "askPr"),
        }.items():
            for key in keys:
                if d.get(key) not in (None, ""):
                    setattr(self.state, attr, float(d[key]))
                    break
        now = int(time.time() * 1000)
        self.state.received_ts = now
        self.state.exchange_ts = exchange_ts
        self.state.last_market_update_ts = now
        if self.state.open_interest is not None:
            self.state.oi_window.append((now, self.state.open_interest))

    def _apply_book(self, data: dict, action: str):
        if action == "snapshot":
            self.bids.clear()
            self.asks.clear()
        for row in data.get("b", []) or []:
            p, q = float(row[0]), float(row[1])
            if q == 0:
                self.bids.pop(p, None)
            else:
                self.bids[p] = q
        for row in data.get("a", []) or []:
            p, q = float(row[0]), float(row[1])
            if q == 0:
                self.asks.pop(p, None)
            else:
                self.asks[p] = q
        bids = sorted(self.bids.items(), reverse=True)[:5]
        asks = sorted(self.asks.items())[:5]
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
        self.state.liquidation_window = [(ts, side, size) for ts, side, size in self.state.liquidation_window if ts >= cutoff]
        self.state.liquidation_long_5m = sum(
            v for ts, side, v in self.state.liquidation_window
            if side == "LONG" and ts >= now - 5 * 60_000
        )
        self.state.liquidation_short_5m = sum(
            v for ts, side, v in self.state.liquidation_window
            if side == "SHORT" and ts >= now - 5 * 60_000
        )
        self.recent_exec_ids = set(list(self.recent_exec_ids)[-2000:])

    async def handle(self, raw):
        if isinstance(raw, bytes):
            return
        if raw == "pong":
            return
        try:
            msg = json.loads(raw)
        except (TypeError, ValueError):
            return
        if msg.get("event") in {"subscribe", "error"}:
            if msg.get("event") == "error":
                self.last_upstream_error = f"Bitget subscription error: {msg.get('msg', '')}"
            return

        now = int(time.time() * 1000)
        self.state.received_ts = now
        self.state.exchange_ts = int(msg.get("ts", now) or now)
        topic = str((msg.get("arg") or {}).get("topic") or "")
        if not topic:
            return

        # A real market message proves the live Bitget websocket is flowing
        # again. This flips the source back from any REST continuity state.
        self.last_data_source = "BITGET_WS"

        rows = msg.get("data") or []
        if topic == "ticker":
            if rows and isinstance(rows[0], dict):
                self._apply_ticker(rows[0], self.state.exchange_ts)
        elif topic == "publicTrade":
            for trade in rows:
                exec_id = str(trade.get("i", ""))
                if exec_id and exec_id in self.recent_exec_ids:
                    continue
                if exec_id:
                    self.recent_exec_ids.add(exec_id)
                size = float(trade.get("v", 0.0))
                side = str(trade.get("S") or "").lower()
                ts = int(trade.get("T", self.state.exchange_ts) or self.state.exchange_ts)
                if side == "buy":
                    self.state.cvd += size
                elif side == "sell":
                    self.state.cvd -= size
                self.state.last_trade_ts = ts
                self.state.last_market_update_ts = now
                minute = ts // 60_000
                if self.last_trade_minute != minute:
                    self.last_trade_minute = minute
                    self.delta_base = self.state.cvd - size if side == "buy" else self.state.cvd + size if side == "sell" else self.state.cvd
                self.state.delta_1m = self.state.cvd - self.delta_base
                self.state.cvd_history.append((ts, self.state.cvd))
        elif topic == "books5":
            if rows and isinstance(rows[0], dict):
                data = rows[0]
                self.state.orderbook_seq = int(data.get("seq", self.state.orderbook_seq or 0))
                self._apply_book(data, str(msg.get("action") or "snapshot"))
        elif topic == "liquidation":
            for liq in rows:
                side = str(liq.get("side") or "").lower()
                amount = float(liq.get("amount", 0.0))
                ts = int(liq.get("ts", self.state.exchange_ts) or self.state.exchange_ts)
                if side == "buy":
                    liquidation_side = "LONG"
                elif side == "sell":
                    liquidation_side = "SHORT"
                else:
                    continue
                self.state.liquidation_window.append((ts, liquidation_side, amount))
        elif topic == "kline":
            interval = str((msg.get("arg") or {}).get("interval") or "")
            if interval in {"5m", "15m", "1H"}:
                dest = (
                    self.state.candles_5 if interval == "5m"
                    else self.state.candles_15 if interval == "15m"
                    else self.state.candles_60
                )
                interval_ms = self._interval_ms(interval)
                for row in rows:
                    start = int(row.get("start", self.state.exchange_ts))
                    candle = Candle(
                        start=start,
                        end=start + interval_ms - 1,
                        open=float(row.get("open", 0.0)),
                        high=float(row.get("high", 0.0)),
                        low=float(row.get("low", 0.0)),
                        close=float(row.get("close", 0.0)),
                        volume=float(row.get("volume", 0.0)),
                        confirmed=start < ((now // interval_ms) * interval_ms),
                    )
                    if dest and dest[-1].start == candle.start:
                        dest[-1] = candle
                    else:
                        dest.append(candle)
                    del dest[:-240]
                if interval == "5m":
                    self.state.last_kline_5_ts = now
                elif interval == "15m":
                    self.state.last_kline_15_ts = now
                else:
                    self.state.last_kline_60_ts = now

        self._trim_windows(now)
        self._refresh_data_health(now)
        await self.on_state(self.state)

    def _refresh_data_health(self, now: int):
        market_age = now - self.state.last_market_update_ts if self.state.last_market_update_ts else 10**9
        trade_age = now - self.state.last_trade_ts if self.state.last_trade_ts else 10**9
        kline_age = now - self.state.last_kline_15_ts if self.state.last_kline_15_ts else 10**9
        if (
            self.state.ws_connected
            and self.last_data_source == "BITGET_WS"
            and market_age < 3000
            and trade_age < 3000
            and kline_age < 120_000
        ):
            self.state.data_health = "HEALTHY"
        elif self.state.ws_connected and market_age < 5000:
            # A connected socket with stale/REST-refreshed state is only
            # degraded; actionable strategy must not treat REST continuity as
            # an equivalent live microstructure feed.
            self.state.data_health = "DEGRADED"
        elif self.last_rest_ok and self.state.last_price is not None:
            self.state.data_health = "DEGRADED"
        else:
            self.state.data_health = "STALE"
