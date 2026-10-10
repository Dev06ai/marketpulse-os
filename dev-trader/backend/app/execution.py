from __future__ import annotations

import asyncio
import json
import math
import os
import threading
import time
import hashlib
from decimal import Decimal, ROUND_DOWN, ROUND_UP
from pathlib import Path
from typing import Any, Awaitable, Callable

from .bitget import BitgetDemoClient, BitgetDemoError
from .ledger import build_fill_ledger
from .protection import stop_coverage
from .trade_identity import client_identity, decode_identity
from .risk import DEFAULT_RISK_PCT, MAX_RISK_PCT


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
        self.session_start_ms = int(os.getenv("DEMO_SESSION_START_MS", "0") or 0)
        self.session_baseline = self._num(os.getenv("DEMO_SESSION_BASELINE_EQUITY_USDT", "0"))
        configured_leverage = int(os.getenv("BITGET_DEMO_LEVERAGE", "20"))
        if configured_leverage < 1:
            raise ValueError("BITGET_DEMO_LEVERAGE must be at least 1.")
        # Operator permits up to 20x; lower explicitly selected leverage is
        # respected. A stale high-leverage setting cannot exceed this ceiling.
        self.leverage = min(configured_leverage, 20)
        self.medium_margin_min = float(os.getenv("BITGET_DEMO_MEDIUM_MARGIN_MIN_USDT", "50"))
        self.medium_margin_max = float(os.getenv("BITGET_DEMO_MEDIUM_MARGIN_MAX_USDT", "75"))
        self.high_margin_min = float(os.getenv("BITGET_DEMO_HIGH_MARGIN_MIN_USDT", "76"))
        self.high_margin_max = float(os.getenv("BITGET_DEMO_HIGH_MARGIN_MAX_USDT", "100"))
        self.high_confidence_threshold = float(os.getenv("BITGET_DEMO_HIGH_CONFIDENCE", "0.85"))
        if not (0 < self.medium_margin_min <= self.medium_margin_max < self.high_margin_min <= self.high_margin_max):
            raise ValueError("Demo confidence-margin bands are invalid.")
        if not 0.70 <= self.high_confidence_threshold < 1.0:
            raise ValueError("BITGET_DEMO_HIGH_CONFIDENCE must be between 0.70 and 1.0.")
        requested_risk_pct = float(os.getenv("BITGET_DEMO_MAX_PLANNED_LOSS_PCT", str(DEFAULT_RISK_PCT)))
        if not math.isfinite(requested_risk_pct) or requested_risk_pct <= 0:
            raise ValueError("BITGET_DEMO_MAX_PLANNED_LOSS_PCT must be finite and positive.")
        self.max_planned_loss_pct = min(requested_risk_pct, MAX_RISK_PCT)
        self.risk_pct = self.max_planned_loss_pct
        self.margin_reserve = max(0.0, float(os.getenv("BITGET_DEMO_MARGIN_RESERVE_USDT", "25")))
        # New key intentionally supersedes the old 500-USDT notional cap from the
        # previous risk-sized executor. At 20x, a 100-USDT margin target needs
        # about 2,000 USDT notional.
        self.max_notional = float(os.getenv(
            "BITGET_DEMO_CONFIDENCE_MAX_NOTIONAL_USDT",
            str(self.high_margin_max * self.leverage),
        ))
        self.max_daily = int(os.getenv("BITGET_DEMO_MAX_DAILY_TRADES", "3"))
        # The feed does not force reversals: admission requires flat exposure.
        self.replace_position_on_signal = False
        self.smart_reversal_enabled = os.getenv("BITGET_DEMO_SMART_REVERSAL", "true").lower() == "true"
        self.sync_seconds = max(3.0, float(os.getenv("BITGET_EXECUTION_SYNC_SECONDS", "5")))
        self.path = Path(os.getenv("BITGET_EXECUTION_STATE_FILE", "/tmp/dev_trader_execution.json"))
        self.lock = threading.RLock()
        self._submission_lock = asyncio.Lock()
        self._sync_lock = asyncio.Lock()
        self._sync_generation = 0
        self._protection_lock = asyncio.Lock()
        self.entry_guard: Callable[[dict[str, Any]], tuple[bool, str]] | None = None
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
        day_start = int(time.time()) // 86400 * 86400
        count = 0
        for row in self.data.get("trades", []):
            opened_ms = int(self._num(row.get("opened_ts") or row.get("created_ts")))
            if opened_ms >= self.session_start_ms and opened_ms // 1000 >= day_start and str(row.get("status")) != "FAILED":
                count += 1
        return count

    def _load(self):
        # A corrupt/truncated journal is a risk event, not proof that the
        # exchange is flat or that previously sent orders never existed.
        # Preserve the original file for recovery; never overwrite it.
        try:
            if self.path.exists():
                parsed = json.loads(self.path.read_text(encoding="utf-8"))
                if (not isinstance(parsed, dict) or
                        not isinstance(parsed.get("trades", []), list) or
                        any(not isinstance(row, dict) for row in parsed.get("trades", []))):
                    raise ValueError("Malformed execution journal structure")
                self.data.update(parsed)
        except Exception:
            self.data["persistence_halt"] = (
                "Cannot verify saved demo execution history. "
                "Preserve the journal and reconcile with Bitget before new entries."
            )
            self.data["trades"] = []
            return
        # Pending/open/unknown orders cannot be dropped due to a history cap.
        # Limit only terminal CLOSED/FAILED records in working memory.
        rows = list(self.data.get("trades") or [])
        terminal_seen = 0
        retained = []
        for row in rows:
            if row.get("status") in {"CLOSED", "FAILED"}:
                terminal_seen += 1
                if terminal_seen > 500:
                    continue
            retained.append(row)
        self.data["trades"] = retained
        intent = self.data.pop("pending_submission", None)
        if intent:
            if not isinstance(intent, dict):
                self.data["persistence_halt"] = "Corrupted in-flight order intent; operator reconciliation required."
                return
            if not any(t.get("client_oid") == intent.get("client_oid") for t in self.data["trades"]):
                self.data["trades"].insert(0, dict(intent, status="SUBMISSION_UNKNOWN",
                    error="Restart during order submission; exchange outcome must be reconciled."))
            # Make the crash-recovered unknown intent durable immediately,
            # including on a second restart before the first sync finishes.
            if not self._save():
                self.data["persistence_halt"] = (
                    "Cannot persist recovered demo order intent; block new exposure."
                )

    def _save(self):
        # A background sync must never overwrite an existing corrupt journal.
        # Keep its forensic contents until an authorized manual restoration.
        if self.data.get("persistence_halt"):
            return False
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, separators=(",", ":"), ensure_ascii=False))
            tmp.replace(self.path)
            return True
        except Exception:
            return False

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
            if self._num(row.get("opened_ts")) >= self.session_start_ms and row.get("status") in {"ORDER_PENDING", "OPEN", "RECONCILIATION_PENDING", "SUBMISSION_UNKNOWN"}:
                return row
        return None

    @staticmethod
    def _num(value: Any, default: float = 0.0) -> float:
        try:
            number = float(value)
            return number if math.isfinite(number) else default
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

    @staticmethod
    def _normalize_qty_up(qty: float, config: dict[str, Any]) -> float:
        step = DemoExecutionEngine._num(config.get("sizeMultiplier"), 0.0)
        min_qty = DemoExecutionEngine._num(
            config.get("minTradeNum")
            or config.get("minOrderSize")
            or config.get("minimumOrderSize"),
            0.0,
        )
        if step <= 0:
            places = int(DemoExecutionEngine._num(config.get("volumePlace"), 3))
            quantum = Decimal("1").scaleb(-max(0, places))
        else:
            quantum = Decimal(str(step))
        base = max(qty, min_qty or 0.0, 0.0)
        value = (Decimal(str(base)) / quantum).to_integral_value(rounding=ROUND_UP) * quantum
        return float(value)

    def _confidence_margin_target(self, confidence: float) -> tuple[float, float, float, str]:
        min_conf = float(os.getenv("QUALITY_MIN_CONFIDENCE", "0.70"))
        if not math.isfinite(confidence) or confidence < min_conf:
            raise BitgetDemoError("Signal confidence is below the demo execution threshold.")
        if confidence < self.high_confidence_threshold:
            span = max(self.high_confidence_threshold - min_conf, 1e-9)
            progress = min(1.0, max(0.0, (confidence - min_conf) / span))
            target = self.medium_margin_min + progress * (self.medium_margin_max - self.medium_margin_min)
            return target, self.medium_margin_min, self.medium_margin_max, "MEDIUM"
        span = max(1.0 - self.high_confidence_threshold, 1e-9)
        progress = min(1.0, max(0.0, (confidence - self.high_confidence_threshold) / span))
        target = self.high_margin_min + progress * (self.high_margin_max - self.high_margin_min)
        return target, self.high_margin_min, self.high_margin_max, "HIGH"

    async def _contract(self) -> dict[str, Any]:
        result = await asyncio.to_thread(self.client.contract_config, self.symbol)
        rows = result.get("data") if isinstance(result, dict) else None
        if isinstance(rows, list) and rows:
            return rows[0]
        if isinstance(rows, dict):
            return rows
        # The client already unwraps and normalizes the v3 instrument response.
        if isinstance(result, dict) and result:
            return result
        raise BitgetDemoError("Bitget instrument rules are unavailable; position sizing is blocked.")

    async def _current_positions(self) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self.client.positions, self.symbol)

    async def _sizing_balance_and_risk_cap(self) -> tuple[float, float]:
        balance = await asyncio.to_thread(self.client.available_balance, self.symbol)
        if not math.isfinite(balance) or balance <= 0:
            raise BitgetDemoError("Bitget Demo futures balance is 0 USDT. Add demo funds before autonomous execution can open a position.")
        account = self.data.get("account_metrics") or {}
        equity = self._num(account.get("equity_usdt"))
        balance = min(balance, equity) if equity > 0 else balance
        peak = self._num(account.get("observed_peak_usdt"), equity)
        risk_factor = 0.5 if peak > 0 and equity > 0 and equity < peak * 0.98 else 1.0
        per_trade_cap = balance * self.max_planned_loss_pct * risk_factor / 100.0

        # Only apply a prospective UTC daily-loss budget when the private
        # account refresh has established an authoritative current-day equity
        # anchor. Inventing a day-open value from available balance can turn
        # incomplete startup/test data into a false zero-risk lock.
        loss_limit_pct = max(0.0, float(os.getenv("BITGET_DEMO_MAX_DAILY_LOSS_PCT", "1.0")))
        day_equity = self._num(account.get("utc_day_open_equity_usdt"))
        authoritative_day = (
            account.get("utc_day") == self._utc_day()
            and day_equity > 0
            and equity > 0
        )
        if not authoritative_day or loss_limit_pct <= 0:
            return balance, per_trade_cap

        daily_cap = day_equity * loss_limit_pct / 100.0
        day_start = int(time.time()) // 86400 * 86400000
        ledger = self.data.get("fill_ledger") or {}
        if ledger.get("complete_window") and ledger.get("fee_accounting_complete"):
            daily_net = self._num((ledger.get("daily_net_usdt") or {}).get(str(day_start)))
        else:
            daily_net = sum(
                self._num(row.get("net_profit_usdt"))
                for row in self.data.get("trades", [])
                if row.get("status") == "CLOSED" and self._num(row.get("closed_ts")) >= day_start
            )

        # Today's profits never expand the allowed loss budget. Both realized
        # losses and live equity drawdown constrain the next planned stop.
        realized_remaining = max(0.0, daily_cap - max(0.0, -daily_net))
        equity_drawdown = max(0.0, day_equity - equity)
        equity_remaining = max(0.0, daily_cap - equity_drawdown)
        return balance, min(per_trade_cap, realized_remaining, equity_remaining)

    async def _risk_size(self, signal: dict[str, Any]) -> tuple[float, float, dict[str, Any]]:
        entry = self._num(signal.get("entry"))
        stop = self._num(signal.get("stop"))
        confidence = self._num(signal.get("confidence"))
        if entry <= 0 or stop <= 0 or entry == stop:
            raise BitgetDemoError("Signal has invalid entry/stop prices.")

        balance, risk_cap = await self._sizing_balance_and_risk_cap()

        target_margin, _, band_max, band = self._confidence_margin_target(confidence)
        spendable = max(0.0, balance - self.margin_reserve)
        if spendable <= 0:
            raise BitgetDemoError("Available demo margin cannot preserve the configured reserve.")
        target_margin = min(target_margin, spendable, band_max)
        target_notional = min(target_margin * self.leverage, self.max_notional)
        config = await self._contract()
        distance = abs(entry - stop)
        fee_rate = max(0.0, float(os.getenv("BITGET_DEMO_TAKER_FEE_RATE", "0.0006")))
        unit_risk = distance + (entry + stop) * fee_rate
        # Margin is a preference, never a reason to round UP exposure. Equity,
        # remaining daily loss budget, reserve and exchange increments dominate.
        qty = self._normalize_qty(min(target_notional / entry, risk_cap / unit_risk), config)
        actual_margin = qty * entry / self.leverage if qty > 0 else 0.0
        planned_risk = qty * unit_risk

        min_usdt = self._num(config.get("minTradeUSDT") or config.get("minOrderAmount"), 0.0)
        if qty <= 0:
            raise BitgetDemoError("Exchange minimum quantity cannot fit within the stop/fee risk guard and margin limits.")
        if min_usdt > 0 and qty * entry < min_usdt:
            raise BitgetDemoError(f"Calculated position is below Bitget minimum notional ({min_usdt:g} USDT).")
        if planned_risk > risk_cap + 1e-9 or actual_margin > min(spendable, band_max) + 1e-6:
            raise BitgetDemoError(
                f"Exchange quantity precision exceeds the {band} margin or stop/fee risk guard."
            )
        return qty, planned_risk, config

    def _signal_allowed(self, signal: dict[str, Any], *, reconciliation_locked: bool = False) -> tuple[bool, str]:
        if os.getenv("DEMO_EXECUTION_PAUSED", "false").lower() == "true" or os.getenv("DEMO_RESET_REQUEST_MS", ""):
            return False, "Operator demo reset/test preparation is paused; no new exposure is admitted."
        if self.data.get("persistence_halt"):
            return False, "Saved execution history or order intent could not be verified; new entries halted."
        if self.data.get("protection_halt"):
            return False, "Exchange stop protection could not be verified; operator review is required."
        if self.data.get("ledger_error"):
            return False, "Exchange accounting refresh failed; risk admission waits for verified data."
        ledger = self.data.get("fill_ledger") or {}
        if hasattr(self.client, "fills_history") and not (ledger.get("complete_window") and ledger.get("fee_accounting_complete")):
            return False, "The exchange fill/fee window is incomplete; new risk is blocked."
        if self._sync_lock.locked() and not reconciliation_locked:
            return False, "Exchange reconciliation is in progress; wait for a verified snapshot."
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
        account = self.data.get("account_metrics") or {}
        day_equity = self._num(account.get("utc_day_open_equity_usdt"))
        equity = self._num(account.get("equity_usdt"))
        if account.get("utc_day") == self._utc_day() and day_equity > 0 and 0 < equity <= day_equity * 0.99:
            return False, "Observed account equity fell 1% today; entries paused until the next UTC day."
        if self._daily_count >= self.max_daily:
            return False, "Demo daily execution cap reached."
        day_start = int(time.time()) // 86400 * 86400000
        closed_today = sorted(
            [r for r in self.data.get("trades", []) if r.get("status") == "CLOSED" and self._num(r.get("opened_ts")) >= self.session_start_ms and self._num(r.get("closed_ts")) >= day_start],
            key=lambda r: self._num(r.get("closed_ts")), reverse=True,
        )
        # Two losing executions pause entries until the next UTC risk day.
        if len(closed_today) >= 2 and all(self._num(r.get("net_profit_usdt")) < 0 for r in closed_today[:2]):
            return False, "Two consecutive demo losses today; entries paused until the next UTC day."
        daily_net = sum(self._num(r.get("net_profit_usdt")) for r in closed_today)
        ledger = self.data.get("fill_ledger") or {}
        if ledger.get("complete_window") and ledger.get("fee_accounting_complete"):
            # Fill accounting includes opening fees and partial exits omitted
            # by unresolved per-entry records. Do not sum both representations.
            fill_net = self._num((ledger.get("daily_net_usdt") or {}).get(str(day_start)))
            daily_net = min(daily_net, fill_net)
        balance = self._num((self.data.get("client_status") or {}).get("available_balance_usdt"))
        loss_limit = max(0.0, float(os.getenv("BITGET_DEMO_MAX_DAILY_LOSS_PCT", "1.0")))
        daily_base = day_equity if day_equity > 0 else (equity if equity > 0 else balance)
        if daily_base > 0 and daily_net < 0 and abs(daily_net) >= daily_base * loss_limit / 100:
            return False, "Demo daily loss limit reached; entries paused until the next UTC day."
        direction = str(signal.get("direction", "")).upper()
        grade = str(signal.get("grade", "")).upper()
        rr = self._num(signal.get("rr"))
        confidence = self._num(signal.get("confidence"))
        if direction not in {"LONG", "SHORT"}:
            return False, "Signal direction is not executable."
        min_conf = float(os.getenv("QUALITY_MIN_CONFIDENCE", "0.70"))
        min_rr = max(2.5, float(os.getenv("QUALITY_MIN_RR", "3.0")))
        if not signal_id:
            return False, "An execution signal ID is required."
        if grade != "A":
            return False, "Only Grade-A signals are eligible for demo execution."
        if confidence < min_conf:
            return False, f"Confidence {confidence:.2f} is below demo execution threshold."
        if rr < min_rr:
            return False, f"R:R {rr:.2f} is below demo execution threshold."
        learned = self.learning.decision_filter(signal) if hasattr(self.learning, "decision_filter") else {}
        if learned.get("allow") is False:
            return False, "Historical setup veto: " + str(learned.get("reason") or "negative observed edge")
        created = self._num(signal.get("created_ts"))
        if created and (int(time.time() * 1000) - created > 15000 or created > int(time.time() * 1000) + 5000):
            return False, "Signal timestamp is stale or invalid."
        if self.entry_guard:
            return self.entry_guard(signal)
        return True, ""

    async def _validate_execution_price(self, signal: dict[str, Any]) -> tuple[float, float]:
        """Validate the signal against Bitget's live public execution market."""
        entry = self._num(signal.get("entry"))
        stop = self._num(signal.get("stop"))
        target = self._num(signal.get("target2") or signal.get("target") or signal.get("target1"))
        direction = str(signal.get("direction") or "").upper()
        if entry <= 0 or stop <= 0 or target <= 0 or direction not in {"LONG", "SHORT"}:
            raise BitgetDemoError("Signal has invalid execution-price geometry.")

        ticker = await asyncio.to_thread(self.client.market_ticker, self.symbol)
        exchange_price = self._num(ticker.get("lastPrice") or ticker.get("lastPr"))
        bid = self._num(ticker.get("bid1Price") or ticker.get("bidPrice") or ticker.get("bidPr"))
        ask = self._num(ticker.get("ask1Price") or ticker.get("askPrice") or ticker.get("askPr"))
        if bid > 0 and ask > 0 and ask < bid:
            raise BitgetDemoError("Bitget execution quote is crossed; wait for a valid order book.")
        if bid > 0 and ask >= bid:
            spread_bps = (ask - bid) / ((ask + bid) / 2) * 10000
            if spread_bps > 4.0:
                raise BitgetDemoError(f"Execution spread is too wide ({spread_bps:.2f} bps).")
            exchange_price = ask if direction == "LONG" else bid
        if exchange_price <= 0:
            raise BitgetDemoError("Bitget execution ticker returned an invalid price.")

        drift_pct = abs(exchange_price - entry) / entry * 100.0
        max_drift_pct = max(0.01, float(os.getenv("BITGET_MAX_ENTRY_DRIFT_PCT", "0.15")))
        if drift_pct > max_drift_pct:
            raise BitgetDemoError(
                f"Bitget price drift {drift_pct:.3f}% exceeds {max_drift_pct:.3f}% execution guard."
            )

        if direction == "LONG" and not (stop < exchange_price < target):
            raise BitgetDemoError("LONG signal is no longer valid at the Bitget execution price.")
        if direction == "SHORT" and not (target < exchange_price < stop):
            raise BitgetDemoError("SHORT signal is no longer valid at the Bitget execution price.")

        # Recompute tradable reward/risk at the actual execution quote.
        fee_rate = max(0.0, float(os.getenv("BITGET_DEMO_TAKER_FEE_RATE", "0.0006")))
        loss_per_unit = abs(exchange_price - stop) + (exchange_price + stop) * fee_rate
        reward_per_unit = abs(target - exchange_price) - (exchange_price + target) * fee_rate
        net_rr = reward_per_unit / loss_per_unit
        if net_rr < max(2.5, float(os.getenv("BITGET_DEMO_MIN_NET_RR", "2.5"))):
            raise BitgetDemoError(f"Executable R:R after estimated fees is too low ({net_rr:.2f}).")

        return exchange_price, drift_pct

    async def handle_signal(self, signal: dict[str, Any]) -> dict[str, Any]:
        # Concurrent tasks must not pass the same cap/duplicate check together.
        async with self._submission_lock:
            generation = self._sync_generation
            created = self._num(signal.get("created_ts"))
            remaining = min(15.0, (created + 15000 - time.time() * 1000) / 1000) if created else 15.0
            try:
                # Join a routine refresh instead of permanently skipping its
                # coincident setup. Only lock acquisition is timed out: never
                # cancel a private order request with an uncertain outcome.
                await asyncio.wait_for(self._sync_lock.acquire(), timeout=max(0.0, remaining))
            except asyncio.TimeoutError:
                result = {"ok": False, "skipped": True,
                    "reason": "Signal expired while waiting for exchange reconciliation; wait for a new setup."}
            else:
                try:
                    if self._sync_generation == generation:
                        await self._refresh_locked()
                    # Keep reconciliation and admission mutually exclusive
                    # through submission, including the second freshness gate.
                    result = await self._handle_signal(signal)
                finally:
                    self._sync_lock.release()
            self.data["last_decision"] = {"signal_id": signal.get("id"), "direction": signal.get("direction"),
                "status": "SUBMITTED" if result.get("ok") else "SKIPPED" if result.get("skipped") else "ERROR",
                "reason": result.get("reason", "Exchange accepted the order; fill reconciliation is tracked separately."),
                "ts": int(time.time() * 1000)}
            self._save()
            return result

    async def _handle_signal(self, signal: dict[str, Any]) -> dict[str, Any]:
        submission_oid = ""
        submission_context = {}
        durable_prediction_opened = False
        allowed, reason = self._signal_allowed(signal, reconciliation_locked=True)
        if not allowed:
            return {"ok": False, "skipped": True, "reason": reason}
        # Strategy candidates still need exchange admission. Existing exposure
        # must close and reconcile before any new entry is submitted.
        try:
            positions = await self._current_positions()
        except Exception as exc:
            return {"ok": False, "skipped": True, "reason": f"Unable to verify Bitget position: {exc}"}

        if any(self._num(p.get("total")) > 0 for p in positions) or self._open_local_trade():
            return {"ok": False, "skipped": True, "reason": "Existing demo exposure must close and reconcile before another entry."}
        status = self.data.get("client_status") or {}
        if not status.get("ready") or status.get("history_reconciliation") != "HEALTHY":
            return {"ok": False, "skipped": True,
                "reason": "Exchange reconciliation is not verified; new entries are blocked."}
        try:
            if await asyncio.to_thread(self.client.pending_orders, self.symbol) or await asyncio.to_thread(self.client.strategy_orders, self.symbol):
                return {"ok": False, "skipped": True, "reason": "Pending exchange orders remain; no new position can be opened."}
        except Exception as exc:
            return {"ok": False, "skipped": True, "reason": f"Cannot verify pending exchange orders: {exc}"}

        try:
            try:
                reference_price, reference_drift_pct = await self._validate_execution_price(signal)
            except BitgetDemoError as exc:
                return {"ok": False, "skipped": True, "reason": str(exc)}

            config = await self._contract()

            entry_plan = self._num(signal.get("entry"))
            stop = self._num(signal.get("stop"))
            tp = self._num(signal.get("target2") or signal.get("target") or signal.get("target1"))
            stop = float(self._format_price(stop, config, str(signal.get("direction")), "sl"))
            tp = float(self._format_price(tp, config, str(signal.get("direction")), "tp"))
            margin_target, margin_min, margin_max, confidence_band = self._confidence_margin_target(
                self._num(signal.get("confidence"))
            )
            qty, risk_usdt, config = await self._risk_size(dict(signal, entry=reference_price, stop=stop))
            # Private sizing calls can be slow. Re-read the executable quote,
            # validate the rounded geometry and only reduce quantity if needed.
            try:
                reference_price, reference_drift_pct = await self._validate_execution_price(
                    dict(signal, stop=stop, target2=tp))
            except BitgetDemoError as exc:
                return {"ok": False, "skipped": True, "reason": str(exc)}
            fee_rate = max(0.0, float(os.getenv("BITGET_DEMO_TAKER_FEE_RATE", "0.0006")))
            unit_risk = abs(reference_price-stop)+(reference_price+stop)*fee_rate
            refreshed_balance, refreshed_risk_cap = await self._sizing_balance_and_risk_cap()
            refreshed_notional_cap = min(self.max_notional,
                max(0.0, refreshed_balance - self.margin_reserve) * self.leverage)
            if qty*unit_risk > refreshed_risk_cap or qty*reference_price > refreshed_notional_cap:
                qty = min(qty, self._normalize_qty(min(refreshed_risk_cap/unit_risk, refreshed_notional_cap/reference_price), config))
            planned_margin = qty * reference_price / self.leverage if qty > 0 else 0.0
            if planned_margin > margin_max:
                qty = self._normalize_qty((margin_max * self.leverage) / reference_price, config)
                planned_margin = qty * reference_price / self.leverage if qty > 0 else 0.0
            if qty <= 0 or qty*reference_price < self._num(config.get("minTradeUSDT") or config.get("minOrderAmount")):
                return {"ok": False, "skipped": True, "reason": "Updated execution quote leaves less than the exchange minimum position size."}
            risk_usdt = qty*unit_risk
            planned_notional = qty * reference_price
            # Sizing/settings requests can take time. Do not submit an entry
            # whose decision expired while waiting for those responses.
            allowed, reason = self._signal_allowed(signal, reconciliation_locked=True)
            if not allowed:
                return {"ok": False, "skipped": True, "reason": reason}
            try:
                await asyncio.to_thread(
                    self.client.set_leverage,
                    self.symbol,
                    str(signal.get("direction")),
                    self.leverage,
                    os.getenv("BITGET_MARGIN_MODE", "isolated"),
                )
            except Exception as exc:
                return {"ok": False, "skipped": True, "reason": f"Cannot verify {self.leverage}x Bitget Demo leverage: {exc}"}
            # Leverage verification is another private request and can outlive
            # the decision or the public quote. Revalidate BOTH feed admission
            # and the executable Bitget price immediately before persisting the
            # order intent. Previously only freshness was rechecked here, so a
            # fast move during set-leverage could bypass the drift/geometry gate.
            allowed, reason = self._signal_allowed(signal, reconciliation_locked=True)
            if not allowed:
                return {"ok": False, "skipped": True, "reason": reason}
            try:
                final_reference_price, final_drift_pct = await self._validate_execution_price(
                    dict(signal, stop=stop, target2=tp)
                )
            except BitgetDemoError as exc:
                return {"ok": False, "skipped": True, "reason": str(exc)}
            final_unit_risk = abs(final_reference_price - stop) + (final_reference_price + stop) * fee_rate
            final_balance, final_risk_cap = await self._sizing_balance_and_risk_cap()
            final_margin = qty * final_reference_price / self.leverage if qty > 0 else 0.0
            final_notional = qty * final_reference_price
            final_risk = qty * final_unit_risk
            if final_risk > final_risk_cap + 1e-9:
                return {"ok": False, "skipped": True, "reason": "Final Bitget quote exceeds the planned-loss guard; wait for a new setup."}
            if final_notional > self.max_notional + 1e-9:
                return {"ok": False, "skipped": True, "reason": "Final Bitget quote exceeds the configured notional cap."}
            if final_margin > min(margin_max, max(0.0, final_balance - self.margin_reserve)) + 1e-6:
                return {
                    "ok": False,
                    "skipped": True,
                    "reason": f"Final Bitget quote exceeds the {confidence_band} margin maximum or available margin reserve.",
                }
            reference_price = final_reference_price
            reference_drift_pct = final_drift_pct
            planned_margin = final_margin
            planned_notional = final_notional
            risk_usdt = final_risk
            allowed, reason = self._signal_allowed(signal, reconciliation_locked=True)
            if not allowed:
                return {"ok": False, "skipped": True, "reason": reason}
            # Bitget UTA permits at most 32 characters; use a deterministic ID
            # for retry/recovery rather than truncating the setup unpredictably.
            client_oid = client_identity(signal, risk_usdt)
            submission_context = dict(execution_id=client_oid, client_oid=client_oid,
                signal_id=signal.get("id"), symbol=self.symbol, direction=str(signal.get("direction")).upper(),
                setup=signal.get("setup"), trade_style=signal.get("trade_style"),
                entry_plan=entry_plan, execution_reference_price=reference_price,
                stop_loss=stop, take_profit=tp, target1=signal.get("target1"), requested_qty=qty,
                filled_qty=0.0, entry_price=0.0, planned_risk_usdt=risk_usdt,
                leverage=self.leverage, planned_margin_usdt=round(planned_margin, 4),
                planned_notional_usdt=round(planned_notional, 4), confidence_band=confidence_band,
                opened_ts=int(time.time()*1000), closed_ts=0, status="SUBMISSION_UNKNOWN",
                signal_snapshot=dict(signal))
            # Save the exact request context before POST. A crash or timeout
            # must retain its stable identity and planned exchange protection.
            self.data["pending_submission"] = submission_context
            if not self._save():
                self.data.pop("pending_submission", None)
                return {"ok": False, "skipped": True, "reason": "Cannot persist order intent; entry blocked until storage recovers."}
            submission_oid = client_oid
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
                "execution_reference_price": reference_price,
                "execution_reference_drift_pct": round(reference_drift_pct, 5),
                "stop_loss": stop,
                "take_profit": tp,
                "target1": signal.get("target1"),
                "requested_qty": qty,
                "filled_qty": 0.0,
                "entry_price": 0.0,
                "exit_price": 0.0,
                "risk_pct": self.risk_pct,
                "planned_risk_usdt": risk_usdt,
                "leverage": self.leverage,
                "planned_margin_usdt": round(planned_margin, 4),
                "planned_notional_usdt": round(planned_notional, 4),
                "confidence_band": confidence_band,
                "margin_target_usdt": round(margin_target, 4),
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
                self.data.pop("pending_submission", None)
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
                    "execution_reference_price": reference_price,
                    "execution_reference_drift_pct": round(reference_drift_pct, 5),
                    "entry_price": 0.0,
                    "stop_loss": stop,
                    "take_profit": tp,
                    "requested_qty": qty,
                    "leverage": self.leverage,
                    "planned_margin_usdt": round(planned_margin, 4),
                    "planned_notional_usdt": round(planned_notional, 4),
                    "confidence_band": confidence_band,
                    "actual_fill_confirmed": False,
                    "ts": now,
                }
                self._save()
            if self.bridge:
                try:
                    bridge_result = await self.bridge.post_open_signal(
                        signal,
                        signal.get("evidence", {}).get("memory_match"),
                    )
                    durable_prediction_opened = bridge_result is not None
                except Exception:
                    durable_prediction_opened = False
            await self._poll_fill(trade["execution_id"])

            # An accepted order can still terminate as rejected/cancelled with
            # zero fill. That is conclusively NOT an executed trade. Clean the
            # durable prediction (when one was actually opened) and report a
            # skip so strategy quota/state is retired instead of leaving a
            # phantom ACTIVE prediction after Bitget rejected the order.
            if trade.get("status") == "FAILED" and not trade.get("actual_fill_confirmed"):
                reason = str(trade.get("error") or "Bitget entry order ended without a fill.")
                cleanup_done = False
                if durable_prediction_opened and self.bridge:
                    try:
                        cleanup_done = await self.bridge.post_outcome(signal, "NOT_EXECUTED", 0.0) is not None
                    except Exception:
                        cleanup_done = False
                return {
                    "ok": False,
                    "skipped": True,
                    "reason": reason,
                    "trade": dict(trade),
                    "durable_prediction_opened": durable_prediction_opened,
                    "durable_cleanup_done": cleanup_done,
                }

            return {
                "ok": True,
                "trade": dict(trade),
                "durable_prediction_opened": durable_prediction_opened,
            }
        except Exception as exc:
            # Before a client order id is committed there is no ambiguous
            # exchange exposure. Treat validation/sizing/config failures as a
            # clean skip rather than persisting a phantom FAILED trade.
            if not submission_oid:
                with self.lock:
                    self.data.pop("pending_submission", None)
                    self._save()
                return {"ok": False, "skipped": True, "reason": str(exc)}
            now = int(time.time() * 1000)
            failed = {
                **submission_context,
                "execution_id": submission_oid or f"DTDEMO-FAILED-{now}",
                "signal_id": signal.get("id"),
                "client_oid": submission_oid,
                "symbol": self.symbol,
                "direction": str(signal.get("direction") or "").upper(),
                "setup": signal.get("setup"),
                "status": "SUBMISSION_UNKNOWN" if submission_oid else "FAILED",
                "opened_ts": now,
                "closed_ts": 0 if submission_oid else now,
                "error": str(exc),
                "signal_snapshot": dict(signal),
            }
            with self.lock:
                self.data.pop("pending_submission", None)
                self.data["trades"].insert(0, failed)
                self.data["trades"] = self.data["trades"][:500]
                self.data["last_event"] = {
                    "key": f"EXECUTION_FAILED:{failed['execution_id']}",
                    "type": "EXECUTION_RECONCILING" if submission_oid else "EXECUTION_FAILED",
                    "execution_id": failed["execution_id"],
                    "direction": failed["direction"],
                    "setup": failed["setup"],
                    "status": failed["status"],
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
        allowed, reason = self._signal_allowed(signal)
        if not allowed:
            return {"action": "KEEP", "reason": reason}
        if not self.smart_reversal_enabled or current_price is None:
            return {"action": "KEEP", "reason": "smart reversal disabled"}
        try:
            await self._validate_execution_price(signal)
        except Exception as exc:
            return {"action": "KEEP", "reason": f"Replacement signal is not executable: {exc}"}
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

        reasons: list[str] = []
        eligible_for_basket_close = bool(opposite)
        candidate_count = 0

        # Bitget aggregates same-side entries at the exchange-position level.
        # Therefore a reversal can close an entire side, but only when every
        # local trade on that side independently agrees that the thesis is weak.
        for old in opposite:
            old_entry = self._num(old.get("entry_price") or old.get("entry_plan"))
            old_stop = self._num(old.get("stop_loss"))
            old_conf = self._num(old.get("confidence"))
            if old_entry <= 0 or old_stop <= 0:
                eligible_for_basket_close = False
                reasons.append(f"{old.get('signal_id')}: missing valid entry/stop")
                continue

            risk = abs(old_entry - old_stop)
            if risk <= 0:
                eligible_for_basket_close = False
                reasons.append(f"{old.get('signal_id')}: invalid risk distance")
                continue

            old_direction = str(old.get("direction") or "").upper()
            progress_r = (
                (float(current_price) - old_entry) / risk
                if old_direction == "LONG"
                else (old_entry - float(current_price)) / risk
            )

            if progress_r >= 1.25:
                eligible_for_basket_close = False
                reasons.append(f"{old.get('signal_id')}: protected profit {progress_r:.2f}R")
                continue

            materially_stronger = new_conf >= max(0.82, old_conf + 0.07)
            strong_rr = new_rr >= 3.0
            market_flip = aligned >= 3
            if materially_stronger and strong_rr and market_flip:
                candidate_count += 1
                reasons.append(
                    f"{old.get('signal_id')}: reversal {new_conf:.2f} confidence, "
                    f"{aligned}/4 directional evidence, old progress {progress_r:.2f}R"
                )
            else:
                eligible_for_basket_close = False
                reasons.append(f"{old.get('signal_id')}: reversal evidence is not strong enough")

        should_close = eligible_for_basket_close and candidate_count == len(opposite)
        if not should_close:
            return {"action": "KEEP", "reason": "; ".join(reasons) or "reversal gate not strong enough"}

        positions = []
        try:
            positions = await self._current_positions()
        except Exception:
            positions = []
        active_positions = [row for row in positions if self._num(row.get("total"), 0.0) > 0]
        if active_positions:
            try:
                mode = str((await asyncio.to_thread(self.client.account_settings)).get("holdMode") or "").lower()
            except Exception:
                mode = ""
            if mode == "hedge_mode":
                old_side = "SHORT" if new_direction == "LONG" else "LONG"
                active_positions = [
                    row for row in active_positions
                    if self._direction_from_position(row) == old_side
                ]
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
                normalized_status = status.replace("-", "_").replace(" ", "_")

                # Bitget can report a non-zero cumulative fill while an order is
                # still only partially filled. That is NOT an executable OPEN
                # position yet: promoting it here would make the app emit
                # EXECUTION_OPEN too early and learn from a position that is not
                # actually established in full.
                trade["exchange_order_status"] = normalized_status
                if normalized_status in {"partially_filled", "partial_fill", "live", "new", "open"}:
                    # Keep ORDER_PENDING until Bitget confirms a full fill.
                    # Preserve the observed cumulative quantity/average only as
                    # diagnostic information for the UI.
                    if filled > 0:
                        trade["filled_qty"] = filled
                    if avg > 0:
                        trade["entry_price"] = avg
                    if filled > 0 and avg > 0:
                        trade["partial_fill_confirmed"]=True
                        await self._ensure_trade_protection(trade)
                    with self.lock:
                        self._save()
                    await asyncio.sleep(0.75)
                    continue

                terminal_partial=normalized_status in {"cancelled","canceled","rejected"} and filled>0
                if normalized_status in {"filled", "full_fill", "full_filled"} or terminal_partial:
                    if filled <= 0 or avg <= 0:
                        trade["error"] = "Filled order is missing exchange quantity or average price; awaiting reconciliation."
                        await asyncio.sleep(0.75)
                        continue
                    # The exchange fill is the single source of truth for the
                    # executed entry. Keep the original signal entry separately
                    # as entry_plan so the UI never confuses a plan with a fill.
                    trade["status"] = "OPEN"
                    trade["entry_price"] = avg
                    trade["filled_qty"] = filled
                    trade["exit_price"] = 0.0
                    trade["closed_ts"] = 0
                    trade["close_reason"] = ""
                    trade["actual_fill_confirmed"] = True
                    trade["entry_order_terminal"]=True
                    trade["terminal_partial_fill"]=terminal_partial
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
                        "leverage": int(trade.get("leverage") or self.leverage),
                        "planned_margin_usdt": self._num(trade.get("planned_margin_usdt")),
                        "planned_notional_usdt": self._num(trade.get("planned_notional_usdt")),
                        "confidence_band": trade.get("confidence_band"),
                        "actual_fill_confirmed": True,
                        "ts": fill_ts,
                        "note": "Bitget Demo market order filled; actual exchange fill price is authoritative.",
                    }
                    with self.lock:
                        self.data["last_event"] = fill_event
                        self._save()
                    await self._ensure_trade_protection(trade)
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

    async def _ensure_trade_protection(self, trade: dict[str, Any]):
        # Fill polling and the reconciliation loop can observe the same entry.
        # Serialize repairs so one task cannot close while another verifies it.
        async with self._protection_lock:
            await self._ensure_trade_protection_unlocked(trade)

    async def _ensure_trade_protection_unlocked(self, trade: dict[str, Any]):
        """Repair full SL coverage for our new single-position entries.

        If exchange protection cannot be confirmed, stop admissions and submit
        one exact-quantity close. Never silently keep trading an unprotected fill.
        """
        if trade.get("protection_close_submitted"):
            return
        try:
            positions = await self._current_positions()
        except Exception as exc:
            self.data["protection_halt"] = f"Cannot verify filled-position protection: {exc}"
            self._save()
            return
        own = [p for p in positions if self._direction_from_position(p) == trade.get("direction") and self._num(p.get("total")) > 0]
        if not own:
            return  # Fill may already have closed; normal reconciliation decides.
        qty = sum(self._num(p.get("total")) for p in own)
        if qty-self._num(trade.get("filled_qty")) > max(1e-8,qty*1e-6):
            self.data["protection_halt"] = "Position ownership/quantity is ambiguous."
            self._save()
            return
        try:
            ticker = await asyncio.to_thread(self.client.market_ticker, self.symbol)
            mark = self._num(ticker.get("markPrice") or ticker.get("lastPrice"))
            orders = await asyncio.to_thread(self.client.strategy_orders, self.symbol)
            coverage = stop_coverage(own, orders, mark)
            if not coverage["all_positions_protected"]:
                sl = self._num(trade.get("stop_loss"))
                valid = sl > 0 and mark > 0 and ((trade["direction"] == "LONG" and sl < mark) or (trade["direction"] == "SHORT" and sl > mark))
                if not valid:
                    raise BitgetDemoError("The planned stop has already been crossed or is invalid.")
                config = await self._contract()
                oid = "DTSL-" + hashlib.sha256(str(trade["execution_id"]).encode()).hexdigest()[:24]
                # If a submission timed out, read its outcome before any retry.
                if not trade.get("full_stop_attempted"):
                    trade["full_stop_attempted"] = True
                    self._save()
                    try:
                        await asyncio.to_thread(self.client.place_full_stop, self.symbol, trade["direction"],
                            self._format_price(sl, config, trade["direction"], "sl"), oid)
                    except Exception:
                        pass
                for _ in range(3):
                    await asyncio.sleep(0.5)
                    orders = await asyncio.to_thread(self.client.strategy_orders, self.symbol)
                    coverage = stop_coverage(own, orders, mark)
                    if coverage["all_positions_protected"]:
                        break
            trade["protection"] = coverage
            if coverage["all_positions_protected"]:
                self._save()
                return
            raise BitgetDemoError("Full exchange stop quantity remains unverified.")
        except Exception as exc:
            self.data["protection_halt"] = str(exc)
            trade["protection_error"] = str(exc)
            # Re-read the live position before sending the close. Never close
            # the original size after a concurrent exchange TP/SL already exited.
            try:
                latest = await self._current_positions()
            except Exception as read_error:
                trade["protection_close_error"] = f"Cannot verify remaining quantity: {read_error}"
                self._save()
                return
            current = self._match_current_position(latest, trade["direction"])
            remaining = self._num((current or {}).get("total"))
            if remaining > 0 and remaining <= self._num(trade.get("filled_qty"))+1e-8:
                oid = "DTDEMO-CLOSE-" + hashlib.sha256((str(trade["execution_id"])+":protection").encode()).hexdigest()[:16]
                trade["protection_close_submitted"] = True
                self._save()
                try:
                    config = await self._contract()
                    await asyncio.to_thread(self.client.place_market_close, self.symbol, trade["direction"],
                        self._format_qty(remaining, config), oid)
                except Exception as close_error:
                    trade["protection_close_error"] = str(close_error)
            self._save()

    async def sync(self) -> list[dict[str, Any]]:
        if self._sync_lock.locked():
            return []
        async with self._sync_lock:
            return await self._refresh_locked()

    async def _refresh_locked(self) -> list[dict[str, Any]]:
        result = await self._sync()
        self._sync_generation += 1
        return result

    async def _sync(self) -> list[dict[str, Any]]:
        if not self.enabled or not self.ready:
            return []
        newly_closed: list[dict[str, Any]] = []
        reconciliation_warnings: list[str] = []
        try:
            now = int(time.time() * 1000)
            positions_verified = True
            try:
                positions = await self._current_positions()
            except Exception as exc:
                positions_verified = False
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
            try:
                strategies = await asyncio.to_thread(self.client.strategy_orders, self.symbol)
                ticker = await asyncio.to_thread(self.client.market_ticker, self.symbol) if position_rows else {}
                self.data["stop_protection"] = (stop_coverage(position_rows, strategies,
                    self._num(ticker.get("markPrice") or ticker.get("lastPrice"))) if positions_verified else
                    {"verified": False, "all_positions_protected": False, "error": "Current exchange positions could not be verified."})
                self.data["pending_strategy_orders"] = strategies
            except Exception as exc:
                self.data["stop_protection"] = {"verified": False, "all_positions_protected": False, "error": str(exc)}
                reconciliation_warnings.append(f"stop_protection: {exc}")
            if now - int(self.data.get("ledger_refresh_ts") or 0) >= 60000:
                self.data["ledger_refresh_ts"] = now
                try:
                    if hasattr(self.client, "fills_history"):
                        fills = await asyncio.to_thread(self.client.fills_history, history_start, now)
                        self.data["fill_ledger"] = build_fill_ledger(fills.get("rows", []), orders, self.symbol,
                            history_start, now, fills.get("complete", False))
                        if self.session_start_ms:
                            self.data["session_ledger"] = build_fill_ledger(fills.get("rows", []), orders, self.symbol,
                                max(history_start,self.session_start_ms), now, fills.get("complete", False))
                    if hasattr(self.client, "account_metrics"):
                        account = await asyncio.to_thread(self.client.account_metrics, self.symbol)
                        prior = self.data.get("account_metrics") or {}
                        equity = self._num(account.get("equity_usdt"))
                        day = self._utc_day()
                        if equity <= 0:
                            raise BitgetDemoError("Bitget account equity is missing or invalid.")
                        day_open = self._num(prior.get("utc_day_open_equity_usdt")) if prior.get("utc_day") == day else 0
                        session_today = self.session_start_ms // 86400000 == now // 86400000
                        if session_today and not day_open:
                            day_open = self.session_baseline
                        account.update({"observed_peak_usdt": max(equity, self.session_baseline, self._num(prior.get("observed_peak_usdt"))),
                            "utc_day": day, "utc_day_open_equity_usdt": day_open or equity,
                            "updated_ts": now})
                        self.data["account_metrics"] = account
                    self.data.pop("ledger_error", None)
                except Exception as exc:
                    self.data["ledger_error"] = str(exc)
            # Recovered exchange orders must consume the daily cap after a
            # restart even when the local file was erased by deployment.
            self._daily_count = self._count_today()
            for trade in self._local_demo_trades():
                if trade.get("status") in {"FAILED", "CLOSED"}:
                    continue
                if not positions_verified:
                    continue  # Missing position data must not simulate a flat account or close.
                if trade.get("status") == "SUBMISSION_UNKNOWN":
                    reconciliation_warnings.append(str(trade.get("execution_id")) + ": submission outcome unknown; awaiting order history")
                    continue
                if trade.get("status") == "ORDER_PENDING":
                    await self._poll_fill(str(trade.get("execution_id")))
                    if trade.get("status")=="FAILED":
                        continue
                direction = str(trade.get("direction", "")).upper()
                current = self._match_current_position(position_rows, direction)
                closed = self._match_history_position(history, trade)
                # A new same-side position must not resurrect a prior lifecycle.
                current_created = self._num((current or {}).get("ctime") or (current or {}).get("createdTime"))
                closed_updated = self._num((closed or {}).get("utime") or (closed or {}).get("updatedTime"))
                if closed and (not current or (current_created > 0 and closed_updated <= current_created)):
                    event = self._finalize_trade(trade, closed, orders)
                    if event:
                        newly_closed.append(event)
                    elif trade.get("reconciliation_warning"):
                        reconciliation_warnings.append(
                            str(trade.get("execution_id")) + ": " +
                            str(trade["reconciliation_warning"])
                        )
                    continue
                if current_created > 0 and self._num(trade.get("opened_ts")) < current_created - 5000:
                    trade["status"] = "RECONCILIATION_PENDING"
                    trade["reconciliation_warning"] = "Trade predates current position; awaiting matching exchange history."
                    reconciliation_warnings.append(str(trade.get("execution_id")) + ": unmatched older lifecycle")
                    continue
                if current:
                    # A pending order can already have a partial exchange
                    # position. Do not promote the local trade to OPEN until
                    # order_detail has confirmed a full fill; otherwise the
                    # aggregate Bitget position can hide a partial fill.
                    if trade.get("status") == "ORDER_PENDING" and not trade.get("actual_fill_confirmed"):
                        trade["partial_position_detected"] = True
                        if self._num(trade.get("filled_qty")) > 0:
                            # The exchange has supplied a partial fill size.
                            # Attempt protection without claiming a full fill.
                            await self._ensure_trade_protection(trade)
                        elif not (self.data.get("stop_protection") or {}).get("all_positions_protected"):
                            # Exchange position exists but size/ownership of
                            # this entry are unknown. Never open more risk or
                            # invent the quantity of a forced market close.
                            warning = (
                                "Exchange reports partial exposure but fill quantity "
                                "and complete protective stop coverage are unverified."
                            )
                            self.data["protection_halt"] = warning
                            trade["protection_error"] = warning
                            reconciliation_warnings.append(
                                str(trade.get("execution_id")) + ": " + warning
                            )
                        continue

                    trade["status"] = "OPEN"
                    trade["position_id"] = str(current.get("posId") or current.get("positionId") or "")

                    # In one-way mode Bitget aggregates same-direction entries
                    # into one exchange position. Never overwrite an individual
                    # signal's actual fill with that aggregate position average.
                    if not trade.get("actual_fill_confirmed"):
                        trade["filled_qty"] = self._num(
                            trade.get("filled_qty")
                            or current.get("total")
                            or current.get("positionSize")
                        )
                        trade["entry_price"] = self._num(
                            trade.get("entry_price"),
                            self._num(current.get("openPriceAvg") or current.get("openAvgPrice") or trade.get("entry_plan"))
                        )
                        trade["actual_fill_confirmed"] = True
                    else:
                        trade["filled_qty"] = self._num(trade.get("filled_qty"))
                        trade["entry_price"] = self._num(trade.get("entry_price") or trade.get("entry_plan"))

                    trade["exit_price"] = 0.0
                    trade["closed_ts"] = 0
                    trade["close_reason"] = ""

                    aggregate_qty = self._num(
                        current.get("total")
                        or current.get("positionSize")
                        or current.get("available"),
                        0.0,
                    )
                    aggregate_unrealized = self._num(current.get("unrealizedPL"), 0.0)
                    aggregate_funding = self._num(current.get("totalFunding"), 0.0)
                    local_qty = self._num(trade.get("filled_qty"), 0.0)
                    share = (local_qty / aggregate_qty) if aggregate_qty > 0 and local_qty > 0 else 0.0
                    trade["unrealized_pnl_usdt"] = aggregate_unrealized * share if share > 0 else 0.0
                    trade["funding_usdt"] = aggregate_funding * share if share > 0 else 0.0
                    if not (self.data.get("stop_protection") or {}).get("all_positions_protected"):
                        await self._ensure_trade_protection(trade)
                    continue

                closed = self._match_history_position(history, trade)
                if closed:
                    event = self._finalize_trade(trade, closed, orders)
                    if event:
                        newly_closed.append(event)
                    elif trade.get("reconciliation_warning"):
                        reconciliation_warnings.append(
                            str(trade.get("execution_id")) + ": " +
                            str(trade["reconciliation_warning"])
                        )
                elif trade.get("status") in {"OPEN", "RECONCILIATION_PENDING"}:
                    trade["status"] = "RECONCILIATION_PENDING"
                    reconciliation_warnings.append(str(trade.get("execution_id")) + ": missing exchange position/history")

            # Several older orders can share a continuously open Bitget side,
            # with partial exits that do not produce a closed-position record.
            # The remaining aggregate quantity cannot prove each entry is open.
            for position in position_rows:
                direction = self._direction_from_position(position)
                side_entries = [row for row in self._local_demo_trades()
                                if row.get("status") == "OPEN" and row.get("direction") == direction]
                local_qty = sum(self._num(row.get("filled_qty")) for row in side_entries)
                exchange_qty = self._num(position.get("total"))
                if local_qty > exchange_qty + max(1e-8, exchange_qty * 1e-6):
                    warning = f"{direction}: local entry quantity {local_qty:g} exceeds remaining exchange quantity {exchange_qty:g}; partial exits require fill attribution."
                    reconciliation_warnings.append(warning)
                    for row in side_entries:
                        row["status"] = "RECONCILIATION_PENDING"
                        row["reconciliation_warning"] = warning
                        row["unrealized_pnl_usdt"] = None

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
            return [row for row in self.data["trades"] if str(row.get("client_oid", "")).startswith("DTDEMO-") and self._num(row.get("opened_ts")) >= self.session_start_ms]

    def _merge_exchange_open_orders(self, orders: list[dict[str, Any]]):
        known = {str(t.get("client_oid")) for t in self.data["trades"] if t.get("client_oid")}
        for order in orders:
            if self._num(order.get("createdTime")) < self.session_start_ms:
                continue
            oid = str(order.get("clientOid") or "")
            if not oid.startswith("DTDEMO-"):
                continue
            if oid in known:
                unknown = next((t for t in self.data["trades"] if t.get("client_oid") == oid and t.get("status") == "SUBMISSION_UNKNOWN"), None)
                if unknown is not None:
                    unknown.update({"order_id": str(order.get("orderId") or ""),
                        "status": "ORDER_PENDING"})
                    for field, value in (("requested_qty", order.get("qty")),
                            ("stop_loss", order.get("stopLoss")), ("take_profit", order.get("takeProfit"))):
                        if self._num(value) > 0:
                            unknown[field] = self._num(value)
                continue
            if oid.startswith("DTDEMO-CLOSE-") or "close" in str(order.get("tradeSide") or "").lower() or str(order.get("reduceOnly") or "").upper() in {"YES", "TRUE"}:
                continue
            if str(order.get("orderStatus") or "").lower() in {"cancelled", "canceled", "rejected"} and self._num(order.get("cumExecQty")) <= 0:
                continue
            side = str(order.get("side") or "").lower()
            direction = "LONG" if side == "buy" else "SHORT" if side == "sell" else ""
            status = str(order.get("orderStatus") or "").lower()
            confirmed_fill = status == "filled" and self._num(order.get("cumExecQty")) > 0 and self._num(order.get("avgPrice")) > 0
            recovered = decode_identity(oid)
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
                "status": "OPEN" if confirmed_fill else "ORDER_PENDING",
                "actual_fill_confirmed": confirmed_fill,
                "exchange_order_status": status,
                "opened_ts": self._num(order.get("createdTime"), int(time.time() * 1000)),
                "closed_ts": 0,
                "realized_pnl_usdt": 0.0,
                "net_profit_usdt": 0.0,
                "fees_usdt": 0.0,
                "funding_usdt": 0.0,
                "risk_pct": self.risk_pct,
                "planned_risk_usdt": abs(self._num(order.get("avgPrice")) - self._num(order.get("stopLoss"))) * self._num(order.get("cumExecQty")) if self._num(order.get("stopLoss")) > 0 else 0.0,
                "close_reason": "",
                "signal_snapshot": {"id": oid, "setup": "BITGET DEMO", "direction": direction, "entry": self._num(order.get("avgPrice") or order.get("price")), "stop": self._num(order.get("stopLoss")), "target2": self._num(order.get("takeProfit")), "rr": 0.0, "evidence": {}},
            }
            with self.lock:
                if recovered:
                    trade.update(recovered)
                    trade["trade_style"] = "SCALP" if recovered["timeframe"] == "5m" else "SWING"
                    trade["signal_snapshot"].update(recovered)
                journal=getattr(self,"journal",None)
                if journal:
                    retained=next((r for r in journal.records(500,"EXECUTION")
                        if (r.get("trade") or {}).get("execution_id")==oid),None)
                    original=(retained or {}).get("trade") or {}
                    snapshot=original.get("signal_snapshot") or {}
                    if snapshot.get("direction")==direction and original.get("client_oid")==oid:
                        trade["signal_snapshot"]=snapshot
                        trade["signal_id"]=snapshot.get("id",oid)
                        for key in ("setup","grade","confidence","rr","trade_style","planned_risk_usdt","target1"):
                            if key in original: trade[key]=original[key]
                        trade["recovery_scope"]="RETAINED_JOURNAL_PLUS_EXCHANGE_TRUTH"
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
            ctime = self._num(row.get("ctime") or row.get("createdTime") or row.get("openTime"), 0)
            closed = self._num(row.get("utime") or row.get("updatedTime"), 0)
            if opened and ctime and opened < ctime - 5000:
                continue
            if opened and closed and opened > closed:
                continue
            candidates.append(row)
        if not candidates:
            return None
        # Earliest containing lifecycle, never the newest unrelated position.
        candidates.sort(key=lambda r: self._num(r.get("utime") or r.get("updatedTime") or r.get("ctime"), 0))
        return candidates[0]

    def _finalize_trade(self, trade: dict[str, Any], closed: dict[str, Any], orders: list[dict[str, Any]]) -> dict[str, Any] | None:
        raw_net = closed.get("netProfit")
        # Never present gross PnL as fee-adjusted expectancy. Exchange net
        # accounting must be present and finite before closing a learning row.
        if (type(raw_net) not in (str, int, float) or
                not str(raw_net).strip() or
                not math.isfinite(self._num(raw_net, float("nan")))):
            trade["status"] = "RECONCILIATION_PENDING"
            trade["reconciliation_warning"] = (
                "Exchange closed position has no verified finite net PnL; "
                "await exchange fee/funding reconciliation."
            )
            trade["unrealized_pnl_usdt"] = None
            trade["learning_review"] = None
            return None
        aggregate_net = self._num(raw_net)
        aggregate_pnl = self._num(closed.get("pnl"), aggregate_net)
        aggregate_funding = self._num(closed.get("totalFunding"), 0.0)
        aggregate_fees = self._num(closed.get("openFee"), 0.0) + self._num(closed.get("closeFee"), 0.0)
        exit_price = self._num(closed.get("closeAvgPrice"))
        entry_price = self._num(trade.get("entry_price") or closed.get("openAvgPrice") or trade.get("entry_plan"))
        local_qty = self._num(trade.get("filled_qty"), 0.0)
        aggregate_qty = self._num(closed.get("closeTotalPos"), 0.0)

        # Bitget can aggregate multiple same-side entries in one history row.
        # Neither zero/unknown fills nor missing aggregate closed quantity
        # prove ownership of the PnL. Never award a complete exchange result
        # to an unverified local signal or train the strategy on fabricated R.
        quantity_tolerance = max(1e-8, aggregate_qty * 1e-6)
        if (local_qty <= 0 or aggregate_qty <= 0 or
                local_qty > aggregate_qty + quantity_tolerance or
                trade.get("actual_fill_confirmed") is False):
            trade["status"] = "RECONCILIATION_PENDING"
            trade["reconciliation_warning"] = (
                "Closed exchange position found, but entry fill ownership or "
                "aggregate closed quantity is unverified. Await fee/fill attribution."
            )
            trade["unrealized_pnl_usdt"] = None
            trade["learning_review"] = None
            return None

        # Use only the portion of an exchange aggregate proven by the fill.
        share = min(1.0, local_qty / aggregate_qty)
        pnl = aggregate_pnl * share
        funding = aggregate_funding * share
        fees = aggregate_fees * share
        net = aggregate_net * share

        trade["status"] = "CLOSED"
        trade["entry_price"] = entry_price
        trade["exit_price"] = exit_price
        trade["filled_qty"] = local_qty if local_qty > 0 else aggregate_qty
        trade["realized_pnl_usdt"] = pnl
        trade["net_profit_usdt"] = net
        trade["fees_usdt"] = fees
        trade["funding_usdt"] = funding
        trade["closed_ts"] = self._num(closed.get("utime") or closed.get("ctime"), int(time.time() * 1000))
        trade["position_id"] = str(closed.get("positionId") or "")
        trade["close_reason"] = self._infer_close_reason(trade, closed, orders)

        planned_risk = self._num(trade.get("planned_risk_usdt"))
        requested_qty = self._num(trade.get("requested_qty"))
        actual_qty = self._num(trade.get("filled_qty"))
        # A terminal partial fill carries only a proportional share of the
        # originally planned stop risk. Dividing its PnL by the full requested
        # risk understated both wins and losses and polluted setup learning.
        actual_risk = planned_risk
        if planned_risk > 0 and requested_qty > 0 and 0 < actual_qty < requested_qty:
            actual_risk = planned_risk * min(1.0, actual_qty / requested_qty)
        trade["actual_risk_usdt"] = round(actual_risk, 6)
        result_r = net / actual_risk if actual_risk > 0 else 0.0
        trade["result_r"] = round(result_r, 4)

        snapshot = dict(trade.get("signal_snapshot") or {})
        snapshot.update({
            "execution_id": trade.get("execution_id"),
            "entry": entry_price,
            "stop": trade.get("stop_loss"),
            "target2": trade.get("take_profit"),
            "rr": trade.get("rr", 0.0),
        })
        outcome = "TP2_REACHED" if trade["close_reason"] == "TP" else "SL_HIT" if trade["close_reason"] == "SL" else "CLOSED"
        lesson = self.learning.resolve(snapshot, outcome, result_r)
        trade["learning_review"] = lesson
        journal=getattr(self,"journal",None)
        if journal:
            journal.record("EXCHANGE_OUTCOME",dict(execution_id=trade["execution_id"],
                signal_id=trade.get("signal_id"),setup=trade.get("setup"),net_profit_usdt=net,
                fees_usdt=fees,funding_usdt=funding,result_r=result_r,signal_snapshot=snapshot),
                int(trade["closed_ts"]),identity="outcome:"+trade["execution_id"])

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
        text = f"{value:.{max(0, min(12, places))}f}"
        return text.rstrip("0").rstrip(".") if "." in text else text

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
        text = format(quantized, f".{places}f")
        return text.rstrip("0").rstrip(".") if "." in text else text

    def history(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.lock:
            rows = [dict(row) for row in self.data["trades"]]
        rows.sort(key=lambda row: self._num(row.get("closed_ts") or row.get("opened_ts"), 0), reverse=True)
        return rows[: max(1, min(int(limit), 500))]

    def summary(self) -> dict[str, Any]:
        rows = [r for r in self.history(500) if self._num(r.get("opened_ts")) >= self.session_start_ms]
        closed = [r for r in rows if r.get("status") == "CLOSED"]
        wins = [r for r in closed if self._num(r.get("net_profit_usdt")) > 0]
        losses = [r for r in closed if self._num(r.get("net_profit_usdt")) < 0]
        gross_profit = sum(self._num(r.get("net_profit_usdt")) for r in wins)
        gross_loss = abs(sum(self._num(r.get("net_profit_usdt")) for r in losses))
        total_net = sum(self._num(r.get("net_profit_usdt")) for r in closed)
        total_r = sum(self._num(r.get("result_r")) for r in closed)
        exchange_positions = (self.data.get("client_status") or {}).get("open_positions") or []
        unresolved = [r for r in rows if r.get("status") in {"RECONCILIATION_PENDING", "SUBMISSION_UNKNOWN"}]
        return {
            "demo_enabled": self.enabled,
            "configured": self.ready,
            "ready": bool((self.data.get("client_status") or {}).get("ready", False)),
            "trades": len(closed),
            "open_trades": len(exchange_positions) if unresolved else len([r for r in rows if r.get("status") in {"OPEN", "ORDER_PENDING"}]),
            "exchange_open_positions": len(exchange_positions),
            "unreconciled_entries": len(unresolved),
            "unknown_submissions": len([r for r in unresolved if r.get("status") == "SUBMISSION_UNKNOWN"]),
            "unrealized_pnl_usdt": round(sum(self._num(p.get("unrealizedPL")) for p in exchange_positions), 6),
            "accounting_complete": not unresolved and (self.data.get("client_status") or {}).get("history_reconciliation") == "HEALTHY",
            "accounting_scope": "CURRENT_TEST_SESSION" if self.session_start_ms else "RECONCILED_CLOSED_ENTRIES",
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
            "max_planned_loss_pct": self.max_planned_loss_pct,
            "effective_max_planned_loss_pct": min(
                self.max_planned_loss_pct,
                float(os.getenv("BITGET_DEMO_MAX_DAILY_LOSS_PCT", "1.0")),
            ),
            "leverage": self.leverage,
            "max_notional_usdt": self.max_notional,
            "margin_sizing": {
                "medium_min_usdt": self.medium_margin_min,
                "medium_max_usdt": self.medium_margin_max,
                "high_min_usdt": self.high_margin_min,
                "high_max_usdt": self.high_margin_max,
                "high_confidence_threshold": self.high_confidence_threshold,
            },
            "execution_policy": "CONFIDENCE_MARGIN_20X_FEE_ADJUSTED",
            "max_daily_loss_pct": float(os.getenv("BITGET_DEMO_MAX_DAILY_LOSS_PCT", "1.0")),
            "consecutive_loss_pause": 2,
            "min_net_rr": max(2.5, float(os.getenv("BITGET_DEMO_MIN_NET_RR", "2.5"))),
            "last_sync_ts": self.data.get("last_sync_ts", 0),
            "client_status": self.data.get("client_status") or {},
            "operator_paused": os.getenv("DEMO_EXECUTION_PAUSED", "false").lower() == "true" or bool(os.getenv("DEMO_RESET_REQUEST_MS", "")),
            "reset_receipt": self.data.get("reset_receipt"),
            "session_start_ts": self.session_start_ms,
            "stop_protection": self.data.get("stop_protection"),
            "protection_halt": self.data.get("protection_halt"),
        }

    def snapshot(self) -> dict[str, Any]:
        return {
            "mode": "BITGET_DEMO",
            "summary": self.summary(),
            "recent_trades": self.history(8),
            "last_event": self.data.get("last_event"),
            "last_decision": self.data.get("last_decision"),
            "account": self.data.get("account_metrics") or {},
            "performance": self.performance(),
        }

    def performance(self) -> dict[str, Any]:
        closed = [r for r in self.history(500) if r.get("status") == "CLOSED" and self._num(r.get("opened_ts")) >= self.session_start_ms]
        values = [self._num(r.get("net_profit_usdt")) for r in closed]
        ledger = dict(self.data.get("fill_ledger") or {})
        ledger["error"] = self.data.get("ledger_error")
        return {"ledger": ledger, "account": self.data.get("account_metrics") or {},
            "session": {"start_ts": self.session_start_ms, "baseline_equity_usdt": self.session_baseline,
                "current_equity_change_usdt": round(self._num((self.data.get("account_metrics") or {}).get("equity_usdt"))-self.session_baseline,6) if self.session_baseline and self.data.get("account_metrics") else None,
                "ledger": self.data.get("session_ledger") or {}, "scope": "NEW_TEST_SESSION"},
            "learning_recovery": {"source": "BITGET_ORDER_HISTORY", "window_days": 30,
                "metadata": "strategy family, timeframe, regime, planned risk", "full_thesis_persisted": False},
            "closed_sample_count": len(values), "expectancy_usdt": round(sum(values)/len(values), 6) if values else None,
            "sample_status": "SMALL_SAMPLE" if len(values) < 30 else "OBSERVED_DEMO_SAMPLE",
            "profitability_validated": False}

    async def run(self):
        if not self.enabled or not self.ready:
            return
        request = os.getenv("DEMO_RESET_REQUEST_MS", "")
        if request:
            from .demo_reset import reset_demo_session
            try:
                async with self._submission_lock:
                    async with self._sync_lock:
                        self.data["reset_receipt"] = await reset_demo_session(self.client, self.symbol, int(request))
            except Exception as exc:
                self.data["reset_receipt"] = {"status": "FAILED_PAUSED", "error": str(exc), "request_ts": request}
            self._save()
        while not self._stop:
            await self.sync()
            await asyncio.sleep(self.sync_seconds)

    def stop(self):
        self._stop = True
