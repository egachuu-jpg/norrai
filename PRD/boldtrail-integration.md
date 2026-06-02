# PRD: BoldTrail Integration — Service Layer Strategy

**Status:** Draft
**Author:** Egan
**Date:** 2026-06-02
**Version:** 1.0

---

## Goal

Stay as an AI automation service layer on top of BoldTrail rather than owning or replacing the CRM. Find creative integrations that work within BoldTrail's limitations without requiring API access or a platform switch.

The full CRM decision (GoHighLevel agency model vs. Follow Up Boss) remains on the table long-term. This PRD covers the short-term path: make the BoldTrail integration workable enough to deliver Norr AI's value without dual-maintenance friction, compliance risk, or brittle manual processes.

---

## Problem Statement

BoldTrail exposes almost no integration surface for outbound automation platforms. The current integration has three unresolved problems:

**1. No opt-out sync.** When a lead opts out of communications inside BoldTrail (email unsubscribe, STOP reply to a BoldTrail number), Norr AI receives no notification. If the same lead is in an active Norr AI SMS sequence, Norr AI keeps texting them. This is a TCPA compliance risk — not just a UX problem.

**2. Dual-maintenance contacts.** Contacts live in BoldTrail (source of truth) and in Neon (needed for Norr AI automation). When BoldTrail contact records change — phone corrections, new leads added manually, status changes — Neon drifts. The current sync path is: log in as brokerage owner → filter by agent → export → BoldTrail emails CSV to owner → owner manually forwards to Egan → Egan manually imports. Every step after the export click is unnecessary.

**3. No contact update API.** BoldTrail does not expose a webhook or REST endpoint for contact field changes. There is no clean programmatic path — CSV is the only option.

---

## Goals

- Reduce the contact sync process to one manual step (the brokerage owner clicks Export)
- Eliminate opt-out compliance gaps for SMS sent through Norr AI's Twilio numbers
- Give agents a self-service way to flag manual opt-out requests
- Make the integration maintainable with no ongoing manual work from Egan

## Non-Goals

- Full two-way sync between BoldTrail and Neon — BoldTrail is read-only from Norr AI's perspective
- Syncing BoldTrail's email opt-outs (BoldTrail handles suppression for its own sends; Norr AI only needs to manage its own SMS channel)
- Real-time contact sync — weekly cadence is acceptable for this use case
- Replacing BoldTrail's contact management for agents

---

## Users

**Brokerage owner:** Runs the CSV export once per week. One manual step. No other involvement.

**Agents:** Flag manual opt-out requests via a button in the Norr AI client portal. No CSV work, no Neon access.

**Egan (Norr AI):** Monitors the automated import pipeline. Resolves parse errors if the BoldTrail CSV format changes.

---

## Architecture

### Contact Sync Pipeline (CSV → Neon)

BoldTrail exports a CSV via email. That email gets auto-forwarded to a Norr AI-controlled inbox. An n8n workflow watches that inbox, parses the CSV attachment, and upserts contact records into the `leads` table in Neon.

```
Brokerage owner clicks Export in BoldTrail
  → BoldTrail emails CSV to brokerage owner
  → Gmail auto-forward rule fires (owner's account, one-time setup)
  → CSV lands at imports@norrai.co
  → n8n Gmail trigger detects new email with attachment
  → Code node parses CSV rows
  → Postgres node: upsert into leads (match on email + phone, update existing, insert new)
  → Log completed event to workflow_events
```

BoldTrail is the authoritative source. Neon is updated from BoldTrail, never the reverse.

**Frequency:** Weekly. Brokerage owner sets a recurring calendar reminder (Monday morning, ~30 seconds). Everything after the export click is automated.

**Deduplication:** Match on email + phone. If both match an existing lead, update the record. If neither matches, insert new. If only one matches, update and log a warning for manual review (possible data quality issue).

### Opt-Out Handling

Two channels, two mechanisms:

**Channel 1 — Twilio STOP (automated).** When a lead replies STOP to any Norr AI Twilio number, Twilio fires a status callback. An n8n webhook catches it and sets `opted_out = true` + `opted_out_at = NOW()` in `leads`. All outbound SMS workflows check this flag before sending.

**Channel 2 — Manual opt-out (agent-flagged).** When a lead requests to stop receiving texts through any other channel (in person, by phone, via BoldTrail), the agent flags it in the Norr AI client portal. A new "Mark as opted out" button in `lead_action_edit.html` posts to an n8n webhook, which sets the same flag in Neon.

This covers the full opt-out surface without requiring BoldTrail to cooperate.

---

## Build Plan

Priority order — build these in sequence.

### 1. Gmail Auto-Forward Rule (No code — one-time setup)

**Owner:** Egan sets this up with the brokerage owner in one sitting.

In the brokerage owner's Gmail account:
- Settings → Filters → Create new filter
- From: `[BoldTrail export sender address — confirm from first real export]`
- Has attachment: yes
- Action: Forward to `imports@norrai.co`

Verify by running a test export and confirming the email arrives at `imports@norrai.co`.

**This alone eliminates the manual forwarding step immediately.**

### 2. n8n CSV Import Workflow

**`workflow_name`:** `boldtrail_csv_import`

**Nodes:**

1. **Gmail Trigger** — watches `imports@norrai.co` for new emails with attachments from the BoldTrail sender address. Fires on match.

2. **Extract Attachment** (Code node) — pulls the CSV attachment from the email, base64-decodes it, parses rows into JSON array. Handles BOM, Windows line endings, quoted commas in fields.

3. **Log Triggered** (Postgres, `continueOnFail: true`)
   ```sql
   INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)
   VALUES ('CLIENT_ID', 'boldtrail_csv_import', 'triggered',
     '{"row_count": {{ $json.row_count }}, "filename": "{{ $json.filename }}"}'::jsonb)
   ```

4. **Upsert Leads** (Postgres, loop over rows, `continueOnFail: true`)
   ```sql
   INSERT INTO leads (client_id, lead_name, email, phone, source, metadata, created_at)
   VALUES ($client_id, $name, $email, $phone, 'boldtrail', $metadata::jsonb, NOW())
   ON CONFLICT (email, phone)
   DO UPDATE SET
     lead_name = EXCLUDED.lead_name,
     metadata = leads.metadata || EXCLUDED.metadata,
     updated_at = NOW()
   ```

5. **Log Completed** (Postgres, `continueOnFail: true`)

6. **Error Workflow:** `Norr AI Workflow Error Logger`

**CSV field mapping (confirm against actual BoldTrail export before going live):**

| BoldTrail column | Neon field |
|-----------------|-----------|
| `Contact Name` or `Full Name` | `lead_name` |
| `Email` | `email` |
| `Phone` | `phone` |
| `Address` | `metadata.property_address` |
| `Status` | `metadata.boldtrail_status` |
| `Assigned To` | `metadata.agent_email` |
| `Source` | `metadata.lead_source` |
| `Created Date` | `metadata.boldtrail_created_at` |

Store any unmapped BoldTrail columns in `metadata` as raw key/value pairs — don't discard data.

**Schema change needed:**
```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
```

### 3. Twilio STOP → Neon Opt-Out Webhook

**`workflow_name`:** `twilio_optout_handler`

**Setup in Twilio:** Configure each phone number's "A message comes in" and "Status callback URL" to point to `https://norrai.app.n8n.cloud/webhook/twilio-optout`.

**Nodes:**

1. **Webhook** — receives Twilio status callback POST

2. **Check for STOP** (IF node) — `$json.body.OptOutType === 'STOP'` OR `$json.body.SmsStatus === 'received'` AND message body matches `/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)$/i`

3. **Set Opted Out** (Postgres, `continueOnFail: true`)
   ```sql
   UPDATE leads
   SET opted_out = true, opted_out_at = NOW()
   WHERE phone = '{{ $json.body.From }}'
   ```

4. **Log Event** (Postgres, `continueOnFail: true`)

**Schema change needed:**
```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS opted_out BOOLEAN DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ;
```

**All outbound SMS workflows must add this check before the Twilio Send node:**

IF node condition: `{{ $('Lookup Lead').first().json.opted_out !== true }}`
- True → send SMS
- False → stop, log skipped event

### 4. "Mark as Opted Out" Button in Client Portal

**File:** `website/clients/lead_action_edit.html`

Add a "Stop texting this lead" button below the existing action buttons. On click:
- Confirm dialog: "Mark [lead name] as opted out? They will no longer receive automated texts from Norr AI."
- POST to `https://norrai.app.n8n.cloud/webhook/manual-optout` with `{ lead_id, agent_token }`
- n8n verifies agent token, sets `opted_out = true` in Neon
- UI shows confirmation: "Opted out. No further texts will be sent."

**`workflow_name`:** `manual_optout_handler`

Button styling: use the existing destructive/secondary button pattern in `norrai.css` — not a primary CTA color, but clearly actionable.

**Test:** Add a test to `tests/lead_action_edit.spec.js` covering the button render, confirm dialog, and success state.

---

## Opt-Out Coverage Matrix

| Scenario | Covered? | Mechanism |
|----------|----------|-----------|
| Lead replies STOP to Norr AI Twilio number | ✅ | Twilio callback → n8n → Neon flag |
| Lead replies STOP to BoldTrail number | ⚠️ Partial | BoldTrail suppresses their own sends. Norr AI only learns about it if agent flags it manually. |
| Lead clicks unsubscribe in BoldTrail email | ⚠️ Partial | Same as above — BoldTrail handles their suppression, Norr AI unaware. |
| Lead tells agent verbally / by phone | ✅ | Agent clicks "Mark as opted out" in portal |
| Lead emails agent to stop | ✅ | Agent clicks button |
| Weekly CSV import picks up status change | ✅ (future) | If BoldTrail exports an opt-out/unsubscribe field, parse it in the import workflow and set flag |

---

## Acceptance Criteria

- [ ] Brokerage owner runs export → email arrives at `imports@norrai.co` with no manual forwarding
- [ ] n8n CSV import workflow triggers automatically on receipt, processes all rows, upserts Neon correctly
- [ ] STOP reply to any Norr AI Twilio number → `opted_out = true` in Neon within 60 seconds
- [ ] All existing outbound SMS workflows check `opted_out` flag before sending
- [ ] "Mark as opted out" button in client portal updates Neon and shows confirmation
- [ ] `workflow_events` has `triggered` + `completed` entries for both new workflows
- [ ] No test regressions — `npm test` passes

---

## Open Questions

- What does the BoldTrail export email sender address look like? Needed for the Gmail filter and n8n trigger. Confirm on the first real export.
- Does BoldTrail include an opt-out / unsubscribe status column in the CSV export? If yes, parse it in the import workflow and use it to set `opted_out`.
- How often does the brokerage owner actually run the export? Weekly is the target — confirm with him and set the calendar reminder together.
- Does the conflict key on `leads` table currently support `(email, phone)` uniqueness? Check schema and add unique index if not present.

---

## Related

- `docs/superpowers/plans/2026-05-13-boldtrail-intake.md` — BoldTrail Zapier intake for new leads (separate from this)
- `db/schema.sql` — needs `opted_out`, `opted_out_at`, `updated_at` columns on `leads`
- `website/clients/lead_action_edit.html` — opt-out button goes here
- `n8n/workflows/` — CSV import and opt-out handler workflows
