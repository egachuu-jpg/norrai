# Testing & Production Promotion Notes
## Real Estate Workflows — Instant Lead Response, Open House Follow-Up, 7-Touch Cold Nurture

---

## Before You Test Anything

### Fix these in n8n after importing each workflow
1. **Twilio credential** — every workflow has `"id": "TWILIO_CREDENTIAL_ID"`. Open each Twilio node and select your actual credential.
2. **Twilio from number** — every workflow has `+18XXXXXXXXXX`. Replace with your actual number.
3. **Anthropic credential** — set to `gXqu8TiqvDY4mUPZ` (copied from the listing description workflow). If you're on the same n8n instance this should resolve automatically. Verify it's linked before testing.
4. **Workflows import as inactive** — activate manually after you've verified the nodes look correct.

### Fix these in the HTML files
| File | Placeholder to replace |
|------|----------------------|
| `website/lead_response.html` | `https://YOUR-N8N-INSTANCE.app.n8n.cloud/webhook/lead-response` |
| `website/open_house.html` | `https://YOUR-N8N-INSTANCE.app.n8n.cloud/webhook/open-house-signin` |
| `website/nurture_enroll.html` | `https://YOUR-N8N-INSTANCE.app.n8n.cloud/webhook/nurture-enroll` |

**Use `/webhook/` paths, not `/webhook-test/`.** The test path only works while n8n is actively listening; production path works always.

---

## Workflow-Specific Notes

### 1. Instant Lead Response

**Phone formatting** — the Twilio node prepends `+1` and strips non-digits: `+1{{ $json.phone.replace(/\D/g, '') }}`. If a lead's phone already has a `+1` or `1` prefix in the form, you'll get `+11XXXXXXXXXX` which Twilio will reject. Test with a bare 10-digit number first. You may want to add a guard in the form or the Code node.

**No email allowlist** — unlike the listing form, there's no DataTable allowlist check. Any submission that passes the token check goes straight to Claude and fires an SMS. Keep the webhook URL private.

**Test checklist:**
- Submit the form with your own phone number as the lead phone
- Confirm SMS arrives within ~30 seconds
- Confirm agent email preview arrives
- Submit without the token (delete the header in devtools or Hoppscotch) — should drop silently with a 200 or timeout, not error

---

### 2. Open House Follow-Up

**Wait node — testing** — the wait node is set to fire at 9am CT the next day. You don't want to actually wait overnight to test it. In n8n, go to Executions, find the paused execution, and click **Resume** manually. This skips the wait and fires the rest of the workflow immediately. Use this to test the Claude + SMS + email path without waiting.

**9am CT timezone math** — the Code node uses `setUTCHours(15, 0, 0, 0)` which is 9am CDT (UTC-6, summer). In winter CST (UTC-5), that fires at 10am. Two options:
- Live with it — 10am is fine
- Change to `14` in November–March and `15` in March–November
- Or compute it properly with a timezone library if it matters

**QR code URL** — the URL embeds agent name, email, and phone as query params. Special characters need encoding. Test your QR code URL by opening it in a browser before printing. The `@` in agent_email must be `%40`. Use a URL encoder or test via browser address bar and verify the property badge and form fields populate correctly.

**Missing params handling** — if someone opens `open_house.html` with no `?address=` param, they see an error message instead of the form. Test this by opening the page with no params.

**Test checklist:**
- Generate a test URL with your own phone/email as agent params
- Scan the QR code on your phone, fill in the form, submit
- In n8n Executions, find the paused execution and manually resume
- Confirm SMS arrives, confirm email arrives if you entered one
- Open the page with no params — confirm error state shows

---

### 3. 7-Touch Cold Nurture

**`$('Prep Fields').first().json` references** — this is the most important thing to verify. Every Build Prompt node and Extract Code node references `Prep Fields` by name to pull lead data across 34 nodes and 5 wait pauses. n8n stores full execution state when pausing, so this should work. But you must verify it on the first real test — if the reference breaks after a wait resumes, all subsequent touches will produce empty prompts.

**How to test without waiting 21 days** — test each touch individually:
1. Enroll a lead
2. Let it hit Wait Day 1 and pause
3. Manually resume in Executions
4. Verify Touch 1 (email) fires correctly with real lead data
5. Let it hit Wait Day 3, manually resume
6. Verify Touch 2 (SMS), and so on

Don't try to test all 6 touches in one session — just verify that data persists across at least one wait resume before going to production.

**Emails require a lead email** — touches T1, T3, and T5 are email-only. There's no `has_email` guard (unlike the open house workflow). If you enroll a lead with no email, SendGrid will receive a blank `toEmail` and the execution will error on those steps, halting the sequence. Two options:
- Make email required in the form (simplest fix — just add `required` to the email field in `nurture_enroll.html`)
- Add an IF node before each SendGrid node to check for email (more work, but allows SMS-only leads)

**Recommend: make email required before going live.**

**The auto-trigger webhook is live but disconnected** — the `Auto-Trigger (future)` webhook node is in the workflow and will be active once you activate the workflow. Someone with the URL could hit it. It won't do anything since it's disconnected from Token Check, but it will accumulate failed/dead executions in your log. If you want it completely inert, delete that node for now and re-add it when you're ready to wire it up.

**No unsubscribe / stop handling** — if a lead replies STOP to an SMS, Twilio honors the opt-out and blocks future messages to that number. n8n won't know this and will still attempt to send the remaining touches. Those attempts will fail silently (Twilio returns an error, n8n logs it). Not catastrophic, but your execution log will have errors for opted-out leads. At 10+ clients this is worth fixing with a Twilio inbound webhook that cancels the n8n execution.

**Test checklist:**
- Enroll with your own phone + email
- Manually resume through at least 2 wait nodes
- Verify lead data (name, property, etc.) is correctly populated in the actual messages — not blank or `undefined`
- Verify email subject and body parse correctly (SUBJECT:/BODY: split)
- Enroll with no email and confirm what happens (error or graceful skip)

---

---

## B&B Manufacturing Estimate Workflow

**Workflow file:** `n8n/workflows/B&B Manufacturing Estimate.json`
**Form file:** `website/bnb_estimate_form.html`
**Webhook path:** `/webhook/bnb-estimate`

### Import checklist
1. Go to n8n Cloud → Workflows → Import → upload `B&B Manufacturing Estimate.json`
2. Open **Claude — Generate Estimate** node → verify "Anthropic account 2" credential is linked
3. Open **Send Estimate Email** node → verify "SendGrid account" credential is linked
4. Webhook is set to `responseMode: onReceived` — form gets immediate 200, estimate sends async

### No placeholders to fix in the HTML
The form already points to `https://norrai.app.n8n.cloud/webhook/bnb-estimate` (production path). No edits needed.

### Test payload (Hoppscotch → POST to `/webhook-test/bnb-estimate`)
Header: `X-Norr-Token: 8F68D963-7060-4033-BD04-7593E4B203CB`

```json
{
  "name": "Test User",
  "company": "Test OEM",
  "email": "YOUR_EMAIL_HERE",
  "phone": "5075550000",
  "part_name": "Hydraulic Tank Bracket",
  "material_type": "mild_steel",
  "thickness": 0.25,
  "length": 12,
  "width": 8,
  "height": 4,
  "weight": null,
  "quantity": 5,
  "notes": "Needs to withstand 3000 PSI",
  "services": [
    { "name": "laser_cutting", "max_cut_length": 12, "holes": 4 },
    { "name": "mig_welding", "weld_length_in": 24 },
    { "name": "powder_coating", "finish_type": "standard", "surface_area_sqft": null }
  ]
}
```

**Expected:** estimate email arrives within ~60 seconds with line-item table, totals, and lead time.

### Test checklist
- [ ] Import workflow, verify both credentials link
- [ ] Fire test payload to `/webhook-test/` URL, confirm estimate email arrives
- [ ] Review email — check line items, total math, lead time, disclaimer
- [ ] Test token rejection: submit with wrong token, confirm no email sent
- [ ] Submit via the actual HTML form in browser (not Hoppscotch) — confirm success banner, then email
- [ ] Switch workflow to `/webhook/` production path and activate

### Known gaps / future work
- **No Neon logging yet** — workflow does not write to `leads` or `workflow_events` tables. Add Postgres nodes when B&B becomes a real client and you have a Neon credential configured in n8n.
- **Rate card is placeholder** — placeholder rates are in the `Build Claude Prompt` Code node as part of the prompt string. To update rates, edit that node directly. Production upgrade: move rate card to a Google Sheets tab and read it at runtime with n8n's Google Sheets node — B&B staff can then update rates without touching n8n.
- **No file attachment handling** — the form accepts a file upload field, but the workflow ignores it. Attachments are not forwarded. For production, add a step to store the file (Cloudflare R2 or similar) and include a link in the estimator's notification.
- **Claude uses placeholder rates** — estimates are directionally correct but not billable. Do not show to B&B until real rates are substituted.

---

## Real Estate Review Request

**Workflow file:** `n8n/workflows/Real Estate Review Request.json`
**Form file:** `website/review_request.html`
**Webhook path:** `/webhook/review-request`

### Before testing
1. Open **Send SMS** node → select your Twilio credential, replace `+18XXXXXXXXXX` with your number.
2. Open **Send Email** node → select "SendGrid Header Auth" credential. Create it in n8n Credentials if needed: type "Header Auth", Name: `Authorization`, Value: `Bearer SG.your-api-key`.
3. Open **Claude API** node → verify "Anthropic account 2" credential is linked.
4. Activate the workflow.

### Wait node testing
The Wait node pauses execution for 1, 3, or 7 days. To test without waiting: go to **Executions**, find the paused execution, click **Resume**. This fires the Claude → SMS → Email path immediately.

### Test checklist
- [ ] Submit as Buyer — verify Claude message says "new home" not "sale"
- [ ] Submit as Seller — verify Claude message says "sale" not "new home"
- [ ] Submit with no Zillow URL — verify only Google link appears in SMS and email
- [ ] Submit with no client email — verify SMS fires, Has Email? node routes to false branch (no SendGrid error)
- [ ] Submit with 1-day delay → manually resume → confirm messages arrive
- [ ] Submit with 3-day delay (default) → manually resume → confirm messages arrive
- [ ] Submit with 7-day delay → manually resume → confirm messages arrive
- [ ] Submit with invalid token → confirm no execution runs (check Executions log)

### Known gaps / edge cases
- **Phone double-prefix** — Prep Fields strips non-digits and prepends `+1`. If client enters `15075551234`, you'll get `+115075551234` which Twilio rejects. Document this for agents: enter 10-digit numbers only.
- **No unsubscribe handling** — Twilio honors STOP replies at the carrier level. n8n will log an error for opted-out numbers but won't halt.

---

## Production Promotion Checklist

- [ ] Twilio account upgraded from trial (trial blocks messages to unverified numbers)
- [ ] Local 507 area code number purchased and set as from number in all 3 workflows
- [ ] All webhook URLs updated in HTML files
- [ ] All 3 workflows activated in n8n
- [ ] HTML files deployed to Cloudflare Pages (`git push` triggers deploy)
- [ ] Token verified — submit each form and confirm it hits n8n with the correct `X-Norr-Token` header
- [ ] At least one end-to-end test per workflow with real phone/email before enrolling a real client
- [ ] For nurture: verified that `$('Prep Fields').first().json` resolves correctly after a wait resumes

---

## Known Gaps (fix before first real client)

| Gap | Workflow | Priority |
|-----|----------|----------|
| Email required for nurture | Cold Nurture | High — will cause execution errors |
| Phone +1 prefix double-adding | Lead Response | Medium — test your specific case |
| Winter CST timezone offset | Open House | Low — 10am is acceptable |
| Auto-trigger node accumulating dead executions | Cold Nurture | Low — cosmetic |
| No opt-out awareness in n8n | Cold Nurture | Low — Twilio handles it, n8n just logs errors |

---

## B&B Lead Generator

**Workflow file:** `n8n/workflows/B&B Lead Generator.json`
**Trigger:** Schedule — every Monday at 11am UTC (6am CDT / 7am CST in winter)
**Review email recipient:** egachuu@gmail.com (placeholder — replace with B&B inbox before go-live)

### Credentials to configure after import

| Node | Credential type | What to set |
|---|---|---|
| Search Apollo | HTTP Header Auth | `X-Api-Key` = Apollo API key |
| Read Exclusion Sheet | Google Sheets OAuth2 | Link Google account; update spreadsheet ID |
| Score with Claude | Anthropic | `gXqu8TiqvDY4mUPZ` (Anthropic account 2) |
| Draft Outreach | Anthropic | `gXqu8TiqvDY4mUPZ` (Anthropic account 2) |
| Send Review Email | SendGrid | `A5ypmjiRLAUMUm9O` (SendGrid account) |
| Log Lead to Neon | Postgres | Add Neon pooled connection string as Postgres credential |

### Google Sheet setup

Create a Google Sheet with two columns in row 1: `company_name` | `domain`

Pre-populate with any companies already in B&B's customer list. Share the sheet with the Google account linked in n8n.

Replace `YOUR_SPREADSHEET_ID` in the Read Exclusion Sheet node with the actual spreadsheet ID (found in the Google Sheet URL: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`).

### Apollo.io setup

B&B must create an Apollo.io account and generate an API key (Settings → API → Create Key). In n8n, create an HTTP Header Auth credential with name `Apollo API Key`, header name `X-Api-Key`, and the key as the value. Link it to the Search Apollo node.

**Required dependency:** The workflow cannot run until B&B provisions an Apollo account.

### How to test without waiting until Monday

1. Import workflow into n8n — configure all 6 credentials and update spreadsheet ID
2. Open the workflow in n8n editor
3. Click **Test workflow** to manually trigger a single execution
4. Watch execution steps in n8n Executions view — each lead processes as a separate SplitInBatches iteration
5. Confirm review emails arrive at egachuu@gmail.com with real lead data and Claude-written draft
6. Confirm rows appear in Neon `leads` table: `SELECT * FROM leads WHERE source = 'bnb_lead_generator';`

### Critical data reference to verify first

The Parse Score and Parse Draft code nodes use `$('Split by Lead').item.json` and `$('Parse Score').item.json` to carry lead fields across node boundaries inside the SplitInBatches loop. **Verify these references resolve correctly on the first test run.** Check the output of Parse Score and Parse Draft in Executions — if `first_name`, `company`, `score`, etc. are blank or undefined, the `.item` reference broke. Fix: add a Set node before each Claude HTTP Request to explicitly copy `$json.*` fields, removing the need for back-references.

### Test checklist

- [ ] Import workflow, configure all 6 credentials
- [ ] Update spreadsheet ID in Read Exclusion Sheet node
- [ ] Add one test company to exclusion sheet (e.g., "B&B Manufacturing" / "bBmfg.com")
- [ ] Manually trigger — confirm Apollo returns contacts in execution output
- [ ] Confirm excluded company is filtered out in Filter and Dedup output
- [ ] Check Parse Score output — confirm score and reason fields are populated with real lead data
- [ ] Confirm leads scoring >= 8 produce a review email with name, company, score, reason, and draft
- [ ] Confirm leads scoring < 8 are silently skipped (no email, no Neon row)
- [ ] Confirm Neon `leads` table has a row for each qualified lead: `SELECT * FROM leads WHERE source = 'bnb_lead_generator';`
- [ ] Replace egachuu@gmail.com with B&B inbox before activating for production
- [ ] Activate workflow — fires automatically Monday 11am UTC

### Known gaps / future work

| Gap | Priority |
|-----|----------|
| Review email recipient is a placeholder (egachuu@gmail.com) | High — replace before go-live |
| Spreadsheet ID is a placeholder (YOUR_SPREADSHEET_ID) | High — replace before go-live |
| Apollo API key not provisioned — B&B must set up account | High — required dependency |
| JobBOSS integration stubbed (comment in Filter and Dedup node) | Low — future |
| No LinkedIn enrichment (Apify integration planned) | Low — future |
| No workflow_events aggregate row in Neon (individual lead rows are logged) | Low — cosmetic |
| Schedule fires at 6am CDT; becomes 7am in winter CST | Low — acceptable |
| SQL uses string escaping not parameterized queries — adequate for demo scale | Low — upgrade for production |
