# PRD: Norr AI Research Agent

**Status:** Draft
**Author:** Egan
**Date:** 2026-05-09
**Version:** 1.0

---

## Problem Statement

Claude drafts personalized messages across multiple workflows (cold nurture, instant lead response, open house follow-up) but has no access to real property or market data. The result is hallucinated facts — invented school names, fabricated market statistics, made-up neighborhood claims — that erode agent trust and create fair housing risk.

Agents need Claude to write messages grounded in verified, publicly available data without requiring manual research on every lead.

---

## Goals

- Provide a single, reusable research sub-workflow any n8n workflow can call
- Return structured, verified facts about a property and its market context
- Enforce fair housing compliance at the data layer before facts reach Claude
- Lay the foundation for a future Comparative Market Analysis (CMA) feature
- Add zero manual work for the agent

## Non-Goals

- Replace a licensed appraisal or formal CMA (Phase 1)
- Access MLS-gated data without a proper integration agreement
- Provide demographic, crime, or protected-class-adjacent data — ever
- Replace the agent's local market expertise

---

## Users

**Primary:** n8n workflows (not humans directly) — the research agent is called by other workflows, not by agents via a UI.

**Indirect beneficiaries:** Real estate agents who receive Claude-drafted messages backed by real data, and leads who receive accurate, trustworthy outreach.

---

## Architecture

### Pattern

The research agent is an n8n sub-workflow exposed as a webhook. Any parent workflow calls it with a standard input payload and receives a standard output payload. The parent workflow's Claude prompt is enriched with the output before drafting any message.

```
Parent Workflow
  └─ HTTP Request → POST /webhook/research-agent
                          │
                    Geocode Address
                    (Census Geocoder — free)
                          │
                    ┌─────┴──────────────────┐
                    │                        │
              Walk Score API           NCES Schools API
              (walkability,            (public federal data,
               transit, bike)           ratings, grades)
                    │                        │
                    └─────────┬──────────────┘
                              │
                        Market Snapshot
                        (RentCast or ATTOM —
                         median price, DOM,
                         inventory level)
                              │
                        Claude: Compliance Filter
                        + Insight Formatter
                              │
                    Return structured JSON
                          │
  └─ Parent Workflow injects into Claude prompt
```

### Calling Pattern (any workflow)

Add two nodes after payload is built, before the Claude drafting node:

1. **HTTP Request** → `POST /webhook/research-agent` with standard input
2. **Set** → merge `$json.research` into the prompt context

The Build Prompt node references `{{ $json.research.insight_block }}` — one variable drop-in regardless of which workflow is calling.

---

## Input Contract

```json
{
  "address": "198 Cuylle Ct",
  "city": "Lakeville",
  "state": "MN",
  "zip": "55044",
  "price_range": "$280k-$320k",
  "beds": 4,
  "baths": 2,
  "sqft": null,
  "year_built": null,
  "caller": "cold_nurture_t3"
}
```

`sqft` and `year_built` are optional in Phase 1 but required for Phase 2 CMA comp matching.
`caller` is logged to `workflow_events` for debugging and future analytics.

---

## Output Contract

```json
{
  "status": "ok",
  "address_verified": true,
  "walkability": {
    "score": 28,
    "label": "Car-Dependent",
    "transit_score": 12,
    "transit_label": "Minimal Transit",
    "bike_score": 35,
    "bike_label": "Bikeable"
  },
  "schools": [
    {
      "name": "Oak Hills Elementary",
      "grades": "K-5",
      "rating": 8,
      "source": "GreatSchools / NCES",
      "distance_miles": 0.6
    }
  ],
  "market": {
    "zip": "55044",
    "median_list_price": 318000,
    "median_days_on_market": 19,
    "active_listings": 14,
    "inventory_label": "Low",
    "price_per_sqft": null,
    "data_date": "2026-05-01"
  },
  "insight_block": "Homes in this price range in Lakeville (55044) are moving quickly — median 19 days on market with low inventory. The nearest elementary school is Oak Hills (K-5), rated 8/10 on GreatSchools. The property has a Walk Score of 28 (Car-Dependent).",
  "cma_ready": false,
  "raw": { ... }
}
```

`insight_block` is a pre-formatted 2-4 sentence summary Claude can drop directly into a prompt. It is compliance-filtered — no demographic, crime, or protected-class language.

`cma_ready: false` in Phase 1. Set to `true` in Phase 2 when comp data is available.

---

## Fair Housing Compliance

This is non-negotiable. The research agent enforces compliance at the data layer:

**Never included — ever:**
- Racial or ethnic composition of an area
- Crime statistics (correlated with demographics in most sources)
- School data framed as a neighborhood quality signal tied to demographics
- Any language steering buyers toward or away from an area based on protected class

**Always included as neutral public facts:**
- Walk Score (physical infrastructure)
- School names, grade ranges, and ratings from federal/public sources — disclosed as "public data, not a recommendation"
- Market statistics (price, days on market, inventory) — economic data only

**Claude compliance prompt (injected into every research agent call):**
```
You are formatting public real estate data into factual summaries.
Rules:
- Only report facts from the data provided. Never invent or estimate.
- Never mention neighborhood demographics, race, religion, national origin, or crime.
- School data is public record — present it neutrally, never as a neighborhood quality judgment.
- If data is missing or unavailable, omit that category entirely. Do not guess.
```

---

## Data Sources

| Source | Data | Cost | Notes |
|--------|------|------|-------|
| Census Geocoder | lat/lng from address | Free | Reliable for US addresses |
| Walk Score API | Walkability, transit, bike scores | Free tier (limited); ~$50/mo production | Requires API key |
| NCES (National Center for Education Statistics) | Public school locations, grades | Free federal data | Less rich than GreatSchools but no ToS concerns |
| GreatSchools API | School ratings | Free tier available | Review ToS — fair housing language required in display |
| RentCast | Median price, DOM, inventory by zip | ~$50-100/mo | Good coverage for MN markets |
| ATTOM Data | Property data, sales history, comps | ~$150-300/mo | Required for Phase 2 CMA |

**Phase 1 minimum viable stack:** Census Geocoder + Walk Score + NCES + RentCast
**Phase 2 CMA stack:** adds ATTOM (or equivalent MLS-adjacent source)

---

## Can This Support a CMA?

**Phase 1 (this PRD):** No — the research agent returns market context but not comparable sales. It tells you the market is moving fast at 19 DOM but does not identify the 4 specific houses that sold near the subject property.

**Phase 2 (CMA extension):** Yes — with ATTOM or a similar data source, the research agent can be extended to:

1. **Find comps** — search closed sales within 0.5 miles, same bed/bath range, last 90 days
2. **Score comps** — rank by similarity (sqft delta, age delta, distance)
3. **Calculate adjusted value** — price per sqft × subject sqft ± adjustment factors
4. **Generate CMA report** — Claude formats a structured CMA summary the agent can share with a seller or buyer

This requires `sqft` and `year_built` in the input (currently optional). The output gains a `cma` block:

```json
{
  "cma": {
    "estimated_value_range": "$305,000 - $325,000",
    "comps": [
      {
        "address": "142 Birchwood Dr, Lakeville MN",
        "sold_price": 312000,
        "sold_date": "2026-04-10",
        "beds": 4, "baths": 2, "sqft": 1980,
        "price_per_sqft": 157.6,
        "distance_miles": 0.3
      }
    ],
    "median_comp_price": 318000,
    "price_per_sqft": 156.2,
    "confidence": "medium",
    "disclaimer": "This is a market analysis for informational purposes only, not a licensed appraisal."
  }
}
```

**Important:** A CMA generated this way is an informational tool, not an appraisal. The disclaimer is mandatory. Agents should review before sharing with clients.

**Verdict:** Build Phase 1 now. The architecture is designed so Phase 2 CMA is an additive extension — same webhook, same output shape, `cma` block added. No rework of parent workflows.

---

## Phasing

### Phase 1 — Research Agent MVP
- [ ] Build `Norr AI Research Agent` n8n workflow
- [ ] Integrate: Census Geocoder → Walk Score → NCES → RentCast → Claude formatter
- [ ] Add compliance filter Claude prompt
- [ ] Log calls to `workflow_events` (client_id = norrai_internal until per-client routing built)
- [ ] Wire into cold nurture workflow (all 6 touches) as first consumer
- [ ] Wire into instant lead response as second consumer
- [ ] Add `research_agent_calls` table to Neon for caching (avoid repeat API calls for same address)

### Phase 2 — CMA Extension
- [ ] Add ATTOM (or equivalent) comp search to research agent
- [ ] Build comp scoring and price-range estimation logic
- [ ] Add `cma` block to output contract
- [ ] Build agent-facing CMA report page (PDF or HTML) at `clients/cma.html`
- [ ] Wire into listing description workflow (seller-side CMA)
- [ ] Add CMA trigger to chief of staff ("Run a CMA on 123 Maple St")

---

## Neon Schema Addition

```sql
CREATE TABLE research_cache (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address     TEXT NOT NULL,
  zip         TEXT,
  result      JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ DEFAULT now() + INTERVAL '7 days'
);

CREATE INDEX ON research_cache (address, expires_at);
```

Cache TTL: 7 days. Re-fetch if expired. Avoids redundant API calls for the same property across multiple workflow touches.

---

## Open Questions

1. **Walk Score ToS for automated use** — confirm their API terms allow n8n automation (not just human-facing display)
2. **GreatSchools vs NCES** — GreatSchools has richer data but fair housing language is required in any display; NCES is cleaner legally. Decide before build.
3. **RentCast vs ATTOM for Phase 1** — RentCast is cheaper and easier to start; ATTOM gives a runway to Phase 2. Evaluate based on data quality for MN markets.
4. **Caching strategy** — 7-day TTL works for market data; school data changes annually. Consider separate TTLs per data category.
5. **MLS access** — long-term, direct MLS data (via RETS or IDX feed) is more accurate for comps than ATTOM. Requires MLS membership or a brokerage partner. Not needed for Phase 1.
