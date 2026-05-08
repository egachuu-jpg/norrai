-- Migration 002: PII column encryption
-- Adds encrypted shadow columns for PII in leads, appointments, and clients tables
-- using pgp_sym_encrypt (pgcrypto symmetric encryption).
--
-- HOW TO RUN:
--   1. Replace REPLACE_WITH_STRONG_KEY with your actual encryption key (store it in a password manager)
--   2. psql <neon-connection-string> -f db/migrations/002_pii_encryption.sql
--
-- BEFORE DROPPING PLAINTEXT COLUMNS:
--   - Update all n8n workflows that query/filter by email or phone to use
--     pgp_sym_decrypt(column_enc, 'KEY') = 'value' instead of direct column comparison
--   - The DROP COLUMN statements are commented out — uncomment only after workflows are updated
--
-- TO DECRYPT (in SQL or n8n Code nodes):
--   pgp_sym_decrypt(email_enc, 'KEY') → plain text email

-- pgcrypto is already enabled in schema.sql but ensure it's present
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- leads table: lead_name, email, phone, lead_message
-- ============================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS lead_name_enc     bytea,
  ADD COLUMN IF NOT EXISTS email_enc         bytea,
  ADD COLUMN IF NOT EXISTS phone_enc         bytea,
  ADD COLUMN IF NOT EXISTS lead_message_enc  bytea;

UPDATE leads SET
  lead_name_enc    = CASE WHEN lead_name    IS NOT NULL THEN pgp_sym_encrypt(lead_name,    'REPLACE_WITH_STRONG_KEY') END,
  email_enc        = CASE WHEN email        IS NOT NULL THEN pgp_sym_encrypt(email,        'REPLACE_WITH_STRONG_KEY') END,
  phone_enc        = CASE WHEN phone        IS NOT NULL THEN pgp_sym_encrypt(phone,        'REPLACE_WITH_STRONG_KEY') END,
  lead_message_enc = CASE WHEN lead_message IS NOT NULL THEN pgp_sym_encrypt(lead_message, 'REPLACE_WITH_STRONG_KEY') END;

-- Uncomment after updating n8n workflows:
-- ALTER TABLE leads
--   DROP COLUMN lead_name,
--   DROP COLUMN email,
--   DROP COLUMN phone,
--   DROP COLUMN lead_message;

-- ============================================================
-- appointments table: customer_name, customer_email, customer_phone
-- ============================================================

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS customer_name_enc  bytea,
  ADD COLUMN IF NOT EXISTS customer_email_enc bytea,
  ADD COLUMN IF NOT EXISTS customer_phone_enc bytea;

UPDATE appointments SET
  customer_name_enc  = CASE WHEN customer_name  IS NOT NULL THEN pgp_sym_encrypt(customer_name,  'REPLACE_WITH_STRONG_KEY') END,
  customer_email_enc = CASE WHEN customer_email IS NOT NULL THEN pgp_sym_encrypt(customer_email, 'REPLACE_WITH_STRONG_KEY') END,
  customer_phone_enc = CASE WHEN customer_phone IS NOT NULL THEN pgp_sym_encrypt(customer_phone, 'REPLACE_WITH_STRONG_KEY') END;

-- Uncomment after updating n8n workflows:
-- ALTER TABLE appointments
--   DROP COLUMN customer_name,
--   DROP COLUMN customer_email,
--   DROP COLUMN customer_phone;

-- ============================================================
-- clients table: primary_contact_name, primary_contact_email, primary_contact_phone
-- ============================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS primary_contact_name_enc  bytea,
  ADD COLUMN IF NOT EXISTS primary_contact_email_enc bytea,
  ADD COLUMN IF NOT EXISTS primary_contact_phone_enc bytea;

UPDATE clients SET
  primary_contact_name_enc  = CASE WHEN primary_contact_name  IS NOT NULL THEN pgp_sym_encrypt(primary_contact_name,  'REPLACE_WITH_STRONG_KEY') END,
  primary_contact_email_enc = CASE WHEN primary_contact_email IS NOT NULL THEN pgp_sym_encrypt(primary_contact_email, 'REPLACE_WITH_STRONG_KEY') END,
  primary_contact_phone_enc = CASE WHEN primary_contact_phone IS NOT NULL THEN pgp_sym_encrypt(primary_contact_phone, 'REPLACE_WITH_STRONG_KEY') END;

-- Uncomment after updating n8n workflows:
-- ALTER TABLE clients
--   DROP COLUMN primary_contact_name,
--   DROP COLUMN primary_contact_email,
--   DROP COLUMN primary_contact_phone;
