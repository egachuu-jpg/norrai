-- db/migrations/008_deal_status_stage_lock.sql
-- Stage is derived from deals, not set by imports:
--   contact_transactions.deal_status  active | pending | closed | cancelled
--   contacts.stage_locked             TRUE = stage was set by hand; loads never change it
-- After every load, scripts/load_contacts.py recomputes each unlocked contact's stage:
--   any active/pending deal -> active_client; else any closed deal -> past_client;
--   only cancelled deals -> review reason 'only_cancelled_deals' (client stages -> prospect).
-- Idempotent. Apply with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/008_deal_status_stage_lock.sql

ALTER TABLE contact_transactions ADD COLUMN IF NOT EXISTS deal_status text NOT NULL DEFAULT 'closed';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_transactions_deal_status_check') THEN
    ALTER TABLE contact_transactions ADD CONSTRAINT contact_transactions_deal_status_check
      CHECK (deal_status IN ('active', 'pending', 'closed', 'cancelled'));
  END IF;
END $$;

-- Back Agent deals in the Termination phase never closed
UPDATE contact_transactions SET deal_status = 'cancelled'
WHERE source = 'back_agent' AND phase ILIKE 'termination%' AND deal_status <> 'cancelled';

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS stage_locked boolean NOT NULL DEFAULT FALSE;
