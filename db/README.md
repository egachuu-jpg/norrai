# NorrAI Database

Postgres hosted on [Neon](https://neon.tech). One project, one database.

## Applying the schema

```bash
psql <neon-connection-string> -f db/schema.sql
```

Find your connection string in the Neon dashboard under **Connection Details**. Use the **pooled** connection string for n8n.

## Connecting n8n to Neon

1. In n8n, go to **Credentials → New → Postgres**.
2. Use these settings:

| Field | Value |
|-------|-------|
| Host | `<your-neon-host>.neon.tech` |
| Port | `5432` |
| Database | `neondb` (default) |
| User | `neondb_owner` (or your role) |
| Password | from Neon dashboard |
| SSL | **Required** |

3. Use the pooled hostname (ends in `-pooler.neon.tech`) for better connection reuse.

## Table overview

| Table | Purpose |
|-------|---------|
| `clients` | NorrAI client businesses — tier, status, contact info |
| `service_contracts` | Billing history per client |
| `twilio_subaccounts` | One Twilio subaccount + phone number per client |
| `norrai_meetings` | NorrAI's own discovery/onboarding/check-in calls |
| `leads` | End-customer leads across all verticals; vertical-specific fields go in `metadata` jsonb |
| `appointments` | End-customer appointments; tracks reminder/follow-up/review-request timestamps |
| `workflow_events` | Raw audit log of every n8n workflow trigger/completion/failure |

## Vertical-specific lead fields

Rather than separate tables per vertical, extra fields live in `leads.metadata` as a jsonb object. Examples:

```json
// Real estate
{ "property_address": "123 Maple St", "price_range": "$250k-$320k", "beds": 3 }

// Insurance
{ "policy_type": "auto", "renewal_date": "2026-09-01", "current_carrier": "State Farm" }

// Dental
{ "procedure_type": "cleaning", "insurance": "Delta Dental", "last_visit": "2024-11-01" }
```

## PII Encryption

PII columns (`lead_name`, `email`, `phone` in `leads`; contact fields in `clients` and `appointments`) are encrypted at rest using `pgp_sym_encrypt` from pgcrypto. Equality lookups (lead dedupe, client resolution) use separate SHA-256 hash columns so the encryption key is never needed for reads.

### Setup

**1. Generate a passphrase**
```bash
openssl rand -base64 32
```

**2. Run the migration** (replace the placeholder with your passphrase first)
```bash
# Edit db/migrations/001_encrypt_pii.sql — replace every REPLACE_WITH_YOUR_KEY
psql "$DATABASE_URL" -f db/migrations/001_encrypt_pii.sql
```

**3. Add the key to n8n**
In n8n Cloud → Settings → Environment Variables, add:
```
PII_ENCRYPTION_KEY = <your passphrase>
```

This is the only place the key lives. If someone obtains only the Neon connection string, PII columns are unreadable without the key.

### Reading encrypted data

Use the `pii_decrypt()` function in any SELECT:
```sql
SELECT pii_decrypt(lead_name, 'your-key') AS lead_name,
       pii_decrypt(email,     'your-key') AS email
FROM leads
WHERE email_hash = pii_hash('sarah@gmail.com');
```

For lookups by email or phone, always use the `_hash` column — never scan the encrypted column directly.

### n8n workflow integration

- Writes: wrap PII values with `pii_encrypt('{{ $json.field }}', '{{ $env.PII_ENCRYPTION_KEY }}')`
- Hash columns: use `pii_hash('{{ $json.field }}')` alongside each encrypted write
- Lookups: `WHERE email_hash = pii_hash('{{ $json.email }}')`
- Reads: `pii_decrypt(email, '{{ $env.PII_ENCRYPTION_KEY }}') AS email`

### What is NOT encrypted

- `leads.source`, `leads.status`, `leads.metadata` — not PII
- `workflow_events.payload` — contains execution IDs only, no PII
- `clients` business fields (`business_name`, `vertical`, etc.) — not PII
- `twilio_subaccounts.phone_number` — Twilio-owned number, not client PII

---

## Smoke test

After applying the schema and running the PII migration, verify FK constraints, encryption, and hash lookups:

```sql
-- Insert a test client with encrypted contact fields
INSERT INTO clients (business_name, vertical, tier, status,
  primary_contact_name, primary_contact_email, primary_contact_email_hash, primary_contact_phone)
VALUES ('Test Dental', 'dental', 'starter', 'prospect',
  pii_encrypt('Jane Owner', 'your-key'),
  pii_encrypt('jane@testdental.com', 'your-key'),
  pii_hash('jane@testdental.com'),
  pii_encrypt('5071234567', 'your-key'))
RETURNING id;

-- Insert a lead with encrypted PII (replace <client_id>)
INSERT INTO leads (client_id, lead_name, email, email_hash, phone, phone_hash, source, metadata)
VALUES ('<client_id>',
  pii_encrypt('Jane Smith', 'your-key'),
  pii_encrypt('jane@example.com', 'your-key'),
  pii_hash('jane@example.com'),
  pii_encrypt('5075559876', 'your-key'),
  pii_hash('5075559876'),
  'website',
  '{"procedure_type": "cleaning", "insurance": "Delta Dental"}')
RETURNING id;

-- Verify: lookup by hash, decrypt for display
SELECT pii_decrypt(lead_name, 'your-key') AS name,
       pii_decrypt(email, 'your-key')     AS email
FROM leads
WHERE email_hash = pii_hash('jane@example.com');
```
