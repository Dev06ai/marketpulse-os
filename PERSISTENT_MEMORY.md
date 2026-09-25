# MarketPulse persistent memory

MarketPulse stores journal entries, signal history, watchlist state, alert state, and the Trader Brain context.

## Durable cloud storage

Set a Render environment variable:

- `DATABASE_URL` = your PostgreSQL connection string

The server creates the `marketpulse_memory` table automatically on startup.

Without `DATABASE_URL`, MarketPulse uses a local fallback plus browser localStorage. That is useful for development but is not durable across a full Render instance replacement.

The browser receives a memory status label:

- **cloud synced** = PostgreSQL persistence is active
- **device fallback** = local fallback is active
- **offline** = sync request failed; local browser data remains available
