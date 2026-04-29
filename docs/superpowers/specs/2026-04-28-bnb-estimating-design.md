# B&B Manufacturing — Automated Estimating Workflow Design

**Date:** 2026-04-28
**Client:** B&B Manufacturing and Assembly, Faribault, MN
**NorrAI Tier:** Starter (demo) → Growth (production)
**Status:** Design approved, pending implementation

---

## Overview

B&B Manufacturing receives quote requests via phone. A sales rep collects info and emails it to whoever is available to estimate. Estimates currently take days; the goal is same-day turnaround.

This workflow replaces the unstructured email handoff with a web form → automated estimate pipeline. The submitter (customer or sales rep) fills out a structured form, Claude estimates each selected service using a rate card, and a line-item quote is emailed back within ~60 seconds.

**What this does:**
- Captures structured job specs via web form
- Estimates each selected service using a rate card + Claude
- Emails a line-item estimate + lead time to the submitter
- Logs every submission to Neon for audit and rate refinement

**What this does not do:**
- Price jobs without human-provided specs (human still defines the job)
- Replace B&B's judgment for complex or ambiguous jobs (disclaimer in email)
- Parse uploaded drawings/files (attachments forwarded as-is)

---

## Architecture & Data Flow

```
Submitter fills form
  → n8n webhook receives payload
  → Set node injects rate card into context
  → HTTP Request to Claude API (estimate prompt)
  → Code node parses Claude JSON response
  → SendGrid sends estimate email to submitter
  → Neon: insert row into leads + workflow_events
```

**Stack:** n8n Cloud + Claude API + SendGrid (studio@norrai.co) + Neon Postgres

**Rate card — demo:** Stored in n8n Set node as structured JSON. Swappable to Google Sheets (n8n native node) for production so B&B staff can update rates without developer involvement.

---

## Intake Form Fields

### Contact Info
- Full name
- Company name
- Email address
- Phone (optional)

### Part Specs
- Part name / description (free text)
- Material type (dropdown: mild steel, stainless steel, aluminum, other)
- Material thickness (numeric, inches)
- Dimensions — length × width × height (inches)
- Weight estimate (lbs, optional)
- Quantity
- File upload (optional — sketch, photo, drawing PDF)
- Special requirements / notes (free text)

### Services Needed (multi-select — selecting reveals detail fields)

| Service | Additional Fields |
|---|---|
| Laser cutting | Max cut length, number of holes/features |
| Waterjet | Max cut length, number of holes/features |
| CNC machining | Number of setups, tolerance class (standard/precision) |
| Press brake forming | Number of bends |
| Welding | Weld type (MIG/TIG/robotic), estimated weld length (inches) |
| Sandblasting | Surface area (sq ft) or auto-calculated from dimensions |
| Powder coating | Finish type (standard/custom), surface area |
| Plating | Plating type (zinc/nickel) |
| Deburring | No additional fields (included with cutting services) |
| Assembly / kitting | Number of components, estimated assembly hours |

---

## Claude Estimation Logic

Claude receives a single prompt containing: rate card + part specs + selected services with detail fields.

### Demo Rate Card (placeholder — real rates replace these)

| Item | Rate |
|---|---|
| Mild steel | $0.85/lb |
| Stainless steel | $2.20/lb |
| Aluminum | $1.90/lb |
| Laser / waterjet | $150/hr |
| CNC machining | $95/hr |
| Press brake | $75/hr |
| Welding (MIG/TIG) | $85/hr |
| Robotic welding | $65/hr |
| Sandblasting | $3.50/sq ft |
| Powder coating | $4.00/sq ft |
| Zinc plating | $2.50/sq ft |
| Nickel plating | $4.50/sq ft |
| Assembly | $45/hr |
| Markup | 20% |

### Claude Tasks
1. Estimate material cost from material type, dimensions, weight, and quantity
2. Estimate time per selected service from detail fields and specs
3. Calculate cost per line item (time × rate or area × rate)
4. Sum all line items + material for subtotal
5. Apply markup
6. Estimate lead time based on services selected and quantity
7. Return structured JSON (parsed by n8n Code node)

### Claude Output Format
```json
{
  "line_items": [
    { "service": "Laser Cutting", "hours": 0.5, "rate": 150, "cost": 75.00 },
    { "service": "MIG Welding", "hours": 1.5, "rate": 85, "cost": 127.50 },
    { "service": "Powder Coating", "sq_ft": 4.2, "rate": 4.00, "cost": 16.80 }
  ],
  "material_cost": 42.50,
  "subtotal": 261.80,
  "markup": 52.36,
  "total": 314.16,
  "lead_time_days": "5–7 business days",
  "notes": "Lead time assumes standard queue. Robotic welding available for quantities over 10."
}
```

---

## Email Output

**From:** studio@norrai.co (B&B branded address in production)
**To:** Submitter email
**Subject:** `Estimate for [Part Name] — B&B Manufacturing`

**Body:**
- Greeting with submitter name
- Line-item table (service, detail, cost)
- Subtotal, markup, total
- Estimated lead time
- Disclaimer: "This estimate is based on the specifications provided. Final pricing may vary upon drawing review."
- CTA: "Reply to this email to move forward or ask questions." (routes to real B&B inbox)

---

## Data Persistence (Neon)

**Table: `leads`**
One row per submission. Vertical-specific fields in `metadata` jsonb:
```json
{
  "client_id": "<B&B client ID>",
  "lead_name": "John Smith",
  "email": "john@oemcorp.com",
  "phone": "5075559999",
  "source": "bnb_estimate_form",
  "metadata": {
    "company": "OEM Corp",
    "part_name": "Hydraulic Tank Bracket",
    "material": "mild_steel",
    "thickness": 0.25,
    "dimensions": "12x8x4",
    "quantity": 5,
    "services": ["laser_cutting", "mig_welding", "powder_coating"],
    "total_estimate": 314.16,
    "lead_time": "5–7 business days"
  }
}
```

**Table: `workflow_events`**
One row per workflow run — captures success/failure and full Claude response for debugging and rate refinement.

---

## Production Upgrade Path

| Component | Demo | Production |
|---|---|---|
| Rate card | n8n Set node | Google Sheets (n8n native node) |
| Sender address | studio@norrai.co | B&B branded address |
| Auth | None (demo) | Cloudflare Access (Zero Trust) |
| File handling | Forwarded as attachment | Linked from submission |

---

## Key Decisions

- **Rate card in Set node for demo:** Fastest to build, zero external dependencies. Google Sheets is the production answer — B&B staff update their own rates without calling NorrAI.
- **Claude outputs JSON:** Reliable parsing via Code node. Prompt instructs Claude to return only valid JSON with no surrounding text.
- **Disclaimer in email:** Claude-generated estimates are approximations. The disclaimer protects B&B and sets correct customer expectations.
- **One part per submission:** Keeps the demo focused. Multi-part RFQ support is a Growth tier feature.
- **No human in the loop:** Estimate sends automatically. The demo's wow moment is speed — ~60 seconds from form submit to inbox.
