# KYVORIQ: LangGraph decision review (pilot)

## What is actually integrated

The Python 3.12 FastAPI engine now calls a LangGraph StateGraph only **after**
its normal SFP, D-Line, MSS, breakout/retest, momentum, level-reaction,
playbook, learning and elite-admission checks have already qualified signals.

Graph nodes: market health -> parallel specialist reviewers -> candidate
evidence review -> risk preflight -> supervisor. Four reviewers operate
independently in parallel:

- regime: 1H/4H and structure alignment; warns about counter-trend setups.
- liquidity: checks observed direction of SFP/level reaction without inventing touches.
- orderflow: directional CVD divergence and *fresh* order-book imbalance.
  Open-interest expansion is context only, never a directional vote.
- entry_timing: compares current BTC price with planned entry and 15m ATR;
  warns about chasing, never changes a price.

The market-health node can route directly to supervisor/WAIT. A specialist's
SUPPORT/CAUTION/UNKNOWN status is an evidence annotation, **not a win
probability**. A caution is *not* an automatic veto; many valid reversals
run against the existing trend. Objective risk geometry and feed failures
still block in guard mode. Nodes are deterministic and read-only: no LLM, exchange API,
live order capability, credential access, or model-generated entry price.

**The graph cannot create/override a trade, add leverage, or bypass the
Bitget executor.** It does not improve win rate by itself; it adds explainable
checks and a comparison mechanism.

## Modes

KYVORIQ_LANGGRAPH_MODE=shadow (default)
- Graph runs for qualified candidates.
- Decisions and small diagnostics are attached to the signal and journaled as
  LANGGRAPH alongside the existing engine revision.
- Graph output **cannot change** the engine's signal/execution action.

KYVORIQ_LANGGRAPH_MODE=guard (opt-in only after forward validation)
- Existing quality gate remains authoritative.
- A graph WAIT/REJECT/error vetoes creation of a *new* signal. It cannot
  invent or force entries. Existing execution rules still validate every order.
- A reviewer error fails closed: no new order on that candidate.

KYVORIQ_LANGGRAPH_MODE=off
- Graph is skipped; previous decision behavior is preserved.

Set mode through deployment environment; never expose it as an unauthenticated
user-facing toggle. Leave Bitget **demo only** and retain
DEMO_EXECUTION_PAUSED=true during the initial rollout.

## Reliability and bounded memory

This is a short, per-candidate graph, not a conversational agent. We do not
save whole market snapshots or checkpoint on every tick: KYVORIQ's bounded
DecisionJournal already holds durable decision evidence. A persistent
LangGraph checkpoint database for 1-second candles would accumulate records,
raise storage costs and potentially impair the 128 MB free host. The graph
processes up to 16 qualified candidates; reviews contain bounded names,
trace and blockers. A read-only /agents endpoint reports recent audit counts,
agent disagreements and cautions without claiming any profitability. It runs only when existing signal gates pass, not
on every WebSocket message.

## Acceptance before enabling guard

1. The backend pytest suite and Python compile checks pass.
2. The free 128 MB container starts and passes smoke tests without OOM.
3. Live demo market feeds remain healthy; no review exceptions or significant
   event-loop stalls occur.
4. Record several market sessions of shadow decisions, separating
   blocked, passed and disagreement cases.
5. Validate net demo outcomes, fees, slippage, missed opportunities, drawdown
   and rejection reasons. Do not treat heuristic confidence as a win rate.
6. Keep an operator kill-switch and return immediately to off on regression.

**Deployment note:** Updating this GitHub branch alone does not prove the
Deplexo service deployed it. The deployed /bootstrap, /config, /health
and Deplexo logs must be checked separately. PR CI is configured to avoid
restarting Deplexo during review.

## Next learning milestone

- Compare specialist disagreements with actual resolved Bitget demo fills and
  missed opportunities using chronological, fee-aware forward evidence.
- Keep shadow logs separate from executed PnL; journal sample counts alone
  cannot establish an edge.
- Only after sufficient validation consider a veto policy, using explicit
  rollout gates and no automatic live-money execution.
