# Open House Enhancements — PRD
**Date:** 2026-05-22
**Status:** Backlog
**Client:** Weichert, Realtors® — Heartland (Evan Knutson + Michelle Jasinski)
**Neon story:** Weichert Realty - Open House Enhancements

---

## Overview

Two feature sets layered onto the existing open house sign-in flow (`open_house.html` + `open_house_setup.html`). The goal is to convert warm open house traffic into leads more aggressively and give agents better routing intelligence on who in the room is already represented.

---

## Feature 1 — Post Sign-In Action Buttons

### Problem
After an attendee signs in, they land on a bare confirmation screen. There's no next step for them — no way to see the listing details or express purchase intent while they're physically standing in the property and motivation is highest.

### Solution

**Button 1: "Take me to MLS Listing"**
- Reads `listing_url` from the QR code URL params
- Opens the MLS listing in a new browser tab
- Hidden if `listing_url` param is absent (graceful degradation)

**Button 2: "Make an Offer"**
- Links to a new `offer_form.html` page (opens new tab)
- Pre-fills attendee name and contact info as URL params
- Form collects: offer price (required), notes (optional)
- Submits to a new n8n workflow that emails the hosting agent via SendGrid
- **This is not a legally binding offer** — it's an intent signal and conversation starter for the agent

### Changes required

| File | Change |
|---|---|
| `open_house_setup.html` | Add `listing_url` input field; include in QR code URL params |
| `open_house.html` | Add two CTA buttons on post-sign-in confirmation screen |
| `website/offer_form.html` | New page (Polar Modern design system) |
| n8n | New offer submission workflow |
| `tests/open_house_setup.spec.js` | Add listing_url field coverage |
| `tests/open_house.spec.js` | Add button visibility + link tests |
| `tests/offer_form.spec.js` | New spec file — high risk |

### Offer form fields

| Field | Required | Notes |
|---|---|---|
| Attendee name | Pre-filled (read-only) | Passed as URL param from sign-in page |
| Email | Pre-filled (read-only) | Passed as URL param |
| Phone | Pre-filled (read-only) | Passed as URL param |
| Offer price | Yes | Numeric input |
| Notes | No | Textarea — contingencies, closing timeline, etc. |

### n8n offer workflow payload

```json
{
  "attendee_name": "Sarah Johnson",
  "email": "sarah@gmail.com",
  "phone": "5075551234",
  "offer_price": "285000",
  "notes": "Contingent on selling current home by Aug 1",
  "agent_email": "eknutson@teamyellownow.com",
  "property_address": "123 Maple St"
}
```

Agent receives a SendGrid email with subject: `New offer interest — 123 Maple St` and a formatted summary of the above.

---

## Feature 2 — Agent Representation Section

### Problem
The open house follow-up workflow currently blasts all attendees with a follow-up message the next day. Represented buyers (those already working with another agent) don't need Norr AI outreach — they need their agent's info forwarded to the hosting agent instead.

### Solution

Add a "Working with an agent?" Yes/No radio to the sign-in form.

**If Yes:**
- Show Agent Name (required), Agent Email (optional), Agent Phone (optional)
- `has_agent: true` in webhook payload
- n8n does NOT send attendee a follow-up
- n8n emails the hosting agent with attendee details + representing agent info

**If No:**
- `has_agent: false` in webhook payload
- Dedupe check against `leads` table (email + phone)
- Upsert lead into Neon with `source: open_house`
- Follow-up workflow fires as normal the next day

### Changes required

| File | Change |
|---|---|
| `open_house.html` | Add Yes/No toggle + conditional agent fields to sign-in form |
| `open_house.html` | Include `has_agent`, `agent_name`, `agent_email`, `agent_phone` in webhook payload |
| n8n `open_house_follow_up` | Add IF branch on `has_agent` |
| n8n (open house sign-in workflow) | Add dedupe + lead upsert for unrepresented attendees |
| `tests/open_house.spec.js` | Add agent representation section tests |

### Updated webhook payload from open_house.html

```json
{
  "attendee_name": "Sarah Johnson",
  "email": "sarah@gmail.com",
  "phone": "5075551234",
  "address": "123 Maple St",
  "agent": "eknutson@teamyellownow.com",
  "has_agent": true,
  "agent_name": "Bob Smith",
  "agent_email": "bob@realty.com",
  "agent_phone": "5079998888"
}
```

### open_house_follow_up workflow logic (updated)

```
IF has_agent = true
  → Send email to hosting agent (agent param):
      Subject: Represented buyer at your open house — 123 Maple St
      Body: Attendee details + their agent's contact info
ELSE
  → Send follow-up SMS/email to attendee (existing flow)
```

---

## Task Sequence (Neon `tasks` table)

| Seq | Title | Category |
|---|---|---|
| 1 | Add listing_url field to open_house_setup.html | dev |
| 2 | Add "Take me to MLS Listing" button to open_house.html | dev |
| 3 | Create offer_form.html | dev |
| 4 | Add "Make an Offer" button to open_house.html | dev |
| 5 | Build n8n offer submission workflow | dev |
| 6 | Update Playwright tests — open_house_setup.html listing_url | testing |
| 7 | Create Playwright tests — offer_form.html | testing |
| 8 | Update Playwright tests — open_house.html MLS + Offer buttons | testing |
| 9 | Add "Working with an agent?" toggle to open_house.html | dev |
| 10 | Conditionally show representing agent fields | dev |
| 11 | Pass has_agent + agent fields in webhook payload | dev |
| 12 | Add dedupe check and lead upsert for unrepresented attendees | dev |
| 13 | Enhance open_house_follow_up workflow — branch on has_agent | dev |
| 14 | Update Playwright tests — open_house.html agent section | testing |

---

## Decisions

- [x] **Offer form disclaimer** — Yes. Display "This is not a legally binding offer" prominently above the submit button.
- [x] **Represented attendees** — No automated message. Hosting agent gets the email; attendee receives nothing from Norr AI.
- [x] **offer_form.html location** — `website/` (public). Attendees access it from their own phones via QR → sign-in → link.
