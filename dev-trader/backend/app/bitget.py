from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from .observability import safe_get_retry_notice


class BitgetDemoError(RuntimeError):
    pass


class BitgetTransientError(BitgetDemoError):
    """Transport uncertainty; retry only idempotent read requests."""
    pass


class _RejectExchangeRedirects(urllib.request.HTTPRedirectHandler):
    """Never forward signed exchange headers to an unexpected redirect target."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class BitgetDemoClient:
    """Bitget Unified Trading Account (UTA v3) Futures REST client, demo-only.

    The Dev Trader key was created with UTA permissions, so all account/trading
    calls use Bitget's /api/v3 UTA endpoints. Live-money execution remains
    intentionally unsupported.
    """

    def __init__(
        self,
        api_key: str | None = None,
        api_secret: str | None = None,
        passphrase: str | None = None,
        base_url: str | None = None,
        timeout: float | None = None,
    ):
        self.api_key = api_key or os.getenv("BITGET_API_KEY", "")
        self.api_secret = api_secret or os.getenv("BITGET_API_SECRET", "")
        self.passphrase = passphrase or os.getenv("BITGET_API_PASSPHRASE", "")
        self.base_url = (base_url or os.getenv("BITGET_BASE_URL", "https://api.bitget.com")).rstrip("/")
        self.timeout = float(timeout or os.getenv("BITGET_API_TIMEOUT", "8"))
        self.product_type = os.getenv("BITGET_PRODUCT_TYPE", "USDT-FUTURES")
        self.margin_coin = os.getenv("BITGET_MARGIN_COIN", "USDT")
        self.demo = str(os.getenv("BITGET_DEMO_TRADING", "false")).lower() in {"1", "true", "yes", "on"}

    @property
    def configured(self) -> bool:
        return self.demo and bool(self.api_key and self.api_secret and self.passphrase)

    @staticmethod
    def _canonical_query(params: dict[str, Any] | None) -> str:
        if not params:
            return ""
        pairs = []
        for key in sorted(params):
            value = params[key]
            if value is None or value == "":
                continue
            pairs.append(
                f"{urllib.parse.quote(str(key), safe='-_.~')}="
                f"{urllib.parse.quote(str(value), safe='-_.~')}"
            )
        return "&".join(pairs)

    def build_signature(
        self,
        timestamp_ms: int,
        method: str,
        path: str,
        query: str = "",
        body: str = "",
    ) -> str:
        query_string = f"?{query}" if query else ""
        prehash = f"{timestamp_ms}{method.upper()}{path}{query_string}{body}"
        digest = hmac.new(
            self.api_secret.encode("utf-8"),
            prehash.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        return base64.b64encode(digest).decode("ascii")

    def _headers(self, timestamp_ms: int, signature: str) -> dict[str, str]:
        return {
            "ACCESS-KEY": self.api_key,
            "ACCESS-SIGN": signature,
            "ACCESS-TIMESTAMP": str(timestamp_ms),
            "ACCESS-PASSPHRASE": self.passphrase,
            "locale": "en-US",
            "Content-Type": "application/json",
            "Accept": "application/json",
            # Required for Bitget Demo Trading API calls.
            "paptrading": "1",
            "User-Agent": "Dev-Trader-Demo/1.1",
        }

    def _request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
        private: bool = True,
    ) -> dict[str, Any]:
        if private and not self.demo:
            raise BitgetDemoError("Bitget client is locked to demo trading. Set BITGET_DEMO_TRADING=true.")
        if private and not self.configured:
            raise BitgetDemoError("Bitget Demo API credentials are not configured.")
        # This client carries Bitget credentials in request headers. An
        # operator typo or compromised BITGET_BASE_URL must never forward them
        # to another host. Public quotes must use the same trusted authority.
        try:
            parsed = urllib.parse.urlsplit(self.base_url)
            trusted_origin = (
                parsed.scheme == "https"
                and parsed.hostname == "api.bitget.com"
                and parsed.port in (None, 443)
                and parsed.username is None and parsed.password is None
                and not parsed.path and not parsed.query and not parsed.fragment
            )
        except ValueError:
            trusted_origin = False
        if not trusted_origin:
            raise BitgetDemoError("Untrusted Bitget API origin; only official HTTPS Bitget is permitted.")

        query = self._canonical_query(params)
        body = json.dumps(payload or {}, separators=(",", ":")) if payload is not None else ""
        timestamp_ms = int(time.time() * 1000)
        url = f"{self.base_url}{path}" + (f"?{query}" if query else "")
        headers = {"Accept": "application/json", "User-Agent": "Dev-Trader-Demo/1.1"}

        if private:
            signature = self.build_signature(timestamp_ms, method, path, query, body)
            headers.update(self._headers(timestamp_ms, signature))
        if body:
            headers["Content-Type"] = "application/json"

        request = urllib.request.Request(
            url,
            data=body.encode("utf-8") if body else None,
            headers=headers,
            method=method.upper(),
        )
        try:
            # The standard urllib redirect handler may copy ACCESS-* headers
            # to the redirect destination. Reject all redirects before retry,
            # instead of sending signed requests to another authority.
            opener = urllib.request.build_opener(_RejectExchangeRedirects())
            with opener.open(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            error = BitgetTransientError if exc.code in {408, 429, 500, 502, 503, 504} else BitgetDemoError
            raise error(f"Bitget HTTP {exc.code}: {raw[:500]}") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            raise BitgetTransientError(f"Bitget network error: {exc}") from exc

        try:
            result = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise BitgetDemoError("Bitget returned non-JSON data.") from exc

        if not isinstance(result, dict):
            raise BitgetDemoError("Bitget returned an unexpected response shape.")
        if str(result.get("code", "")) not in {"", "00000", "0"}:
            raise BitgetDemoError(f"Bitget API error {result.get('code')}: {result.get('msg')}")
        return result

    @retry(
        retry=retry_if_exception_type(BitgetTransientError),
        wait=wait_exponential(multiplier=0.2, min=0.2, max=1.0),
        stop=stop_after_attempt(3),
        before_sleep=safe_get_retry_notice,
        reraise=True,
    )
    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """Bounded retries for READS ONLY. Never retry market order POST."""
        return self._request("GET", path, params=params, private=True)

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", path, payload=payload, private=True)

    @staticmethod
    def _data(result: dict[str, Any]) -> Any:
        return result.get("data") or {}

    @staticmethod
    def _list(result: dict[str, Any]) -> list[dict[str, Any]]:
        data = result.get("data") or {}
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for key in ("list", "assets", "data"):
                rows = data.get(key)
                if isinstance(rows, list):
                    return rows
        return []

    def market_ticker(self, symbol: str = "BTCUSDT") -> dict[str, Any]:
        """Read the public Bitget UTA ticker for execution-price validation."""
        result = self._request(
            "GET",
            "/api/v3/market/tickers",
            params={"category": self.product_type, "symbol": symbol},
            private=False,
        )
        rows = result.get("data") or []
        if not isinstance(rows, list) or not rows:
            raise BitgetDemoError("Bitget market ticker returned no data.")
        row = rows[0]
        return row if isinstance(row, dict) else {}

    def account(self, symbol: str = "BTCUSDT") -> dict[str, Any]:
        # UTA assets is a single unified endpoint. Fetch the asset list and
        # filter for the configured margin coin locally.
        return self._get("/api/v3/account/assets")

    def account_info(self) -> dict[str, Any]:
        data = self._data(self._get("/api/v3/account/info"))
        return data if isinstance(data, dict) else {}

    def account_settings(self) -> dict[str, Any]:
        data = self._data(self._get("/api/v3/account/settings"))
        return data if isinstance(data, dict) else {}

    def set_leverage(
        self,
        symbol: str,
        direction: str,
        leverage: int,
        margin_mode: str | None = None,
    ) -> dict[str, Any]:
        """Set futures leverage for one symbol before opening demo exposure.

        Bitget UTA v3 configures leverage per trading pair. Isolated margin also
        requires the intended position side, so fail closed rather than assuming
        the exchange account already matches the strategy.
        """
        direction = str(direction or "").upper()
        if direction not in {"LONG", "SHORT"}:
            raise BitgetDemoError("A LONG or SHORT direction is required to set leverage.")
        try:
            leverage_value = int(leverage)
        except (TypeError, ValueError) as exc:
            raise BitgetDemoError("Leverage must be an integer.") from exc
        # Independent execution boundary: never submit over 20x even when
        # a caller bypasses the higher-level sizing configuration.
        if leverage_value < 1 or leverage_value > 20:
            raise BitgetDemoError("KYVORIQ demo leverage must remain within 1x-20x.")

        raw_mode = str(margin_mode or os.getenv("BITGET_MARGIN_MODE", "isolated")).lower()
        mode = "isolated" if raw_mode == "isolated" else "crossed"
        payload = {
            "category": self.product_type,
            "symbol": symbol,
            "leverage": str(leverage_value),
            "marginMode": mode,
        }
        if mode == "isolated":
            payload["posSide"] = "long" if direction == "LONG" else "short"
        return self._post("/api/v3/account/set-leverage", payload)

    def contract_config(self, symbol: str = "BTCUSDT") -> dict[str, Any]:
        rows = self._list(
            self._get(
                "/api/v3/market/instruments",
                {"category": self.product_type, "symbol": symbol},
            )
        )
        row = dict(rows[0]) if rows else {}
        for old, new in {"volumePlace": "quantityPrecision", "pricePlace": "pricePrecision", "minTradeNum": "minOrderQty"}.items():
            if new in row:
                row[old] = row[new]
        for old, new in {"sizeMultiplier": "quantityMultiplier", "priceEndStep": "priceMultiplier"}.items():
            if new in row:
                row[old] = row[new]
        return row

    @staticmethod
    def _normalize_position(row: dict[str, Any]) -> dict[str, Any]:
        """Map UTA v3 fields at the boundary; retain the exchange originals."""
        result = dict(row)
        aliases = {
            "holdSide": "posSide", "openPriceAvg": "avgPrice",
            "openAvgPrice": "openPriceAvg", "closeAvgPrice": "closePriceAvg",
            "unrealizedPL": "unrealisedPnl", "pnl": "cumRealisedPnl",
            "openFee": "openFeeTotal", "closeFee": "closeFeeTotal",
            "ctime": "createdTime", "utime": "updatedTime",
        }
        for old, new in aliases.items():
            if new in result:
                result[old] = result[new]
        return result

    def positions(self, symbol: str = "BTCUSDT") -> list[dict[str, Any]]:
        return [self._normalize_position(row) for row in self._list(
            self._get(
                "/api/v3/position/current-position",
                {"category": self.product_type, "symbol": symbol},
            )
        )]

    def position_history(
        self,
        symbol: str = "BTCUSDT",
        start_ms: int | None = None,
        end_ms: int | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        return [self._normalize_position(row) for row in self._list(
            self._get(
                "/api/v3/position/history-position",
                {
                    "category": self.product_type,
                    "symbol": symbol,
                    "startTime": start_ms,
                    "endTime": end_ms,
                    "limit": max(1, min(int(limit), 100)),
                },
            )
        )]

    def orders_history(
        self,
        symbol: str = "BTCUSDT",
        limit: int = 100,
        start_ms: int | None = None,
        end_ms: int | None = None,
    ) -> list[dict[str, Any]]:
        page_size = max(1, min(int(limit), 100))
        cursor = None
        result = {}
        for _ in range(10):
            response = self._get("/api/v3/trade/history-orders", {
                "category": self.product_type, "symbol": symbol,
                "startTime": start_ms, "endTime": end_ms,
                "limit": page_size, "cursor": cursor,
            })
            rows = self._list(response)
            for row in rows:
                order_id = str(row.get("orderId") or "")
                if not order_id:
                    raise BitgetDemoError("Historical order is missing its ID; reconciliation is blocked.")
                result[order_id] = row
            if len(rows) < page_size:
                return list(result.values())
            data = self._data(response)
            next_cursor = str(data.get("cursor") or "") if isinstance(data, dict) else ""
            if not next_cursor or next_cursor == cursor:
                raise BitgetDemoError("Historical-order pagination is incomplete; reconciliation is blocked.")
            cursor = next_cursor
        raise BitgetDemoError("Historical-order window exceeds the verified pagination limit.")

    def order_detail(self, symbol: str, order_id: str) -> dict[str, Any]:
        data = self._data(
            self._get(
                "/api/v3/trade/order-info",
                {"orderId": order_id},
            )
        )
        return data if isinstance(data, dict) else {}

    def pending_orders(self, symbol: str = "BTCUSDT") -> list[dict[str, Any]]:
        result = self._get("/api/v3/trade/unfilled-orders", {
            "category": self.product_type, "symbol": symbol, "limit": 100,
        })
        rows = self._list(result)
        if len(rows) >= 100:
            raise BitgetDemoError("Pending-order snapshot may be truncated; reset is blocked.")
        return rows

    def strategy_orders(self, symbol: str = "BTCUSDT") -> list[dict[str, Any]]:
        rows = self._list(self._get("/api/v3/trade/unfilled-strategy-orders", {
            "category": self.product_type,
        }))
        return [r for r in rows if str(r.get("symbol", "")).upper() == symbol.upper()]

    def cancel_order(self, order_id: str) -> dict[str, Any]:
        if not order_id:
            raise BitgetDemoError("Cannot cancel an order without its exchange ID.")
        return self._post("/api/v3/trade/cancel-order", {"orderId": order_id})

    def cancel_strategy_order(self, order_id: str) -> dict[str, Any]:
        if not order_id:
            raise BitgetDemoError("Cannot cancel a strategy order without its exchange ID.")
        return self._post("/api/v3/trade/cancel-strategy-order", {"orderId": order_id})

    def place_full_stop(self, symbol: str, direction: str, stop: str, client_oid: str) -> dict[str, Any]:
        if direction not in {"LONG", "SHORT"} or self.numeric(stop) <= 0:
            raise BitgetDemoError("Full-position stop requires a valid side and trigger price.")
        payload = {"category": self.product_type, "symbol": symbol, "type": "tpsl",
                   "tpslMode": "full", "side": "sell" if direction == "LONG" else "buy",
                   "stopLoss": stop, "slTriggerBy": "mark", "slOrderType": "market", "clientOid": client_oid}
        if str(self.account_settings().get("holdMode", "")).lower() == "hedge_mode":
            payload["posSide"] = direction.lower()
        else:
            payload["reduceOnly"] = "yes"
        return self._post("/api/v3/trade/place-strategy-order", payload)

    def fills_history(self, start_ms: int, end_ms: int, max_pages: int = 10) -> dict[str, Any]:
        """Read a bounded, paginated 30-day window; never claim truncation is complete."""
        rows, cursor, seen = [], None, set()
        for _ in range(max_pages):
            result = self._get("/api/v3/trade/fills", {
                "category": self.product_type, "startTime": start_ms,
                "endTime": end_ms, "limit": 100, "cursor": cursor,
            })
            page = self._list(result)
            rows.extend(page)
            data = self._data(result)
            next_cursor = str(data.get("cursor") or "") if isinstance(data, dict) else ""
            if len(page) < 100 or not next_cursor:
                return {"rows": rows, "complete": True, "start_ts": start_ms, "end_ts": end_ms}
            if next_cursor in seen:
                break
            seen.add(next_cursor)
            cursor = next_cursor
        return {"rows": rows, "complete": False, "start_ts": start_ms, "end_ts": end_ms}

    def account_metrics(self, symbol: str = "BTCUSDT") -> dict[str, Any]:
        data = self._data(self.account(symbol))
        if not isinstance(data, dict):
            return {}
        asset = next((r for r in (data.get("assets") or []) if isinstance(r, dict)
                      and str(r.get("coin")).upper() == self.margin_coin), {})
        return {
            "equity_usdt": self.numeric(data.get("usdtEquity"), None),
            "balance_usdt": self.numeric(asset.get("balance"), None),
            "available_balance_usdt": self.numeric(asset.get("available"), None),
            "account_unrealized_usdt": self.numeric(data.get("usdtUnrealisedPnl"), None),
        }

    def fills(self, symbol: str = "BTCUSDT", order_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        return self._list(
            self._get(
                "/api/v3/trade/fills",
                {
                    "category": self.product_type,
                    "symbol": symbol,
                    "orderId": order_id,
                    "limit": max(1, min(int(limit), 100)),
                },
            )
        )

    def place_market_order(
        self,
        symbol: str,
        direction: str,
        size: str,
        stop_loss: str,
        take_profit: str,
        client_oid: str,
    ) -> dict[str, Any]:
        side = "buy" if str(direction).upper() == "LONG" else "sell"
        payload = {
            "category": self.product_type,
            "symbol": symbol,
            "side": side,
            "orderType": "market",
            "qty": size,
            "timeInForce": "gtc",
            "clientOid": client_oid,
            "reduceOnly": "no",
            "marginMode": os.getenv("BITGET_MARGIN_MODE", "isolated"),
            "takeProfit": take_profit,
            "stopLoss": stop_loss,
            "tpTriggerBy": "mark",
            "slTriggerBy": "mark",
            "tpOrderType": "market",
            "slOrderType": "market",
        }
        settings = self.account_settings()
        if str(settings.get("holdMode", "")).lower() == "hedge_mode":
            payload["posSide"] = "long" if str(direction).upper() == "LONG" else "short"
        return self._post("/api/v3/trade/place-order", payload)

    def place_market_close(
        self,
        symbol: str,
        direction: str,
        size: str,
        client_oid: str,
    ) -> dict[str, Any]:
        """Close an existing futures position with a market order.

        Bitget UTA uses the opposite side to close a position. In one-way mode
        the order must be reduce-only. In hedge mode the existing position
        side is supplied with posSide and reduceOnly is omitted.
        """
        direction = str(direction).upper()
        if direction not in {"LONG", "SHORT"}:
            raise BitgetDemoError("Invalid position direction for close.")
        side = "sell" if direction == "LONG" else "buy"
        payload = {
            "category": self.product_type,
            "symbol": symbol,
            "side": side,
            "orderType": "market",
            "qty": size,
            "timeInForce": "gtc",
            "clientOid": client_oid,
            "marginMode": os.getenv("BITGET_MARGIN_MODE", "isolated"),
        }
        settings = self.account_settings()
        hold_mode = str(settings.get("holdMode", "")).lower()
        if hold_mode == "hedge_mode":
            payload["posSide"] = "long" if direction == "LONG" else "short"
        else:
            payload["reduceOnly"] = "yes"
        return self._post("/api/v3/trade/place-order", payload)

    @staticmethod
    def extract_order_id(result: dict[str, Any]) -> str:
        data = result.get("data") or {}
        if isinstance(data, dict):
            return str(data.get("orderId") or data.get("orderID") or "")
        return ""

    @staticmethod
    def numeric(value: Any, default: float = 0.0) -> float:
        try:
            number = float(value)
            return number if math.isfinite(number) else default
        except (TypeError, ValueError):
            return default

    def available_balance(self, symbol: str = "BTCUSDT") -> float:
        data = self._data(self.account(symbol))
        assets = data.get("assets") if isinstance(data, dict) else data
        if isinstance(assets, list):
            for row in assets:
                if str(row.get("coin", "")).upper() != self.margin_coin.upper():
                    continue
                # Current UTA asset responses expose balance; older/current
                # variants may also include available-style aliases.
                for key in ("available", "availableBalance", "availableAmount", "balance"):
                    value = self.numeric(row.get(key), -1)
                    if value >= 0:
                        return value
        shape = {
            "data_type": type(data).__name__,
            "data_keys": sorted(list(data.keys())) if isinstance(data, dict) else [],
            "asset_count": len(assets) if isinstance(assets, list) else 0,
            "margin_coin": self.margin_coin,
        }
        raise BitgetDemoError(
            "Unable to read available USDT balance from Bitget UTA Demo account; "
            f"response_shape={json.dumps(shape, separators=(',', ':'))}"
        )

    def status(self, symbol: str = "BTCUSDT") -> dict[str, Any]:
        result = {
            "diagnostic_stage": "start",
            "demo_enabled": self.demo,
            "configured": self.configured,
            "api_version": "UTA_V3",
            "symbol": symbol,
            "product_type": self.product_type,
            "margin_mode": os.getenv("BITGET_MARGIN_MODE", "isolated"),
        }
        if not self.configured:
            result["ready"] = False
            result["reason"] = "Bitget Demo API credentials are not configured."
            return result

        warnings: list[str] = []
        try:
            # Account-info requires no UTA permission and is the cleanest
            # authentication/connectivity probe.
            result["diagnostic_stage"] = "account_info"
            account_info = self.account_info()
            result["account_permission_type"] = account_info.get("permType")
            result["account_permissions"] = account_info.get("permissions") or []

            # Asset balance is the funding/readiness source.
            result["diagnostic_stage"] = "assets"
            balance = self.available_balance(symbol)
            result["available_balance_usdt"] = round(balance, 4)
            result["funded"] = balance > 0

            # Settings and positions are useful diagnostics but should not
            # make an otherwise authenticated/funded Demo account appear
            # disconnected if one auxiliary endpoint is unavailable.
            result["diagnostic_stage"] = "account_settings"
            try:
                settings = self.account_settings()
                result["hold_mode"] = settings.get("holdMode")
                result["account_mode"] = settings.get("accountMode")
                result["asset_mode"] = settings.get("assetMode")
            except Exception as exc:
                warnings.append(f"account_settings: {exc}")

            result["diagnostic_stage"] = "positions"
            try:
                positions = self.positions(symbol)
                result["open_positions"] = [
                    {
                        "holdSide": p.get("holdSide") or p.get("posSide"),
                        "total": p.get("total") or p.get("available") or p.get("positionSize"),
                        "openPriceAvg": p.get("openPriceAvg") or p.get("openAvgPrice") or p.get("openAvgPx"),
                        "unrealizedPL": p.get("unrealizedPL") or p.get("unrealisedPnl"),
                        "positionId": p.get("posId") or p.get("positionId"),
                    }
                    for p in positions
                    if self.numeric(p.get("total") or p.get("positionSize") or p.get("available"), 0.0) > 0
                ]
            except Exception as exc:
                result["open_positions"] = []
                warnings.append(f"positions: {exc}")

            result["diagnostic_stage"] = "complete"
            result["ready"] = bool(balance > 0 and self.demo and self.configured)
            result["reason"] = "READY" if result["ready"] else "Bitget Demo futures balance is 0 USDT."
            if warnings:
                result["warnings"] = warnings
        except Exception as exc:
            result["ready"] = False
            result["reason"] = str(exc)
            result["error_type"] = type(exc).__name__
            try:
                print(
                    f"BITGET_DEMO_STATUS_ERROR stage={result.get('diagnostic_stage')} "
                    f"type={type(exc).__name__} reason={str(exc)[:300]}",
                    flush=True,
                )
            except Exception:
                pass
        return result
        try:
            result["diagnostic_stage"] = "account_settings"
            settings = self.account_settings()
            result["diagnostic_stage"] = "positions"
            positions = self.positions(symbol)
            result["diagnostic_stage"] = "assets"
            balance = self.available_balance(symbol)
            result["diagnostic_stage"] = "complete"
            result.update({
                "ready": balance > 0,
                "available_balance_usdt": round(balance, 4),
                "hold_mode": settings.get("holdMode"),
                "account_mode": settings.get("accountMode"),
                "open_positions": [
                    {
                        "holdSide": p.get("holdSide") or p.get("posSide"),
                        "total": p.get("total") or p.get("available") or p.get("positionSize"),
                        "openPriceAvg": p.get("openPriceAvg") or p.get("openAvgPrice") or p.get("openAvgPx"),
                        "unrealizedPL": p.get("unrealizedPL") or p.get("unrealisedPnl"),
                        "positionId": p.get("posId") or p.get("positionId"),
                    }
                    for p in positions
                    if self.numeric(p.get("total") or p.get("positionSize") or p.get("available"), 0.0) > 0
                ],
            })
            if balance <= 0:
                result["reason"] = "Bitget Demo futures balance is 0 USDT."
        except Exception as exc:
            result["ready"] = False
            result["reason"] = str(exc)
            result["error_type"] = type(exc).__name__
            try:
                print(f"BITGET_DEMO_STATUS_ERROR stage={result.get('diagnostic_stage')} type={type(exc).__name__} reason={str(exc)[:300]}", flush=True)
            except Exception:
                pass
        return result
