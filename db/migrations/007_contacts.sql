-- db/migrations/007_contacts.sql
-- contacts + contact_transactions: a client's own customer book (households) + deal history.
-- Safe to run on the live database: only creates the two new tables/indexes/trigger and is
-- idempotent (IF NOT EXISTS / CREATE OR REPLACE). Depends on clients, leads and set_updated_at(),
-- which already exist. The same block is appended to db/schema.sql.
-- Apply with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/007_contacts.sql

-- ============================================================
-- CONTACTS: a client's own customer book (households)
-- ============================================================
-- One row per household (a couple/family that shares a mailing address), scoped
-- to the client business via client_id -- same convention as leads/appointments.
-- Norr AI's own contacts would be `norrai_contacts`, like `norrai_meetings`.
-- Vertical-specific fields go in metadata jsonb. `stage` is the relationship:
-- past_client / active_client / sphere / prospect. A row is created by an import
-- (source + source_key make re-imports idempotent) or promoted from a lead.
CREATE TABLE IF NOT EXISTS contacts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES clients(id),
  lead_id          uuid REFERENCES leads(id),            -- set when promoted from a lead
  display_name     text NOT NULL,                        -- as printed on a label: "Dave & Jenny Campbell"
  first_name       text,
  last_name        text,
  second_first_name text,                                -- second person in the household, if any
  second_last_name  text,
  phone            text,                                 -- 10 digits
  email            text,
  mail_street      text,
  mail_city        text,
  mail_state       text,
  mail_zip         text,
  address_status   text NOT NULL DEFAULT 'needs_lookup'
    CHECK (address_status IN ('buyer_property', 'contact_file', 'needs_lookup', 'verified', 'undeliverable')),
  address_verified_at timestamptz,                       -- set when checked against USPS/county records
  stage            text NOT NULL DEFAULT 'past_client'
    CHECK (stage IN ('past_client', 'active_client', 'sphere', 'prospect')),
  review_reasons   text[] NOT NULL DEFAULT '{}',         -- why a human should look at this row
  first_closing    date,
  last_closing     date,
  deal_count       integer NOT NULL DEFAULT 0,
  source           text,                                 -- e.g. back_agent | brokersumo | manual
  source_key       text,                                 -- stable key within source (hash of names)
  metadata         jsonb,
  sms_opt_out      boolean NOT NULL DEFAULT FALSE,
  email_opt_out    boolean NOT NULL DEFAULT FALSE,
  do_not_mail      boolean NOT NULL DEFAULT FALSE,
  opted_out_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_contacts_client_stage ON contacts(client_id, stage);
CREATE INDEX IF NOT EXISTS idx_contacts_client_addr_status ON contacts(client_id, address_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_source_key
  ON contacts(client_id, source, source_key)
  WHERE source IS NOT NULL AND source_key IS NOT NULL;

-- One row per deal. Real-estate-shaped on purpose; other verticals keep history in
-- appointments (dental) or their own table later.
CREATE TABLE IF NOT EXISTS contact_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id       uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES clients(id),
  side             text NOT NULL CHECK (side IN ('Buyer', 'Seller', 'Landlord', 'Tenant')),
  closing_date     date,
  started_date     date,
  phase            text,                                 -- Post-Closing | Termination | ...
  agent_name       text,
  street           text,
  city             text,
  state            text,
  zip              text,
  address_incomplete boolean NOT NULL DEFAULT FALSE,     -- truncated/partial in the source
  source           text,
  source_ref       text,                                 -- stable id of the deal in the source system
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_transactions_contact ON contact_transactions(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_transactions_client_closing ON contact_transactions(client_id, closing_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_transactions_source_ref
  ON contact_transactions(client_id, source, source_ref)
  WHERE source IS NOT NULL AND source_ref IS NOT NULL;
