# Michelle Jasinski — Weichert Realty

**Tier:** Starter
**Vertical:** Real Estate
**Status:** active
**Since:** 2026-05-17

---

## Contact

| Field | Value |
|---|---|
| Primary contact | Michelle Jasinski |
| Email | mjasinski@teamyellownow.com |
| Phone | 507-210-7967 |
| Business name | Weichert, Realtors® - Heartland - Faribault |
| City | Faribault, MN |

---

## Stack

| Field | Value |
|---|---|
| Neon `client_id` | `451306d1-6437-42b8-8ffe-c16f28803490` |
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
- Michelle maintains the Sheet directly (add past clients after each close)
- Sheet column format documented in `website/clients/weichert_guide.html`

---

## Why they hired us

Same office and motivation as Evan Knutson — speed-to-lead and consistent follow-up. BoldTrail doesn't automate personalized outreach; leads were falling through during showings.

---

## Quirks & preferences

- Confirm Michelle is on Zapier Starter plan (not free) at every check-in — free tier silently pauses
- Nurture is SMS-dominant — avoid stacking email sequences on top of BoldTrail's automated listing alerts
- Evan Knutson also at this office (`client_id: ded234e3-1c78-45c3-8924-6036e1fcaf60`) — same workflow stack, stories shared between both agents

---

## Active Stories

| Story | Status | PRD |
|---|---|---|
| Weichert Realty - Open House Enhancements | backlog | [[2026-05-22-open-house-enhancements]] |
| Weichert Realty - 7-Touch Cold Nurture Enhancements | backlog | [[2026-05-22-nurture-enhancements]] |
| Weichert Realty — Weekly Marketing Drip | backlog | [[2026-05-22-weekly-marketing-drip]] |
| Weichert Realty — Boosted Property Lead Ingestion | backlog | [[2026-05-22-property-boost-lead-ingestion]] |

---

## History

- 2026-05-17 — Client row created in Neon
- 2026-05-22 — Open house enhancements story created (14 tasks)

---

## Open items

- [ ] Record Twilio subaccount number and SID above
- [ ] Get Google Sheet ID from Michelle, wire into birthday & anniversary workflow, record above
- [ ] Confirm Michelle is on Zapier Starter plan
