"""Compact strategy metadata carried by Bitget's durable 32-character client ID.

This preserves family/timeframe/regime and planned risk through a host restart.
It does not pretend to store the full order-flow thesis or an unlimited history.
"""
import hashlib

FAMILIES = {"S": "SFP", "D": "D-LINE", "B": "BREAKOUT RETEST", "M": "MSS",
            "F": "MOMENTUM CAPTURE", "H": "HARMONIC", "U": "UNKNOWN"}
TIMEFRAMES = {"5": "5m", "F": "15m", "H": "1h", "U": "UNKNOWN"}
REGIMES = {"U": "TREND_UP", "D": "TREND_DOWN", "R": "RANGE", "V": "HIGH_VOL", "X": "UNKNOWN"}
DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def family(setup: str) -> str:
    text = str(setup).upper()
    for code, name in FAMILIES.items():
        if name in text or (code == "D" and "DLINE" in text) or (code == "B" and "BREAKOUT" in text):
            return name
    return text or "UNKNOWN"


def client_identity(signal: dict, risk_usdt: float) -> str:
    fam = next((k for k,v in FAMILIES.items() if v == family(signal.get("setup"))), "U")
    tf = next((k for k,v in TIMEFRAMES.items() if v == signal.get("timeframe")), "U")
    reg = next((k for k,v in REGIMES.items() if v == signal.get("regime")), "X")
    cents = max(0, min(36**3-1, round(risk_usdt*100)))
    risk = "".join(DIGITS[(cents // (36**p)) % 36] for p in (2,1,0))
    direction = "L" if signal.get("direction") == "LONG" else "S"
    digest = hashlib.sha256(str(signal.get("id")).encode()).hexdigest()[:16]
    return f"DTDEMO-V2{fam}{tf}{reg}{direction}{risk}{digest}"


def decode_identity(oid: str) -> dict:
    if len(oid) != 32 or not oid.startswith("DTDEMO-V2"):
        return {}
    if oid[9] not in FAMILIES or oid[10] not in TIMEFRAMES or oid[11] not in REGIMES or oid[12] not in "LS":
        return {}
    try:
        risk = int(oid[13:16], 36)/100
        int(oid[16:], 16)
    except ValueError:
        return {}
    return {"setup": FAMILIES[oid[9]], "timeframe": TIMEFRAMES[oid[10]],
            "regime": REGIMES[oid[11]], "direction": "LONG" if oid[12] == "L" else "SHORT",
            "planned_risk_usdt": risk, "recovery_scope": "EXCHANGE_FAMILY_CONTEXT"}
