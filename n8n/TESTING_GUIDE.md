# Workflow Testing Guide
## Real Estate — Instant Lead Response, Open House Follow-Up, 7-Touch Cold Nurture

---

## Prerequisites (do once, before any testing)

1. Import all 3 workflows into n8n
2. Fix Twilio credential + from number in each
3. Verify Anthropic credential resolves
4. Update webhook URLs in all 3 HTML files
5. Activate all 3 workflows

Use **Hoppscotch** to test webhooks directly before touching the forms. Faster feedback loop.

---

## 1. Instant Lead Response

**Step 1 — Hit the webhook directly in Hoppscotch**
```
POST https://norrai.app.n8n.cloud/webhook/lead-response
Header: X-Norr-Token: 8F68D963-7060-4033-BD04-7593E4B203CB
Body:
{
  "agent_name": "Jane Smith",
  "agent_email": "your@email.com",
  "agent_phone": "5071234567",
  "lead_name": "Test Lead",
  "phone": "YOUR_REAL_PHONE",
  "email": "your@email.com",
  "source": "zillow",
  "lead_message": "I saw the listing on Zillow and I'm interested. Is it still available?",
  "property_address": "123 Maple St, Faribault, MN 55021",
  "price_range": "$299,900",
  "beds": 3,
  "baths": 2,
  "key_details": "New roof, updated kitchen"
}
```
Watch the n8n execution panel. Confirm it runs end to end. Check your phone for SMS and your inbox for the agent preview email.

**Step 2 — Read the actual messages**
- Does the SMS mention the lead's name and the property? Not generic?
- Does it sign off with the agent phone?
- Under ~120 words?

**Step 3 — Test the form**
Open `lead_response.html` in a browser, fill it out, submit. Confirm the same result.

**Step 4 — Test the token check**
Send the Hoppscotch request without the `X-Norr-Token` header. The execution should stop at Token Check and go nowhere.

---

## 2. Open House Follow-Up

**Step 1 — Build a test URL and open it**
```
https://tools.norrai.co/open_house.html?address=123+Maple+St,+Faribault,+MN&agent=Jane+Smith&agent_email=your%40email.com&agent_phone=5071234567
```
Confirm: property badge shows the address, form loads correctly.

**Step 2 — Test missing params**
Open `open_house.html` with no query string. Confirm the error message shows instead of the form.

**Step 3 — Submit the form**
Use your own phone number. Submit. Confirm the success state (form hides, confirmation text appears).

**Step 4 — Manually resume the wait node**
In n8n → Executions, find the paused execution. Click into it, find the **Wait Until 9am CT** node, click **Resume**. The workflow should continue immediately.

**Step 5 — Read the messages**
- Does the SMS mention the attendee's name?
- Does it reference the property address?
- Does it acknowledge what they wrote in "What brought you in today?" naturally?
- Signs off with agent name + phone?

**Step 6 — Test with no email**
Submit the form leaving email blank. Resume the wait. Confirm it hits the **Has Email?** IF node and skips SendGrid cleanly — no errors in the execution log.

---

## 3. 7-Touch Cold Nurture

This one takes the most time to test properly. Do it in a single sitting where you can manually step through each touch.

**Step 1 — Enroll via Hoppscotch first**
```
POST https://norrai.app.n8n.cloud/webhook/nurture-enroll
Header: X-Norr-Token: 8F68D963-7060-4033-BD04-7593E4B203CB
Body:
{
  "agent_name": "Jane Smith",
  "agent_email": "your@email.com",
  "agent_phone": "5071234567",
  "lead_name": "Cold Lead",
  "phone": "YOUR_REAL_PHONE",
  "email": "your@email.com",
  "source": "zillow",
  "lead_message": "I was looking at 123 Maple but went quiet after the first response.",
  "property_address": "123 Maple St, Faribault, MN 55021",
  "price_range": "$299,900",
  "beds": 3,
  "baths": 2
}
```

**Step 2 — Step through touches 1–3 manually**

The execution will pause at **Wait Day 1**. Resume it. Watch Touch 1 (email) fire.

It pauses again at **Wait Day 3**. Resume. Watch Touch 2 (SMS) fire.

It pauses again at **Wait Day 7**. Resume. Watch Touch 3 (email) fire.

**This is the critical check:** open the actual SMS and email messages and confirm the lead's name, property address, and price range are correctly filled in — not blank or `undefined`. If they're blank, the `$('Prep Fields').first().json` reference is breaking after wait resumes. Stop and debug before continuing.

**Step 3 — Read the messages critically**
Each touch should feel meaningfully different. You're looking for:
- T1 (email): warm follow-up, references the property
- T2 (SMS): different angle — not "just checking in"
- T3 (email): feels like useful intel, not a sales pitch

If any of them read like a template, tweak the prompt in the Build Prompt Set node for that touch.

**Step 4 — Test no-email path**
Enroll a second lead with email left blank. Step through to T1. Confirm SendGrid errors (expected — this is the known gap). Then add `required` to the email field in `nurture_enroll.html` and redeploy to prevent it happening in production.

**Step 5 — Test the form**
Open `nurture_enroll.html`, enroll a lead, confirm the success message and that agent fields persist on the next load.

---

## Order to run all of this

```
1. Prerequisites (credentials, URLs, activate)
2. Lead Response — Hoppscotch → form → token test
3. Open House — URL/params → form → resume wait → messages
4. Cold Nurture — Hoppscotch → step through T1–T3 → verify data persists
5. Fix email required field in nurture form
6. Deploy HTML changes to Cloudflare Pages
```

Total time realistically: 2–3 hours if you do it methodically. The nurture workflow is the only one that requires active babysitting (manually resuming waits). The other two you can fully test in under 30 minutes each.
