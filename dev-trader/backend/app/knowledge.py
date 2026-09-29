from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]
with (ROOT / "knowledge" / "strategy_rules.yaml").open("r", encoding="utf-8") as f:
    RULES = yaml.safe_load(f)
