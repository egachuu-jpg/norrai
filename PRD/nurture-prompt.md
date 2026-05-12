# PRD: Nurture Prompt — 7-Day No-Reply Follow-Up

**Status:** Draft
**Author:** Egan
**Date:** 2026-05-12
**Version:** 1.0

---

## Problem Statement

When a lead comes in, the system fires an instant lead response automatically. But if the lead goes quiet, there is no automatic next step — the agent has to remember to manually enroll them in the cold nurture sequence via `nurture_enroll.html`. Most won't remember. Leads that don't reply to the first touch silently age out.

The right behavior: if a lead hasn't been enrolled in nurture 7 days after intake, prompt the agent once via email with a one-click enroll button. Agent sees the lead's name and context, clicks the button, lead enters the cold nurture sequence. No form to fill out, no digging through n8n.

---

## Goals

- Eliminate the manual gap between lead response and nurture enrollment
- Give the agent a lightweight decision point (enroll vs. skip) rather than removing them from the loop entirely
- Keep the implementation simple — no reply detection, no Twilio inbound parsing, no AI

## Non-Goals

- Detecting whether the lead actually replied (too complex for now — agent judgment handles this)
- Auto-enrolling without agent confirmation
- Re-prompting after the first nudge (one email, done)

---

## Users

**Primary:** Real estate agents on Norr AI Starter or Growth tier
**Use case:** A lead came in from Zillow, got the instant response, went quiet, and is now sitting in Neon with no next action

---

## Architecture

```
Scheduled Trigger (daily, 8am CT)
        │
        ▼
Query Neon: leads where nurture_enrolled_at IS NULL
            AND created_at < now() - 7 days
            AND status NOT IN ('converted', 'dead')
            AND client.status = 'active'
        │
   No results → stop
   Results → group by agent_email
        │
        ▼
For each agent with eligible leads:
  SendGrid: "Nurture Prompt" email
  (lead name, source, date added, one Enroll button per lead)
        │
        ▼
Log triggered/completed → workflow_events (Neon)

────────────────────────────────────────────────

Agent clicks Enroll button
        │
        ▼
n8n: /webhook/nurture-prompt-confirm?lead_id=xxx&token=xxx
        │
        ▼
Lookup lead in Neon by lead_id
        │
        ▼
Fire cold nurture enrollment webhook (existing)
        │
        ▼
UPDATE leads SET nurture_enrolled_at = now() WHERE id = lead_id
        │
        ▼
Respond with simple HTML confirmation page
("Sarah Johnson has been enrolled in the cold nurture sequence.")
```

---

## Neon Schema Change

Add one column to `leads`:

```sql
ALTER TABLE leads ADD COLUMN nurture_enrolled_at timestamptz;
```

This is the only schema change needed. The daily query uses this column as the "has already been enrolled or prompted" gate.

The column also doubles as useful reporting data — when looking at a lead's history, `nurture_enrolled_at` shows exactly when they entered the sequence.

---

## Query: Eligible Leads

```sql
SELECT
  l.id,
  l.lead_name,
  l.email,
  l.phone,
  l.source,
  l.metadata,
  l.created_at,
  c.primary_contact_email AS agent_email,
  c.business_name
FROM leads l
JOIN clients c ON l.client_id = c.id
WHERE l.nurture_enrolled_at IS NULL
  AND l.created_at < now() - INTERVAL '7 days'
  AND l.status NOT IN ('converted', 'dead')
  AND c.status = 'active'
ORDER BY c.id, l.created_at
```

Results are grouped by `agent_email` in a Code node before building emails — one email per agent, all their eligible leads in one message.

---

## Enroll Button URL

```
https://norrai.app.n8n.cloud/webhook/nurture-prompt-confirm?lead_id={lead_id}&token=8F68D963-7060-4033-BD04-7593E4B203CB
```

Styled as a button in the HTML email. One button per lead in the email body.

The token is the shared workflow token — same pattern used across all n8n webhooks. Not high security, but the link is only ever sent to the agent's email address via SendGrid, and Cloudflare Access is not applicable here (this is an outbound email link, not a protected page).

---

## Email Design

**From:** hello@norrai.co  
**From Name:** Norr AI  
**Subject:** 🔔 {n} lead(s) ready for nurture — {date}  
**Send time:** 8am CT daily (only fires if there are eligible leads)

**Body structure:**

```
Hi {agent_first_name},

These leads received your first message but haven't been enrolled 
in your follow-up sequence yet. One click to enroll:

────────────────────────────────
Sarah Johnson
Added: May 4 · Source: Zillow · 3bd $280k–$320k

  [ Enroll in Cold Nurture ]

────────────────────────────────
Mike Torres
Added: May 3 · Source: Website form

  [ Enroll in Cold Nurture ]
────────────────────────────────

If you're already in conversation with someone, ignore their button — 
it will expire after they're enrolled or marked inactive.

— Norr AI
```

Each `[ Enroll in Cold Nurture ]` is an anchor tag styled as a button, pointing to the `/webhook/nurture-prompt-confirm` URL with that lead's `lead_id`.

No click tracking (same policy as all transactional emails — disable in SendGrid to avoid Promotions tab).

---

## Confirm Webhook: /webhook/nurture-prompt-confirm

**Input:** `lead_id` (UUID) + `token` (query params)

**Steps:**
1. Token Check (same IF node pattern as all workflows)
2. Lookup lead: `SELECT * FROM leads WHERE id = $lead_id`
3. Validate lead exists and `nurture_enrolled_at IS NULL` — if already enrolled, respond with a friendly "already enrolled" page and stop
4. Fire cold nurture enrollment: POST to `/webhook/nurture-enroll` with lead fields
5. Update lead: `UPDATE leads SET nurture_enrolled_at = now() WHERE id = $lead_id`
6. Respond with plain HTML confirmation page (no redirect, no JS required)
7. Log `completed` to `workflow_events`

**Success page (inline HTML response):**
```html
<h2>Done.</h2>
<p>Sarah Johnson has been enrolled in the cold nurture sequence. 
The first touch goes out shortly.</p>
```

Minimal. No Norr AI branding required — this is a functional confirmation, not a marketing surface.

---

## Workflows

| Workflow | workflow_name |
|---|---|
| Nurture Prompt Scheduler | `nurture_prompt_scheduler` |
| Nurture Prompt Confirm | `nurture_prompt_confirm` |

Both need `Log Triggered` + `Log Completed` nodes per the standard pattern. Add both to the `workflow_name` registry in CLAUDE.md.

The Scheduler uses the `norrai_internal` client_id for its own `workflow_events` logging (same as Chief of Staff and Red Alert Scheduler). The Confirm webhook looks up the lead's `client_id` from Neon and uses that for its event log.

---

## Edge Cases

| Case | Handling |
|---|---|
| Agent clicks Enroll button twice | Idempotency check: if `nurture_enrolled_at IS NOT NULL`, return "already enrolled" page and skip the enrollment webhook call |
| Lead marked `converted` or `dead` before day 7 | Excluded by the query — `status NOT IN ('converted', 'dead')` |
| Lead has no email (SMS-only) | Cold nurture has email-only touches (T1, T3, T5) — flag this in the prompt email: "Note: no email on file — SMS touches only." For now, still enroll; the workflow will skip email nodes. Long-term: add a guard in the nurture workflow for missing email. |
| Agent has no eligible leads that day | Scheduler produces no results, no email sent |
| `lead_id` in URL is tampered or invalid | Postgres lookup returns no rows → respond with "lead not found" page, log nothing |

---

## Phasing

### Phase 1 (build this)
- [ ] `ALTER TABLE leads ADD COLUMN nurture_enrolled_at timestamptz;` — apply to Neon production
- [ ] n8n: Nurture Prompt Scheduler workflow — daily schedule, Neon query, SendGrid email per agent
- [ ] n8n: Nurture Prompt Confirm webhook — lookup, fire nurture enrollment, update Neon, HTML response
- [ ] Add `nurture_enrolled_at` to `db/schema.sql`
- [ ] Add both `workflow_name` values to CLAUDE.md registry

### Phase 2 (later)
- [ ] When the agent manually submits `nurture_enroll.html`, also set `nurture_enrolled_at` on the lead record — so the scheduler doesn't prompt for leads the agent already handled manually
- [ ] Expose `nurture_enrolled_at` in the monitoring dashboard lead detail view
- [ ] Chief of staff command: "Enroll [lead name] in nurture" → sets flag + fires enrollment

---

## Open Questions

1. **7 days vs. configurable** — hardcoded at 7 days for now. Could be a per-client setting in the `clients` table later (`nurture_prompt_delay_days`), but one value is fine to start.
2. **One email per agent vs. one per lead** — this PRD chooses one digest email per agent (all eligible leads in one message). If an agent has 10 leads, 10 individual emails would be noisy. Digest is better UX.
3. **Expiry** — the enroll button has no expiry token. If an agent saves the email and clicks the button 30 days later, it will still work (as long as `nurture_enrolled_at IS NULL`). This is acceptable behavior.
