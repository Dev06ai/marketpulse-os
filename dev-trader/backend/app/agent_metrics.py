"""Bounded, descriptive LangGraph agent-observation metrics.

Counts only journaled *review decisions*, never claims a win rate or PnL
edge. Historical fills and feature timestamps are not reconstructed here.
"""
from collections import Counter


def summarize_agent_reviews(records: list[dict]) -> dict:
    rows = [r for r in records if str(r.get("version") or "").startswith("langgraph-")]
    actions = Counter(str(r.get("action") or "UNKNOWN") for r in rows)
    concerns = Counter()
    agents = {}
    disagreement = 0
    for row in rows:
        disagreement += bool(row.get("agent_disagreement"))
        concerns.update(str(x) for x in (row.get("selected_concerns") or []))
        selected_id = str(row.get("engine_selected_id") or "")
        candidates = row.get("candidate_reviews") or []
        selected = next((c for c in candidates if str(c.get("id") or "") == selected_id), None)
        for name, report in (selected or {}).get("agents", {}).items():
            by_agent = agents.setdefault(str(name), Counter())
            by_agent[str(report.get("verdict") or "UNKNOWN")] += 1
    return {
        "sampled_reviews": len(rows),
        "actions": dict(sorted(actions.items())),
        "agent_disagreements": disagreement,
        "agents": {name: dict(sorted(counts.items()))
                   for name, counts in sorted(agents.items())},
        "top_concerns": [{"reason": reason, "count": count}
                         for reason, count in concerns.most_common(12)],
        "profitability_proven": False,
        "measurement_note": "Advisory selection statistics only; not a forecast or verified win rate.",
    }
