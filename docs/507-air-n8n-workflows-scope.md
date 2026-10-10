# 507 Air — n8n workflow scope: review-request + missed-call text-back

Drafted 2026-10-09. **Scope only — not built.** Two workflows, both chosen because 507 Air's
problem is low discovery (reviews drive GBP prominence) and its profile claims 24/7 (so an
unanswered call is a reputational risk). See `507-air-aeo-findings.md` for the why.

Both must follow the **Workflow Logging Standard** in `CLAUDE.md` (Lookup Client → Log Triggered →
… → Log Completed, with Error Workflow = `Norr AI Workflow Error Logger`). Register names in
`n8n/README.md`. Import into n8n project **Norr AI** (`dHMe2aoOwTztDaWE`).

---

## Prerequisites (shared — do these first)

1. ✅ **Create the 507 Air `clients` row** — DONE 2026-10-09.
   **`client_id` = `492902e1-4f82-4a89-aaa0-c54acadebf06`** (507 Air Heating & Cooling, LLC / hvac /
   starter / active). This is the hardcoded `client_id` for both workflows' Lookup Client nodes — do
   **not** reuse the B&B or norrai_internal id.
2. **Twilio:** create a 507 Air subaccount + provision an SMS-capable number; record it in
   `twilio_subaccounts`. Needed for both (review SMS + text-back). A2P 10DLC registration is required
   for US SMS at volume — see the A2P plan in memory; a single low-volume number may send before full
   campaign approval but confirm current Twilio rules.
3. **Confirm review link:** `https://g.page/r/CS6mxtsUw3ujEBM/review` (already live in
   `client-sites/507-air/js/review-link.js`). Reuse it verbatim.

### Copy constraints (both workflows)

- **No emergency / after-hours *rate* language anywhere** — Oscar's decision, `GBP_SETUP.md §4`.
  "Open 24/7" is fine; pricing for after-hours is not.
- **Ask every customer** for a review — no review gating (no "only happy customers" filter).
- SMS must include opt-out ("Reply STOP to opt out") and identify the sender (507 Air). CAN-SPAM/TCPA:
  both messages go to people with an existing relationship (a customer / someone who just called), which
  is the defensible basis — keep it that way (no cold lists).

---

## Workflow 1 — Review request — ✅ BUILT 2026-10-09 (inactive)

**n8n workflow id:** `dvT9jA24H98Z1fT7` ("507 Air Review Request", project Norr AI). Validates clean.
**workflow_name:** `507air_review_request` (registered in `n8n/README.md`). Built **SMS-first** (simpler
than the RE template, which is email-first/Claude-personalized — not reusable as-is for an HVAC one-tap link).

**Before activating (both required):**
1. Provision the 507 Air Twilio number (prereq 2) and set it as the `from` on the **Send SMS** node
   (currently placeholder `+1XXXXXXXXXX`), pointing at the right Twilio subaccount credential.
2. Fire a test via the `n8n-payload`/`http-request` skill against the `/webhook/507air-review-request`
   path with header `x-norr-token`, confirm the SMS and the `triggered`/`completed` rows in
   `workflow_events`, then set the workflow active.

**As built:** Webhook (`507air-review-request`, POST) → Token Check → [Prep Fields → Wait
(`delay_hours`, default 2) → Send SMS → Log Completed] + [Log Triggered]. Hardcoded
`client_id 492902e1-…`, review link baked into the SMS, STOP opt-out included. Error Workflow =
`Norr AI Workflow Error Logger`. **Payload:** `{ customer_name, phone, email?, delay_hours? }`.

### Original scope (for reference)

**Goal:** after a completed job, text (and optionally email) the customer a one-tap link to leave a
Google review. Reviews are 507 Air's #1 prominence lever (8 vs competitor median 452).

**Trigger — the open question.** 507 Air has no CRM/field software, so "job completed" has no automatic
signal. Options (pick one with Oscar):
- **(a) Internal mini-form** (recommended): a Cloudflare-Access-gated page (like the agent forms) where
  Oscar enters customer first name + mobile after a job. Simplest, reliable, no new software. POSTs to the
  n8n production webhook.
- (b) Oscar forwards/texts job info to a number/inbox that n8n watches (more fiddly).
- (c) Later: trigger off a real scheduling tool if he adopts one.

**Flow (webhook → …):**
1. **Webhook** (production `/webhook/…`) — payload `{ customer_name, phone, job_type?, agent_email }`.
2. **Token Check** (CSRF guard, secondary to Cloudflare Access).
3. **Lookup Client** (Postgres, `continueOnFail`) — hardcode 507 Air `client_id` (from prereq 1).
4. **Log Triggered** (Postgres, `continueOnFail`).
5. **Normalize + validate** (Set) — E.164 phone, trim name; stop if phone invalid.
6. **Wait** — delay send ~2–3 hours after job entry (feels natural, not robotic). Optional; could send
   immediately if Oscar enters it at end of job.
7. **Twilio: Send SMS** — one message, review link, STOP opt-out. **No `continueOnFail` on this node**
   (it's a send/action node — CLAUDE.md rule). Draft copy:
   > Hi {name}, thanks for choosing 507 Air! If we did right by you, a quick Google review really helps
   > our family business: {review_link} — Reply STOP to opt out.
8. **(Optional) SendGrid email** fallback if no mobile (email instead).
9. **Log Completed** (Postgres, `continueOnFail`).
- **Settings → Error Workflow:** `Norr AI Workflow Error Logger`.

**Guardrails:** de-dupe so the same phone isn't asked twice in N days (SELECT recent sends from
`workflow_events`/a small table before sending). One ask + at most one follow-up — never nag.

---

## Workflow 2 — Missed-call → SMS text-back

**workflow_name:** `507air_missed_call_textback` (register in `n8n/README.md`)

**Goal:** when a call to the business line goes unanswered, auto-text the caller so a missed call doesn't
become a lost job (and doesn't contradict the 24/7 promise).

**Telephony prerequisite (the real design decision).** Text-back only works if missed calls generate a
Twilio event. Two paths:
- **(a) Twilio number as the public line** — the GBP/site number *is* a Twilio number that forwards to
  Oscar's cell; if he doesn't answer in N seconds, Twilio fires the text-back. Cleanest, but means
  changing the displayed number or porting `(507) 491-3063` to Twilio.
- **(b) Conditional call forwarding** — Oscar's carrier forwards *unanswered* calls to a Twilio number,
  which texts back. No number change, but carrier-dependent and flakier.
- This can run largely in **Twilio Studio** rather than n8n; if so, n8n's role is just logging via a
  Twilio status webhook. Decide Studio-vs-n8n once the telephony path is chosen.

**Flow (Twilio inbound/status webhook → …):**
1. **Webhook** — Twilio posts call status (`no-answer` / `busy` / missed).
2. **Lookup Client** + **Log Triggered** (Postgres, `continueOnFail`).
3. **IF missed** (status in no-answer/busy/failed) — else stop.
4. **(Optional) business-hours / dedupe branch** — avoid double-texting repeat callers within minutes.
5. **Twilio: Send SMS** (no `continueOnFail`). Draft copy:
   > Sorry we missed your call — this is 507 Air Heating & Cooling. How can we help? Reply here or call
   > (507) 491-3063. Reply STOP to opt out.
6. **Log Completed** (Postgres, `continueOnFail`).
- **Settings → Error Workflow:** `Norr AI Workflow Error Logger`.

**Note:** keep copy to "how can we help" — **no after-hours rate language** even though the line is 24/7.

---

## After building (both)

- Run the **`n8n-audit`** skill against each workflow (logging-standard compliance).
- Test with the `n8n-payload` skill before going live; use the `/webhook/` production path, not test.
- Add names to `n8n/README.md` registry and note in `docs/workflows-built.md`.

## Open decisions for Oscar / Egan

1. Review-request **trigger** — internal form (a) vs forward (b)?
2. Missed-call **telephony** — Twilio-as-main-line (a) vs conditional forwarding (b)? Willing to change/port
   the displayed number?
3. SMS **or** SMS+email for review requests?
4. Confirm the 507 Air `clients` row details before insert.
