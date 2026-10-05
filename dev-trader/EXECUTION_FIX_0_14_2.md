# Demo entry reconciliation fix — 0.14.2 / build 100

The October 5 report exposed a timing bug: a strategy signal arriving during
the routine exchange refresh was permanently skipped. The plan was then kept
active because demo lifecycle updates correctly depend on exchange fills,
but unsubmitted rejections had no terminal lifecycle path.

Changes:

- Admission joins an in-progress refresh and reuses its completed snapshot.
  Refresh and admission remain mutually exclusive through order submission.
- Lock waiting is bounded by the original 15-second signal lifetime. The
  final freshness, price drift, fee-adjusted reward/risk, accounting, exposure,
  stop-protection and loss-limit checks remain in force. Old targets are never
  chased and no real order request is cancelled by the lock timeout.
- Unsubmitted rejections become `NOT_EXECUTED` and persist as such across
  restarts. They add no win, loss, P&L or zero-R learning sample. Existing or
  uncertain exchange submissions remain managed through reconciliation.
- Android shows historical skip/error reasons under a timestamped last entry
  attempt instead of presenting them as the current scanning status.
- Runtime diagnostics now identify demo execution correctly. The backend
  revision is `market-decision-v3.1`; exchange client IDs retain the V3
  generation for stable retry/recovery identity.

Regression coverage exercises overlapping refreshes, expiry during refresh,
failed history requests, the final entry gate, late prices, durable retirement,
and preservation of open/pending/uncertain exchange orders. Release publication
requires backend tests, the constrained-container probe, Android builds,
six emulator layout checks and native host connectivity checks.

A displayed setup is a candidate, not a fill or a guaranteed winning trade.
The fix does not relax market-data or risk gates, and profitability is not
established by the subsequent price reaching a rejected setup's target.
