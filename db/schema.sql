-- NorrAI Postgres Schema
-- Hosted on Neon
-- Run: psql <neon-connection-string> -f db/schema.sql

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- UTILITY: auto-update updated_at on row change
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- INTERNAL OPS TABLES
-- ============================================================

CREATE TABLE clients (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name         text NOT NULL,
  vertical              text NOT NULL,   -- dental | real_estate | insurance | salon | etc.
  tier                  text NOT NULL,   -- starter | growth | pro
  status                text NOT NULL,   -- prospect | active | paused | churned
  primary_contact_name  text,
  primary_contact_email text,
  primary_contact_phone text,
  website               text,
  notes                 text,
  token                 uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_clients_status ON clients(status);


CREATE TABLE service_contracts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES clients(id),
  tier          text NOT NULL,           -- starter | growth | pro
  monthly_price numeric(10,2),
  setup_fee     numeric(10,2),
  start_date    date NOT NULL,
  end_date      date,                    -- null = currently active
  status        text NOT NULL,           -- active | paused | cancelled
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE twilio_subaccounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES clients(id),
  subaccount_sid  text UNIQUE NOT NULL,
  phone_number    text,                  -- E.164 format e.g. +15071234567
  created_at      timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE norrai_meetings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES clients(id),
  meeting_type     text,                 -- discovery | onboarding | check_in | upsell
  scheduled_at     timestamptz,
  duration_minutes int,
  outcome          text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- WORKFLOW DATA TABLES
-- ============================================================

CREATE TABLE leads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES clients(id),
  lead_name    text,
  email        text,
  phone        text,
  source       text,                     -- zillow | website | referral | form | phone | etc.
  lead_message text,
  status              text NOT NULL DEFAULT 'new', -- new | contacted | qualified | nurturing | converted | unenrolled | dead
  metadata            jsonb,                    -- vertical-specific fields (property info, policy type, etc.)
  nurture_enrolled_at timestamptz,              -- set when lead enters cold nurture sequence
  sms_opt_out         boolean NOT NULL DEFAULT FALSE,
  email_opt_out       boolean NOT NULL DEFAULT FALSE,
  communication_opted_out boolean NOT NULL DEFAULT FALSE, -- excludes lead from marketing broadcast emails (weekly drip); does NOT affect transactional msgs
  opted_out_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_leads_client_status ON leads(client_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_email_phone
  ON leads(email, phone)
  WHERE email IS NOT NULL AND phone IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_email_only
  ON leads(email)
  WHERE email IS NOT NULL AND phone IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_phone_only
  ON leads(phone)
  WHERE phone IS NOT NULL AND email IS NULL;


CREATE TABLE appointments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               uuid NOT NULL REFERENCES clients(id),
  customer_name           text,
  customer_email          text,
  customer_phone          text,
  appointment_type        text,          -- cleaning | exam | showing | haircut | etc.
  scheduled_at            timestamptz NOT NULL,
  duration_minutes        int,
  status                  text NOT NULL DEFAULT 'scheduled', -- scheduled | confirmed | no_show | cancelled | completed
  reminder_sent_at        timestamptz,
  follow_up_sent_at       timestamptz,
  review_request_sent_at  timestamptz,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_appointments_client_scheduled ON appointments(client_id, scheduled_at);


CREATE TABLE workflow_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES clients(id),
  workflow_name text NOT NULL,           -- missed_call | listing_description | appointment_reminder | etc.
  event_type    text NOT NULL,           -- triggered | completed | failed
  payload       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_events_client_workflow_time
  ON workflow_events(client_id, workflow_name, created_at);


-- ============================================================
-- COS (CHIEF OF STAFF) SESSIONS
-- ============================================================

CREATE TABLE cos_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text NOT NULL,
  channel    text NOT NULL CHECK (channel IN ('slack', 'sms')),
  messages   jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel)
);

CREATE TRIGGER cos_sessions_updated_at
  BEFORE UPDATE ON cos_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- RESEARCH AGENT CACHE
-- ============================================================

CREATE TABLE research_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address     text NOT NULL,
  zip         text,
  result      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + INTERVAL '7 days'
);

CREATE INDEX idx_research_cache_address_expires ON research_cache(address, expires_at);

-- ============================================================
-- WEEKLY MARKETING DRIP (Weichert weekly listing email)
-- ============================================================

-- Queue of agent-submitted listing batches awaiting the Monday 9am CT send.
-- One row per intake-form submission. The Monday workflow reads the latest
-- pending row, scrapes each listing, sends, then marks it sent.
CREATE TABLE IF NOT EXISTS listing_queue (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  listings     jsonb NOT NULL,            -- [{url: string, address: string|null}] — max 10
  status       text NOT NULL DEFAULT 'pending', -- pending | sent | failed
  sent_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_listing_queue_status_submitted
  ON listing_queue(status, submitted_at DESC);

-- ============================================================
-- EMAIL TRIAGE ASSISTANT
-- ============================================================

-- Stores all processed emails: dedup key + audit log.
-- status = auto_actioned for emails acted on automatically,
-- pending = awaiting Telegram approval,
-- approved/skipped = resolved via Telegram reply.
CREATE TABLE IF NOT EXISTS email_triage_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      TEXT NOT NULL,
  inbox           TEXT NOT NULL,
  sender          TEXT,
  subject         TEXT,
  snippet         TEXT,
  category        TEXT,
  proposed_action TEXT,
  status          TEXT DEFAULT 'auto_actioned',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  UNIQUE(message_id, inbox)
);

-- One row per inbox per sweep run for health monitoring.
CREATE TABLE IF NOT EXISTS email_triage_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            TEXT NOT NULL,
  inbox             TEXT NOT NULL,
  emails_processed  INT DEFAULT 0,
  auto_actioned     INT DEFAULT 0,
  queued_for_review INT DEFAULT 0,
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_triage_queue_pending
  ON email_triage_queue(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_triage_queue_dedup
  ON email_triage_queue(message_id, inbox);
