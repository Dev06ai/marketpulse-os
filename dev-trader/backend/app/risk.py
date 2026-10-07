from __future__ import annotations
import math

def calculate_risk(
    account_balance: float,
    risk_pct: float,
    entry: float,
    stop: float,
    target: float | None = None,
    hard_cap_pct: float = 1.0,
) -> dict:
    values = (account_balance, risk_pct, entry, stop, hard_cap_pct)
    if not all(math.isfinite(float(value)) for value in values):
        raise ValueError("Risk inputs must be finite numbers.")
    if account_balance < 0 or risk_pct < 0 or hard_cap_pct < 0:
        raise ValueError("Balance and risk percentages cannot be negative.")
    if entry <= 0 or stop <= 0 or entry == stop:
        raise ValueError("Entry and stop must be positive and different.")
    if target is not None and (not math.isfinite(float(target)) or target <= 0
                               or (target-entry)*(entry-stop) <= 0):
        raise ValueError("Target must be positive and on the profit side of entry.")
    account_balance = max(float(account_balance), 0.0)
    requested_pct = max(float(risk_pct), 0.0)
    applied_pct = min(requested_pct, float(hard_cap_pct))
    entry = float(entry)
    stop = float(stop)
    target_value = None if target is None else float(target)
    distance = abs(entry - stop)
    risk_amount = account_balance * applied_pct / 100.0
    units = risk_amount / distance if distance > 0 else 0.0
    rr = (abs(target_value - entry) / distance) if target_value is not None and distance > 0 else None
    return {
        "account_balance": round(account_balance, 2),
        "requested_risk_pct": round(requested_pct, 4),
        "applied_risk_pct": round(applied_pct, 4),
        "risk_capped": requested_pct > applied_pct,
        "risk_amount": round(risk_amount, 2),
        "entry": round(entry, 8),
        "stop": round(stop, 8),
        "stop_distance": round(distance, 8),
        "stop_distance_pct": round((distance / entry * 100.0) if entry > 0 else 0.0, 5),
        "units_at_1x": round(units, 8),
        "target": round(target_value, 8) if target_value is not None else None,
        "rr": round(rr, 4) if rr is not None else None,
        "manual_execution_only": True,
    }
