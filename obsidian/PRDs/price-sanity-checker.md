# PRD: Price Sanity Checker

**Status:** Draft
**Author:** Egan
**Date:** 2026-05-11
**Version:** 1.0

---

## Problem Statement

Agents occasionally price listings out of range — either from seller pressure, outdated comps, or gut feel that doesn't match the current market. A quick pre-listing sanity check against recent comp data catches obvious mispricing before the listing goes live, saving the agent from a price reduction conversation 30 days in.

This is a lightweight version of the CMA Tool — no ATTOM API required, no formal adjustments, no client-deliverable report. Just a fast gut-check: does the proposed price make sense given what's sold nearby in the last 90 days?

---

## Goals

- Return a price sanity assessment in under 60 seconds
- Compare proposed list price against research-agent comp data
- Give the agent a plain-language verdict: in-range, slightly high, or significantly high
- Flag if comp coverage is too thin to make a confident assessment
- Require no external paid APIs beyond the existing research agent stack

## Non-Goals

- Replace the formal CMA Tool — this is a pre-listing quick check, not a client deliverable
- Calculate precise price adjustments (sqft delta, feature adjustments) — that's the CMA Tool
- Provide a formal appraisal or legal price opinion
- Store results for client sharing — internal agent tool only

---

## Users

**Primary:** Real estate agents preparing a new listing
**Use cases:**
- Before agreeing to a seller's suggested list price
- Double-checking a listing before uploading to MLS
- Quick gut check when comps are murky (rural, unique property type)

---

## Architecture

```
Agent submits clients/price_check.html
(address, proposed price, beds, baths, sqft, year_built)
        │
        ▼
n8n: Price Sanity Checker Workflow
        │
  Token Check → Research Agent
  (fetches comps + market data for the address)
        │
  Claude: Price Analysis
  (compare proposed price to comp set,
   apply directional reasoning,
   return verdict + reasoning)
        │
  Respond to webhook
  (result displayed inline on page)
        │
  Log to workflow_events (Neon)
```

The result is returned synchronously to the form page — no email needed. Agent sees the verdict within 60 seconds of submitting.

---

## Input Contract

```json
{
  "address": "198 Cuylle Ct",
  "city": "Lakeville",
  "state": "MN",
  "zip": "55044",
  "beds": 4,
  "baths": 2,
  "sqft": 2100,
  "year_built": 2005,
  "proposed_price": 329000,
  "notable_features": "Updated kitchen, new roof 2022, finished basement"
}
```

`sqft`, `year_built`, and `notable_features` are optional but improve analysis quality.

---

## Output Contract

```json
{
  "status": "ok",
  "verdict": "slightly_high",
  "proposed_price": 329000,
  "comp_median": 312000,
  "comp_range": "$298,000 – $324,000",
  "comp_count": 4,
  "days_on_market_context": "Homes in this zip are selling in 19 days with low inventory.",
  "reasoning": "Your proposed price of $329,000 is about 5% above the median of 4 comparable sales in the last 90 days ($312,000). The market is active with low inventory, which could support a slight premium. The updated kitchen and new roof are positive factors. A list price of $319,000–$325,000 would align more closely with comp data while leaving room to negotiate.",
  "data_confidence": "medium",
  "comps_used": [
    {
      "address": "142 Birchwood Dr, Lakeville MN",
      "sold_price": 312000,
      "sold_date": "2026-04-10",
      "beds": 4,
      "baths": 2,
      "sqft": 1980
    }
  ],
  "comps_disclaimer": "Comparable sales sourced from publicly available listings. For a complete market analysis, use the formal CMA tool.",
  "low_confidence_warning": null
}
```

**Verdict values:**
- `in_range` — proposed price within 3% of comp median
- `slightly_high` — 3-8% above comp median
- `significantly_high` — >8% above comp median
- `below_market` — proposed price is below comp median (flag for agent awareness)
- `insufficient_data` — fewer than 3 comps returned; assessment not possible

---

## Claude Prompt Structure

```
You are a real estate pricing analyst. Evaluate whether a proposed list price is 
reasonable given recent comparable sales.

SUBJECT PROPERTY: [address], [city], [state] [zip]
BEDS/BATHS/SQFT/YEAR BUILT: [beds]/[baths]/[sqft]/[year_built]
NOTABLE FEATURES: [notable_features or "none provided"]
PROPOSED LIST PRICE: $[proposed_price]

COMPARABLE SALES (last 90 days, nearby):
[recent_comps from research agent — address, sold_price, sold_date, beds, baths, sqft]

MARKET CONTEXT:
[market data from research agent — median_sale_price, median_days_on_market, 
 inventory_level, yoy_price_trend]

DATA CONFIDENCE: [data_confidence from research agent]

Return a JSON object:
{
  "verdict": "in_range | slightly_high | significantly_high | below_market | insufficient_data",
  "comp_median": <integer>,
  "comp_range": "<low> – <high>",
  "comp_count": <integer>,
  "days_on_market_context": "<one sentence>",
  "reasoning": "<2-3 sentences: where the price sits, what factors support or undercut it, 
                 a suggested range if not in_range>",
  "low_confidence_warning": "<string if data_confidence is low, else null>"
}

Rules:
- Base reasoning only on the comp data provided. Do not invent sale prices.
- Do not recommend a specific list price — give a range and let the agent decide.
- Do not mention demographics, crime, or any protected class characteristics.
- If fewer than 3 comps are available, return verdict: insufficient_data with explanation.
- Tone: direct, factual, non-judgmental. The agent may disagree with the data.
```

---

## Agent-Facing UI: clients/price_check.html

A form behind Cloudflare Access (clients group). Results display inline on the same page — no email, no page navigation.

**Form fields:**
- Property address (street, city, state, zip)
- Beds / Baths
- Square footage (optional)
- Year built (optional)
- Proposed list price (required, number input)
- Notable features (optional textarea)

**Result display:**
- Verdict badge: green (in_range / below_market), yellow (slightly_high), red (significantly_high), gray (insufficient_data)
- Reasoning paragraph
- Comp table (address, sold price, sold date, beds/baths/sqft)
- `comps_disclaimer` in small text
- Low confidence warning if applicable

**Loading state:** "Checking comps... (usually under 60 seconds)"

---

## Workflow Name

`price_sanity_checker` — add to `workflow_events` logging and workflow_name registry in CLAUDE.md.

---

## Tier

**Starter and Growth** — no paid APIs required beyond the existing research agent stack. Strong pre-listing value-add.

Pitch framing: *"Before you agree to a list price, run a 60-second comp check. If the number doesn't match the market, you know before the listing goes live — not 30 days in."*

---

## Phasing

### Phase 1
- [ ] `clients/price_check.html` form with inline result display
- [ ] n8n workflow: Token Check → Research Agent → Claude analysis → respond to webhook
- [ ] Playwright tests for `price_check.html`
- [ ] Add `price_sanity_checker` to workflow_name registry

### Phase 2
- [ ] Chief of staff integration: "Is $329k reasonable for 198 Cuylle Ct, 4 bed 2 bath?"
- [ ] Optional: connect to Listing Description Generator — if price check runs first, pass `comp_median` and `comp_range` into the listing description prompt for accurate pricing language

---

## Relationship to CMA Tool

The Price Sanity Checker and CMA Tool overlap but serve different moments:

| | Price Sanity Checker | CMA Tool |
|---|---|---|
| **When used** | Quick pre-listing gut check | Formal listing presentation prep |
| **Comps** | Public data via research agent | ATTOM / MLS (complete coverage) |
| **Adjustments** | None — directional only | Full sqft/feature adjustments |
| **Output** | Verdict + reasoning (inline) | Full report with shareable link |
| **Deliverable** | Internal only | Can share with client |
| **Time** | ~60 seconds | ~2 minutes |
| **Tier** | Starter / Growth | Pro only |

Use the Price Sanity Checker when you need a quick read. Use the CMA Tool when you're sitting across from a seller.

---

## Open Questions

1. **Webhook response timeout** — if the research agent takes >30 seconds, the form webhook may time out. Design: n8n responds immediately with a `job_id`, form polls a status endpoint. Or: increase webhook timeout and hold the response. Polling is more resilient.
2. **Cache reuse** — if the research agent cache already has data for this address (from a cold nurture or lead response call), the price check should hit the cache and return in under 5 seconds. Verify cache key format matches across workflows.
3. **Below-market verdict** — should a `below_market` verdict trigger any additional messaging to the agent? Or just display as-is and let them decide?
