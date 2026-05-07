# Cloudflare Zero Trust Access — Design Spec
**Date:** 2026-05-06

## Goal

Protect agent- and client-facing tools on `tools.norrai.co` using Cloudflare Zero Trust Access (email OTP). Restructure `website/` folder to reflect security groupings, simplifying both access control and mental model.

---

## Folder Restructure

```
website/
├── index.html                  ← public (stays at root)
├── services.html
├── how-it-works.html
├── pricing.html
├── contact.html
├── dental.html
├── real-estate.html
├── insurance.html
├── open_house.html
├── discovery_form.html
├── event_ops_discovery.html
├── onboarding_form.html
├── privacy.html
├── terms.html
├── clients/                    ← protected: clients group
│   ├── listing_form.html
│   ├── lead_response.html
│   ├── open_house_setup.html
│   ├── nurture_enroll.html
│   ├── review_request.html
│   ├── lead_action_edit.html
│   └── bnb_estimate_form.html
└── internal/                   ← protected: internal group
    ├── brand_concepts.html
    └── norrai_style_guide.html
```

Public pages stay at root — clean URLs, no change to norrai.co marketing site paths.

---

## Cloudflare Zero Trust Configuration

### Access Groups

| Group | Members | Purpose |
|---|---|---|
| `clients` | All client/prospect tool users + Egan's email | Real estate agents, B&B employees, future clients |
| `internal` | Egan's email only | Internal reference pages |

### Access Applications

Two applications — one per folder prefix. No individual path configs needed.

| Application | Domain | Path | Policy group | Session |
|---|---|---|---|---|
| Norr AI Client Tools | `tools.norrai.co` | `/clients/*` | `clients` | 7 days |
| Norr AI Internal | `tools.norrai.co` | `/internal/*` | `internal` | 1 day |

### Auth Method
Email OTP (One-Time Pin) — Cloudflare sends a code to the user's inbox. No passwords. Free up to 50 users.

---

## Side Effects to Address

### 1. Playwright Tests
All tests referencing moved pages need path updates:
- `tests/listing_form.spec.js` — path changes to `/clients/listing_form.html`
- `tests/bnb_estimate_form.spec.js` — path changes to `/clients/bnb_estimate_form.html`

### 2. Hardcoded Internal Links
Any `href` links between pages that reference moved files need updating.

### 3. QR Code URLs
`open_house_setup.html` generates a QR code URL pointing to `open_house.html`. That page stays at root — no change needed.

### 4. n8n Webhook URLs
n8n workflow webhook URLs are independent of the website folder structure — no changes needed.

### 5. Email Links
Any SendGrid emails containing links to agent tools need path updates if they reference moved pages.

---

## What Does NOT Change

- Public marketing pages — same paths, no disruption
- `open_house.html` — stays public at root (attendees scan QR on phone)
- `onboarding_form.html` — stays public at root (clients fill out themselves)
- `discovery_form.html` / `event_ops_discovery.html` — stays public at root (prospects)
- n8n webhook URLs — independent of website structure
- Cloudflare Pages deployment — build output dir remains `website/`

---

## Adding Future Clients

When a new client onboards:
1. Go to Zero Trust → Access → Groups → `clients`
2. Add their email address
3. Done — they get access to all `/clients/*` pages automatically

No new Cloudflare applications needed.
