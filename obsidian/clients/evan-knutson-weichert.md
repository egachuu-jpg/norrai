# Evan Knutson — Weichert Realty

**Tier:** Starter
**Vertical:** Real Estate
**Status:** active
**Since:** 2026-05-22

---

## Contact

| Field | Value |
|---|---|
| Primary contact | Evan Knutson |
| Email | eknutson@teamyellownow.com |
| Phone | 507-210-9140 |
| Business name | Weichert, Realtors® - Heartland - Faribault |
| City | Faribault, MN |

---

## Stack

| Field | Value |
|---|---|
| Neon `client_id` | `ded234e3-1c78-45c3-8924-6036e1fcaf60` |
| Twilio number | TBD — assign and record here |
| Twilio subaccount SID | TBD — assign and record here |
| Active workflows | Instant Lead Response, Listing Description Generator, Open House Setup, Open House Follow-Up, 7-Touch Cold Nurture, Review Request, Birthday & Anniversary Outreach |
| n8n workflow names | `instant_lead_response`, `listing_description`, `open_house_setup`, `open_house_follow_up`, `cold_nurture`, `review_request`, `bday_anniversary_outreach` |

---

## CRM & Integrations

- **CRM:** BoldTrail (kvCORE) — Weichert brokerage controls outbound webhooks directly
- **Webhook delivery:** Zapier Starter ($20/mo) required — free tier pauses after 2 weeks
- **BoldTrail lead field names:** `firstname`, `lastname`, `email`, `phone`, `origin`, `street`, `city`, `state`, `zip`
- **Nurture approach:** SMS-dominant — BoldTrail already sends automated listing alert emails, so email-heavy nurture creates overlap and looks automated

---

## Birthday & Anniversary

- Google Sheet ID: TBD — wire into workflow at onboarding, record here
- Evan maintains the Sheet directly (add past clients after each close)
- Sheet column format documented in `website/clients/weichert_guide.html`

---

## Why they hired us

Speed-to-lead and consistent follow-up. BoldTrail doesn't automate personalized outreach — leads were falling through while Evan was in showings. Wanted past clients to feel remembered between transactions without manual effort.

---

## Quirks & preferences

- Confirm Evan is on Zapier Starter plan (not free) at every check-in — free tier silently pauses
- Nurture is SMS-dominant — avoid stacking email sequences on top of BoldTrail's automated listing alerts
- Michelle Jasinski also at this office (same business name in Neon, `client_id: 451306d1-6437-42b8-8ffe-c16f28803490`) — potential future client

---

## History

- 2026-05-22 — Onboarding call, system handoff

---

## Open items

- [ ] Record Twilio subaccount number and SID above
- [ ] Get Google Sheet ID from Evan, wire into birthday & anniversary workflow, record above
- [ ] Confirm Evan is on Zapier Starter plan
