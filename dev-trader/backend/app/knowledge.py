from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]
with (ROOT / "knowledge" / "strategy_rules.yaml").open("r", encoding="utf-8") as f:
    RULES = yaml.safe_load(f)

with (ROOT / "knowledge" / "advanced_market_playbook.yaml").open("r", encoding="utf-8") as f:
    MARKET_KNOWLEDGE = yaml.safe_load(f) or {}

def knowledge_summary() -> dict:
    return {
        "version": MARKET_KNOWLEDGE.get("version"),
        "name": MARKET_KNOWLEDGE.get("name"),
        "domains": sorted(
            k for k in MARKET_KNOWLEDGE.keys()
            if k not in {"version", "name", "purpose"}
        ),
    }
