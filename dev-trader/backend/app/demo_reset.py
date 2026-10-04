"""Explicit operator-controlled demo reset; never triggered by a market signal."""
from __future__ import annotations

import asyncio
import hashlib
import time

from .bitget import BitgetDemoError


async def reset_demo_session(client, symbol: str, request_ms: int) -> dict:
    now = int(time.time() * 1000)
    if not client.demo or not client.configured:
        raise BitgetDemoError("Reset requires the configured demo-only client.")
    if symbol != "BTCUSDT":
        raise BitgetDemoError("This reset is scoped to BTCUSDT demo positions.")
    if not 0 <= now - request_ms <= 20 * 60_000:
        raise BitgetDemoError("Demo reset request expired or is in the future.")
    receipt = {"request_ts": request_ms, "status": "RUNNING", "closed_sides": [],
               "cancelled_orders": [], "started_ts": now}
    # Stop pending entries from reopening exposure; retain protective strategy
    # exits until exchange positions have actually disappeared.
    regular = await asyncio.to_thread(client.pending_orders, symbol)
    strategies = await asyncio.to_thread(client.strategy_orders, symbol)
    for row in regular:
        oid = str(row.get("orderId") or "")
        await asyncio.to_thread(client.cancel_order, oid)
        receipt["cancelled_orders"].append(oid)
    for row in strategies:
        if not row.get("stopLoss") and not row.get("takeProfit"):
            oid = str(row.get("orderId") or "")
            await asyncio.to_thread(client.cancel_strategy_order, oid)
            receipt["cancelled_orders"].append(oid)
    positions = await asyncio.to_thread(client.positions, symbol)
    for row in positions:
        qty = client.numeric(row.get("total"))
        if qty <= 0:
            continue
        direction = str(row.get("holdSide") or row.get("posSide") or "").upper()
        if direction not in {"LONG", "SHORT"}:
            raise BitgetDemoError("Unknown exchange position side; reset remains paused.")
        # Exact remaining exchange quantity, never the sum of old local entries.
        size = format(qty, ".12f").rstrip("0").rstrip(".")
        oid = "DTDEMO-CLOSE-" + hashlib.sha256(f"{request_ms}:{direction}".encode()).hexdigest()[:16]
        try:
            result = await asyncio.to_thread(client.place_market_close, symbol, direction, size, oid)
            receipt["closed_sides"].append({"direction": direction, "qty": qty,
                                           "order_id": client.extract_order_id(result)})
        except Exception as exc:
            # A timeout can still fill. Verify flatness below without blindly
            # sending a second closing order.
            receipt.setdefault("submission_errors", []).append(str(exc))
    for _ in range(12):
        remaining = await asyncio.to_thread(client.positions, symbol)
        if not any(client.numeric(r.get("total")) > 0 for r in remaining):
            break
        await asyncio.sleep(1)
    else:
        raise BitgetDemoError("Exchange exposure remains after reset; entries stay paused and protective exits are retained.")
    for row in await asyncio.to_thread(client.strategy_orders, symbol):
        oid = str(row.get("orderId") or "")
        try:
            await asyncio.to_thread(client.cancel_strategy_order, oid)
            receipt["cancelled_orders"].append(oid)
        except Exception:
            # It may have disappeared after the position was closed. The final
            # exchange snapshot, rather than a cancel acknowledgement, decides.
            pass
    remaining = await asyncio.to_thread(client.positions, symbol)
    regular = await asyncio.to_thread(client.pending_orders, symbol)
    strategies = await asyncio.to_thread(client.strategy_orders, symbol)
    if any(client.numeric(r.get("total")) > 0 for r in remaining) or regular or strategies:
        raise BitgetDemoError("Reset has remaining exposure/orders; entries stay paused.")
    receipt.update(status="VERIFIED_FLAT", completed_ts=int(time.time() * 1000),
                   remaining_positions=0, remaining_orders=0)
    return receipt
