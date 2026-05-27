# Open House Enhancements — Testing Checklist
*Story: Weichert Realty - Open House Enhancements*

Run `npm test` first to confirm no HTML regressions, then work through these in order.

---

## 1. Real Estate Open House Setup (regression + new behavior)

Use `clients/weichert_open_house_setup.html` or Hoppscotch to hit `webhook/open-house-setup`.

- [ ] Submit with `source_form: 'open_house_setup'` (standard) → QR email arrives, URL does **not** contain `wf=` or `listing_url=`
- [ ] Submit with `source_form: 'weichert_open_house_setup'` + a `listing_url` → QR email arrives, URL contains `wf=weichert&listing_url=...`
- [ ] Submit with `source_form: 'weichert_open_house_setup'` + **no** `listing_url` → QR URL contains `wf=weichert` but no `listing_url=`

---

## 2. open_house.html Routing

Scan or open the QR codes generated above and verify:

- [ ] Standard QR → form posts to `open-house-signin` (check n8n execution log)
- [ ] Weichert QR → form posts to `weichert-open-house-signin`
- [ ] When `listing_url` is in the URL, **MLS** and **Make an Offer** buttons appear after sign-in
- [ ] When `listing_url` is absent, post-sign-in action buttons do not appear

---

## 3. Real Estate Open House Follow-Up Weichert (new workflow)

Sign in at a Weichert open house URL (`wf=weichert` in QR).

- [ ] `has_agent: false` → check Neon `leads` table for new/updated row; email arrives at attendee next morning at 9am CT
- [ ] `has_agent: true` (agent name filled) → confirm **no** Neon lead row written; email still sends
- [ ] Repeat sign-in with a previously used email (`has_agent: false`) → confirm row is **updated**, not duplicated

---

## 4. Weichert Offer Submit (new workflow)

Fill and submit `weichert_offer_form.html`.

- [ ] Email arrives at `eknutson@teamyellownow.com` with agent cc'd
- [ ] Offer amount formatted as `$XXX,XXX` (no decimals)
- [ ] Financing type, close date, and contingencies display correctly
- [ ] Buyer info (name, phone, email) present
- [ ] Buyer notes section shows notes when provided; "No notes provided." when blank
- [ ] MLS listing link appears when `listing_url` was in URL params
- [ ] Check Neon `workflow_events` for `triggered` + `completed` rows with correct `client_id`
