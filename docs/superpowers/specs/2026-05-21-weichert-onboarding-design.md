# Design: Evan Knutson (Weichert Realty) Onboarding Materials

**Date:** 2026-05-21
**Status:** Approved
**Scope:** Client guide page + Obsidian client file for Weichert Realty handoff

---

## Context

Evan Knutson of Weichert Realty is being onboarded tomorrow morning (2026-05-22). All workflows are fully configured and live — tomorrow is the handoff and training call. He is a Starter tier real estate client.

**Active workflows:**
- Real Estate Instant Lead Response
- Real Estate Listing Description Generator
- Real Estate Open House (Setup + Follow-Up)
- Real Estate 7-Touch Cold Nurture
- Real Estate Review Request
- Birthday & Anniversary Outreach

**Stack specifics:**
- CRM: BoldTrail (kvCORE) — Weichert brokerage controls outbound webhooks; Zapier Starter ($20/mo) is required
- Nurture sequence: SMS-dominant (BoldTrail already sends automated listing alert emails — overlap risk)
- Bday/anniversary: runs from a Google Sheet Evan maintains

---

## Deliverable 1: `website/clients/weichert_guide.html`

A single client-portal page. Protected by Cloudflare Access (already in `/clients/` directory). Evan bookmarks it; it also prints cleanly as a leave-behind PDF.

### Page Structure

**Header**
- Norr AI logo/emblem
- Eyebrow: "Evan Knutson · Weichert Realty"
- Headline: "Your Automation System"

**Intro block**
- 2–3 sentences: what the system does for him at a high level
- Support contact: Egan's email + phone

**Table of contents**
- 6 anchor links, one per workflow section

**Workflow sections — in this order:**

1. Instant Lead Response
2. Listing Description Generator
3. Open House
4. Cold Nurture Enrollment
5. Review Request
6. Birthday & Anniversary Outreach

**Each workflow section contains:**
- Workflow name (heading)
- What it does — 1–2 sentences, written in agent-friendly plain English (no tech jargon)
- When to use it — specific trigger scenario ("Use this when a new lead comes in from Zillow, your website, or BoldTrail")
- What to fill in — bulleted list of the key inputs the form asks for
- "→ Open Tool" button — links to the relevant `/clients/` page
- For Birthday & Anniversary (no form): instead of a button, a callout box explaining it runs automatically at 9am daily, and a table showing the required Google Sheet column format

**Birthday & Anniversary Google Sheet format:**

| Column | Format | Example |
|--------|--------|---------|
| `lead_name` | Full name | Sarah Johnson |
| `email` | Email address | sarah@email.com |
| `phone` | 10 digits | 5075551234 |
| `birthday` | MM-DD | 03-14 |
| `transaction_anniversary` | YYYY-MM-DD | 2022-07-15 |
| `property_address` | Street address | 412 Oak St, Faribault MN |
| `birthday_sent_year` | Leave blank | (system fills this) |
| `anniversary_sent_year` | Leave blank | (system fills this) |

**Footer**
- Norr AI branding + support contact repeated

### Print Stylesheet (`@media print`)
- Hide: site header chrome, table of contents, "Open Tool" buttons (replace with URL text)
- Tighten spacing between sections
- Force page breaks before major sections if needed
- Font size adjustments for clean 2–3 page output
- Print as: "Your Norr AI System — Evan Knutson" header on each page

### Visual Style
- Polar Modern design system (matching all other `/clients/` pages)
- Workflow sections rendered as cards with subtle borders
- "→ Open Tool" buttons use glacial accent color
- Birthday & Anniversary callout box uses a distinct background (blush or light glacial tint) to signal it's different from the form-based tools

---

## Deliverable 2: `obsidian/clients/evan-knutson-weichert.md`

Internal client record using the standard `_template.md` structure.

**Fields:**
- Tier: Starter
- Vertical: Real Estate
- Status: active
- Since: 2026-05-22
- Contact: Evan Knutson, Weichert Realty, [email/phone TBD]
- Neon `client_id`: [to fill in]
- Twilio number: [to fill in]
- Active workflows: all 6 listed above with their `workflow_name` registry values
- Why they hired us: speed-to-lead + consistent follow-up. BoldTrail doesn't automate personalized outreach.
- Quirks: BoldTrail webhook requires Zapier Starter; nurture is SMS-dominant; bday/anniversary workflow reads from Evan's Google Sheet (Sheet ID wired into workflow)
- Open items: confirm Zapier is on Starter plan (not free tier — pauses after 2 weeks)

---

## What This Is NOT

- No troubleshooting guide (Evan calls Egan if something breaks)
- No BoldTrail/Zapier setup instructions (already configured)
- No workflow diagrams or technical documentation
- No separate print file — print support via `@media print` on the same HTML file

---

## File Locations

| File | Path |
|------|------|
| Client guide | `website/clients/weichert_guide.html` |
| Obsidian client record | `obsidian/clients/evan-knutson-weichert.md` |

---

## Success Criteria

- Evan can open the guide page on his phone or laptop during the call and find any tool in under 10 seconds
- The page prints to a clean 2–3 page PDF with no layout breaks
- The Obsidian file gives Egan everything needed to answer a support question about Evan's stack without digging through n8n
