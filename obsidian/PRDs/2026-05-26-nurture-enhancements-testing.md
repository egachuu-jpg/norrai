# 7-Touch Cold Nurture Enhancements — Testing Checklist
*Story: Weichert Realty - 7-Touch Cold Nurture Enhancements*

---

## Pre-flight: Activate workflows in n8n

- [ ] **Nurture Prompt Scheduler** — open in n8n, verify cron is `0 13 * * *` (8am CT), Error Workflow → Norr AI Workflow Error Logger, logging nodes wired. Then activate.
- [ ] **Nurture Prompt Confirm** — open in n8n, verify webhook path is `/webhook/nurture-prompt-confirm` (not `/webhook-test/`), Error Workflow set, logging nodes wired. Then activate.
- [ ] **Nurture De-Enroll Prompt** — import `Nurture De-Enroll Prompt.json`, verify cron is `0 15 * * 1` (Monday 10am CT), activate.
- [ ] **Nurture De-Enroll Confirm** — import `Nurture De-Enroll Confirm.json`, verify webhook path is `/webhook/nurture-deenroll-confirm`, activate.

---

## 1. Smoke test — Nurture Prompt Scheduler

*Manually trigger the workflow in n8n (Test > Trigger manually).*

- [ ] Digest email arrives at the agent's email address
- [ ] Lead list is correct — only leads with `nurture_enrolled_at IS NULL`, older than 7 days, status not `converted`/`unenrolled`/`dead`, client active
- [ ] Each lead row shows name, source, date added, and any property info from metadata
- [ ] "Enroll in Cold Nurture" button URL is `https://norrai.app.n8n.cloud/webhook/nurture-prompt-confirm?lead_id=...&token=8F68D963...`
- [ ] `workflow_events` in Neon has `triggered` and `completed` rows for `nurture_prompt_scheduler`
- [ ] If no eligible leads exist, no email sent (check n8n execution — `Has Eligible Leads?` routes to false branch)

---

## 2. Smoke test — Nurture Prompt Confirm

*Click the "Enroll in Cold Nurture" button from the digest email.*

- [ ] Browser shows success page: *"[Lead name] has been enrolled in the cold nurture sequence."*
- [ ] `leads.nurture_enrolled_at` is stamped in Neon for that lead
- [ ] `leads.status` updated to `nurturing`
- [ ] `workflow_events` has `triggered` + `completed` rows for `nurture_prompt_confirm`
- [ ] **Idempotency:** click the same button again → shows *"Already enrolled."* page, no duplicate enrollment
- [ ] Cold nurture sequence fires (check n8n — `Real Estate 7-Touch Cold Nurture` should have a new execution)

---

## 3. Smoke test — Nurture De-Enroll Prompt

*Set a test lead to `status = 'nurturing'` in Neon, then manually trigger the workflow.*

```sql
UPDATE leads SET status = 'nurturing', nurture_enrolled_at = now() - INTERVAL '3 days'
WHERE id = '<your-test-lead-id>';
```

- [ ] Digest email arrives at agent with the test lead listed
- [ ] Lead row shows name, source, enrolled date, and property info (if any in metadata)
- [ ] "Remove from Nurture" button is red, URL is `https://norrai.app.n8n.cloud/webhook/nurture-deenroll-confirm?lead_id=...&token=8F68D963...`
- [ ] Agent with zero nurturing leads gets no email (verify by checking another agent's account or temporarily setting all leads to non-nurturing)
- [ ] `workflow_events` has `triggered` + `completed` rows for `nurture_deenroll_prompt`

---

## 4. Smoke test — Nurture De-Enroll Confirm

*Click the "Remove from Nurture" button from the de-enroll digest email.*

- [ ] Browser shows success page: *"[Lead name] has been removed from nurture. No further follow-ups will be sent."*
- [ ] `leads.status` is `unenrolled` in Neon
- [ ] `workflow_events` has `triggered` + `completed` rows for `nurture_deenroll_confirm`
- [ ] **Idempotency:** click same button again → shows *"Already removed."* page, no error
- [ ] Lead no longer appears in the next De-Enroll Prompt digest (re-trigger the scheduler and verify)
- [ ] **Enrollment guard check:** re-enroll the lead in 7-Touch, wait for the next touch's Wait node to resolve, then unenroll mid-sequence → verify the next touch does NOT fire (IF Enrolled check stops execution)

---

## 5. Bad token / invalid link checks

- [ ] Hit `nurture-deenroll-confirm?lead_id=<valid-id>&token=WRONG` → 403 page
- [ ] Hit `nurture-deenroll-confirm?lead_id=not-a-uuid&token=8F68D963...` → workflow throws error (check n8n execution log)
- [ ] Hit `nurture-prompt-confirm?lead_id=<valid-id>&token=WRONG` → 403 page
