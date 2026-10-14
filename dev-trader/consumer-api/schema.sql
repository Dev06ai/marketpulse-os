-- Separate database and credentials from KYVORIQ's live trading system.
-- Never grant consumers permissions on exchange, execution, strategy or owner tables.
BEGIN;
CREATE TABLE IF NOT EXISTS consumer_accounts (
    subject TEXT PRIMARY KEY CHECK (length(subject) BETWEEN 1 AND 256),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS consumer_entitlements (
    subject TEXT PRIMARY KEY REFERENCES consumer_accounts(subject) ON DELETE CASCADE,
    tier TEXT NOT NULL CHECK (tier IN ('BASIC','PRO','ELITE')),
    source TEXT NOT NULL CHECK (source IN ('payment_webhook','admin_grant')),
    valid_until TIMESTAMPTZ NOT NULL,
    source_reference TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS consumer_billing_events (
    provider TEXT NOT NULL,
    event_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(provider, event_id)
);
CREATE TABLE IF NOT EXISTS consumer_audit_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_subject TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    details JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS consumer_entitlements_expiry_idx ON consumer_entitlements(valid_until);
COMMIT;
