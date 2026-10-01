from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class BitgetDemoError(RuntimeError):
    pass


class BitgetDemoClient:
    """Minimal Bitget Classic Futures REST client, deliberately demo-only.

    Live-money execution is intentionally unsupported by this client. Every
    private request carries the Bitget demo header (paptrading=1).
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
            # Bitget requires this header for Demo Trading API requests.
            "paptrading": "1",
            "User-Agent": "Dev-Trader-Demo/1.0",
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

        query = self._canonical_query(params)
        body = json.dumps(payload or {}, separators=(",", ":")) if payload is not None else ""
        timestamp_ms = int(time.time() * 1000)
        url = f"{self.base_url}{path}" + (f"?{query}" if query else "")
        headers = {"Accept": "application/json", "User-Agent": "Dev-Trader-Demo/1.0"}

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
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            raise BitgetDemoError(f"Bitget HTTP {exc.code}: {raw[:500]}") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            raise BitgetDemoError(f"Bitget network error: {exc}") from exc

        try:
            result = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise BitgetDemoError("Bitget returned non-JSON data.") from exc

        if not isinstance(result, dict):
            raise BitgetDemoError("Bitget returned an unexpected response shape.")
        if str(result.get("code", "")) not in {"", "00000", "0"}:
            raise BitgetDemoError(f"Bitget API error {result.get('code')}: {result.get('msg')}")
        return result

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._request("GET", path, params=params, private=True)

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", path, payload=payload, private=True)

    @staticmethod
    def _data(result: dict[str, Any]) -> Any:
        return result.get("data") or {}

    @staticmethod
    def _list(result: dict[str, Any]) -> list[dict[str, Any]]:
        data = result.get("data") or {}
        rows = data.get("list") if isinstance(data, dict) else data
        return rows if isinstance(rows, list) else []

    def account(self, symbol: str = "BTCUSDT") -> dict[str, Any]:
        return self._get(
            "/api/v2/mix/account/account",
            {
                "symbol": symbol,
                "productType": self.product_type,
                "marginCoin": self.margin_coin,
            },
        )

    def contract_config(self, symbol: str = "BTCUSDT") -> dict[str, Any]:
        return self._get(
            "/api/v2/mix/market/contracts",
            {
                "productType": self.product_type,
                "symbol": symbol,
            },
        )

    def positions(self, symbol: str = "BTCUSDT") -> list[dict[str, Any]]:
        return self._list(
            self._get(
                "/api/v2/mix/position/single-position",
                {
                    "symbol": symbol,
                    "productType": self.product_type,
                    "marginCoin": self.margin_coin,
                },
            )
        )

    def position_history(
        self,
        symbol: str = "BTCUSDT",
        start_ms: int | None = None,
        end_ms: int | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        return self._list(
            self._get(
                "/api/v2/mix/position/history-position",
                {
                    "productType": self.product_type,
                    "symbol": symbol,
                    "startTime": start_ms,
                    "endTime": end_ms,
                    "limit": max(1, min(int(limit), 100)),
                },
            )
        )

    def orders_history(self, symbol: str = "BTCUSDT", limit: int = 100) -> list[dict[str, Any]]:
        return self._list(
            self._get(
                "/api/v2/mix/order/orders-history",
                {
                    "productType": self.product_type,
                    "symbol": symbol,
                    "limit": max(1, min(int(limit), 100)),
                },
            )
        )

    def order_detail(self, symbol: str, order_id: str) -> dict[str, Any]:
        data = self._data(
            self._get(
                "/api/v2/mix/order/detail",
                {
                    "productType": self.product_type,
                    "symbol": symbol,
                    "orderId": order_id,
                },
            )
        )
        return data if isinstance(data, dict) else {}

    def fills(self, symbol: str = "BTCUSDT", order_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        return self._list(
            self._get(
                "/api/v2/mix/order/fills",
                {
                    "productType": self.product_type,
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
            "symbol": symbol,
            "productType": self.product_type,
            "marginMode": os.getenv("BITGET_MARGIN_MODE", "isolated"),
            "marginCoin": self.margin_coin,
            "size": size,
            "side": side,
            "tradeSide": "open",
            "orderType": "market",
            "clientOid": client_oid,
            "reduceOnly": "NO",
            "presetStopSurplusPrice": take_profit,
            "presetStopLossPrice": stop_loss,
        }
        return self._post("/api/v2/mix/order/place-order", payload)

    @staticmethod
    def extract_order_id(result: dict[str, Any]) -> str:
        data = result.get("data") or {}
        if isinstance(data, dict):
            return str(data.get("orderId") or data.get("orderID") or "")
        return ""

    @staticmethod
    def numeric(value: Any, default: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def available_balance(self, symbol: str = "BTCUSDT") -> float:
        data = self._data(self.account(symbol))
        if isinstance(data, dict):
            for key in ("available", "availableBalance", "crossedMarginAvailable", "usdtAvailable"):
                value = self.numeric(data.get(key), -1)
                if value >= 0:
                    return value
        if isinstance(data, list):
            for row in data:
                if str(row.get("marginCoin", "")).upper() == self.margin_coin:
                    for key in ("available", "availableBalance", "crossedMarginAvailable"):
                        value = self.numeric(row.get(key), -1)
                        if value >= 0:
                            return value
        raise BitgetDemoError("Unable to read available USDT balance from Bitget Demo account.")

    def status(self, symbol: str = "BTCUSDT") -> dict[str, Any]:
        result = {
            "demo_enabled": self.demo,
            "configured": self.configured,
            "symbol": symbol,
            "product_type": self.product_type,
            "margin_mode": os.getenv("BITGET_MARGIN_MODE", "isolated"),
        }
        if not self.configured:
            result["ready"] = False
            result["reason"] = "Bitget Demo API credentials are not configured."
            return result
        try:
            positions = self.positions(symbol)
            balance = self.available_balance(symbol)
            result.update({
                "ready": True,
                "available_balance_usdt": round(balance, 4),
                "open_positions": [
                    {
                        "holdSide": p.get("holdSide"),
                        "total": p.get("total"),
                        "openPriceAvg": p.get("openPriceAvg") or p.get("openAvgPrice"),
                        "unrealizedPL": p.get("unrealizedPL"),
                        "positionId": p.get("posId") or p.get("positionId"),
                    }
                    for p in positions
                    if self.numeric(p.get("total"), 0.0) > 0
                ],
            })
        except Exception as exc:
            result["ready"] = False
            result["reason"] = str(exc)
        return result
