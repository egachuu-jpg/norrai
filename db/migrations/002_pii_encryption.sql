-- Migration 002: PII column encryption
-- Adds encrypted shadow columns for PII in leads, appointments, and clients tables
-- using pgp_sym_encrypt (pgcrypto symmetric encryption).
--
-- HOW TO RUN:
--   psql <neon-connection-string> -v PII_KEY='your-strong-key-here' -f db/migrations/002_pii_encryption.sql
--
-- Generate a strong key: openssl rand -base64 32
-- Store the key in a password manager (Bitwarden, 1Password, etc.)
-- Also add it to n8n as environment variable: PII_ENCRYPTION_KEY=<same value>
--
-- BEFORE DROPPING PLAINTEXT COLUMNS:
--   - Update all n8n workflows that INSERT leads to use pgp_sym_encrypt (see n8n/TESTING_NOTES.md)
--   - The DROP COLUMN statements are commented out — uncomment only after workflows are verified
--
-- TO DECRYPT (in SQL):
--   pgp_sym_decrypt(email_enc, :'PII_KEY') → plain text email

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
  lead_name_enc    = CASE WHEN lead_name    IS NOT NULL THEN pgp_sym_encrypt(lead_name,    :'PII_KEY') END,
  email_enc        = CASE WHEN email        IS NOT NULL THEN pgp_sym_encrypt(email,        :'PII_KEY') END,
  phone_enc        = CASE WHEN phone        IS NOT NULL THEN pgp_sym_encrypt(phone,        :'PII_KEY') END,
  lead_message_enc = CASE WHEN lead_message IS NOT NULL THEN pgp_sym_encrypt(lead_message, :'PII_KEY') END;

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
  customer_name_enc  = CASE WHEN customer_name  IS NOT NULL THEN pgp_sym_encrypt(customer_name,  :'PII_KEY') END,
  customer_email_enc = CASE WHEN customer_email IS NOT NULL THEN pgp_sym_encrypt(customer_email, :'PII_KEY') END,
  customer_phone_enc = CASE WHEN customer_phone IS NOT NULL THEN pgp_sym_encrypt(customer_phone, :'PII_KEY') END;

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
  primary_contact_name_enc  = CASE WHEN primary_contact_name  IS NOT NULL THEN pgp_sym_encrypt(primary_contact_name,  :'PII_KEY') END,
  primary_contact_email_enc = CASE WHEN primary_contact_email IS NOT NULL THEN pgp_sym_encrypt(primary_contact_email, :'PII_KEY') END,
  primary_contact_phone_enc = CASE WHEN primary_contact_phone IS NOT NULL THEN pgp_sym_encrypt(primary_contact_phone, :'PII_KEY') END;

-- Uncomment after updating n8n workflows:
-- ALTER TABLE clients
--   DROP COLUMN primary_contact_name,
--   DROP COLUMN primary_contact_email,
--   DROP COLUMN primary_contact_phone;
