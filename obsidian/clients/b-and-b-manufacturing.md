# B&B Manufacturing

**Tier:** Starter (demo phase)
**Vertical:** Manufacturing
**Status:** prospect — warm
**Since:** 2026-04

---

## Contact

| Field | Value |
|---|---|
| Primary contact | TBD |
| Email | TBD |
| Phone | TBD |
| Business name | B&B Manufacturing |
| City | Faribault, MN |

---

## Stack

| Field | Value |
|---|---|
| Neon `client_id` | `86a01b94-ddab-4594-8afc-8212fb18fdd0` |
| Twilio number | not yet assigned |
| Active workflows | B&B Lead Generator, B&B Manufacturing Estimate |
| n8n workflow names | `bnb_lead_generator`, `bnb_estimate` |

---

## Why they hired us

Warm prospect. Demo estimating workflow was built to show them a concrete use case — a form-driven estimating tool that generates quotes via Claude and sends a review email. Lead generator workflow also built: scheduled Apollo.io scrape → Claude scoring → SendGrid review email.

---

## Quirks & preferences

- Apollo.io account is a required dependency — B&B must provision their own
- Rate card is placeholder — swap with real B&B rates before going live
- Both workflows need smoke testing before client handoff

---

## History

- 2026-04-29 — Demo estimating workflow + form built
- 2026-05 — B&B lead generator workflow built
- Pending — smoke test both workflows, import JSON into n8n, verify estimate email

---

## Open items

- [ ] Smoke test B&B estimate workflow: import JSON into n8n, fire test payload, verify estimate email
- [ ] Swap placeholder rates with real B&B rates
- [ ] Add Neon logging nodes once B&B is onboarded as a client
- [ ] B&B to provision Apollo.io account

---

## Notes

Rate card currently lives in n8n workflow directly. Move to Google Sheets for production so B&B staff can update rates without touching n8n.
