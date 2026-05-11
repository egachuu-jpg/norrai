# Design: Research Agent Integration into Existing Workflows

**Date:** 2026-05-11
**Author:** Egan
**Status:** Approved

---

## Scope

Wire the live Research Agent subworkflow into three existing real estate workflows. Each integration creates a new workflow file — originals are untouched.

**In scope:**
- Real Estate Instant Lead Response
- Real Estate 7-Touch Cold Nurture
- Real Estate Open House Follow-Up

**Out of scope:**
- Listing Description Generator (dropped — optional value not worth the complexity)
- Net-new workflows (Buyer Briefing, Price Sanity Checker, Lead Scoring — separate PRDs exist)

---

## New Files

| New file | n8n workflow name |
|---|---|
| `Real Estate Instant Lead Response with Research.json` | Real Estate Instant Lead Response with Research |
| `Real Estate 7-Touch Cold Nurture with Research.json` | Real Estate 7-Touch Cold Nurture with Research |
| `Real Estate Open House Follow-Up with Research.json` | Real Estate Open House Follow-Up with Research |

Originals remain in `n8n/workflows/` unchanged.

---

## Architecture

### Pattern (applied to all three workflows)

Two nodes inserted into each workflow:

1. **Call Research Agent** — HTTP Request, `continueOnFail: true`
   - POST to `https://norrai.app.n8n.cloud/webhook/research-agent`
   - Header: `x-norr-token: 8F68D963-7060-4033-BD04-7593E4B203CB`
   - Body: address fields + available property details + `caller` identifier
   - `continueOnFail: true` — a research failure never blocks the main flow

2. **Enrich with Research** — Code node, `continueOnFail: true`
   - Spreads all fields from the upstream payload node
   - Safely extracts `insight_block` from research response (defaults to `''` if research failed or returned an error status)
   - Parses `property_address` string into `research_address`, `research_city`, `research_state`, `research_zip` for the research call body

All downstream Build Prompt nodes reference **Enrich with Research** as their single data source.

### Insertion Points

**Instant Lead Response:**
```
Validate Input → [Call Research Agent] → [Enrich with Research] → Build Prompt → Draft Response (Claude) → ...
```

**Cold Nurture:**
```
Prep Fields → [Call Research Agent] → [Enrich with Research] → Wait Day 1 → Build Prompt T1 → ...
```
Research called once at enrollment. 7-day cache on the research agent covers the full 21-day nurture run.

**Open House Follow-Up:**
```
Wait Until 9am CT → [Call Research Agent] → [Enrich with Research] → Build Prompt → Draft Follow-Up (Claude) → ...
```
Called after the overnight wait — avoids running a Gemini search that could go stale before the follow-up fires.

---

## Research Agent Call

### Address Parsing

All three workflows receive `property_address` as a single string (e.g., `"1106 Cuylle Ct, Faribault, MN, 55021"`). The Enrich node parses on commas:

- 4 parts → `address`, `city`, `state`, `zip`
- Fewer parts → pass full string as `address`, leave others blank

The Census Geocoder and Gemini handle partial addresses acceptably for message drafting purposes.

### Call Body Per Workflow

**Instant Lead Response:**
```json
{
  "address": "<parsed>",
  "city": "<parsed>",
  "state": "<parsed>",
  "zip": "<parsed>",
  "price_range": "{{ price_range }}",
  "beds": "{{ beds }}",
  "baths": "{{ baths }}",
  "caller": "instant_lead_response"
}
```

**Cold Nurture:**
```json
{
  "address": "<parsed>",
  "city": "<parsed>",
  "state": "<parsed>",
  "zip": "<parsed>",
  "price_range": "{{ price_range }}",
  "beds": "{{ beds }}",
  "baths": "{{ baths }}",
  "caller": "cold_nurture"
}
```

**Open House Follow-Up:**
```json
{
  "address": "<parsed>",
  "city": "<parsed>",
  "state": "<parsed>",
  "zip": "<parsed>",
  "caller": "open_house_follow_up"
}
```
No price_range, beds, or baths available from the sign-in form — omitted.

---

## Prompt Updates

### Instant Lead Response

Add after `key_details` in the Build Prompt Set node:

```
MARKET CONTEXT (verified data — use naturally to strengthen the response):
{{ $json.insight_block || 'No market data available.' }}
```

### Cold Nurture

Research data injected into **T1, T2, T3 only**. T4 (soft check-in), T5 (no-pressure patience), T6 (final farewell) are relationship-oriented touches — data injection would feel out of place.

All Build Prompt Tx nodes updated to reference `$('Enrich with Research')` instead of `$('Prep Fields')`. The Enrich node passes through all Prep Fields data, so field references are identical — only the node name changes.

**T1 (email, day 1)** — add after property details block:
```
MARKET CONTEXT (use only if relevant to make the message feel informed — do not force it):
{{ $('Enrich with Research').first().json.insight_block || 'No market data available.' }}
```

**T2 (SMS, day 3)** — replace vague "sharp market observation" angle with:
```
Angle: Share one specific market fact from the data below as a genuine tip. If no data is available, pick a compelling property detail instead.
MARKET DATA: {{ $('Enrich with Research').first().json.insight_block }}
```

**T3 (email, day 7)** — replace "share a genuine market observation" with:
```
Angle: Value-add market intel. Use the verified data below — do not invent statistics.
MARKET DATA: {{ $('Enrich with Research').first().json.insight_block }}
```

**T4, T5, T6** — no prompt changes. Node reference updated from `$('Prep Fields')` to `$('Enrich with Research')` for data access, prompt text unchanged.

### Open House Follow-Up

Add after `PROPERTY HIGHLIGHTS` in the Build Prompt Set node:

```
MARKET CONTEXT (verified data — use naturally to strengthen the follow-up):
{{ $json.insight_block || 'No market data available.' }}
```

---

## Error Handling

- Both new nodes use `continueOnFail: true`
- `insight_block` defaults to `''` — Claude prompts handle this gracefully with the `|| 'No market data available.'` fallback
- Research failures are silent to the lead/attendee — the workflow continues and sends a message without market data, same as today
- No new error workflow hookup needed — existing Error Workflow covers logging

---

## Workflow Logging

No changes to `workflow_events` logging. The `caller` field on each research agent call provides debugging context in the research agent's own logs. If per-caller research logging is needed later, add it to the research agent subworkflow — not here.

---

## Testing

Manual smoke test per workflow after import:
1. Fire test payload (use existing pinned data in n8n)
2. Confirm research agent is called (check n8n execution log)
3. Confirm `insight_block` appears in the Claude prompt (check Build Prompt output)
4. Confirm Claude output references market data naturally
5. Confirm workflow completes normally if research agent is unreachable (toggle workflow off temporarily, re-test)

No Playwright tests needed — these are n8n workflow JSON files, not HTML forms.
