import asyncio
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class MarketPulseBridge:
    """Non-blocking bridge from Dev Trader to MarketPulse's durable Node core."""

    def __init__(self):
        self.base_url = str(os.getenv("MARKETPULSE_CORE_URL", "https://marketpulse-os-d4p9.onrender.com")).rstrip("/")
        self.token = str(os.getenv("DEV_TRADER_BRIDGE_TOKEN", ""))
        self.timeout = float(os.getenv("DEV_TRADER_BRIDGE_TIMEOUT", "2.5"))
        self._memory_cache: list[dict[str, Any]] = []
        self._memory_cache_ts = 0.0

    @property
    def enabled(self) -> bool:
        return bool(self.base_url and self.token)

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None, params: dict[str, Any] | None = None):
        if not self.enabled:
            return None
        url = self.base_url + path
        if params:
            query = urllib.parse.urlencode({k: v for k, v in params.items() if v not in (None, "")})
            if query:
                url += "?" + query
        headers = {
            "accept": "application/json",
            "x-dev-trader-bridge": self.token,
            "user-agent": "Dev-Trader/0.8 bridge",
        }
        data = None
        if payload is not None:
            data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            headers["content-type"] = "application/json"
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
            return None
        except Exception:
            return None

    async def _post_retry(self, path: str, payload: dict[str, Any]):
        for attempt in range(3):
            result = await asyncio.to_thread(self._request, "POST", path, payload)
            if isinstance(result, dict) and result.get("ok") is not False:
                return result
            if attempt < 2:
                await asyncio.sleep(0.4 * (attempt + 1))
        return None

    async def post_open_signal(self, signal: dict[str, Any], memory_match: dict[str, Any] | None = None):
        payload = dict(signal or {})
        payload["memoryMatch"] = memory_match
        return await self._post_retry("/api/dev-trader/learning/signal", payload)

    async def post_outcome(self, signal: dict[str, Any], outcome: str, result_r: float):
        payload = dict(signal or {})
        payload["outcome"] = outcome
        payload["resultR"] = result_r
        return await self._post_retry("/api/dev-trader/learning/outcome", payload)

    async def fetch_setup_memories(self, symbol: str):
        now = asyncio.get_running_loop().time()
        if self._memory_cache and now - self._memory_cache_ts < 10.0:
            return list(self._memory_cache)
        result = await asyncio.to_thread(
            self._request,
            "GET",
            "/api/dev-trader/setup-memory",
            None,
            {"symbol": symbol.upper()},
        )
        rows = result.get("memories", []) if isinstance(result, dict) else []
        self._memory_cache = rows if isinstance(rows, list) else []
        self._memory_cache_ts = now
        return list(self._memory_cache)

    async def fetch_open_signals(self, symbol: str):
        result = await asyncio.to_thread(
            self._request,
            "GET",
            "/api/dev-trader/learning/open",
            None,
            {"symbol": symbol.upper()},
        )
        rows = result.get("predictions", []) if isinstance(result, dict) else []
        return rows if isinstance(rows, list) else []
