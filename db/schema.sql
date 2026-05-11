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
  status       text NOT NULL DEFAULT 'new', -- new | contacted | nurturing | converted | dead
  metadata     jsonb,                    -- vertical-specific fields (property info, policy type, etc.)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_leads_client_status ON leads(client_id, status);


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
