# Norr AI Starter Contract System — Design Spec

**Date:** 2026-05-17
**Scope:** Starter tier only. Growth and Pro to follow separately.

---

## Overview

A lightweight system for generating, delivering, and recording Starter tier service agreements. No e-signature service required. Egan generates a PDF from an internal browser tool, emails it to the client, and records it in Neon after they sign and return it.

---

## Components

### 1. Contract Generator Page

**File:** `website/internal/contract_generator.html`
**Access:** Cloudflare Access — internal group (already protected)

A two-section internal page:

**Section A — Generate**
Form fields:
- Client name (contact person)
- Business name
- Contact email
- Monthly retainer ($)
- Setup fee ($)
- Contract start date

On click of **Generate Contract**, the full formatted contract renders below the form in print-ready layout. Cmd+P → Save as PDF → email to client.

**Section B — Mark as Signed**
Appears after generating. After the client returns the signed PDF, Egan fills in the signed date and clicks **Record Signature**. This fires a POST to `/webhook/contract-signed`.

---

### 2. Contract Language — Starter Tier

Full agreement text rendered into the page. Key terms:

| Term | Value |
|------|-------|
| Services | n8n + Claude API automation workflows, template-based, no custom software development |
| Monthly retainer | As specified in contract |
| Setup fee | As specified in contract; non-refundable |
| Payment | Setup fee + first month's retainer due on signing; monthly retainer invoiced on the same date each month thereafter |
| Term | Month-to-month |
| Cancellation | 30 days written notice by either party; setup fee non-refundable |
| IP ownership | Norr AI retains ownership of all workflows, automation infrastructure, and tooling; client owns their own data |
| Confidentiality | Both parties keep each other's business information confidential |
| Liability cap | Norr AI's liability limited to fees paid in the prior 30 days |
| Results | No guarantee of specific outcomes (lead volume, revenue, conversion rates) |
| Governing law | State of Minnesota |

---

### 3. Contract-Signed n8n Webhook

**Webhook path:** `/webhook/contract-signed`
**Method:** POST

**Payload from page:**
```json
{
  "business_name": "...",
  "contact_name": "...",
  "contact_email": "...",
  "tier": "starter",
  "monthly_price": 500.00,
  "setup_fee": 500.00,
  "start_date": "2026-06-01",
  "signed_date": "2026-05-20"
}
```

**Workflow steps:**
1. **Upsert client** — look up `clients` by `primary_contact_email`; if not found, INSERT with `tier: starter`, `status: active`, `vertical: tbd` (Egan updates vertical manually after)
2. **Insert contract** — INSERT into `service_contracts` (`client_id`, `tier`, `monthly_price`, `setup_fee`, `start_date`, `status: active`)
3. **Return success** — page shows confirmation

---

## Data Flow

```
Egan fills form
    → Contract renders in browser
    → Cmd+P → PDF → email to client
    → Client signs, scans/emails back
    → Egan clicks "Record Signature"
    → POST /webhook/contract-signed
    → n8n upserts clients row
    → n8n inserts service_contracts row
    → Page confirms
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `website/internal/contract_generator.html` | Generator + Mark as Signed UI |
| `n8n/workflows/Norr AI Contract Signed.json` | Webhook workflow — upserts client, inserts contract |

## Schema Changes

None required. `clients` and `service_contracts` tables already exist in the current schema.

---

## Out of Scope

- Growth and Pro tier contracts (separate specs)
- E-signature service integration
- Automated contract delivery (email sent by n8n)
- Contract PDF storage (Neon or Blob)
- Client portal contract view
