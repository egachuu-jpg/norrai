-- Migration 006: Webhook rate limiting table
-- Tracks request counts per token per time window to enforce rate limits.
-- Each workflow checks this table and rejects requests over threshold.
--
-- Rate limit window: 1 hour
-- Default limit: 60 requests per token per hour
--
-- TO APPLY:
--   psql <neon-connection-string> -f db/migrations/006_rate_limits.sql

CREATE TABLE IF NOT EXISTS webhook_rate_limits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    text        NOT NULL,
  endpoint      text        NOT NULL,
  window_start  timestamptz NOT NULL,
  request_count int         NOT NULL DEFAULT 1,
  UNIQUE (token_hash, endpoint, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup
  ON webhook_rate_limits (token_hash, endpoint, window_start);

-- Auto-clean entries older than 24 hours via a scheduled job or manual VACUUM
-- Quick cleanup query: DELETE FROM webhook_rate_limits WHERE window_start < now() - INTERVAL '24 hours';
