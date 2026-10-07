from app.manual_levels import load_manual_level_pack, manual_engine_rules, manual_reaction_levels

def test_dewald_manual_pack_is_complete():
    pack=load_manual_level_pack()
    assert pack["enabled"] is True
    assert len(pack["levels"]) == 13 and len(pack["zones"]) == 4
    assert all(z["estimated"] is True for z in pack["zones"])

def test_manual_pack_is_reaction_only():
    rows=manual_reaction_levels()
    assert len(rows) == 17
    assert any(r["label"]=="1H OB" and r["zone_low"]==83020.0 and r["zone_high"]==83390.0 for r in rows)
    rules=manual_engine_rules()
    assert rules["allow_blind_touch_entries"] is False
    assert rules["entry_requires_confirmation"] is True
    assert rules["min_confirmation_score"] == 3
