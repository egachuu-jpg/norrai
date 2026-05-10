# PRD: Norr AI CMA Tool

**Status:** Draft
**Author:** Egan
**Date:** 2026-05-09
**Version:** 1.0

---

## Problem Statement

Real estate agents spend 1-3 hours manually pulling a Comparative Market Analysis (CMA) — finding comparable sold properties, adjusting for differences, and estimating a price range. This work happens before every listing presentation and many buyer consultations.

The Research Agent (Phase 1) gives agents informal market context via Gemini + public web data. That's sufficient for lead outreach but not for a CMA an agent presents to a client. A formal CMA requires complete MLS comp coverage, structured price adjustments, and a professional deliverable.

Norr AI CMA Tool automates the 80% — comp selection, price analysis, and report generation — so the agent's job is review and local judgment, not data entry.

---

## Goals

- Generate a draft CMA in under 2 minutes from a property address
- Pull complete comp data from MLS or ATTOM (not just publicly indexed sales)
- Score and rank comps by similarity to the subject property
- Produce a price range estimate with methodology the agent can explain
- Generate a shareable HTML report the agent can send to a client
- Integrate with the chief of staff ("Run a CMA on 412 Oak Street")
- Stay within fair housing legal guardrails at every step

## Non-Goals

- Replace a licensed appraisal — always disclaim this
- Automate the agent's final pricing recommendation — agent always reviews
- Access MLS data without a proper integration agreement
- Serve buyers directly — this is an agent-facing tool

---

## Users

**Primary:** Real estate agents on Norr AI Pro tier
**Use cases:**
- Listing presentations (seller wants to know what their home is worth)
- Buyer consultations (is this asking price reasonable?)
- Internal pricing gut-check before making an offer

---

## What Makes a Good CMA

### Subject Property Inputs Required
- Full address
- Beds, baths
- Square footage
- Year built
- Property type (single family, condo, townhome)
- Lot size (for SFH)
- Notable features (garage, pool, finished basement, recent renovation)

### Comp Selection Criteria
- **Geography:** within 0.5 miles (urban), 1 mile (suburban), 2 miles (rural)
- **Sold date:** closed within 90 days preferred, up to 180 days if inventory is thin
- **Size:** ±20% square footage of subject
- **Beds/baths:** ±1 bed, same bath count preferred
- **Property type:** must match (no comparing SFH to condo)
- **Condition:** similar or adjustable

### Price Adjustment Methodology
Comps are rarely identical. Standard adjustments:

| Feature | Typical Adjustment |
|---|---|
| Sqft difference | ±$price_per_sqft × delta_sqft |
| Bedroom difference | ±$5,000-$10,000 per bed |
| Bathroom difference | ±$3,000-$7,000 per bath |
| Garage (vs. none) | ±$10,000-$20,000 |
| Year built (per decade) | ±$3,000-$8,000 |
| Lot size (SFH) | ±$2-5 per sqft delta |
| Finished basement | ±$15,000-$30,000 |

Adjustments are directional estimates — Claude generates the logic, agent reviews the result. The tool does not claim to be an appraisal.

### Output: Price Range Estimate
- Low: average of bottom 2 adjusted comps
- Mid: weighted median of all adjusted comps
- High: average of top 2 adjusted comps
- Recommended list range: Mid ± 2-3% (agent adjusts based on condition and strategy)

---

## Architecture

```
Agent triggers CMA
(via clients/cma.html form OR chief of staff Slack command)
        │
        ▼
n8n: CMA Workflow
        │
  ┌─────┴──────────────────────────────┐
  │                                    │
Census Geocoder                  Research Agent
(address → lat/lng)              (calls Gemini for market
                                  context, schools, snapshot)
  │                                    │
  └─────────────┬──────────────────────┘
                │
        ATTOM Data API
        (or MLS feed)
        Comp search:
        - 0.5-1 mile radius
        - Sold last 90-180 days
        - Matching property type
        - ±20% sqft, ±1 bed
                │
        Comp Scoring (Code node)
        - Rank by similarity score
        - Select top 4-6 comps
        - Calculate adjustments
                │
        Claude: CMA Analysis
        - Summarize comp set
        - Apply adjustments
        - Generate price range
        - Write narrative sections
                │
        Build CMA Report (Code node)
        - Render HTML report
        - Store in Neon
        - Generate shareable link
                │
        Deliver to Agent
        - Email with report link
        - Slack notification (if chief of staff triggered)
```

---

## Data Sources

### Primary: ATTOM Data API
ATTOM provides property data, sales history, and AVM (Automated Valuation Model) data. It is the most accessible MLS-adjacent source without requiring a direct MLS membership.

**Key endpoints:**
- `/property/detail` — subject property details (beds, baths, sqft, year built, lot size)
- `/sale/snapshot` — recent sales by radius, property type, date range
- `/avm/detail` — automated valuation (use as a sanity check, not primary estimate)

**Cost:** ~$150-300/mo depending on call volume. Pro tier clients only.

### Alternative: Direct MLS Feed (RETS/IDX)
Requires MLS membership or a brokerage partner with data sharing rights. More accurate and complete than ATTOM but significantly more complex to integrate. Long-term goal — not needed for initial launch.

### Supporting: Research Agent (Phase 1)
The CMA workflow calls the Research Agent for market snapshot and school data. This avoids duplicating that logic.

---

## Input Contract

```json
{
  "subject": {
    "address": "198 Cuylle Ct",
    "city": "Lakeville",
    "state": "MN",
    "zip": "55044",
    "beds": 4,
    "baths": 2,
    "sqft": 2100,
    "year_built": 2005,
    "property_type": "single_family",
    "lot_sqft": 8500,
    "garage": true,
    "finished_basement": false,
    "notable_features": "Updated kitchen, new roof 2022"
  },
  "agent_email": "agent@example.com",
  "agent_name": "Best Agent",
  "client_id": "...",
  "triggered_by": "cma_form"
}
```

---

## Output Contract

```json
{
  "cma_id": "uuid",
  "status": "complete",
  "subject": { ... },
  "market_context": {
    "median_sale_price": 318000,
    "median_days_on_market": 19,
    "inventory_level": "Low",
    "yoy_price_trend": "+4.2%"
  },
  "comps": [
    {
      "address": "142 Birchwood Dr, Lakeville MN",
      "sold_price": 312000,
      "sold_date": "2026-04-10",
      "beds": 4,
      "baths": 2,
      "sqft": 1980,
      "year_built": 2003,
      "distance_miles": 0.3,
      "similarity_score": 94,
      "adjustments": {
        "sqft": "+$2,400",
        "year_built": "-$600",
        "total": "+$1,800"
      },
      "adjusted_price": 313800
    }
  ],
  "price_estimate": {
    "low": 305000,
    "mid": 315000,
    "high": 325000,
    "recommended_list_range": "$312,000 - $320,000",
    "methodology": "Weighted median of 5 adjusted comparable sales closed within 90 days within 0.8 miles."
  },
  "narrative": {
    "market_summary": "The Lakeville market is moving quickly with low inventory...",
    "comp_summary": "Five comparable single-family homes sold nearby in the last 90 days...",
    "pricing_rationale": "Based on adjusted comparable sales, this property is positioned in the $312,000-$320,000 range..."
  },
  "report_url": "https://tools.norrai.co/cma/uuid",
  "disclaimer": "This analysis is prepared for informational purposes by Norr AI and does not constitute a licensed appraisal. Agent review required before sharing with clients.",
  "created_at": "2026-05-09T..."
}
```

---

## Comp Scoring Algorithm

Each candidate comp gets a similarity score (0-100):

```
score = 100
  - abs(comp_sqft - subject_sqft) / subject_sqft × 30   (sqft weight: 30pts)
  - abs(comp_beds - subject_beds) × 10                   (beds weight: 10pts each)
  - abs(comp_baths - subject_baths) × 7                  (baths weight: 7pts each)
  - abs(comp_year_built - subject_year_built) / 10       (age weight: ~1pt/decade)
  - comp_distance_miles × 5                              (distance weight: 5pts/mile)
  - days_since_sold / 30 × 2                             (recency weight: 2pts/month old)
```

Select top 4-6 comps by score. Discard anything below 60. If fewer than 3 comps score above 60, expand radius by 0.5 miles and/or extend date range to 180 days, note this in the report.

---

## Agent-Facing UI: clients/cma.html

A form behind Cloudflare Access (clients group) where the agent inputs the subject property and submits. The page polls for completion and displays the report inline, with a "Share with client" button that generates a read-only link.

**Form fields:**
- Address (street, city, state, zip)
- Beds / Baths / Sqft / Year Built
- Property type (dropdown)
- Lot size (optional)
- Garage (yes/no)
- Finished basement (yes/no)
- Notable features (free text, optional)
- Client name (for report personalization)

**Shareable report:** `https://tools.norrai.co/cma/[uuid]` — public but unguessable UUID. Expires after 30 days.

---

## Chief of Staff Integration

The chief of staff workflow recognizes CMA intent and triggers the CMA workflow:

**Slack command:** `Run a CMA on 198 Cuylle Ct Lakeville MN 4 bed 2 bath 2100 sqft built 2005`

Chief of staff extracts structured fields via Claude, POSTs to the CMA webhook, and responds in Slack:

> CMA running for 198 Cuylle Ct — I'll post the report link here when it's ready (usually 60-90 seconds).

Then posts the report URL when complete.

---

## Neon Schema

```sql
CREATE TABLE cmas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID REFERENCES clients(id),
  agent_email     TEXT NOT NULL,
  subject_address TEXT NOT NULL,
  subject_data    JSONB NOT NULL,
  comp_data       JSONB,
  price_estimate  JSONB,
  narrative       JSONB,
  report_html     TEXT,
  report_url      TEXT,
  status          TEXT DEFAULT 'pending',
  triggered_by    TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  expires_at      TIMESTAMPTZ DEFAULT now() + INTERVAL '30 days'
);

CREATE INDEX ON cmas (agent_email, created_at DESC);
CREATE INDEX ON cmas (report_url);
```

---

## Fair Housing Compliance

**The CMA tool must never:**
- Use demographic composition data as an input or output
- Describe neighborhoods using language tied to protected classes
- Steer agents toward or away from areas for protected-class reasons
- Display crime statistics in any form

**The CMA tool must always:**
- Include the disclaimer on every report and shareable link
- Present comp data as factual sales records, not neighborhood characterizations
- Note that the agent is responsible for reviewing and taking ownership of the analysis before sharing

**Claude CMA prompt guardrail:**
```
You are generating a Comparative Market Analysis summary.
- Only use data from the comp set provided. Do not estimate or invent prices.
- Never reference neighborhood demographics, crime, school quality as a proxy
  for area desirability, or any protected class characteristics.
- This is not a licensed appraisal. The disclaimer must appear in every output.
- If the comp set is thin (fewer than 3 comps), note this limitation explicitly.
```

---

## Pricing & Tier

CMA Tool is **Pro tier only** (ATTOM API cost is ~$150-300/mo, not viable on Starter/Growth margins).

Include in Pro proposal as a named deliverable: *"AI-assisted CMA generation — draft CMA in under 2 minutes, agent reviews and shares."*

---

## Phasing

### Phase 2A — Core CMA
- [ ] ATTOM integration (comp search, property detail)
- [ ] Comp scoring algorithm (Code node)
- [ ] Claude CMA analysis prompt + price range calculation
- [ ] `clients/cma.html` form + polling UI
- [ ] HTML report template (Polar Modern design)
- [ ] Shareable report URL with UUID + 30-day expiry
- [ ] Neon `cmas` table
- [ ] Basic workflow_events logging

### Phase 2B — Chief of Staff Integration
- [ ] CMA intent detection in chief of staff Claude prompt
- [ ] Structured field extraction from natural language
- [ ] Slack delivery of report URL when complete

### Phase 2C — MLS Direct Feed (long-term)
- [ ] MLS partnership or brokerage data sharing agreement
- [ ] RETS/IDX feed integration replacing ATTOM
- [ ] Full sold history coverage for complete comp sets

---

## Open Questions

1. **ATTOM vs. MLS for launch** — ATTOM is faster to integrate but monthly cost adds up. Is there a brokerage partner in the first-client pipeline who could provide data sharing? If so, MLS direct is worth pursuing from the start.
2. **Adjustment values** — the per-feature adjustments (bedroom +$8k, etc.) are estimates that vary by market. MN suburban markets may differ. Consider letting the agent configure these per market, or pulling ATTOM's own adjustment model.
3. **Report format** — HTML shareable link is simplest to build. PDF export is a common client expectation. Add PDF generation (via headless browser or a library) in Phase 2B.
4. **Comp confidence threshold** — if fewer than 3 comps score above 60, should the tool decline to produce a price estimate and just show the raw comps? Or produce an estimate with a stronger caveat?
5. **AVM sanity check** — ATTOM provides its own AVM estimate. Use as a confidence check on our estimate (if they're within 5%, flag green; if they diverge by >10%, flag for agent review)?
