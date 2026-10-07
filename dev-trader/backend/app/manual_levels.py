"""Persistent manual level packs used by both charting and reaction logic."""
from __future__ import annotations
import json, math
from pathlib import Path
from typing import Any

PACK_PATH = Path(__file__).resolve().parents[1] / "knowledge" / "manual_level_packs" / "dewald_2026_10_07.json"

def _finite(value: Any) -> float | None:
    try: out=float(value)
    except (TypeError, ValueError): return None
    return out if math.isfinite(out) and out>0 else None

def load_manual_level_pack() -> dict:
    try: data=json.loads(PACK_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {"enabled":False,"pack_id":"unavailable","levels":[],"zones":[],"engine_rules":{}}
    data.setdefault("levels",[]); data.setdefault("zones",[]); data.setdefault("engine_rules",{})
    return data

def manual_engine_rules() -> dict:
    pack=load_manual_level_pack()
    return dict(pack.get("engine_rules") or {}) if pack.get("enabled") else {}

def manual_level_pack_summary() -> dict:
    pack=load_manual_level_pack()
    return {"pack_id":pack.get("pack_id","manual"),"pack_name":pack.get("pack_name","Manual Levels"),
            "symbol":pack.get("symbol","BTCUSDT"),"enabled":bool(pack.get("enabled",False)),
            "level_count":len(pack.get("levels") or []),"zone_count":len(pack.get("zones") or []),
            "zone_boundaries_estimated":any(bool(x.get("estimated")) for x in pack.get("zones") or [] if isinstance(x,dict))}

def manual_reaction_levels() -> list[dict]:
    pack=load_manual_level_pack()
    if not pack.get("enabled") or str(pack.get("symbol","BTCUSDT")).upper()!="BTCUSDT": return []
    rows=[]; pid=str(pack.get("pack_id","manual"))
    for raw in pack.get("levels") or []:
        if not isinstance(raw,dict): continue
        price=_finite(raw.get("price"))
        if price is None: continue
        rows.append({"id":raw.get("id") or f"manual:{price:.2f}","kind":str(raw.get("kind","LEVEL")).upper(),
            "label":str(raw.get("label") or raw.get("kind") or "LEVEL"),"price":round(price,2),
            "direction":str(raw.get("reaction_bias","BOTH")).upper(),"source":"MANUAL_LEVEL_PACK",
            "pack_id":pid,"manual":True,"priority":int(raw.get("priority") or 0)})
    for raw in pack.get("zones") or []:
        if not isinstance(raw,dict): continue
        lo=_finite(raw.get("bottom")); hi=_finite(raw.get("top"))
        if lo is None or hi is None: continue
        lo,hi=sorted((lo,hi)); mid=(lo+hi)/2
        rows.append({"id":raw.get("id") or f"manual:zone:{mid:.2f}","kind":str(raw.get("kind","OB_ZONE")).upper(),
            "label":str(raw.get("label") or "ZONE"),"price":round(mid,2),"direction":str(raw.get("reaction_bias","BOTH")).upper(),
            "source":"MANUAL_LEVEL_PACK","pack_id":pid,"manual":True,"priority":int(raw.get("priority") or 0),
            "zone_low":round(lo,2),"zone_high":round(hi,2),"timeframe":str(raw.get("timeframe") or ""),
            "estimated":bool(raw.get("estimated",False))})
    return rows
