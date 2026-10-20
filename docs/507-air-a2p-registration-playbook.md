# 507 Air — A2P 10DLC registration: wording + consent evidence

Drafted 2026-10-20. Companion to `507-air-nap-consent-pitch-playbook.md` (Part 2 consent plan) and
`507-air-n8n-workflows-scope.md`.

**How reliable this is.** I could **not** read Twilio's own pages from the cloud environment (DNS failure on
`twilio.com` / `help.twilio.com`). Everything below tagged **[search]** comes from search-result summaries of
Twilio's docs/error pages and carrier-registration guides; **[inference]** is my judgment; nothing is verified
against the live Twilio console. **Before submitting, read the current Twilio docs/console fields yourself**
(fees, use-case names, and field limits change), and have a lawyer review the consent language.

---

## 0. A correction to my earlier advice

I earlier ranked "tech asks verbally at the job" as the best consent path. For **registration**, don't rely
on it. Guidance on verbal consent conflicts **[search]**: one provider says verbal consent is *not acceptable*
for A2P 10DLC (have the customer text you first instead), another accepts it only with recorded calls, and
Twilio's own onboarding guide shows a verbal/IVR example where the caller must reply yes/no. You can't show a
reviewer a verbal opt-in. **Use a signed/checked form or a customer-initiated text** as the opt-in you register.
Verbal can still be how Oscar *introduces* the form.

---

## 1. Registration structure

### Brand
- **Register 507 Air as the brand, in its own Twilio subaccount** (Twilio's preferred ISV setup: a Secondary
  Customer Profile + Brand under the customer's subaccount **[search]**) — not Norr AI's brand.
- **Brand type:** if the LLC has an EIN, it can't register as a Sole Proprietor — it must be a Standard or
  Low-Volume Standard brand **[search]**. Legal name, EIN and address must match IRS/state records exactly
  (a common rejection cause **[search]**).
- 🚩 **Address conflict:** brand registration needs the business address on the EIN record. If that's Oscar's
  home, it's not public-facing like a directory listing, but tell him it goes into the registration. Resolve the
  address question first (`507-air-nap-consent-pitch-playbook.md` Part 1).
- Needs from Oscar: exact legal name ("507 Air Heating & Cooling, LLC"), EIN, registered address, authorized
  contact name/email/phone, website (`507air.com`, must load without errors **[search]**).

### Campaigns — two, in this order
1. **Now: one *service-only* campaign** (use case: **Customer Care** — or Low Volume Mixed; check the console).
   Covers: missed-call reply, post-service follow-up, review request. **No marketing content.**
2. **Later (spring): a separate *Marketing* campaign** for maintenance reminders/offers, once a consented list
   exists.
Why: marketing is its own category, the use case **can't be changed after registration**, and sources advise
separate campaigns (up to five per brand) over one Mixed campaign **[search]**. Keeping service-only first
means less scrutiny and a faster approval for the text-back — the time-sensitive piece. **Low Volume Mixed**
(under ~2,000 segments/day on T-Mobile, lower monthly fee **[search]**) is a defensible single-campaign
alternative if you'd rather register once — but then the marketing opt-in standard applies to the whole
campaign **[inference]**. Fees conflict between sources ($4 brand / $15 vetting / ~$2 monthly were cited);
confirm in Twilio's console.

### Approval timing
Your roadmap says 2–4 weeks; Twilio's sole-proprietor path is cited as 5–10 days **[search]** (not available
to an EIN business). Start now. Until approved, run the workflows email-only (lessons-learned pattern).

---

## 2. Wording — campaign fields

Rules that cause rejection **[search]**: vague descriptions ("sends messages to customers"), samples without
the brand name or opt-out, a pre-checked consent box, consent bundled with accepting terms, a privacy policy
that doesn't cover SMS/mobile-info sharing, brand/website mismatches. Be specific; name the sender, the
recipients, and why.

### Campaign description (service campaign)

> 507 Air Heating & Cooling, LLC is a family-owned HVAC contractor in Faribault, Minnesota. This campaign sends
> text messages to (1) people who called the business and did not reach a person — a single reply asking how
> we can help; and (2) existing customers who have agreed to receive texts — a thank-you with a link to leave
> a Google review, and follow-ups about a completed service visit. Messages contain no promotional content.
> Numbers are collected only from callers, from signed customer forms, or from people who text us first; no
> purchased or third-party lists are used. Recipients can reply STOP at any time.

### Message flow / opt-in description (describe each way a number enters the system)

> **1. Missed-call reply.** A person calls the business line, (507) 491-3063. If the call is not answered, the
> caller receives one automated text asking how we can help. The person initiated contact by calling; the text
> only responds to that call and contains no promotion. Every message includes STOP instructions.
>
> **2. Service-form consent.** After a service visit the customer is given our service form (sample at
> https://507air.com/sms-consent). It contains an **unchecked** checkbox with the full text-message disclosure
> (brand name, message types, frequency, "message and data rates may apply", STOP/HELP, links to Terms and
> Privacy Policy). The customer checks the box and signs. We record the number, date, and form version, and send
> texts only to customers with a recorded consent.
>
> **3. Text-to-join.** Customers may text JOIN to (507) XXX-XXXX. The instructions appear on our invoices, vehicles,
> and https://507air.com/sms-consent (screenshots at that URL). The customer receives a confirmation message
> with the disclosure and can reply STOP to cancel.

Replace XXX-XXXX with the real Twilio number. If you don't launch text-to-join, delete path 3 and don't describe
it — describe only flows that really exist.

**Missed-call risk [inference]:** I found no source on how reviewers treat missed-call text-back. Reviewers may
ask how the caller "opted in." If they push back, the fallback is a short phone-greeting prompt ("Press 1 and
we'll text you right now") so the caller takes an affirmative action. Plan for that, but start with the plain
flow above.

### Sample messages (need ≥2; bracket variables; brand name; opt-out in at least one)

1. **Missed-call reply**
   > 507 Air Heating & Cooling: Sorry we missed your call! How can we help? Reply here or call (507) 491-3063. Reply STOP to opt out.
2. **Review request**
   > Hi [First Name], thanks for choosing 507 Air Heating & Cooling! If we took good care of you, we'd appreciate a quick Google review: [review link] Reply STOP to opt out.
3. **Service follow-up**
   > 507 Air Heating & Cooling: Hi [First Name], following up on your [service type] visit on [date]. Questions? Call (507) 491-3063. Reply STOP to opt out.

Don't put an after-hours/emergency **rate** or a promise like "we'll respond in 5 minutes" in any message (Oscar's
standing rule; and don't promise times you can't keep). Avoid public URL shorteners (bit.ly etc.), which carriers
often filter **[inference]**; use the Google review link directly and test that it delivers.

### Required system messages
- **Opt-in confirmation (text-to-join):** `507 Air Heating & Cooling: You're signed up for service texts (follow-ups, review requests). Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to cancel. Terms & privacy: 507air.com/sms-terms`
- **HELP reply:** `507 Air Heating & Cooling: For help call (507) 491-3063 or email airheatingandcooling507@outlook.com. Reply STOP to cancel. Msg & data rates may apply.`
- **STOP confirmation:** `507 Air Heating & Cooling: You've been unsubscribed and won't receive more texts. Reply START to resubscribe.`
  (Configure these in the Messaging Service's opt-out/help settings; make sure STOP also updates `leads.sms_opt_out`.)

### Marketing campaign (spring) — wording differs
- **Description:** "…sends maintenance reminders and seasonal service offers to existing customers who opted in to promotional texts…"
- **Sample:** `507 Air Heating & Cooling: Hi [First Name], it's time for your fall furnace tune-up. Reply YES to book or call (507) 491-3063. Msg & data rates may apply. Reply STOP to opt out.`
- Requires its **own** opt-in (separate checkbox/keyword, e.g. text `TUNEUP`), the disclosure "**Consent is not a condition of purchase**", and a realistic frequency ("up to 2 msgs/month"). No emergency-rate language.

---

## 3. Consent disclosure text (for forms, web page, invoice)

Twilio's rejection for pre-checked boxes **[search]** (error 30925): the messaging-consent checkbox must be
**separate**, **unchecked by default**, and not the same control as accepting Terms/Privacy.

**Service texts (use for the registered campaign):**
> ☐ I agree to receive text messages from **507 Air Heating & Cooling** about my service — follow-ups after my
> visit and requests to leave a review. Message frequency varies. Message and data rates may apply. Reply STOP
> to cancel, HELP for help. See our [Terms] and [Privacy Policy].

**Promotional texts (separate checkbox, only for the later marketing campaign):**
> ☐ I also agree to receive **promotional** text messages from **507 Air Heating & Cooling** — maintenance
> reminders and seasonal offers (up to [2] per month). Consent is not a condition of any purchase. Message and
> data rates may apply. Reply STOP to cancel, HELP for help. See our [Terms] and [Privacy Policy].

Don't write "…and our partners" without naming them; consent can't be transferred from a list provider
**[search]**.

---

## 4. Documents and forms to build (the evidence pack)

All public ones live on **507air.com** — reviewers visit the brand's website and look for the privacy policy
**[search — third-party guide, not Twilio's wording]**. Norr AI's own `website/privacy.html` / `terms.html`
can't stand in for 507 Air (and note Norr's page says it sends no marketing texts — don't copy that line if
a marketing campaign is coming).

| # | Document | Where | Purpose |
|---|---|---|---|
| 1 | **Privacy Policy** (with SMS section) | `507air.com/privacy.html`, linked in every footer | Must cover SMS and state mobile info / opt-in consent is **not shared with third parties or affiliates for marketing** (Twilio error 30908 **[search]**). Suggested clause: "No mobile information will be shared with third parties or affiliates for marketing or promotional purposes. Text-messaging originator opt-in data and consent will not be shared with any third parties." |
| 2 | **SMS Terms** | `507air.com/sms-terms.html` | Program name (507 Air Heating & Cooling), what messages, frequency, "message and data rates may apply", STOP/HELP instructions, support contact, carrier non-liability, link to privacy |
| 3 | **SMS consent / opt-in page** | `507air.com/sms-consent.html` | The public proof URL: program description, the disclosure text, **images of the actual service form** (and blank sample), the JOIN instructions, and where they appear. Use this URL in the "message flow" field |
| 4 | **Service form with SMS checkbox** | Paper/estimate/invoice Oscar uses (+ photo/scan hosted on #3) | Unchecked box, disclosure text, signature + date. This is the registered opt-in |
| 5 | **Text-to-join proof** (if launched) | Invoice footer, vehicle/flyer, QR → #3 | Shows where customers see the keyword and number |
| 6 | **Web opt-in form** (optional, later) | `507air.com` form | Unchecked checkbox, separate from terms. High-risk per `CLAUDE.md` → full Playwright coverage first |
| 7 | **Consent log** | Neon `leads` | Proposed columns: `sms_consent_at`, `sms_consent_type` (service/marketing), `sms_consent_method` (form/text_join/web), `sms_consent_text` (exact wording/version). Stored digitally with identity and date — reviewers/carriers can ask |
| 8 | **Opt-out handling spec** | internal | STOP/HELP replies; inbound handler sets `sms_opt_out = true`; honor reasonable opt-out words; every workflow gates on consent AND not opted out |
| 9 | **One-page SOP for Oscar** | internal | Hand the customer the form, never type a number without a checked box, how to log it |
| 10 | **Registration data sheet** | internal | Legal name, EIN, address, contacts, website, brand/campaign field text from §2 |

Retention: keep consent records for several years — commonly advised ~4 years because of the TCPA limitations
period **[inference — confirm with counsel]**.

---

## 5. Pre-submission checklist (map to the known rejection causes)

- [ ] `507air.com` loads cleanly; privacy + SMS terms linked in the footer
- [ ] Privacy policy explicitly covers SMS and the no-sharing clause
- [ ] Opt-in proof is a **public URL** (screenshots/PDF of the real form), not behind a login
- [ ] Consent checkbox unchecked by default, separate from terms acceptance
- [ ] Campaign description + message flow name the sender, recipients, purpose, and each real opt-in path
- [ ] ≥2 sample messages, bracketed variables, brand name in each, STOP in at least one
- [ ] Legal name / EIN / address match IRS records exactly; brand type is not Sole Proprietor
- [ ] Use case chosen deliberately (can't be changed later)
- [ ] STOP/HELP/opt-in confirmation messages configured; STOP syncs to Neon
- [ ] Workflows built to **refuse sends without recorded consent**

## 6. Order of work
1. Oscar: EIN, legal name, registration address, and the address decision.
2. Build #1–#3 on 507air.com (+ Playwright tests); build the service form (#4).
3. Create the 507 Air Twilio subaccount + number; submit brand, then the service campaign.
4. While waiting: run review-request/missed-call email-only or in test; add consent columns + gate.
5. After approval: turn on SMS. Spring: collect promotional consent, register the marketing campaign.
