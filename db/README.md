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

## Smoke test

After applying the schema, run this to verify FK constraints and jsonb storage:

```sql
-- Insert a test client
INSERT INTO clients (business_name, vertical, tier, status)
VALUES ('Test Dental', 'dental', 'starter', 'prospect')
RETURNING id;

-- Insert a lead with metadata (replace <client_id> with the returned uuid)
INSERT INTO leads (client_id, lead_name, email, source, metadata)
VALUES ('<client_id>', 'Jane Smith', 'jane@example.com', 'website',
        '{"procedure_type": "cleaning", "insurance": "Delta Dental"}')
RETURNING id;

-- Insert an appointment
INSERT INTO appointments (client_id, customer_name, appointment_type, scheduled_at)
VALUES ('<client_id>', 'Jane Smith', 'cleaning', '2026-05-01 10:00:00-05')
RETURNING id;
```
