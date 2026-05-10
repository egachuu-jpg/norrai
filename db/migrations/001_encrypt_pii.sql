-- Migration 001: Encrypt PII columns using pgcrypto
--
-- Encrypts lead_name, email, phone in leads / clients / appointments.
-- Adds deterministic SHA-256 hash columns on email + phone so n8n can
-- still do equality lookups (dedupe, client resolution) without needing
-- the encryption key.
--
-- BEFORE RUNNING:
--   1. Replace every instance of REPLACE_WITH_YOUR_KEY with your actual
--      passphrase (32+ random characters recommended).
--   2. Store that same passphrase in n8n → Settings → Environment Variables
--      as  PII_ENCRYPTION_KEY
--   3. For a DB that already has real production data, take a full backup first.
--      For test-data-only DBs it is safe to truncate affected tables instead.
--
-- Run:
--   psql "$DATABASE_URL" -f db/migrations/001_encrypt_pii.sql
--
-- Idempotent: safe to re-run (uses IF NOT EXISTS / OR REPLACE).

-- ─── Prerequisites ────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Helper functions ─────────────────────────────────────────────────────────

-- Encrypt a plaintext string. Returns NULL for NULL/empty input.
CREATE OR REPLACE FUNCTION pii_encrypt(plaintext text, key text)
RETURNS bytea
LANGUAGE sql
AS $$
  SELECT CASE
    WHEN plaintext IS NULL OR plaintext = '' THEN NULL
    ELSE pgp_sym_encrypt(plaintext, key)
  END
$$;

-- Decrypt a bytea ciphertext. Returns NULL for NULL input.
CREATE OR REPLACE FUNCTION pii_decrypt(ciphertext bytea, key text)
RETURNS text
LANGUAGE sql
AS $$
  SELECT CASE
    WHEN ciphertext IS NULL THEN NULL
    ELSE pgp_sym_decrypt(ciphertext, key)
  END
$$;

-- One-way SHA-256 hash for equality lookups (dedupe, client resolution).
-- Normalises to lowercase + trimmed so case/whitespace variations collide.
-- Returns NULL for NULL/empty input so NULL hashes never match each other.
CREATE OR REPLACE FUNCTION pii_hash(value text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN value IS NULL OR trim(value) = '' THEN NULL
    ELSE encode(digest(lower(trim(value)), 'sha256'), 'hex')
  END
$$;

-- ─── leads ───────────────────────────────────────────────────────────────────

-- Hash columns must exist before the type change so we can populate them
-- from the still-plaintext values.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS email_hash text,
  ADD COLUMN IF NOT EXISTS phone_hash text;

UPDATE leads
SET
  email_hash = pii_hash(email),
  phone_hash = pii_hash(phone)
WHERE email_hash IS NULL;

-- Change PII columns to encrypted bytea.
-- The USING clause encrypts any existing rows; replace the key placeholder first.
ALTER TABLE leads
  ALTER COLUMN lead_name  TYPE bytea USING pii_encrypt(lead_name,  'REPLACE_WITH_YOUR_KEY'),
  ALTER COLUMN email      TYPE bytea USING pii_encrypt(email,      'REPLACE_WITH_YOUR_KEY'),
  ALTER COLUMN phone      TYPE bytea USING pii_encrypt(phone,      'REPLACE_WITH_YOUR_KEY');

CREATE INDEX IF NOT EXISTS idx_leads_email_hash ON leads(email_hash);
CREATE INDEX IF NOT EXISTS idx_leads_phone_hash ON leads(phone_hash);

-- ─── clients ─────────────────────────────────────────────────────────────────

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS primary_contact_email_hash text;

UPDATE clients
SET primary_contact_email_hash = pii_hash(primary_contact_email)
WHERE primary_contact_email_hash IS NULL;

ALTER TABLE clients
  ALTER COLUMN primary_contact_name  TYPE bytea USING pii_encrypt(primary_contact_name,  'REPLACE_WITH_YOUR_KEY'),
  ALTER COLUMN primary_contact_email TYPE bytea USING pii_encrypt(primary_contact_email, 'REPLACE_WITH_YOUR_KEY'),
  ALTER COLUMN primary_contact_phone TYPE bytea USING pii_encrypt(primary_contact_phone, 'REPLACE_WITH_YOUR_KEY');

CREATE INDEX IF NOT EXISTS idx_clients_email_hash ON clients(primary_contact_email_hash);

-- ─── appointments ─────────────────────────────────────────────────────────────
-- No lookup workflows against appointments yet, so no hash columns needed.

ALTER TABLE appointments
  ALTER COLUMN customer_name  TYPE bytea USING pii_encrypt(customer_name,  'REPLACE_WITH_YOUR_KEY'),
  ALTER COLUMN customer_email TYPE bytea USING pii_encrypt(customer_email, 'REPLACE_WITH_YOUR_KEY'),
  ALTER COLUMN customer_phone TYPE bytea USING pii_encrypt(customer_phone, 'REPLACE_WITH_YOUR_KEY');
