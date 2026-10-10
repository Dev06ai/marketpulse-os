import asyncio
import json
import math
import os
import time
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest, urlopen

import websockets

from .models import Candle, MarketState
from .trade_profile import TradeVolumeProfile


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
        # Demo orders use authenticated Bitget PAP; observation uses the same
        # real-market public venue as the exchange-price admission REST quote.
        # The PAP public WS can have sparse books/trades on virtual markets,
        # so never depend on that feed for genuine market participation.
        # The old PAP public feed remains an explicit, reversible override.
        self.url = os.getenv(
            "BITGET_PUBLIC_WS_URL", "wss://ws.bitget.com/v3/ws/public",
        )
        known_public_sources = {
            "wss://ws.bitget.com/v3/ws/public": "LIVE_PUBLIC_MARKET_DATA",
            "wss://wspap.bitget.com/v3/ws/public": "DEMO_PUBLIC_MARKET_DATA",
        }
        if self.url not in known_public_sources:
            raise ValueError("Untrusted Bitget public market WebSocket URL; only official v3 endpoints are permitted.")
        self.public_market_venue = known_public_sources[self.url]
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
        self.last_ws_packet_ms = 0
        self.last_connected_ms = 0
        self.last_critical_reconnect_ms = 0
        self.critical_reconnect_count = 0
        self.subscription_status: dict[str, dict] = {}
        self.channel_packets: dict[str, int] = {}
        self.binary_packets = 0
        # Source provenance tracks the observed market, not the account that
        # will later simulate orders. Live-market volume must not be relabeled
        # as demo-matching-engine volume in performance evidence.
        self.volume_profile = TradeVolumeProfile(
            "BITGET_LIVE_PUBLIC_USDT_FUTURES" if self.public_market_venue == "LIVE_PUBLIC_MARKET_DATA"
            else "BITGET_DEMO_PUBLIC_USDT_FUTURES"
        )

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
                    max_queue=max(8, min(10000, int(os.getenv("BITGET_WS_MAX_QUEUE", "64")))),
                    open_timeout=8,
                    close_timeout=3,
                ) as ws:
                    self.state.ws_connected = True
                    self.state.data_health = "CONNECTING"
                    self.last_data_source = "BITGET_WS"
                    self.last_ws_packet_ms = int(time.time() * 1000)
                    self.last_connected_ms = self.last_ws_packet_ms
                    # These diagnostics describe THIS connection, not a
                    # previous socket whose subscription may have failed.
                    self.subscription_status.clear()
                    self.channel_packets.clear()
                    self._invalidate_book()
                    self.state.last_trade_ts = None
                    self.state.last_market_update_ts = None
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
                    # Consume live packets while REST history warms up. Slow
                    # backfill must not leave the socket's input queue stalled.
                    warmup = asyncio.create_task(self.backfill())
                    await self.on_state(self.state)
                    heartbeat = asyncio.create_task(self._heartbeat(ws))
                    try:
                        async for raw in ws:
                            self.last_ws_packet_ms = int(time.time() * 1000)
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
                        warmup.cancel()
                        await asyncio.gather(heartbeat, warmup, return_exceptions=True)
                        self.state.ws_connected = False
                        self.volume_profile.gap(int(time.time()*1000))
                        self._refresh_data_health(int(time.time() * 1000))
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.last_upstream_error = f"Bitget WS: {str(exc)[:220]}"
                self.state.ws_connected = False
                self.volume_profile.gap(int(time.time()*1000))
                self._refresh_data_health(int(time.time() * 1000))
                await self.on_state(self.state)
                await asyncio.sleep(2.0)

    def _invalidate_book(self):
        self.bids.clear()
        self.asks.clear()
        self.state.last_book_ts = None
        self.state.orderbook_seq = None
        self.state.book_bid_qty = self.state.book_ask_qty = self.state.book_imbalance = 0.0
        self.state.spread_bps = 0.0

    def _critical_channel_stall(self, now: int) -> str | None:
        """Distinguish healthy ticker traffic from stalled depth/trade topics.

        Read-only diagnosis. Reconnect is a bounded transport recovery, never
        permission to relax the hard 5s book or 15s trade admission gates.
        120s tolerance avoids reconnecting for ordinary brief demo inactivity.
        """
        if not self.state.ws_connected or now-self.last_connected_ms < 120_000:
            return None
        for topic, observed in (("books5", self.state.last_book_ts),
                                ("publicTrade", self.state.last_trade_ts)):
            subscription = self.subscription_status.get(topic) or {}
            if subscription.get("event") == "error":
                return topic + "_SUBSCRIPTION_ERROR"
            # An old channel cannot be declared healthy by fresh ticker
            # traffic or REST refresh. Missing trade/book counts as stale.
            if not observed or observed > now+1000 or now-observed > 120_000:
                return topic + "_NO_FRESH_DATA"
        return None

    async def _heartbeat(self, ws):
        last_ping_ms = int(time.time() * 1000)
        while not self.stop:
            await asyncio.sleep(5)
            try:
                now = int(time.time() * 1000)
                if now - self.last_ws_packet_ms > 45_000:
                    self.last_upstream_error = "Bitget WS stopped receiving packets; reconnecting."
                    await ws.close()
                    return
                stall_reason = self._critical_channel_stall(now)
                # No more than one channel-stall reconnect in five minutes.
                # Sparse demo feeds may genuinely lack matches/books; never
                # spin or falsely call stale data HEALTHY.
                if (stall_reason and
                        now-self.last_critical_reconnect_ms >= 300_000):
                    self.last_critical_reconnect_ms = now
                    self.critical_reconnect_count += 1
                    self.last_upstream_error = (
                        "Bitget public channel stale: "+stall_reason+
                        "; bounded WebSocket reconnect requested.")
                    await ws.close()
                    return
                if now - last_ping_ms >= 30_000:
                    await ws.send("ping")
                    last_ping_ms = now
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
                *(self._backfill_interval(interval, dest_name, 720 if interval == "1H" else 240)
                  for interval, dest_name in (("5m", "candles_5"), ("15m", "candles_15"), ("1H", "candles_60"))),
                self._backfill_trades(),
            )
            self.last_rest_candle_sync_ms = int(time.time() * 1000)
            self.last_rest_ok = True
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
            try:
                start = int(row[0])
                candle = Candle(
                    start=start, end=start + interval_ms - 1,
                    open=float(row[1]), high=float(row[2]), low=float(row[3]), close=float(row[4]),
                    volume=float(row[5]) if len(row) > 5 else 0.0,
                    confirmed=start < (now // interval_ms) * interval_ms,
                )
            except (TypeError, ValueError, IndexError, KeyError, OverflowError):
                continue
            if (not all(math.isfinite(v) for v in (candle.open,candle.high,candle.low,candle.close,candle.volume))
                    or not 0 < candle.low <= min(candle.open,candle.close) <= max(candle.open,candle.close) <= candle.high
                    or candle.volume < 0 or start % interval_ms != 0 or start > now):
                continue
            # Do not overwrite a concurrently received live forming candle
            # with the older REST snapshot. Past unconfirmed bars can mature.
            if start not in merged or (not merged[start].confirmed and start < (now // interval_ms) * interval_ms):
                merged[start] = candle
        values = sorted(merged.values(), key=lambda x: x.start)
        dest.clear()
        dest.extend(values[-limit:])
        # Historical REST candles warm the strategy, but they must not make the
        # live-feed health gate believe the websocket kline channel is fresh.
        # The live timestamp is updated only by Bitget websocket kline messages.


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
        if self.recent_exec_ids:
            return  # Live trades already established CVD; never reset it mid-stream.
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
        # REST tape warms CVD only. Live trade freshness requires a WS packet.

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
        parsed = {}
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
                    try:
                        value = float(d[key])
                        if not math.isfinite(value) or (attr == "open_interest" and value < 0) or (attr not in {"funding_rate", "open_interest"} and value <= 0):
                            return False
                    except (TypeError, ValueError):
                        return False
                    parsed[attr] = value
                    break
        if not any(key in parsed for key in ("last_price", "bid", "ask")):
            return False
        for attr, value in parsed.items():
            setattr(self.state, attr, value)
        now = int(time.time() * 1000)
        self.state.received_ts = now
        self.state.exchange_ts = exchange_ts
        self.state.last_market_update_ts = exchange_ts
        if self.state.open_interest is not None:
            self.state.oi_window.append((now, self.state.open_interest))
        return True

    def _apply_book(self, data: dict, action: str):
        try:
            for row in [*(data.get("b") or []), *(data.get("a") or [])]:
                price, size = float(row[0]), float(row[1])
                if not math.isfinite(price) or not math.isfinite(size) or price <= 0 or size < 0:
                    raise ValueError("Invalid order-book level")
        except (ValueError, TypeError, IndexError):
            self._invalidate_book()
            return False
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
        if not bids or not asks or bids[0][0] >= asks[0][0]:
            self._invalidate_book()
            return False
        bid_qty = sum(q for _, q in bids)
        ask_qty = sum(q for _, q in asks)
        total = bid_qty + ask_qty
        self.state.book_bid_qty = bid_qty
        self.state.book_ask_qty = ask_qty
        self.state.book_imbalance = ((bid_qty - ask_qty) / total) if total else 0.0
        if bids and asks:
            mid = (bids[0][0] + asks[0][0]) / 2.0
            self.state.spread_bps = ((asks[0][0] - bids[0][0]) / mid * 10_000) if mid else 0.0
        return True

    def _trim_windows(self, now: int):
        cutoff = now - 15 * 60_000
        self.state.oi_window = [(ts, v) for ts, v in self.state.oi_window if ts >= cutoff]
        self.state.cvd_history = [(ts, v) for ts, v in self.state.cvd_history if ts >= cutoff]
        self.state.flow_history = [row for row in self.state.flow_history if row[0] >= cutoff][-5000:]
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
            self.binary_packets += 1
            return
        if raw == "pong":
            return
        try:
            msg = json.loads(raw)
        except (TypeError, ValueError):
            return
        if not isinstance(msg, dict) or not isinstance(msg.get("arg") or {}, dict):
            return
        if msg.get("event") in {"subscribe", "error"}:
            arg = msg.get("arg") or {}
            topic = str(arg.get("topic") or arg.get("channel") or "unknown")
            self.subscription_status[topic] = {"event": msg.get("event"), "code": msg.get("code"),
                                               "message": str(msg.get("msg") or "")[:220]}
            if msg.get("event") == "error":
                self.last_upstream_error = f"Bitget subscription error: {msg.get('msg', '')}"
                if topic == "publicTrade":
                    self.volume_profile.gap(int(time.time()*1000))
            elif topic == "publicTrade":
                self.volume_profile.connect(int(time.time()*1000))
            return

        now = int(time.time() * 1000)
        self.state.received_ts = now
        try:
            exchange_ts = int(msg.get("ts", now) or now)
        except (TypeError, ValueError, OverflowError):
            return
        self.state.exchange_ts = exchange_ts
        topic = str((msg.get("arg") or {}).get("topic") or "")
        if not topic:
            return
        if len(self.channel_packets) < 12 or topic in self.channel_packets:
            self.channel_packets[topic] = self.channel_packets.get(topic, 0)+1

        # Only ticker/public-trade traffic proves the live price/trade path
        # is flowing again. A liquidation-only or acknowledgement message must
        # not let REST-refreshed state appear HEALTHY.
        rows = msg.get("data") or []
        if not isinstance(rows, list):
            return
        if topic == "ticker":
            if rows and isinstance(rows[0], dict):
                if self._apply_ticker(rows[0], self.state.exchange_ts):
                    self.last_data_source = "BITGET_WS"
        elif topic == "publicTrade":
            for trade in rows:
                try:
                    size = float(trade.get("v", 0.0))
                    price = float(trade.get("p") or 0.0)
                    side = str(trade.get("S") or "").lower()
                    ts = int(trade.get("T", self.state.exchange_ts) or self.state.exchange_ts)
                    if not all(math.isfinite(v) and v > 0 for v in (size, price)) or side not in {"buy", "sell"} or ts <= 0:
                        continue
                except (ValueError, TypeError, AttributeError):
                    continue
                exec_id = str(trade.get("i", ""))
                if exec_id and exec_id in self.recent_exec_ids:
                    continue
                if exec_id:
                    self.recent_exec_ids.add(exec_id)
                self.last_data_source = "BITGET_WS"
                if side == "buy":
                    self.state.cvd += size
                elif side == "sell":
                    self.state.cvd -= size
                self.state.last_trade_ts = ts
                if price > 0:
                    self.volume_profile.ingest(exec_id,ts,price,size,now)
                    self.state.last_price = price
                    self.state.flow_history.append((ts, price, self.state.cvd, size))
                self.state.last_market_update_ts = ts
                minute = ts // 60_000
                if self.last_trade_minute != minute:
                    self.last_trade_minute = minute
                    self.delta_base = self.state.cvd - size if side == "buy" else self.state.cvd + size if side == "sell" else self.state.cvd
                self.state.delta_1m = self.state.cvd - self.delta_base
                self.state.cvd_history.append((ts, self.state.cvd))
        elif topic == "books5":
            if rows and isinstance(rows[0], dict):
                data = rows[0]
                try:
                    sequence = int(data.get("seq", self.state.orderbook_seq or 0))
                    # Bitget data.ts is generation time; the envelope ts is
                    # push time. A delayed snapshot must retain its true age.
                    # Legacy packets may use an explicit envelope timestamp,
                    # but missing timestamps must never become receipt time.
                    book_ts = int(data.get("ts", msg.get("ts")))
                    if book_ts <= 0 or book_ts > now + 1000:
                        raise ValueError("Unverifiable depth timestamp")
                except (TypeError, ValueError, OverflowError):
                    self._invalidate_book()
                    self._refresh_data_health(now)
                    return
                if self.state.orderbook_seq and sequence and sequence <= self.state.orderbook_seq:
                    return  # A duplicate/replayed book cannot refresh depth.
                if self.state.last_book_ts and book_ts < self.state.last_book_ts:
                    return  # Regressing generation time cannot replace newer depth.
                if self._apply_book(data, str(msg.get("action") or "snapshot")):
                    self.state.orderbook_seq = sequence
                    # A replayed packet is not fresh depth just because it was
                    # received now. Admission uses this exchange timestamp.
                    self.state.last_book_ts = book_ts
        elif topic == "liquidation":
            for liq in rows:
                if not isinstance(liq, dict):
                    continue
                side = str(liq.get("side") or "").lower()
                try:
                    amount = float(liq.get("amount", 0.0))
                    ts = int(liq.get("ts", self.state.exchange_ts) or self.state.exchange_ts)
                except (TypeError, ValueError, OverflowError):
                    continue
                if not math.isfinite(amount) or amount <= 0 or not 0 <= now-ts <= 5*60_000:
                    continue
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
                accepted = False
                for row in rows:
                    try:
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
                    except (TypeError, ValueError, AttributeError):
                        continue
                    if (not all(math.isfinite(v) for v in (candle.open,candle.high,candle.low,candle.close,candle.volume))
                            or not 0 < candle.low <= min(candle.open,candle.close) <= max(candle.open,candle.close) <= candle.high
                            or candle.volume < 0 or start % interval_ms != 0 or start > now):
                        continue
                    accepted = True
                    if dest and dest[-1].start == candle.start:
                        dest[-1] = candle
                    elif not dest or dest[-1].start < candle.start:
                        dest.append(candle)
                    else:
                        # Delayed/replayed bars must not become the newest bar
                        # or alter the chronological indicator/trigger inputs.
                        by_start = {c.start: c for c in dest}
                        by_start[candle.start] = candle
                        dest[:] = sorted(by_start.values(), key=lambda c: c.start)
                    del dest[:-(720 if interval=="1H" else 240)]
                if accepted and interval == "5m":
                    self.state.last_kline_5_ts = now
                elif accepted and interval == "15m":
                    self.state.last_kline_15_ts = now
                elif accepted:
                    self.state.last_kline_60_ts = now

        self.state.trade_volume_profile = self.volume_profile.snapshot(now)
        self._trim_windows(now)
        self._refresh_data_health(now)
        await self.on_state(self.state)

    def feed_diagnostics(self) -> dict:
        now = int(time.time() * 1000)
        def age(ts):
            return now-ts if ts else None
        return {"subscriptions": self.subscription_status, "packets": self.channel_packets,
                "public_market_venue": self.public_market_venue,
                "binary_packets": self.binary_packets,
                "last_book_ts": self.state.last_book_ts,
                "quote_age_ms": age(self.state.last_market_update_ts),
                "book_age_ms": age(self.state.last_book_ts),
                "trade_age_ms": age(self.state.last_trade_ts),
                "kline_15_age_ms": age(self.state.last_kline_15_ts),
                "critical_stall": self._critical_channel_stall(now),
                "critical_reconnect_count": self.critical_reconnect_count}

    def _refresh_data_health(self, now: int):
        market_age = now - self.state.last_market_update_ts if self.state.last_market_update_ts else 10**9
        trade_age = now - self.state.last_trade_ts if self.state.last_trade_ts else 10**9
        book_age = now - self.state.last_book_ts if self.state.last_book_ts else 10**9
        kline_age = now - self.state.last_kline_15_ts if self.state.last_kline_15_ts else 10**9
        if (
            self.state.ws_connected
            and self.last_data_source == "BITGET_WS"
            and -1000 <= market_age < 3000
            and -1000 <= trade_age < 15000
            and -1000 <= book_age < 5000
            and -1000 <= kline_age < 120_000
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
