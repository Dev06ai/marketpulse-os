"""Verify active exchange stop coverage independently of a submitted preset."""
import math


def number(value) -> float:
    try:
        result = float(value)
        return result if math.isfinite(result) else 0.0
    except (TypeError, ValueError):
        return 0.0


def stop_coverage(positions: list[dict], orders: list[dict], mark_price: float) -> dict:
    rows = []
    for p in positions:
        qty = number(p.get("total") or p.get("positionSize"))
        side = str(p.get("holdSide") or p.get("posSide") or "").lower()
        if qty <= 0:
            continue
        protected = 0.0
        ids = set()
        for o in orders:
            oid = str(o.get("orderId") or "")
            if not oid or oid in ids or str(o.get("posSide") or "").lower() != side:
                continue
            if str(o.get("status") or "").lower() not in {"pending", "live"}:
                continue
            stop = number(o.get("stopLoss"))
            if stop <= 0 or mark_price <= 0 or side not in {"long", "short"}:
                continue
            if (side == "long" and stop >= mark_price) or (side == "short" and stop <= mark_price):
                continue
            if str(o.get("slOrderType") or "market").lower() != "market":
                continue
            ids.add(oid)
            full = str(o.get("tpslMode") or "").lower() == "full"
            # Our full-position SL orders explicitly use full mode and carry
            # this prefix, which can be recovered after ephemeral state loss.
            full = full or (str(o.get("clientOid") or "").startswith("DTSL-") and number(o.get("qty")) == 0)
            protected += qty if full else number(o.get("qty"))
        covered = protected >= qty-max(1e-8, qty*1e-6)
        rows.append({"direction": side.upper(), "position_qty": qty,
                     "stop_qty": min(qty, protected), "coverage_pct": round(min(1,protected/qty)*100, 2),
                     "fully_protected": covered})
    return {"verified": True, "all_positions_protected": all(r["fully_protected"] for r in rows), "positions": rows}
