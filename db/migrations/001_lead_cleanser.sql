-- db/migrations/001_lead_cleanser.sql
-- Lead Cleanser + Lead Response schema additions
-- Apply with: psql <neon-connection-string> -f db/migrations/001_lead_cleanser.sql

-- clients: add token for per-client webhook auth
ALTER TABLE clients ADD COLUMN IF NOT EXISTS token text UNIQUE;

-- leads: add pipeline stage + AI OS scheduler fields
ALTER TABLE leads ADD COLUMN IF NOT EXISTS stage text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_contacted_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_action_due date;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS notes text;

-- workflow_events: add lead_id for per-lead history queries
ALTER TABLE workflow_events ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES leads(id);

-- approval_tokens: one row per lead response event, holds both drafts + session token
CREATE TABLE IF NOT EXISTS approval_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token        text UNIQUE NOT NULL,
  lead_id      uuid NOT NULL REFERENCES leads(id),
  client_id    uuid NOT NULL REFERENCES clients(id),
  sms_draft    text,
  email_draft  text,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_tokens_token ON approval_tokens(token);
CREATE INDEX IF NOT EXISTS idx_approval_tokens_lead ON approval_tokens(lead_id);
