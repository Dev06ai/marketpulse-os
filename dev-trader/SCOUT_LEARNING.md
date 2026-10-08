# KYVORIQ — Opportunity Scout & Performance Learning (observational)

Two new read-only agents extend the LangGraph specialist team's evidence flow
without changing KYVORIQ's 1–3-trades/day policy or its Bitget demo execution
engine. The agents do NOT promise better win rate.

## 1. Opportunity Scout

The market callback runs the scout after the existing strategy evaluator.
It can observe:
- REJECTED_CANDIDATE: a real detector candidate failed the existing gate;
- UNSELECTED_QUALIFIED: qualified detector not chosen;
- RADAR_WATCH: an explicitly developing/confirmed radar hint with NO confirmed
  executable entry/stop/target.

Selected signals are excluded; actual executions have their own exchange
history. The scout requires healthy connected market data and a fresh quote.
Records are bounded to 16 simultaneously pending, 24 per UTC day, and 90-minute
cooldown per source/direction/setup.

### Forward evidence

Each observation has a 60-minute horizon. The existing sampled-price journal is
used to measure directional price movement and observed favorable/adverse
excursion, **only** when it contains sufficiently continuous samples and a
timestamped terminal observation. Missing or gapped windows are UNVERIFIABLE.
Results have the label RESOLVED_PRICE_ONLY. They are *not* a hypothetical
backtest, trade execution, attainable return, or missed profit. We do not
pretend radar had an entry/SL/TP or choose fills in hindsight.

The scout's latest observations and limits are exposed at GET /agents/scout.
It uses the existing bounded local DecisionJournal, not a paid database.
Restart recovery is best effort and bounded by journal retention. No change is
made to the executor when a scout observation looks favorable.

## 2. Performance Learning Agent

Runs approximately every five minutes independently of trading signals.
Read-only evidence includes:
- Closed Bitget demo trades **with confirmed actual fills** and a numeric
  exchange-reported net P&L;
- exact signal_id matched to the signal's saved LangGraph reviewer verdicts;
- whether the fill ledger has a complete window AND complete fee accounting;
- separately the count of favorable scout price paths.

Agent comparison of CAUTION/SUPPORT/UNKNOWN versus realized net P&L is
descriptive only. Per-verdict mean results are hidden until at least 30
observations and verified fee accounting. That threshold is not evidence of
statistical significance; out-of-sample forward verification is still required.
If ledger accounting is incomplete, fee-complete P&L metrics remain unknown.
Unknown or unresolved trades cannot become wins.

GET /agents/learning returns the latest report, including whether fee-accounted
results are available and how many graph decisions matched actual fills. The
existing GET /agents also shows bounded counts. All endpoints are read-only.
The agent does not retrain, rewrite strategy rules, change leverage, or execute.

## Operating safeguards

- Leave KYVORIQ_LANGGRAPH_MODE=shadow for the first forward-test sessions.
- Leave demo entries operator-paused during the initial audit where feasible;
  never enable real-money execution based on this observational change.
- A scout or attribution exception cannot block the primary market callback.
- Do not treat a positive observed directional move as a missed executable
  trade, or use it to boost uncalibrated confidence.
- Real improvement requires stable market feed, reconciled fills, true fees,
  multi-session comparison, and an unbiased holdout period.
- Monitor journal retention and the /agents endpoints; the database can be
  ephemeral if /data is not mounted.
