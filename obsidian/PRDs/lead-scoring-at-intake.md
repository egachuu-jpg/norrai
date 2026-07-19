# PRD: Lead Scoring at Intake

**Status:** Draft
**Author:** Egan
**Date:** 2026-05-11
**Version:** 1.0

---

## Problem Statement

All leads currently enter the system and get the same treatment: dedupe check, record creation, instant lead response + cold nurture enrollment. A lead in a hot market (5 days on market, low inventory) where the buyer is asking about a specific property they saw 2 hours ago is fundamentally different from a lead browsing price ranges for a move 18 months out.

Agents can't tell the difference from the lead form data alone. Without prioritization, the hottest leads sit in the same queue as window-shoppers — and agents are the ones manually triaging.

Lead Scoring at Intake automatically classifies each new lead by urgency using two signals: market heat at the target address and lead intent signals from the lead message itself. The score is stored in Neon and surfaced in the dashboard.

---

## Goals

- Score every new lead on a 1-10 scale automatically at intake, before any agent sees it
- Combine market heat (how competitive is the market at this address?) with intent signals (how serious does this buyer seem?)
- Write the score to `leads.metadata` in Neon for dashboard display and workflow routing
- Generate a 1-sentence "why" summary the agent can read at a glance
- Add zero latency to the existing intake pipeline (runs in parallel, non-blocking)

## Non-Goals

- Replace agent judgment on lead quality — this is a signal, not a decision
- Score based on demographic data — only property market data and lead message content
- Build a separate lead management UI — score surfaces in the existing dashboard
- Score non-real-estate leads (dental, insurance use different signals)

---

## Users

**Primary:** Real estate agents who receive leads through Norr AI intake workflows
**Secondary:** Egan monitoring client health via the internal dashboard

**Use cases:**
- Agent wakes up to 5 new leads and wants to know which one to call first
- Dashboard shows a "hot lead" badge on a client who got a high-scoring lead overnight
- Chief of staff can answer "what are my hottest leads right now?"

---

## Architecture

Lead scoring runs as a **non-blocking parallel branch** inside the Lead Cleanser pipeline. After the dedup check confirms a lead is new, the main branch creates the Neon record and fires the nurture/lead response enrollment. The scoring branch runs concurrently and writes back to the record when complete. Main flow never waits on scoring.

```
Lead Cleanser Pipeline
        │
  Dedup Check (new lead confirmed)
        │
  ┌─────┴─────────────────────────────┐
  │ (main branch)                     │ (scoring branch — parallel, non-blocking)
  │                                   │
Create lead record in Neon     Research Agent
Fire instant lead response     (market heat for target address/zip)
Fire cold nurture enrollment         │
                               Claude: Score Lead
                               (market signals + intent analysis)
                                     │
                               UPDATE leads SET metadata = metadata ||
                               '{"lead_score": 8, "lead_score_reason": "...",
                                 "market_heat": "high", "scored_at": "..."}'
                               WHERE id = [lead_id]
```

The scoring branch uses `continueOnFail: true` — a scoring failure never blocks the main flow.

---

## Scoring Model

**Final score: 1-10 (integer)**

Composed of two sub-scores:

### Market Heat Score (1-5)

Derived from research agent `market` data for the target zip:

| Condition | Points |
|---|---|
| DOM ≤ 14 days + inventory: Low | 5 |
| DOM ≤ 21 days + inventory: Low | 4 |
| DOM ≤ 30 days + inventory: Balanced | 3 |
| DOM > 30 days OR inventory: High | 2 |
| Insufficient market data | 2 (neutral, don't penalize) |

YoY price trend modifier: if trend > +3%, add 1 point (capped at 5).

### Intent Score (1-5)

Derived from Claude analysis of `lead_message`:

Claude assesses:
- **Specificity** — is the buyer asking about a specific property, or browsing?
- **Timeline language** — "looking to buy soon" vs. "thinking about it" vs. no timeline mentioned
- **Action signals** — asks about showing, financing, offer process, inspection, closing
- **Engagement depth** — detailed question vs. one-line form submission

| Intent Signal | Score Range |
|---|---|
| Specific property + showing/offer/financing question + short timeline | 4-5 |
| Specific property interest + moderate engagement | 3-4 |
| General interest, reasonable engagement | 2-3 |
| Minimal message, no timeline, browsing signals | 1-2 |

**Combined:** `lead_score = market_heat_score + intent_score` (2-10 range; displayed as-is)

---

## Claude Prompt for Intent Scoring

```
You are scoring a real estate lead's intent level based on their message.

LEAD MESSAGE: [DATA][lead_message][/DATA]
PROPERTY OF INTEREST: [property_address or "not specified"]
PRICE RANGE: [price_range or "not specified"]

Score the lead's buying intent from 1-5:
5 = High urgency — specific property interest, short timeline, action-oriented question
4 = Active buyer — engaged question, some specificity, reasonable timeline signals
3 = Moderate interest — general interest, some engagement, unclear timeline
2 = Low intent — minimal message, browsing language, no timeline
1 = Very low — one-word response, no specific interest

Return JSON:
{
  "intent_score": <1-5>,
  "intent_reason": "<one sentence explaining the score>"
}

Rules:
- Base score only on the message content. Do not factor in name, email, or phone.
- Do not penalize short messages if the content is specific and action-oriented.
- A lead asking "what's the price?" is less intent than a lead asking "can I see it tomorrow?"
```

---

## Output: leads.metadata Fields Added

```json
{
  "lead_score": 8,
  "lead_score_reason": "Active market (DOM 14 days, low inventory) + buyer asking about specific property and available showing times.",
  "market_heat": "high",
  "market_heat_score": 4,
  "intent_score": 4,
  "scored_at": "2026-05-11T14:32:00Z",
  "scoring_version": "1.0"
}
```

`scoring_version` allows future model changes to be tracked without data migration.

---

## Dashboard Integration

The internal dashboard (`internal/dashboard.html`) already shows workflow health per client. Add a **hot leads** indicator per real estate client:

- Show count of leads scored ≥ 7 in the last 24 hours
- Show count of leads scored ≥ 8 in the last 7 days
- "No recent hot leads" if none in 7 days

Query:
```sql
SELECT COUNT(*) FROM leads
WHERE client_id = $client_id
  AND (metadata->>'lead_score')::int >= 7
  AND created_at > now() - interval '24 hours';
```

---

## Chief of Staff Integration

The chief of staff workflow recognizes intent:
- "What are my hottest leads?" → query leads scored ≥ 7, last 7 days, return formatted list
- "Show me leads that came in overnight" → leads from last 8 hours with score + reason

---

## Workflow Name

`lead_scoring` — add to `workflow_events` logging and workflow_name registry in CLAUDE.md.

---

## Neon Schema Change

No new table needed. Score data goes in `leads.metadata` (existing jsonb column).

Add index for dashboard queries:
```sql
CREATE INDEX ON leads ((metadata->>'lead_score'), client_id, created_at DESC);
```

Add to `db/schema.sql`.

---

## Tier

**Growth and above** — lead scoring is a value-add that justifies the tier upgrade from Starter. Frame it as: *"Your Growth plan automatically scores every lead on arrival. You wake up knowing which ones to call first."*

Could be offered as a Starter add-on at $100/mo if there's demand.

---

## Phasing

### Phase 1
- [ ] Add scoring branch to Lead Cleanser pipeline (parallel, non-blocking, `continueOnFail: true`)
- [ ] Research Agent call for market heat
- [ ] Claude intent scoring prompt
- [ ] `UPDATE leads SET metadata` write-back to Neon
- [ ] Add `lead_scoring` to workflow_name registry and `workflow_events` logging
- [ ] Add index to `db/schema.sql`

### Phase 2
- [ ] Dashboard hot leads indicator per client
- [ ] Chief of staff queries: "what are my hottest leads?"
- [ ] Routing logic: score ≥ 8 triggers Slack alert to agent immediately (not just email)

### Phase 3
- [ ] Score decay: re-score leads weekly if no contact has been made — market conditions change
- [ ] Feedback loop: track which scored leads converted and tune weights over time

---

## Open Questions

1. **Parallel branch timing** — the scoring branch calls the research agent which can take 10-30 seconds. The `UPDATE` write-back happens asynchronously. Dashboard needs to handle `lead_score: null` state gracefully for leads that haven't been scored yet.
2. **Research agent cache alignment** — if the research agent already ran for this address (from an earlier lead or a nurture enrollment), the cache hit means scoring is nearly instant. Cache key must be consistent across all callers.
3. **Score inflation** — hot markets will score many leads as 7-8 even if intent is low, because market heat adds 4-5 points automatically. Consider whether market heat should be a modifier rather than an additive component, to avoid desensitizing agents to high scores.
4. **Cross-client data** — multiple leads for the same address from the same zip would all get the same market heat score. Research agent cache handles this efficiently — one Gemini call covers all of them.
