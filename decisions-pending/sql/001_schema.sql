-- Decisions Pending — schema (Task A1)
-- Derived from decisions-pending-prd.md §7 via the dev spec (the PRD file itself
-- is not in this repo; column set reconstructed from every reference in the
-- dev spec — see decisions-pending/README.md § Schema provenance).
--
-- Idempotent: safe to run repeatedly (psql -f sql/001_schema.sql).
-- All timestamps stored UTC (timestamptz); "today" for app logic is
-- America/Chicago via cos.today_chicago().

CREATE SCHEMA IF NOT EXISTS cos;

-- Chicago-local "today" — every date comparison in app logic uses this,
-- never CURRENT_DATE (which is UTC on the server).
CREATE OR REPLACE FUNCTION cos.today_chicago() RETURNS date
LANGUAGE sql STABLE
AS $$ SELECT (now() AT TIME ZONE 'America/Chicago')::date $$;

-- ---------------------------------------------------------------------------
-- pending_decisions — one row per open loop Egan owes a decision/action on
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cos.pending_decisions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  ask           text,             -- one sentence: what is being asked of Egan
  detail        text,
  consequence   text,             -- what happens if missed (rendered for critical items)
  deadline      date,             -- NULL = no deadline, always surfaced
  lead_days     integer NOT NULL DEFAULT 7 CHECK (lead_days >= 0),
  urgency       text NOT NULL DEFAULT 'normal'
    CHECK (urgency IN ('low', 'normal', 'high', 'critical')),
  status        text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'done', 'dismissed', 'expired')),
  snoozed_until date,             -- snoozed items stay status='open', hidden until this date
  owner         text NOT NULL DEFAULT 'egan',
  source        text NOT NULL
    CHECK (source IN ('manual', 'email', 'calendar', 'recurring', 'system')),
  source_ref    text NOT NULL,    -- thread_id / event_id / rule_id:date / uuid4 for manual
  draft_reply   text,             -- classifier-suggested reply (email items)
  nag_pending   boolean NOT NULL DEFAULT false,  -- set by anti-staleness job (Task A4)
  escalated_at  timestamptz,      -- set once when the deadline-7 one-tier promotion fires
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,      -- when status left 'open'
  UNIQUE (source, source_ref)
);

CREATE INDEX IF NOT EXISTS idx_pending_decisions_surfacing
  ON cos.pending_decisions (status, snoozed_until, deadline);
-- (source, source_ref) lookup is covered by the UNIQUE constraint's index.

-- ---------------------------------------------------------------------------
-- command_log — audit trail of every state-changing call through the cos API
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cos.command_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id   uuid REFERENCES cos.pending_decisions(id),
  source_agent  text NOT NULL DEFAULT 'hermes',
  parsed_action jsonb NOT NULL,   -- the request as received (method, path, body)
  applied       boolean NOT NULL,
  error         text,             -- populated when applied = false
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_command_log_decision
  ON cos.command_log (decision_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- digest_log — one row per rendered morning digest
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cos.digest_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_date   date NOT NULL DEFAULT cos.today_chicago(),
  rendered_text text NOT NULL,
  item_ids      uuid[] NOT NULL,  -- pending_decisions ids in rendered (numbered) order
  model         text NOT NULL,
  sent_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_digest_log_sent_at
  ON cos.digest_log (sent_at DESC);

-- ---------------------------------------------------------------------------
-- decision_rules — recurring obligations, expanded nightly by WF-rules (v1.1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cos.decision_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  rrule       text NOT NULL,      -- RFC 5545 RRULE string (dateutil.rrule compatible)
  lead_days   integer NOT NULL DEFAULT 7 CHECK (lead_days >= 0),
  urgency     text NOT NULL DEFAULT 'normal'
    CHECK (urgency IN ('low', 'normal', 'high', 'critical')),
  consequence text,
  detail      text,
  owner       text NOT NULL DEFAULT 'egan',
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- v_surfaced — what the digest and /pending show today
--   open, not snoozed into the future, and inside the lead window
--   (no-deadline items always show; deadline - lead_days = today must show)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW cos.v_surfaced AS
SELECT p.*
FROM cos.pending_decisions p
WHERE p.status = 'open'
  AND (p.snoozed_until IS NULL OR p.snoozed_until <= cos.today_chicago())
  AND (p.deadline IS NULL
       OR (p.deadline - p.lead_days) <= cos.today_chicago());

-- ---------------------------------------------------------------------------
-- cos_api role — the ONLY credential the API process holds.
-- No DELETE anywhere, no access outside the cos schema.
-- Password is intentionally not set here: operator runs
--   ALTER ROLE cos_api PASSWORD '<generated>';
-- after applying this file (never commit a password).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cos_api') THEN
    CREATE ROLE cos_api LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA cos TO cos_api;
GRANT SELECT, INSERT, UPDATE ON cos.pending_decisions, cos.command_log TO cos_api;
GRANT SELECT ON cos.digest_log, cos.v_surfaced TO cos_api;
GRANT EXECUTE ON FUNCTION cos.today_chicago() TO cos_api;
-- No grants on decision_rules: only n8n (its own credential) reads/writes rules.
-- REVOKE the PUBLIC default so cos_api cannot reach public schema objects.
REVOKE ALL ON SCHEMA public FROM cos_api;
