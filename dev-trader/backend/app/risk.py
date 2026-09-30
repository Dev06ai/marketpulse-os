from __future__ import annotations

def calculate_risk(
    account_balance: float,
    risk_pct: float,
    entry: float,
    stop: float,
    target: float | None = None,
    hard_cap_pct: float = 1.0,
) -> dict:
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
