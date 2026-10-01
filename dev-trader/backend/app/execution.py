from __future__ import annotations

import asyncio
import json
import math
import os
import threading
import time
from decimal import Decimal, ROUND_DOWN
from pathlib import Path
from typing import Any, Awaitable, Callable

from .bitget import BitgetDemoClient, BitgetDemoError


class DemoExecutionEngine:
    """Demo-only autonomous executor with exchange reconciliation and learning.

    This phase deliberately has no live-money path. The exchange client itself
    rejects private execution unless BITGET_DEMO_TRADING=true.
    """

    def __init__(self, learning, bridge=None):
        self.learning = learning
        self.bridge = bridge
        self.client = BitgetDemoClient()
        self.symbol = os.getenv("SYMBOL", "BTCUSDT")
        self.risk_pct = float(os.getenv("BITGET_DEMO_RISK_PCT", "0.25"))
        self.max_notional = float(os.getenv("BITGET_DEMO_MAX_NOTIONAL_USDT", "500"))
        self.max_daily = int(os.getenv("BITGET_DEMO_MAX_DAILY_TRADES", "3"))
        self.sync_seconds = max(3.0, float(os.getenv("BITGET_EXECUTION_SYNC_SECONDS", "5")))
        self.path = Path(os.getenv("BITGET_EXECUTION_STATE_FILE", "/tmp/dev_trader_execution.json"))
        self.lock = threading.RLock()
        self.data = {
            "version": 1,
            "trades": [],
            "last_sync_ts": 0,
            "last_event": None,
            "client_status": {},
        }
        self._load()
        self._daily_anchor = self._utc_day()
        self._daily_count = self._count_today()
        self._stop = False

    @staticmethod
    def _utc_day() -> str:
        return time.strftime("%Y-%m-%d", time.gmtime())

    def _rotate_day(self):
        day = self._utc_day()
        if day != self._daily_anchor:
            self._daily_anchor = day
            self._daily_count = self._count_today()

    def _count_today(self) -> int:
        day_start = int(time.mktime(time.gmtime())) - (int(time.time()) % 86400)
        count = 0
        for row in self.data.get("trades", []):
            ts = int(row.get("opened_ts") or row.get("created_ts") or 0) // 1000
            if ts >= day_start and str(row.get("status")) != "FAILED":
                count += 1
        return count

    def _load(self):
        try:
            if self.path.exists():
                parsed = json.loads(self.path.read_text())
                if isinstance(parsed, dict):
                    self.data.update(parsed)
        except Exception:
            pass
        self.data["trades"] = list(self.data.get("trades") or [])[:500]

    def _save(self):
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, separators=(",", ":"), ensure_ascii=False))
            tmp.replace(self.path)
        except Exception:
            pass

    @property
    def enabled(self) -> bool:
        return self.client.demo

    @property
    def ready(self) -> bool:
        return self.client.configured

    def _today_trades(self) -> int:
        self._rotate_day()
        return self._daily_count

    def _open_local_trade(self) -> dict[str, Any] | None:
        for row in self.data["trades"]:
            if row.get("status") in {"ORDER_PENDING", "OPEN"}:
                return row
        return None

    @staticmethod
    def _num(value: Any, default: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _direction_from_position(row: dict[str, Any]) -> str:
        side = str(row.get("holdSide") or row.get("posSide") or row.get("side") or "").lower()
        if side == "long" or side == "buy":
            return "LONG"
        if side == "short" or side == "sell":
            return "SHORT"
        return ""

    @staticmethod
    def _normalize_qty(qty: float, config: dict[str, Any]) -> float:
        step = DemoExecutionEngine._num(config.get("sizeMultiplier"), 0.0)
        min_qty = DemoExecutionEngine._num(
            config.get("minTradeNum")
            or config.get("minOrderSize")
            or config.get("minimumOrderSize"),
            0.0,
        )
        if step <= 0:
            # Fall back to the exchange's declared decimal precision.
            places = int(DemoExecutionEngine._num(config.get("volumePlace"), 3))
            quantum = Decimal("1").scaleb(-max(0, places))
        else:
            quantum = Decimal(str(step))
        value = (Decimal(str(max(qty, 0.0))) / quantum).to_integral_value(rounding=ROUND_DOWN) * quantum
        if value < Decimal(str(min_qty or 0.0)):
            return 0.0
        return float(value)

    async def _contract(self) -> dict[str, Any]:
        result = await asyncio.to_thread(self.client.contract_config, self.symbol)
        rows = result.get("data") if isinstance(result, dict) else None
        if isinstance(rows, list) and rows:
            return rows[0]
        if isinstance(rows, dict):
            return rows
        return {}

    async def _current_positions(self) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self.client.positions, self.symbol)

    async def _risk_size(self, signal: dict[str, Any]) -> tuple[float, float, dict[str, Any]]:
        entry = self._num(signal.get("entry"))
        stop = self._num(signal.get("stop"))
        if entry <= 0 or stop <= 0 or entry == stop:
            raise BitgetDemoError("Signal has invalid entry/stop prices.")
        balance = await asyncio.to_thread(self.client.available_balance, self.symbol)
        if balance <= 0:
            raise BitgetDemoError("Bitget Demo futures balance is 0 USDT. Add demo funds before autonomous execution can open a position.")
        risk_usdt = balance * self.risk_pct / 100.0
        distance = abs(entry - stop)
        raw_qty = risk_usdt / distance
        raw_qty = min(raw_qty, self.max_notional / entry)
        config = await self._contract()
        qty = self._normalize_qty(raw_qty, config)
        min_usdt = self._num(
            config.get("minTradeUSDT")
            or config.get("minOrderAmount"),
            0.0,
        )
        if qty <= 0:
            raise BitgetDemoError("Calculated demo position is below Bitget's minimum quantity.")
        if min_usdt > 0 and qty * entry < min_usdt:
            raise BitgetDemoError(f"Calculated position is below Bitget minimum notional ({min_usdt:g} USDT).")
        return qty, risk_usdt, config

    def _signal_allowed(self, signal: dict[str, Any]) -> tuple[bool, str]:
        if not self.enabled:
            return False, "Demo execution disabled."
        if not self.ready:
            return False, "Bitget Demo API credentials are not configured."
        self._rotate_day()
        if self._daily_count >= self.max_daily:
            return False, "Demo daily execution cap reached."
        if self._open_local_trade():
            return False, "An executed demo trade is already active."
        direction = str(signal.get("direction", "")).upper()
        grade = str(signal.get("grade", "")).upper()
        rr = self._num(signal.get("rr"))
        confidence = self._num(signal.get("confidence"))
        if direction not in {"LONG", "SHORT"}:
            return False, "Signal direction is not executable."
        min_conf = float(os.getenv("QUALITY_MIN_CONFIDENCE", "0.70"))
        min_rr = float(os.getenv("QUALITY_MIN_RR", "3.0"))
        if grade and grade != "A":
            return False, "Only Grade-A signals are eligible for demo execution."
        if confidence < min_conf:
            return False, f"Confidence {confidence:.2f} is below demo execution threshold."
        if rr < min_rr:
            return False, f"R:R {rr:.2f} is below demo execution threshold."
        return True, ""

    async def handle_signal(self, signal: dict[str, Any]) -> dict[str, Any]:
        allowed, reason = self._signal_allowed(signal)
        if not allowed:
            return {"ok": False, "skipped": True, "reason": reason}

        # Reconcile the exchange before opening anything. A service restart must
        # never cause Dev Trader to double-open a position.
        try:
            positions = await self._current_positions()
        except Exception as exc:
            return {"ok": False, "reason": f"Unable to verify Bitget position: {exc}"}

        if any(self._num(row.get("total"), 0.0) > 0 for row in positions):
            return {"ok": False, "skipped": True, "reason": "Bitget already has an open futures position."}

        try:
            qty, risk_usdt, config = await self._risk_size(signal)
            entry_plan = self._num(signal.get("entry"))
            stop = self._num(signal.get("stop"))
            tp = self._num(signal.get("target2") or signal.get("target") or signal.get("target1"))
            client_oid = f"DTDEMO-{str(signal.get('id', 'signal'))[:24]}-{int(time.time() * 1000) % 100000000}"
            result = await asyncio.to_thread(
                self.client.place_market_order,
                self.symbol,
                signal.get("direction"),
                self._format_qty(qty, config),
                self._format_price(stop),
                self._format_price(tp),
                client_oid,
            )
            order_id = self.client.extract_order_id(result)
            now = int(time.time() * 1000)
            trade = {
                "execution_id": client_oid,
                "signal_id": signal.get("id"),
                "client_oid": client_oid,
                "order_id": order_id,
                "symbol": self.symbol,
                "direction": str(signal.get("direction")).upper(),
                "setup": signal.get("setup"),
                "trade_style": signal.get("trade_style"),
                "grade": signal.get("grade"),
                "confidence": signal.get("confidence"),
                "rr": signal.get("rr"),
                "entry_plan": entry_plan,
                "stop_loss": stop,
                "take_profit": tp,
                "target1": signal.get("target1"),
                "requested_qty": qty,
                "filled_qty": 0.0,
                "entry_price": 0.0,
                "exit_price": 0.0,
                "risk_pct": self.risk_pct,
                "planned_risk_usdt": risk_usdt,
                "realized_pnl_usdt": 0.0,
                "net_profit_usdt": 0.0,
                "fees_usdt": 0.0,
                "funding_usdt": 0.0,
                "status": "ORDER_PENDING",
                "opened_ts": now,
                "closed_ts": 0,
                "close_reason": "",
                "position_id": "",
                "exchange_order": result.get("data") if isinstance(result, dict) else {},
                "learning_review": None,
                "error": "",
                "signal_snapshot": signal,
            }
            with self.lock:
                self.data["trades"].insert(0, trade)
                self.data["trades"] = self.data["trades"][:500]
                self._daily_count += 1
                self.data["last_event"] = {
                    "key": f"EXECUTION_OPEN:{client_oid}",
                    "type": "EXECUTION_OPEN",
                    "execution_id": client_oid,
                    "direction": trade["direction"],
                    "setup": trade["setup"],
                    "status": "ORDER_PENDING",
                    "ts": now,
                }
                self._save()
            if self.bridge:
                try:
                    await self.bridge.post_open_signal(signal, signal.get("evidence", {}).get("memory_match"))
                except Exception:
                    pass
            await self._poll_fill(trade["execution_id"])
            return {"ok": True, "trade": dict(trade)}
        except Exception as exc:
            now = int(time.time() * 1000)
            failed = {
                "execution_id": f"DTDEMO-FAILED-{now}",
                "signal_id": signal.get("id"),
                "client_oid": "",
                "symbol": self.symbol,
                "direction": str(signal.get("direction") or "").upper(),
                "setup": signal.get("setup"),
                "status": "FAILED",
                "opened_ts": now,
                "closed_ts": now,
                "error": str(exc),
            }
            with self.lock:
                self.data["trades"].insert(0, failed)
                self.data["trades"] = self.data["trades"][:500]
                self.data["last_event"] = {
                    "key": f"EXECUTION_FAILED:{failed['execution_id']}",
                    "type": "EXECUTION_FAILED",
                    "execution_id": failed["execution_id"],
                    "direction": failed["direction"],
                    "setup": failed["setup"],
                    "status": "FAILED",
                    "note": str(exc),
                    "ts": now,
                }
                self._save()
            return {"ok": False, "reason": str(exc)}

    async def _poll_fill(self, execution_id: str):
        trade = self._trade_by_id(execution_id)
        if not trade or not trade.get("order_id"):
            return
        for _ in range(12):
            if trade.get("status") in {"OPEN", "CLOSED", "FAILED"}:
                return
            try:
                detail = await asyncio.to_thread(self.client.order_detail, self.symbol, str(trade["order_id"]))
                status = str(detail.get("state") or detail.get("orderStatus") or "").lower()
                filled = self._num(detail.get("baseVolume") or detail.get("filledQty") or detail.get("cumExecQty"))
                avg = self._num(detail.get("priceAvg") or detail.get("avgPrice") or detail.get("fillPrice"))
                if filled > 0:
                    trade["filled_qty"] = filled
                if avg > 0:
                    trade["entry_price"] = avg
                if status in {"filled", "full_fill", "full-filled"} or filled > 0:
                    trade["status"] = "OPEN"
                    trade["exchange_order_detail"] = detail
                    trade["last_exchange_ts"] = int(time.time() * 1000)
                    self.learning.record_event(
                        trade["signal_snapshot"],
                        "EXECUTION_OPEN",
                        trade["entry_price"] or trade["entry_plan"],
                        "Bitget Demo order filled.",
                    )
                    with self.lock:
                        self._save()
                    return
                if status in {"cancelled", "canceled", "rejected"}:
                    trade["status"] = "FAILED"
                    trade["error"] = f"Bitget order status: {status}"
                    with self.lock:
                        self._save()
                    return
            except Exception:
                pass
            await asyncio.sleep(0.75)

    def _trade_by_id(self, execution_id: str) -> dict[str, Any] | None:
        with self.lock:
            for row in self.data["trades"]:
                if str(row.get("execution_id")) == str(execution_id):
                    return row
        return None

    async def sync(self) -> list[dict[str, Any]]:
        if not self.enabled or not self.ready:
            return []
        newly_closed: list[dict[str, Any]] = []
        reconciliation_warnings: list[str] = []
        try:
            now = int(time.time() * 1000)
            try:
                positions = await self._current_positions()
            except Exception as exc:
                positions = []
                reconciliation_warnings.append(f"current_positions: {exc}")
            position_rows = [p for p in positions if self._num(p.get("total"), 0.0) > 0]

            # Bitget UTA v3 limits historical order/fill queries to a maximum
            # 30-day window per request. Keep reconciliation inside that window.
            history_start = max(0, now - 30 * 24 * 60 * 60 * 1000)
            try:
                history = await asyncio.to_thread(
                    self.client.position_history,
                    self.symbol,
                    history_start,
                    now,
                    100,
                )
            except Exception as exc:
                history = []
                reconciliation_warnings.append(f"position_history: {exc}")

            try:
                orders = await asyncio.to_thread(
                    self.client.orders_history,
                    self.symbol,
                    100,
                    history_start,
                    now,
                )
            except Exception as exc:
                orders = []
                reconciliation_warnings.append(f"orders_history: {exc}")

            self._merge_exchange_open_orders(orders)
            for trade in self._local_demo_trades():
                if trade.get("status") in {"FAILED", "CLOSED"}:
                    continue
                if trade.get("status") == "ORDER_PENDING":
                    await self._poll_fill(str(trade.get("execution_id")))
                direction = str(trade.get("direction", "")).upper()
                current = self._match_current_position(position_rows, direction)
                if current:
                    trade["status"] = "OPEN"
                    trade["position_id"] = str(current.get("posId") or current.get("positionId") or "")
                    trade["filled_qty"] = self._num(current.get("total") or trade.get("filled_qty"))
                    trade["entry_price"] = self._num(
                        current.get("openPriceAvg") or current.get("openAvgPrice"),
                        self._num(trade.get("entry_price") or trade.get("entry_plan"))
                    )
                    trade["unrealized_pnl_usdt"] = self._num(current.get("unrealizedPL"))
                    trade["funding_usdt"] = abs(self._num(current.get("totalFee") or current.get("deductedFee")))
                    continue

                closed = self._match_history_position(history, trade)
                if closed:
                    event = self._finalize_trade(trade, closed, orders)
                    if event:
                        newly_closed.append(event)

            with self.lock:
                self.data["last_sync_ts"] = now
                status = self._safe_status(
                    balance=None,
                    open_positions=position_rows,
                )
                if reconciliation_warnings:
                    status["reconciliation_warning"] = " | ".join(reconciliation_warnings)
                    status["history_reconciliation"] = "DEGRADED"
                else:
                    status["history_reconciliation"] = "HEALTHY"
                self.data["client_status"] = status
                self._save()
        except Exception as exc:
            with self.lock:
                self.data["client_status"] = {
                    "demo_enabled": self.enabled,
                    "configured": self.ready,
                    "ready": False,
                    "reason": str(exc),
                }
                self.data["last_sync_ts"] = int(time.time() * 1000)
                self._save()
        return newly_closed

    def _safe_status(self, balance: float | None, open_positions: list[dict[str, Any]]) -> dict[str, Any]:
        status = {
            "demo_enabled": True,
            "configured": self.ready,
            "ready": False,
            "symbol": self.symbol,
            "product_type": self.client.product_type,
            "margin_mode": os.getenv("BITGET_MARGIN_MODE", "isolated"),
            "open_positions": [
                {
                    "holdSide": p.get("holdSide"),
                    "total": p.get("total"),
                    "openPriceAvg": p.get("openPriceAvg") or p.get("openAvgPrice"),
                    "unrealizedPL": p.get("unrealizedPL"),
                    "positionId": p.get("posId") or p.get("positionId"),
                }
                for p in open_positions
            ],
        }
        if balance is not None:
            available = self._num(balance, 0.0)
        else:
            try:
                available = self._num(self.client.available_balance(self.symbol), 0.0)
            except Exception as exc:
                status["balance_error"] = str(exc)
                status["readiness_reason"] = "Bitget Demo balance check failed."
                try:
                    print(f"BITGET_DEMO_BALANCE_ERROR type={type(exc).__name__} reason={str(exc)[:400]}", flush=True)
                except Exception:
                    pass
                available = 0.0
        status["available_balance_usdt"] = round(available, 4)
        status["funded"] = available > 0
        status["ready"] = bool(self.enabled and self.ready and available > 0)
        if status["ready"]:
            status["readiness_reason"] = "READY"
        elif status.get("balance_error"):
            status["readiness_reason"] = "Bitget Demo balance check failed."
        elif self.enabled and self.ready and available <= 0:
            status["readiness_reason"] = "Add Bitget Demo USDT funds to the futures account."
        else:
            status["readiness_reason"] = "Bitget Demo API credentials are not configured."
        return status

    def _local_demo_trades(self) -> list[dict[str, Any]]:
        with self.lock:
            return [row for row in self.data["trades"] if str(row.get("client_oid", "")).startswith("DTDEMO-")]

    def _merge_exchange_open_orders(self, orders: list[dict[str, Any]]):
        known = {str(t.get("client_oid")) for t in self.data["trades"] if t.get("client_oid")}
        for order in orders:
            oid = str(order.get("clientOid") or "")
            if not oid.startswith("DTDEMO-") or oid in known:
                continue
            side = str(order.get("side") or "").lower()
            direction = "LONG" if side == "buy" else "SHORT" if side == "sell" else ""
            status = str(order.get("orderStatus") or "").lower()
            trade = {
                "execution_id": oid,
                "signal_id": oid,
                "client_oid": oid,
                "order_id": str(order.get("orderId") or ""),
                "symbol": self.symbol,
                "direction": direction,
                "setup": "BITGET DEMO",
                "trade_style": "DEMO",
                "entry_plan": self._num(order.get("price") or order.get("avgPrice")),
                "entry_price": self._num(order.get("avgPrice") or order.get("price")),
                "stop_loss": self._num(order.get("stopLoss") or order.get("presetStopLossPrice")),
                "take_profit": self._num(order.get("takeProfit") or order.get("presetStopSurplusPrice")),
                "requested_qty": self._num(order.get("qty")),
                "filled_qty": self._num(order.get("cumExecQty")),
                "status": "OPEN" if status == "filled" else "ORDER_PENDING",
                "opened_ts": self._num(order.get("createdTime"), int(time.time() * 1000)),
                "closed_ts": 0,
                "realized_pnl_usdt": 0.0,
                "net_profit_usdt": 0.0,
                "fees_usdt": 0.0,
                "funding_usdt": 0.0,
                "risk_pct": self.risk_pct,
                "planned_risk_usdt": 0.0,
                "close_reason": "",
                "signal_snapshot": {"id": oid, "setup": "BITGET DEMO", "direction": direction, "entry": self._num(order.get("avgPrice") or order.get("price")), "stop": self._num(order.get("stopLoss")), "target2": self._num(order.get("takeProfit")), "rr": 0.0, "evidence": {}},
            }
            with self.lock:
                self.data["trades"].insert(0, trade)
                known.add(oid)
        self.data["trades"] = self.data["trades"][:500]

    @staticmethod
    def _match_current_position(rows: list[dict[str, Any]], direction: str) -> dict[str, Any] | None:
        for row in rows:
            if DemoExecutionEngine._direction_from_position(row) == direction and DemoExecutionEngine._num(row.get("total"), 0.0) > 0:
                return row
        return None

    def _match_history_position(self, history: list[dict[str, Any]], trade: dict[str, Any]) -> dict[str, Any] | None:
        direction = str(trade.get("direction", "")).upper()
        opened = self._num(trade.get("opened_ts"), 0)
        candidates = []
        for row in history:
            if str(row.get("symbol", self.symbol)).upper() != self.symbol.upper():
                continue
            hold = self._direction_from_position(row)
            if hold and hold != direction:
                continue
            ctime = self._num(row.get("ctime") or row.get("openTime"), 0)
            if opened and ctime and abs(ctime - opened) > 12 * 60 * 60 * 1000:
                continue
            candidates.append(row)
        if not candidates:
            return None
        candidates.sort(key=lambda r: self._num(r.get("utime") or r.get("ctime"), 0), reverse=True)
        return candidates[0]

    def _finalize_trade(self, trade: dict[str, Any], closed: dict[str, Any], orders: list[dict[str, Any]]) -> dict[str, Any] | None:
        net = self._num(closed.get("netProfit"), self._num(closed.get("pnl"), 0.0))
        pnl = self._num(closed.get("pnl"), net)
        funding = self._num(closed.get("totalFunding"), 0.0)
        fees = self._num(closed.get("openFee"), 0.0) + self._num(closed.get("closeFee"), 0.0)
        exit_price = self._num(closed.get("closeAvgPrice"))
        entry_price = self._num(closed.get("openAvgPrice"), self._num(trade.get("entry_price") or trade.get("entry_plan")))
        trade["status"] = "CLOSED"
        trade["entry_price"] = entry_price
        trade["exit_price"] = exit_price
        trade["filled_qty"] = self._num(closed.get("closeTotalPos"), self._num(trade.get("filled_qty")))
        trade["realized_pnl_usdt"] = pnl
        trade["net_profit_usdt"] = net
        trade["fees_usdt"] = fees
        trade["funding_usdt"] = funding
        trade["closed_ts"] = self._num(closed.get("utime") or closed.get("ctime"), int(time.time() * 1000))
        trade["position_id"] = str(closed.get("positionId") or "")
        trade["close_reason"] = self._infer_close_reason(trade, closed, orders)

        planned_risk = self._num(trade.get("planned_risk_usdt"))
        result_r = net / planned_risk if planned_risk > 0 else 0.0
        trade["result_r"] = round(result_r, 4)

        snapshot = dict(trade.get("signal_snapshot") or {})
        snapshot.update({
            "entry": entry_price,
            "stop": trade.get("stop_loss"),
            "target2": trade.get("take_profit"),
            "rr": trade.get("rr", 0.0),
        })
        outcome = "TP2_REACHED" if trade["close_reason"] == "TP" else "SL_HIT" if trade["close_reason"] == "SL" else "CLOSED"
        lesson = self.learning.resolve(snapshot, outcome, result_r)
        trade["learning_review"] = lesson

        now = int(time.time() * 1000)
        event = {
            "key": f"EXECUTION_CLOSED:{trade['execution_id']}",
            "type": "EXECUTION_CLOSED",
            "execution_id": trade["execution_id"],
            "signal_id": trade.get("signal_id"),
            "direction": trade.get("direction"),
            "setup": trade.get("setup"),
            "entry_price": entry_price,
            "exit_price": exit_price,
            "stop_loss": trade.get("stop_loss"),
            "take_profit": trade.get("take_profit"),
            "realized_pnl_usdt": round(pnl, 6),
            "net_profit_usdt": round(net, 6),
            "result_r": round(result_r, 4),
            "close_reason": trade["close_reason"],
            "status": "CLOSED",
            "ts": now,
            "learning_review": lesson,
        }
        with self.lock:
            self.data["last_event"] = event
            self._save()
        if self.bridge:
            try:
                awaitable = self.bridge.post_outcome(snapshot, outcome, result_r)
                # Caller is sync; schedule the coroutine when an event loop exists.
                asyncio.create_task(awaitable)
            except Exception:
                pass
        return event

    @staticmethod
    def _infer_close_reason(trade: dict[str, Any], closed: dict[str, Any], orders: list[dict[str, Any]]) -> str:
        closed_ts = DemoExecutionEngine._num(closed.get("utime") or closed.get("ctime"), 0)
        relevant = []
        for order in orders:
            if str(order.get("symbol", "")).upper() != str(trade.get("symbol", "")).upper():
                continue
            updated = DemoExecutionEngine._num(order.get("updatedTime") or order.get("createdTime"), 0)
            if closed_ts <= 0 or updated <= 0 or abs(updated - closed_ts) <= 10 * 60 * 1000:
                relevant.append(order)
        text = " ".join(
            str(order.get("execType") or order.get("delegateType") or order.get("orderType") or "")
            for order in relevant
        ).lower()
        if any(x in text for x in ("stop_loss", "stop-loss", "stoploss", "loss_market", "sl")):
            return "SL"
        if any(x in text for x in ("take_profit", "take-profit", "takeprofit", "profit_market", "tp")):
            return "TP"

        close_price = DemoExecutionEngine._num(closed.get("closeAvgPrice"))
        tp = DemoExecutionEngine._num(trade.get("take_profit"))
        sl = DemoExecutionEngine._num(trade.get("stop_loss"))
        direction = str(trade.get("direction", "")).upper()
        if close_price > 0 and tp > 0:
            if direction == "LONG" and close_price >= tp * 0.9995:
                return "TP"
            if direction == "SHORT" and close_price <= tp * 1.0005:
                return "TP"
        if close_price > 0 and sl > 0:
            if direction == "LONG" and close_price <= sl * 1.0005:
                return "SL"
            if direction == "SHORT" and close_price >= sl * 0.9995:
                return "SL"
        return "UNKNOWN"

    @staticmethod
    def _format_qty(value: float, config: dict[str, Any]) -> str:
        places = int(DemoExecutionEngine._num(config.get("volumePlace"), 6))
        return f"{value:.{max(0, min(12, places))}f}".rstrip("0").rstrip(".") or "0"

    @staticmethod
    def _format_price(value: float) -> str:
        return f"{value:.8f}".rstrip("0").rstrip(".")

    def history(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.lock:
            rows = [dict(row) for row in self.data["trades"]]
        rows.sort(key=lambda row: self._num(row.get("closed_ts") or row.get("opened_ts"), 0), reverse=True)
        return rows[: max(1, min(int(limit), 500))]

    def summary(self) -> dict[str, Any]:
        rows = self.history(500)
        closed = [r for r in rows if r.get("status") == "CLOSED"]
        wins = [r for r in closed if self._num(r.get("net_profit_usdt")) > 0]
        losses = [r for r in closed if self._num(r.get("net_profit_usdt")) < 0]
        gross_profit = sum(self._num(r.get("net_profit_usdt")) for r in wins)
        gross_loss = abs(sum(self._num(r.get("net_profit_usdt")) for r in losses))
        total_net = sum(self._num(r.get("net_profit_usdt")) for r in closed)
        total_r = sum(self._num(r.get("result_r")) for r in closed)
        return {
            "demo_enabled": self.enabled,
            "configured": self.ready,
            "ready": bool((self.data.get("client_status") or {}).get("ready", False)),
            "trades": len(closed),
            "open_trades": len([r for r in rows if r.get("status") in {"OPEN", "ORDER_PENDING"}]),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": round(len(wins) / len(closed), 3) if closed else None,
            "total_net_profit_usdt": round(total_net, 4),
            "gross_profit_usdt": round(gross_profit, 4),
            "gross_loss_usdt": round(gross_loss, 4),
            "profit_factor": round(gross_profit / gross_loss, 3) if gross_loss > 0 else None,
            "total_r": round(total_r, 4),
            "daily_executions": self._today_trades(),
            "daily_cap": self.max_daily,
            "risk_pct": self.risk_pct,
            "max_notional_usdt": self.max_notional,
            "last_sync_ts": self.data.get("last_sync_ts", 0),
            "client_status": self.data.get("client_status") or {},
        }

    def snapshot(self) -> dict[str, Any]:
        return {
            "mode": "BITGET_DEMO",
            "summary": self.summary(),
            "recent_trades": self.history(8),
            "last_event": self.data.get("last_event"),
        }

    async def run(self):
        if not self.enabled or not self.ready:
            return
        while not self._stop:
            await self.sync()
            await asyncio.sleep(self.sync_seconds)

    def stop(self):
        self._stop = True
