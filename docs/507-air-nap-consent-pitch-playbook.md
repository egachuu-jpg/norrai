# 507 Air — NAP fix, SMS consent, and the text-back + reactivation pitch

Drafted 2026-10-20. Companion to `507-air-aeo-findings.md` (the why) and `507-air-n8n-workflows-scope.md`
(the workflows). **Not legal advice** — the consent section reflects how TCPA/CTIA/carrier rules are generally
described; confirm current Twilio 10DLC requirements and, before any marketing SMS goes out, have a lawyer
look at the consent language. Items marked *(unverified)* are my understanding, not something I checked.

---

## Part 1 — Fixing the address / NAP problem

### Question zero (ask Oscar before anything else)

**Which address did you verify the Google profile with?** It's hidden from the public, so nobody on our side
can see it — and it's the distance anchor for "near me" ranking. Note that the GBP service-area list includes
**Skyline, MN 56001**, and the Mankato address found on HomeAdvisor (99 Laurinda Lane) is also ZIP **56001**.
That may be coincidence, but if the real hidden anchor is Mankato and not Faribault, the proximity story
changes (he'd be handicapped in Faribault, not helped). Don't assume "Faribault" until he answers.

Also ask where each wrong address came from: is 99 Laurinda Lane a former address, a family member's, a
second location? Is 17893 Alexander Ave his home?

### Decide one canonical record

For a hidden-address service-area business, canonical NAP is:

| Field | Value |
|---|---|
| Name | **507 Air Heating and Cooling** (as on GBP). "&" vs "and" is cosmetic — don't edit the GBP name now |
| Phone | **(507) 491-3063** everywhere, same 10-digit format |
| Location | **Faribault, MN** (city/area only) — *if Oscar confirms that's the real base* |
| Street address | **None published** (SAB). PO Box 355 stays as a *mailing* address on the website |
| Website | https://507air.com |

Keep the PO Box on the site: it also doubles as the physical postal address CAN-SPAM requires on marketing
emails (FTC accepts a PO box *(unverified — confirm)*).

### Path A — keep the address hidden (the likely answer)

1. **Fix at the source first.** Aggregators (BuildZoom, Angi/HomeAdvisor, many small directories) often
   copy public records, and they'll re-pollute any correction you make downstream. Look up the license
   (`MB800960`) on the MN DLI lookup and the LLC on the MN Secretary of State search, and see what address
   each shows publicly. The SOS registered-office address is public and generally must be a real street
   address *(unverified)* — if it's his home, the options are a commercial registered agent address or
   accepting that one source stays public. Ask DLI which license fields are public.
2. **Website:** footer already shows PO Box + Faribault on all 5 pages and in schema; nothing to change
   unless Oscar chooses a different city. Tests in `tests/507air_site.spec.js` guard the footer.
3. **Correct each existing listing to hide the street address and show Faribault:**

   | Listing | What to do |
   |---|---|
   | **BBB** (Accredited since 2026-06-26) | Edit in the BBB business portal: city Mankato → Faribault, hide/remove street address. Accredited listings may need BBB review for an address change — contact them if the portal blocks it |
   | **HomeAdvisor / Angi** (one company; fixing one may fix both) | Claim the profile / pro account, remove the Mankato street address, set service area. If there's no control, use their "report incorrect info" path |
   | **BuildZoom** | Claim the listing or request a correction; likely derives from license records, so fix at the source (step 1) too |
4. **Create the five missing listings** (Bing Places, Apple Business Connect, Yelp, Facebook, Nextdoor) with
   **address hidden / service-area-only** wherever supported — confirm each one offers it before starting;
   if one forces a public street address, skip it or use a mailing option rather than expose his home.
5. **Aggregators:** if wrong data keeps reappearing after 4–8 weeks *(rough, unverified)*, claim the big
   data aggregators (Data Axle, Localeze/Neustar, Foursquare) or use a paid listing manager. For one
   client, manual is cheaper — don't buy Yext/BrightLocal syncing yet.
6. **Search for leftovers:** Google the phone number, the business name, and both old addresses in quotes;
   fix or request removal of each hit. Personal-address exposure on people-search sites is a separate privacy
   cleanup, not a NAP task.
7. **Track it** in a small table (directory · URL · status · date) and fill the `citations` array in
   `scripts/aeo-audit/clients/507-air.json`; re-run the audit for the citations pillar (currently 0/15).

### Path B — Oscar shows a real Faribault address

Only valid if it's a place where **customers can actually visit** with posted hours (Google's rule — hiding the
address is required when customers aren't served at the location). Caveats:
- A profile has **one set of hours**; a staffed office with posted hours sits awkwardly next to "Open 24
  hours." Decide which the profile says before switching.
- Expect **re-verification** and possibly a temporary visibility dip. Do it on its own — not the same week as
  other profile edits.
- Order: GBP → website (footer + schema + tests) → existing directories → new listings. Same fixes as Path A,
  but every directory shows the street address instead of hiding it.
- Never use the home address as a storefront, and never a mailbox/virtual office he doesn't staff.

### Path C — the real base is Mankato / Skyline

Then the canonical city isn't Faribault. The GBP service area would stay (it already includes both), but the
site footer/schema city, BBB, and the "Faribault" framing change — and the hidden anchor is already near
Mankato. Needs its own plan; revisit once Oscar answers question zero.

---

## Part 2 — Getting consent to text customers

Three kinds of message, three different risk levels. Design the system so **no message can be sent unless
its consent state is recorded.**

| Message | Basis | Consent needed? |
|---|---|---|
| **Missed-call text-back** | The person just called *you*; reply is informational | Not collected up front. Keep it one message, no promotion, identify 507 Air, include opt-out |
| **Review request** | Existing customer; but it benefits the business | Treat as needing consent — **collect at the job**, don't assume (the legal line is gray; the conservative path is cheap) |
| **Past-client reactivation / promotions** | Marketing | **Prior express written consent** for SMS (clear disclosure, an affirmative act, not a condition of purchase). A customer having given you their number for a service is **not** consent for promo texts |

### How to collect it (best first)

1. **At the job (recommended).** The tech/Oscar asks and the customer agrees verbally or on the
   estimate/invoice. In the planned internal mini-form, add a **required "Customer agreed to texts"** field
   (plus how: verbal / signed / form) — the review workflow refuses to send unless it's set. This also gives
   the proof of consent that carriers ask for.
2. **Text-to-join.** Put a keyword on the invoice, van, or a QR code: customer texts `JOIN` to the 507 Air
   number → auto-reply with the disclosure and confirmation. The inbound text is itself the opt-in record.
   Best for marketing consent.
3. **Web form on 507air.com** with an unchecked box and the disclosure. Heavier: the site has no forms
   today, and per `CLAUDE.md` a webhook form is **high-risk** (needs full tests). Later.
4. **Existing customers with no consent:** email them (CAN-SPAM needs no consent, just an unsubscribe link and
   postal address) with a one-click "yes, text me reminders" link; or Oscar asks on his next call/visit. **Do
   not** text a list of old customers to ask for consent.

### Disclosure wording (for the form, invoice, and JOIN reply — have it reviewed)

> By checking this box / texting JOIN, you agree to receive text messages from **507 Air Heating & Cooling**
> about your service — appointment follow-ups, review requests, and [optional: maintenance reminders and
> occasional offers]. Message frequency varies. Message and data rates may apply. Reply STOP to cancel,
> HELP for help. Consent is not a condition of any purchase. [Privacy Policy link]

Use **two separate opt-ins**: (A) service texts (follow-up, review request), (B) promotions. Don't bundle B
into A, and don't pre-check either.

### What to record (nothing exists yet — `leads` has only `sms_opt_out`, `email_opt_out`, `opted_out_at`)

The roadmap already lists "log sms_consent + consent_timestamp." Proposed columns on `leads` (migration needed,
not written): `sms_consent_at timestamptz`, `sms_consent_type text` (service | marketing),
`sms_consent_method text` (verbal | signed | web | text_join), `sms_consent_text text` (exact wording/version).
Rules for every SMS workflow:
- Gate every send on **consent present AND `sms_opt_out = false`**.
- Match on phone with `NULLIF(trim(...), '')` so a blank never matches a stored blank (see the dedupe lesson in
  `docs/lessons-learned.md`).
- **STOP replies:** Twilio blocks sends to a number that replied STOP, but your database won't know unless an
  inbound-SMS handler sets `sms_opt_out = true`. Honor reasonable opt-out words, not only "STOP".
- Send window: roughly 8am–9pm in the recipient's local time for marketing *(verify; Minnesota may add its own
  rules — check)*. Never send marketing at night even though the business is 24/7.

### Carrier registration (blocks SMS going live)

- US business texting over a standard number needs **A2P 10DLC** brand + campaign registration; the roadmap
  already notes 2–4 weeks. Start it now. Decide whether the **brand is 507 Air's** (own EIN/legal name,
  likely what carriers expect for a per-client subaccount) — confirm Twilio's current ISV rules.
- Carriers review the **opt-in flow and the business's website/privacy policy**. `507air.com` has no privacy
  policy or SMS terms page today — likely needed before approval. Add one (copy the pattern from norrai.co's
  privacy/terms) and test it per the site's Playwright rules.
- Until approval, fallback per lessons-learned: run the workflow email-only and switch to SMS later.

---

## Part 3 — Pitch: missed-call text-back + past-client reactivation

Talk to Oscar in jobs and dollars, not tools (`CLAUDE.md` sales principles). Don't say n8n, Claude, or
"automation." **No price in this conversation unless he asks** — Egan hasn't decided pricing.

### Missed-call text-back

**The pitch:** "When you're under a house or on a roof, the phone rings and you can't get it. That caller
calls the next shop. This sends them a text within seconds — 'Sorry we missed you, how can we help?' — so
they're talking to you instead of your competitor. And your profile says you're open 24/7, so a call at 9pm
that goes nowhere hurts your reputation."

**Make it concrete — ask him three things:**
1. How many calls a week do you miss or send to voicemail? (He can count this week from his call log.)
2. Of those, how many were real jobs vs. wrong numbers/sales calls?
3. What's a typical repair ticket? A typical install?

Math to do on the call: `missed real-job calls per month × share you'd book × average ticket = jobs and
dollars left on the table.` Use **his** numbers; I've deliberately not invented any. (His Google profile
shows only 4 calls and 28 website clicks since July — a small channel, so the billboard and word-of-mouth
calls matter more than they look.)

**What he needs to decide / what we need:**
- **Phone setup:** keep (507) 491-3063 with his carrier forwarding unanswered calls to our number
  (no number change, carrier-dependent), or move the number to Twilio (cleaner, but a change). See
  `507-air-n8n-workflows-scope.md`.
- **Gap in the current scope:** who sees the **replies**? If a caller texts back, the reply lands on a
  Twilio number — it must be forwarded to Oscar's cell or email, or leads answer into a void. Add reply
  forwarding before launch.
- Copy rules: one message, no promotion, identifies 507 Air, includes "Reply STOP to opt out", **no emergency
  or after-hours rate language** (his 2026-08-06 decision). Don't promise a response time he can't keep.
- Needs: Twilio subaccount + number, 10DLC registration (above), the build, `n8n-audit`, a live test.

### Past-client reactivation

**The pitch:** "Your best customers are the ones who already trust you. Most furnaces and ACs need a yearly
tune-up and most people forget until something breaks. A reminder before winter — and again before summer —
puts you first in line, and costs far less than any billboard."

**Be honest about the starting point:** 507 Air has no CRM, and the business is young. **First question: how
many past customers does he have, and in what form** (invoices, phone contacts, QuickBooks, Facebook
messages)? Then:
- **Phase 1 — capture (start now):** every job logs name, phone, email, equipment, date, and consent
  (the same internal form as the review workflow). Without this there's nothing to reactivate.
- **Phase 2 — first campaign:** realistically the **spring AC tune-up (April–May)**. Today is late October, so
  this winter's window is mostly closing; a quick email to whatever list exists is still worth doing.
- **Channels, in order:** email (no consent needed — unsubscribe + postal address required) → **postcard**
  (no consent rules; pairs well with the billboard) → Oscar's own calls → **SMS only to opted-in customers**.
- Copy rules: tune-up and safety framing, **no "emergency rates" language**, no discounts he hasn't approved.
- Fits `CLAUDE.md` tiers: missed-call text-back is a **Starter** workflow; reactivation is the **Growth**
  anchor. (Pricing intentionally not set here.)

### Order to propose to Oscar

1. This week: address answer + license + FAQ read-through (see `507-air-oscar-message.md`).
2. Start 10DLC registration and the privacy/terms page now — it's the longest lead time.
3. Missed-call text-back first (fastest payoff, no list needed).
4. Review requests, with consent captured at the job.
5. Reactivation once there's a list and consent — target spring.
