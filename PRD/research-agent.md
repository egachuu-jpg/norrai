# PRD: Norr AI Research Agent

**Status:** Draft
**Author:** Egan
**Date:** 2026-05-09
**Version:** 2.0 — Gemini-powered, single-API architecture

---

## Problem Statement

Claude drafts personalized messages across multiple workflows (cold nurture, instant lead response, open house follow-up) but has no access to real property or market data. The result is hallucinated facts — invented school names, fabricated market statistics, made-up neighborhood claims — that erode agent trust and create fair housing risk.

Agents need Claude to write messages grounded in verified, publicly available data without requiring manual research on every lead.

---

## Goals

- Provide a single, reusable research sub-workflow any n8n workflow can call
- Return structured, verified facts using one API call (Gemini + Google Search grounding)
- Enforce fair housing compliance before facts reach the message-drafting Claude call
- Cover market context, schools, walkability, and informal comps in one shot
- Add zero manual work for the agent

## Non-Goals

- Formal CMA with complete MLS comp coverage — see `PRD/cma-tool.md`
- Access MLS-gated data without a proper integration agreement
- Provide demographic, crime, or protected-class-adjacent data — ever
- Replace the agent's local market expertise

---

## Users

**Primary:** n8n workflows — the research agent is called by parent workflows, not by agents directly.

**Indirect beneficiaries:** Agents who receive Claude-drafted messages backed by real data; leads who receive accurate, trustworthy outreach.

---

## Architecture

### Why Gemini

Gemini 2.0 Flash with Google Search grounding can query live web data (Zillow, Redfin, Realtor.com, GreatSchools, school district sites) and synthesize structured output in one API call. This eliminates the need for separate Walk Score, NCES, and RentCast API integrations — reducing cost, complexity, and API key management to a single endpoint.

### Pattern

```
Parent Workflow
  └─ HTTP Request → POST /webhook/research-agent
                          │
                    Census Geocoder
                    (address → lat/lng, verify address is real)
                          │
                    Gemini 2.0 Flash
                    + Google Search Grounding
                    (one call covering all data categories)
                          │
                    Claude: Compliance Filter
                    + Insight Formatter
                          │
                    Return structured JSON
                          │
  └─ Parent Workflow injects into Claude prompt
```

### n8n Node Structure

1. **Webhook** — receives input from parent workflow
2. **Census Geocoder** (HTTP Request) — validates address, returns lat/lng
3. **Build Gemini Prompt** (Set) — constructs structured research prompt
4. **Gemini Research** (HTTP Request) — single call with search grounding
5. **Parse + Compliance Filter** (Code) — strips any non-compliant data, structures output
6. **Claude Formatter** (HTTP Request) — formats `insight_block` for message use
7. **Respond** — returns structured JSON to parent workflow

---

## Gemini API Call

```json
{
  "model": "gemini-2.0-flash",
  "contents": [{
    "parts": [{
      "text": "Research the following property and local market. Return ONLY information you find from search results — do not estimate or invent any numbers.\n\nPROPERTY: [address], [city], [state] [zip]\nPRICE RANGE: [price_range]\nBEDS: [beds] | BATHS: [baths]\n\nReturn a JSON object with these fields:\n- walkability: { description: string } (from Walk Score or similar sources)\n- schools: [ { name, grades, rating, source, distance_miles } ] (nearest 2-3 public schools)\n- market: { median_sale_price, median_days_on_market, inventory_level (low/balanced/high), yoy_price_trend, data_source, data_date }\n- recent_comps: [ { address, sold_price, sold_date, beds, baths, sqft_if_available } ] (up to 4 comparable recently sold homes from public listings)\n- data_confidence: { market: high/medium/low, comps: high/medium/low, schools: high/medium/low }\n\nDo not include demographic data, crime statistics, or any information about the racial or ethnic composition of the area."
    }]
  }],
  "tools": [{ "google_search_retrieval": {} }],
  "generationConfig": { "response_mime_type": "application/json" }
}
```

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

`sqft` and `year_built` are optional — include them when available for better comp matching.
`caller` is logged to `workflow_events` for debugging.

---

## Output Contract

```json
{
  "status": "ok",
  "address_verified": true,
  "walkability": {
    "description": "Car-dependent area. Most errands require a vehicle."
  },
  "schools": [
    {
      "name": "Oak Hills Elementary",
      "grades": "K-5",
      "rating": 8,
      "source": "GreatSchools",
      "distance_miles": 0.6
    }
  ],
  "market": {
    "zip": "55044",
    "median_sale_price": 318000,
    "median_days_on_market": 19,
    "inventory_level": "Low",
    "yoy_price_trend": "+4.2%",
    "data_source": "Zillow / Redfin",
    "data_date": "2026-05"
  },
  "recent_comps": [
    {
      "address": "142 Birchwood Dr, Lakeville MN",
      "sold_price": 312000,
      "sold_date": "2026-04-10",
      "beds": 4,
      "baths": 2,
      "sqft": 1980
    }
  ],
  "data_confidence": {
    "market": "high",
    "comps": "medium",
    "schools": "high"
  },
  "insight_block": "Homes in this price range in Lakeville (55044) are moving quickly — median 19 days on market with low inventory, up 4.2% year over year. The nearest public elementary school is Oak Hills (K-5, rated 8/10 on GreatSchools).",
  "comps_disclaimer": "Comparable sales sourced from publicly available listings. For a complete market analysis, see your agent's formal CMA."
}
```

`data_confidence` lets the parent Claude prompt adjust language — high confidence gets stated as fact, medium gets hedged ("based on available data").

`comps_disclaimer` is always included when `recent_comps` is non-empty and must be surfaced to the agent anywhere comps are displayed.

---

## Fair Housing Compliance

**Never included — ever:**
- Racial or ethnic composition of an area
- Crime statistics
- School data framed as a neighborhood quality signal tied to demographics
- Any language steering buyers toward or away from an area based on protected class

**Claude compliance prompt (injected into every formatting call):**
```
You are formatting verified real estate research into factual summaries.
Rules:
- Only use facts from the data provided. Never add, estimate, or invent.
- Never mention neighborhood demographics, race, religion, national origin, or crime.
- School data is public record — present it neutrally as a fact, never as a quality judgment.
- If confidence is "low" for a category, omit it from the insight_block entirely.
- Always hedge comps: "based on publicly available sales data."
```

---

## Caching

Repeat calls for the same address waste API budget. Cache results in Neon:

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

TTL: 7 days. The research agent checks cache before calling Gemini. Market data changes slowly enough that 7 days is safe for message drafting purposes.

---

## Cost

| Component | Cost |
|-----------|------|
| Gemini 2.0 Flash | ~$0.075 / 1M input tokens. One research call ≈ 500-800 tokens. Effectively $0 at current volume. |
| Census Geocoder | Free |
| Neon cache reads | Free (existing connection) |

Total per research call: **< $0.001** at current Norr AI volume.

---

## Workflows That Will Consume This

| Workflow | Touch points |
|----------|-------------|
| Cold Nurture (Slack) | All 6 touches — called once at enrollment, cached for the run |
| Instant Lead Response | Called on new lead, injects into Claude SMS/email draft |
| Open House Follow-Up | Called with property from setup, injects into follow-up draft |
| Listing Description | Optional — provides comp context for pricing language |

---

## Limitations vs. Formal CMA

The research agent's `recent_comps` are sourced from publicly indexed sales on Zillow and Redfin — **not** the full MLS. Coverage is partial. This is sufficient for message drafting and informal market context. It is **not** sufficient for a formal CMA an agent presents to a seller or buyer.

For full CMA functionality, see `PRD/cma-tool.md`.

---

## Open Questions

1. **Gemini search grounding ToS** — confirm automated/programmatic use is permitted under current terms
2. **Confidence threshold** — if Gemini returns `data_confidence.comps: low`, should comps be omitted from `insight_block` entirely, or included with a stronger hedge?
3. **Cache invalidation** — should cache be invalidated early if a workflow specifically requests fresh data (e.g., for a listing that just went under contract)?
