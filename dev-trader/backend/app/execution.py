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
        # Multiple emitted signals may remain open together. A reversal is
        # handled explicitly by the strategy/execution supervisor rather than
        # automatically replacing every existing position.
        self.replace_position_on_signal = False
        self.smart_reversal_enabled = os.getenv("BITGET_DEMO_SMART_REVERSAL", "true").lower() == "true"
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
        signal_id = str(signal.get("id") or "").strip()
        if signal_id and any(
            str(row.get("signal_id") or "").strip() == signal_id
            for row in self.data.get("trades", [])
        ):
            return False, "This signal has already been submitted to Bitget Demo."
        self._rotate_day()
        if self._daily_count >= self.max_daily:
            return False, "Demo daily execution cap reached."
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
        # Sync first so a just-closed position is not mistaken for an active one.
        try:
            await self.sync()
        except Exception:
            pass

        allowed, reason = self._signal_allowed(signal)
        if not allowed:
            return {"ok": False, "skipped": True, "reason": reason}

        # Every emitted StrategyEngine signal is actionable. Existing
        # same-direction trades stay open; a smart reversal, when warranted,
        # is performed by manage_signal_transition() before this method opens
        # the new signal.
        try:
            positions = await self._current_positions()
        except Exception as exc:
            return {"ok": False, "reason": f"Unable to verify Bitget position: {exc}"}

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
                self._format_price(stop, config, str(signal.get("direction")), "sl"),
                self._format_price(tp, config, str(signal.get("direction")), "tp"),
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
                    "key": f"EXECUTION_PENDING:{client_oid}",
                    "type": "EXECUTION_PENDING",
                    "execution_id": client_oid,
                    "signal_id": trade.get("signal_id"),
                    "direction": trade["direction"],
                    "setup": trade["setup"],
                    "status": "ORDER_PENDING",
                    "entry_plan": entry_plan,
                    "entry_price": 0.0,
                    "stop_loss": stop,
                    "take_profit": tp,
                    "requested_qty": qty,
                    "actual_fill_confirmed": False,
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

    async def manage_signal_transition(
        self,
        signal: dict[str, Any],
        current_price: float | None,
    ) -> dict[str, Any]:
        """Decide whether a new signal should supersede existing opposite trades.

        Same-direction setups are additive: keep existing positions and open the
        new setup. Opposite-direction setups only force a reversal when the new
        signal has materially stronger evidence and the existing trade has not
        already established meaningful profit. In hedge mode, a non-superseding
        opposite signal can coexist; in one-way mode Bitget will naturally net
        the position, so the decision is made conservatively before submission.
        """
        if not self.smart_reversal_enabled or current_price is None:
            return {"action": "KEEP", "reason": "smart reversal disabled"}
        new_direction = str(signal.get("direction") or "").upper()
        if new_direction not in {"LONG", "SHORT"}:
            return {"action": "KEEP", "reason": "invalid direction"}

        with self.lock:
            open_trades = [
                dict(row) for row in self.data.get("trades", [])
                if str(row.get("status") or "").upper() == "OPEN"
            ]
        opposite = [row for row in open_trades if str(row.get("direction") or "").upper() != new_direction]
        if not opposite:
            return {"action": "KEEP", "reason": "no opposite open trade"}

        new_conf = self._num(signal.get("confidence"))
        new_rr = self._num(signal.get("rr"))
        evidence = signal.get("evidence") if isinstance(signal.get("evidence"), dict) else {}
        aligned = 0
        if str(evidence.get("trend_15") or "").upper() == new_direction.replace("LONG","UP").replace("SHORT","DOWN"):
            aligned += 1
        if str(evidence.get("trend_60") or "").upper() == new_direction.replace("LONG","UP").replace("SHORT","DOWN"):
            aligned += 1
        if str(evidence.get("trend_240") or "").upper() == new_direction.replace("LONG","UP").replace("SHORT","DOWN"):
            aligned += 1
        expected_structure = "BULLISH" if new_direction == "LONG" else "BEARISH"
        if str(evidence.get("market_structure") or "").upper() == expected_structure:
            aligned += 1

        should_close = False
        reasons: list[str] = []
        for old in opposite:
            old_entry = self._num(old.get("entry_price") or old.get("entry_plan"))
            old_stop = self._num(old.get("stop_loss"))
            old_conf = self._num(old.get("confidence"))
            if old_entry <= 0 or old_stop <= 0:
                continue
            risk = abs(old_entry - old_stop)
            if risk <= 0:
                continue
            old_direction = str(old.get("direction") or "").upper()
            progress_r = (
                (float(current_price) - old_entry) / risk
                if old_direction == "LONG"
                else (old_entry - float(current_price)) / risk
            )
            # Once a trade has already established roughly +1.25R, do not churn
            # it merely because a counter-signal appears.
            if progress_r >= 1.25:
                reasons.append(f"{old.get('signal_id')}: protected profit {progress_r:.2f}R")
                continue

            materially_stronger = new_conf >= max(0.82, old_conf + 0.07)
            strong_rr = new_rr >= 3.0
            market_flip = aligned >= 3
            if materially_stronger and strong_rr and market_flip:
                should_close = True
                reasons.append(
                    f"{old.get('signal_id')}: reversal {new_conf:.2f} confidence, "
                    f"{aligned}/4 directional evidence, old progress {progress_r:.2f}R"
                )

        if not should_close:
            return {"action": "KEEP", "reason": "; ".join(reasons) or "reversal gate not strong enough"}

        positions = []
        try:
            positions = await self._current_positions()
        except Exception:
            positions = []
        active_positions = [row for row in positions if self._num(row.get("total"), 0.0) > 0]
        if active_positions:
            await self._close_existing_positions(active_positions)
            await self.sync()
        return {"action": "REVERSE", "reason": "; ".join(reasons)}

    async def _close_existing_positions(self, positions: list[dict[str, Any]]):
        """Close all currently open Bitget Demo positions before a new signal."""
        close_orders = []
        for row in positions:
            qty = self._num(
                row.get("total")
                or row.get("positionSize")
                or row.get("available"),
                0.0,
            )
            if qty <= 0:
                continue
            direction = self._direction_from_position(row)
            if direction not in {"LONG", "SHORT"}:
                continue
            config = await self._contract()
            formatted_qty = self._format_qty(qty, config)
            if formatted_qty == "0":
                continue
            client_oid = f"DTDEMO-CLOSE-{int(time.time() * 1000) % 100000000}"
            result = await asyncio.to_thread(
                self.client.place_market_close,
                self.symbol,
                direction,
                formatted_qty,
                client_oid,
            )
            close_orders.append((client_oid, self.client.extract_order_id(result)))

        if not close_orders:
            return

        # Market close requests are accepted asynchronously. Wait briefly for
        # Bitget's position endpoint to show zero before opening the replacement.
        for _ in range(20):
            await asyncio.sleep(0.35)
            current = await self._current_positions()
            if not any(self._num(r.get("total"), 0.0) > 0 for r in current):
                return
        raise BitgetDemoError("Bitget Demo position did not fully close before the replacement signal.");

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
                    # The exchange fill is the single source of truth for the
                    # executed entry. Keep the original signal entry separately
                    # as entry_plan so the UI never confuses a plan with a fill.
                    trade["status"] = "OPEN"
                    trade["entry_price"] = avg if avg > 0 else self._num(trade.get("entry_price") or trade.get("entry_plan"))
                    trade["filled_qty"] = filled if filled > 0 else self._num(trade.get("filled_qty") or trade.get("requested_qty"))
                    trade["exit_price"] = 0.0
                    trade["closed_ts"] = 0
                    trade["close_reason"] = ""
                    trade["actual_fill_confirmed"] = True
                    trade["exchange_order_detail"] = detail
                    trade["last_exchange_ts"] = int(time.time() * 1000)
                    fill_ts = trade["last_exchange_ts"]
                    fill_event = {
                        "key": f"EXECUTION_OPEN:{execution_id}:{fill_ts}",
                        "type": "EXECUTION_OPEN",
                        "execution_id": execution_id,
                        "signal_id": trade.get("signal_id"),
                        "direction": trade["direction"],
                        "setup": trade.get("setup"),
                        "status": "OPEN",
                        "entry_plan": self._num(trade.get("entry_plan")),
                        "entry_price": trade["entry_price"],
                        "stop_loss": self._num(trade.get("stop_loss")),
                        "take_profit": self._num(trade.get("take_profit")),
                        "filled_qty": trade["filled_qty"],
                        "actual_fill_confirmed": True,
                        "ts": fill_ts,
                        "note": "Bitget Demo market order filled; actual exchange fill price is authoritative.",
                    }
                    with self.lock:
                        self.data["last_event"] = fill_event
                        self._save()
                    self.learning.record_event(
                        trade["signal_snapshot"],
                        "EXECUTION_OPEN",
                        trade["entry_price"] or trade["entry_plan"],
                        "Bitget Demo order filled.",
                    )
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
                    trade["exit_price"] = 0.0
                    trade["closed_ts"] = 0
                    trade["close_reason"] = ""
                    trade["actual_fill_confirmed"] = True
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
        # Use the UTA diagnostic path so a valid funded Demo account is not
        # reported as disconnected because one auxiliary endpoint failed.
        status = self.client.status(self.symbol)
        status["symbol"] = self.symbol
        status["product_type"] = self.client.product_type
        status["margin_mode"] = os.getenv("BITGET_MARGIN_MODE", "isolated")
        status["open_positions"] = [
            {
                "holdSide": p.get("holdSide") or p.get("posSide"),
                "total": p.get("total") or p.get("positionSize") or p.get("available"),
                "openPriceAvg": p.get("openPriceAvg") or p.get("openAvgPrice"),
                "unrealizedPL": p.get("unrealizedPL") or p.get("unrealisedPnl"),
                "positionId": p.get("posId") or p.get("positionId"),
            }
            for p in open_positions
            if self._num(p.get("total") or p.get("positionSize") or p.get("available"), 0.0) > 0
        ]
        if balance is not None:
            status["available_balance_usdt"] = round(self._num(balance, 0.0), 4)
            status["funded"] = status["available_balance_usdt"] > 0
            if status["funded"] and status.get("ready") is not True:
                status["ready"] = True
                status["reason"] = "READY"
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
    def _price_step(config: dict[str, Any]) -> Decimal:
        """Return Bitget's exact exchange price step for this instrument.

        Bitget exposes priceEndStep as the price step length. Fall back to
        pricePlace only when priceEndStep is unavailable.
        """
        raw_step = config.get("priceEndStep")
        try:
            step = Decimal(str(raw_step))
        except (TypeError, ValueError, ArithmeticError):
            step = Decimal("0")
        if step > 0:
            return step

        try:
            places = max(0, int(DemoExecutionEngine._num(config.get("pricePlace"), 0)))
        except (TypeError, ValueError):
            places = 0
        return Decimal("1").scaleb(-places)

    @staticmethod
    def _format_price(
        value: float,
        config: dict[str, Any] | None = None,
        direction: str = "",
        role: str = "",
    ) -> str:
        """Format a protective price as an exact Bitget tick multiple.

        For a LONG, SL is rounded down and TP up; for a SHORT, SL is rounded
        up and TP down. This keeps protection on the intended side of the
        planned level while satisfying Bitget's price-step constraint.
        """
        try:
            decimal_value = Decimal(str(value))
        except (TypeError, ValueError, ArithmeticError):
            raise BitgetDemoError("Invalid protective price.")

        step = DemoExecutionEngine._price_step(config or {})
        if step <= 0:
            return f"{decimal_value:.8f}".rstrip("0").rstrip(".")

        direction = str(direction).upper()
        role = str(role).lower()
        from decimal import ROUND_CEILING, ROUND_FLOOR

        rounding = ROUND_DOWN
        if role == "sl" and direction == "LONG":
            rounding = ROUND_FLOOR
        elif role == "tp" and direction == "LONG":
            rounding = ROUND_CEILING
        elif role == "sl" and direction == "SHORT":
            rounding = ROUND_CEILING
        elif role == "tp" and direction == "SHORT":
            rounding = ROUND_FLOOR

        normalized = (decimal_value / step).to_integral_value(rounding=rounding) * step
        places = max(0, -step.as_tuple().exponent)
        quantized = normalized.quantize(step)
        return format(quantized, f".{places}f").rstrip("0").rstrip(".")

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
