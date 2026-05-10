-- NorrAI Postgres Schema
-- Hosted on Neon
-- Run: psql <neon-connection-string> -f db/schema.sql

-- Enable pgcrypto for gen_random_uuid() and PII encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── PII helpers (created by migration 001_encrypt_pii.sql) ──────────────────
-- pii_encrypt(text, key)  → bytea   — pgp_sym_encrypt wrapper; NULL-safe
-- pii_decrypt(bytea, key) → text    — pgp_sym_decrypt wrapper; NULL-safe
-- pii_hash(text)          → text    — SHA-256 hex for equality lookups; NULL-safe

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
  primary_contact_name       bytea,                -- pii_encrypt'd
  primary_contact_email      bytea,                -- pii_encrypt'd
  primary_contact_email_hash text,                 -- pii_hash'd; used for lookups
  primary_contact_phone      bytea,                -- pii_encrypt'd
  website               text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_clients_status     ON clients(status);
CREATE INDEX idx_clients_email_hash ON clients(primary_contact_email_hash);


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
  lead_name   bytea,                -- pii_encrypt'd
  email       bytea,                -- pii_encrypt'd
  email_hash  text,                 -- pii_hash'd; used for dedupe lookups
  phone       bytea,                -- pii_encrypt'd
  phone_hash  text,                 -- pii_hash'd; used for dedupe lookups
  source       text,                     -- zillow | website | referral | form | phone | etc.
  lead_message text,
  status       text NOT NULL DEFAULT 'new', -- new | contacted | nurturing | converted | dead
  metadata     jsonb,                    -- vertical-specific fields (property info, policy type, etc.)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_leads_client_status ON leads(client_id, status);
CREATE INDEX idx_leads_email_hash    ON leads(email_hash);
CREATE INDEX idx_leads_phone_hash    ON leads(phone_hash);


CREATE TABLE appointments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               uuid NOT NULL REFERENCES clients(id),
  customer_name           bytea,                -- pii_encrypt'd
  customer_email          bytea,                -- pii_encrypt'd
  customer_phone          bytea,                -- pii_encrypt'd
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
