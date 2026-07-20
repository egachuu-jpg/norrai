# PRD: Norr AI AEO Service (Answer Engine Optimization)

**Status:** Draft
**Author:** Egan
**Date:** 2026-07-18
**Version:** 1.0

---

## Problem Statement

When a homeowner in Faribault asks "who should I call to fix my furnace?" they
increasingly ask an AI — Google's AI Overviews / AI Mode, ChatGPT, Perplexity —
instead of scanning ten blue links. Those engines synthesize an answer from a
small set of signals: Google Business Profile data, review volume and recency,
structured data on the business website, and consistent citations across the web.
A local service business either *is* the answer or is invisible, and almost none
of them know which one they are — let alone how to change it.

Traditional SEO agencies sell this vertical backlinks and blog posts. Nobody
local is selling **measurable AI-answer presence** — "here are the 20 questions
your customers ask AI, here's how often you're the answer, and here's the number
going up each month."

Norr AI already owns every primitive this service needs: GBP build-out (507 Air
setup packet), review-request automation (`review_request` workflow), a
Gemini + Google Search grounding pattern (Research Agent), Claude for scoring
and drafting, Neon for history, and the `workflow_events` reporting spine.

## Goals

- A repeatable **audit engine** that scores any local service business's
  AI-search readiness in under an hour of operator time — usable as both a
  sales wedge and a recurring deliverable
- A **query battery** that measures actual AI-answer presence per client per
  month, stored in Neon, trending in a report — the headline metric clients pay
  to move
- A **fix playbook** (one-time Foundation build) and an **ongoing engine**
  (retainer) mapped cleanly onto the existing Starter/Growth/Pro tiers
- 507 Air as pilot and case study
- Vertical playbooks for HVAC, construction/trades, and plumbing/electrical

## Non-Goals

- Guaranteeing placement in AI Overviews or any engine — we measure and
  improve presence; nobody can promise it
- Paid ads management (Google LSA/PPC) — adjacent upsell, not this service
- Review gating or incentivized reviews — against Google TOS; we ask every
  customer, filter none
- National/e-commerce SEO — this is local service businesses only

---

## The Mechanism — Three Layers

```
┌─ 1. AUDIT ENGINE (evaluate) ──────────────────────────────┐
│  GBP scan · website scan · citations check · query battery │
│  → pillar scores → Polar Modern scorecard                  │
│  Sales wedge ($0–99) AND monthly re-run for retainers      │
└────────────────────────────────────────────────────────────┘
┌─ 2. FOUNDATION BUILD (fix, one-time) ─────────────────────┐
│  GBP overhaul · schema injection · FAQ/answer pages ·      │
│  service-area pages · citations cleanup · review wiring    │
└────────────────────────────────────────────────────────────┘
┌─ 3. ONGOING ENGINE (retainer, n8n-automated) ─────────────┐
│  review requests · AI-drafted review responses ·           │
│  GBP posts (seasonal calendar) · monthly answer page ·     │
│  monthly audit re-run + scorecard delivery                 │
└────────────────────────────────────────────────────────────┘
┌─ 4. OPTIMIZER (continual, results-driven) ────────────────┐
│  monthly diff + query-loss attribution → typed action list │
│  → auto-apply site changes · Norr-applies GBP edits ·      │
│  client nudges — every action tracked against next battery │
└────────────────────────────────────────────────────────────┘
```

### Layer 1: Audit Engine

Five weighted pillars, 0–100 total. Claude turns raw check results into the
scored narrative; raw data + scores stored in Neon so month-over-month deltas
are queryable.

| Pillar | Weight | What's checked |
|---|---|---|
| **GBP completeness & activity** | 25 | Verified · correct primary category · ≥8 services listed · hours + attributes set · ≥10 photos with one uploaded in last 60 days · post in last 30 days · Q&A seeded |
| **Reputation** | 25 | Review count vs. top-3 local competitors · avg rating ≥4.6 · velocity ≥4/mo · owner response rate ~100% within 48h |
| **Website answerability** | 25 | Valid `LocalBusiness` + `Service` + `FAQPage` JSON-LD · FAQ content per core service · service+city pages for top towns · NAP exact-match with GBP · entity signals (license #, insurance, years, brands serviced) · mobile + Core Web Vitals |
| **Citations & consistency** | 15 | NAP exact-match across Bing Places, Apple Maps, Yelp, Facebook, BBB, Angi, Nextdoor |
| **AI answer presence** | 10 | Query battery result: mentioned in X of N queries (lagging outcome metric — lowest weight, highest sales value) |

**Query battery** — the differentiator. ~20 queries generated from a template
matrix per client:

```
{service} × {city} × {intent}
  services: from GBP services list (furnace repair, AC install, …)
  cities:   top 4–5 service-area towns
  intents:  "best ___ near me" · "who should I call for ___" ·
            "how much does ___ cost in ___" · "emergency ___"
```

Each query runs monthly through **Gemini 2.5 Flash + Google Search grounding**
(same single-API pattern as the Research Agent — a practical proxy for AI
Overviews) plus optional Perplexity spot-checks. Logged per run: engine, query,
`client_mentioned` (bool), competitor names mentioned, cited URLs.

The sales artifact this produces: *"Here are the 20 questions your customers
ask AI. You appear in 2. Here's who appears in the other 18, and why."*

**Data collection, by source:**

| Signal | How | Notes |
|---|---|---|
| GBP rating, review count, hours, photos, status | Google **Places API** Place Details | Cheap, no approval needed. Competitors via Text Search ("HVAC contractor Faribault MN") |
| GBP posts, Q&A, response rate | GBP API *or* manual check | GBP API needs Google approval; the 507 Air "Norr AI added as Manager" ownership model is exactly what enables agency API access later. Manual quarterly check until then |
| Website schema, NAP, titles, sitemap | Fetch + parse (n8n Code node / script) | JSON-LD parse, regex NAP match against GBP values |
| Core Web Vitals | PageSpeed Insights API | Free |
| Citations | Manual checklist first pass | ~30 min; automate later if volume justifies |
| AI presence | Gemini grounding query battery | ~$0.10–0.30/client/month at 20 queries |

### Layer 2: Foundation Build (one-time)

The fix playbook, ordered by impact:

1. **GBP overhaul or creation** — the 507 Air `GBP_SETUP.md` becomes the
   template: identity, SAB setting, categories, service area, description,
   services, attributes, photos, review-link wiring. Ownership model is fixed
   policy: profile on the *client's* Google account, Norr AI added as Manager.
2. **Schema injection** — `LocalBusiness` (subtype `HVACBusiness`,
   `GeneralContractor`, `Plumber`, `Electrician`), `Service` per service, and
   `FAQPage` JSON-LD sitewide. For clients on Norr-built Cloudflare Worker
   sites this is a template drop-in; for external sites it's a snippet handoff
   or a rebuild upsell.
3. **Answer content** — an FAQ page per core service written the way AI engines
   quote: direct question → 2–3 sentence factual answer → local specifics
   (real price ranges, response times, brands serviced, license info). Claude
   drafts from a client questionnaire; owner approves.
4. **Service-area pages** — one page per top town (service + city + real local
   detail, not doorway-page boilerplate).
5. **Citations cleanup** — claim/correct the top 8 listings to exact NAP match.
6. **Review pipeline wiring** — review links on site + the "Get more reviews"
   short link to the owner (already the 507 Air pattern).

### Layer 3: Ongoing Engine (retainer)

All n8n, all logging to `workflow_events` per the standard:

| Motion | Cadence | How |
|---|---|---|
| Review requests | Post-job | Adapt existing `review_request` workflow: job-complete trigger (or weekly CSV/simple form from owner) → SMS via client Twilio subaccount → Google review short link. Ask everyone, gate no one |
| Review responses | Within 48h | Poll new reviews (Places API) → Claude drafts response in owner's voice → owner approves via SMS/email (Growth: pre-approved templates auto-post once GBP API access lands) |
| GBP posts | 2–4/mo | Seasonal calendar per vertical (below) → Claude drafts → owner approves → manual post (API post later) |
| New answer page | 1/mo (Growth+) | Pick the lowest-performing query battery question → publish a page that answers it |
| Audit re-run + scorecard | Monthly | Automated re-run → scorecard published to `tools.norrai.co/clients/aeo/<slug>/<YYYY-MM-DD>.html` (Cloudflare Access `clients` group) → SendGrid email from hello@norrai.co with the link |

**Seasonal content calendars** (drives GBP posts + monthly pages):

- **HVAC:** Sept–Nov furnace tune-up/replacement · Dec–Feb emergency heat + filters · Apr–Jun AC tune-up/install · Jul–Aug AC repair + IAQ
- **Construction/remodel:** Jan–Mar planning/permits/financing · Apr–Sept project galleries (photos are the ranking currency) · Oct–Dec winter-prep + next-year booking
- **Plumbing/electrical:** emergency-intent queries dominate — 24/7 attributes, "emergency ___ near me" answer pages, frozen-pipe/generator seasonal spikes

### Layer 4: The Optimizer — closing the loop

Without this layer the service measures continuously but optimizes on a fixed
calendar. The Optimizer makes the monthly cycle results-driven:

```
audit + query battery results (this month)
        │
  Diff vs. last month + competitor state
        │
  Query-loss attribution ── for each query the client ISN'T the answer:
        │                   Claude reads the winning answer's cited URLs +
        │                   winner's GBP data and names the reason —
        │                   "they have a page answering exactly this,"
        │                   "3× your reviews," "better category match"
        │
  Claude: prioritized action list, each action typed by who applies it
        │
  ┌─────┴──────────────┬───────────────────────┐
  auto-apply           Norr-applies            recommend-only
  (Norr-built sites)   (GBP, as Manager)       (needs the client)
  schema fixes, FAQ    description/services/   job photos, review asks
  blocks, new answer   Q&A edits, posts,       for specific job types,
  page, meta edits →   review responses →      license info, changes to
  commit + PR + tests  applied directly        a site we don't control
  + wrangler deploy    (API later; ~min/ea     → one SMS/email with the
                       manual now)             ask, tracked to done
        │
  Log every applied action to aeo_actions with its target query/pillar
        │
  Next month's battery shows whether the action moved its target
  → "what we changed → what it did" section in the scorecard
```

Key points:

- **Attribution, not checklists.** Actions are generated from *why a specific
  query was lost to a specific competitor*, not from a generic best-practices
  list. That's what makes month 6 different from month 1.
- **GBP needs no client friction.** Norr AI is a Manager on every profile
  (fixed policy from the 507 Air model), so description tweaks, service-list
  additions, Q&A seeding, and posts are Norr-applied — the owner only ever
  approves tone-sensitive items (review responses) if they want to.
- **Norr-built sites make website changes near-free.** A new FAQ block or
  answer page on a Cloudflare Worker site is a Claude-drafted commit → tests →
  deploy. External sites downgrade those actions to recommend-only — which is
  the site-rebuild upsell pressure, made visible in the scorecard.
- **Actions are accountable.** `aeo_actions` links each change to the query or
  pillar it targets; the next battery run scores it. Some won't move — that's
  fine and honest, and the trend is what's sold.

### How much is manual? (steady-state, per client per month)

| Work | Who | Automated? |
|---|---|---|
| Data pulls, scoring, query battery, scorecard build + delivery | System | Fully, from Phase 3 |
| Review request sends | System | Fully |
| Optimizer analysis + action drafting | System (Claude) | Fully |
| Review responses | Claude drafts → approval | Approval tap only |
| GBP edits/posts | Claude drafts → Egan applies as Manager | ~10 min/mo (API later: near-zero) |
| Website changes (Norr-built sites) | Claude commits → Egan reviews PR + deploys | ~10–15 min/mo |
| Citations | Egan, checklist | One-time + rare re-check |
| Reviewing the Optimizer's action list | Egan | ~10 min/mo — the real operator job |
| Photos, review asks, external-site changes | Client | Recommend-only, nudged + tracked |

Target: **≤30–45 min of operator time per client per month** at steady state.
Foundation builds and the citations first pass are project work by design;
owner approvals are a feature (their voice, their profile), not overhead.

---

## Packaging & Pricing

The audit is the wedge; the retainer is the business.

| Offer | Price | Contents |
|---|---|---|
| **AEO Audit** | $99 (free with booked discovery call) | Full scorecard + competitor gap + 20-query AI presence table. COGS: ~$2 API + <1 operator hour once tooling exists. Run it on a prospect *before* the discovery call — the unsolicited teardown is the pitch |
| **Foundation Build** | $750–1,500 one-time | Layer 2, scoped by whether GBP exists and whether Norr AI controls the site. Maps to existing setup-fee range |
| **AEO Starter retainer** | $500–600/mo | Review request automation + AI-drafted review responses + 2 GBP posts/mo + monthly scorecard. Fits the Starter tier as-is — standalone or bundled |
| **AEO Growth retainer** | $1,000–1,200/mo | Starter + 1 answer page/mo + competitor & citation monitoring + full query battery trending + quarterly strategy call |
| **Pro** | Existing Pro pricing | Multi-location, job-management integration (ServiceTitan/Jobber → auto review triggers), custom dashboard on tools.norrai.co |

**Sales language** (per the never-lead-with-technology rule):

- HVAC thinks in ticket value: one recovered furnace-replacement call is
  $6–12k. *"When someone asks their phone 'who should fix my furnace in
  Faribault' — are you the answer? Want me to show you what it says right now?"*
  (Live demo: run the query in front of them.)
- Construction thinks in project value and referral droughts: *"Your next
  $80k remodel client is asking ChatGPT for a shortlist. Let's find out if
  you're on it."*
- The monthly scorecard is retention: the number goes up, the client sees
  competitors they know by name, churn resistance is built in.

---

## Implementation

### Phased build

| Phase | Scope | Effort |
|---|---|---|
| **1. Manual-assisted audit** | Claude Code script (`scripts/aeo-audit/`?) that takes name/URL/place-id + competitor list, runs Places API + site parse + Gemini query battery, emits scores JSON + Polar Modern report HTML. Operator fills citations checklist by hand. **Sellable immediately** | Days |
| **2. Pilot** | Run on 507 Air (free) — real scorecard, before/after once the GBP verifies. Becomes the case-study artifact for every pitch | Hours + elapsed time |
| **3. n8n automation** | `aeo_query_battery` (monthly cron per client) + `aeo_monthly_report` (assemble scorecard, SendGrid delivery) + `aeo_review_response` (Places poll → Claude draft → owner approval) + `aeo_optimizer` (monthly diff → attribution → action list into `aeo_actions`). Register all in `n8n/README.md`; standard logging on all | 1–2 weeks part-time |
| **4. GBP API access** | Apply for Google Business Profile API under the Norr AI agency account once ≥2–3 managed profiles exist. Unlocks auto-posting and review auto-response | Elapsed/approval-gated |

### Neon schema additions (`db/schema.sql`)

```sql
CREATE TABLE aeo_audits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid REFERENCES clients(id),
  run_at        timestamptz NOT NULL DEFAULT now(),
  total_score   int,
  pillar_scores jsonb,   -- {gbp, reputation, website, citations, ai_presence}
  raw           jsonb,   -- full check results for the report
  report_url    text
);

CREATE TABLE aeo_queries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid REFERENCES clients(id),
  run_at           timestamptz NOT NULL DEFAULT now(),
  engine           text NOT NULL,        -- 'gemini_grounded' | 'perplexity' | ...
  query            text NOT NULL,
  client_mentioned boolean NOT NULL,
  mentioned_names  jsonb,                -- competitors named in the answer
  cited_urls       jsonb
);

CREATE TABLE aeo_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid REFERENCES clients(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  action_type   text NOT NULL,   -- 'auto_apply' | 'norr_applies' | 'recommend_only'
  surface       text NOT NULL,   -- 'website' | 'gbp' | 'citations' | 'client'
  description   text NOT NULL,
  target_query  text,            -- query battery question this targets, if any
  target_pillar text,            -- pillar this targets, if any
  status        text NOT NULL DEFAULT 'proposed',  -- proposed|applied|declined|done
  applied_at    timestamptz,
  outcome_note  text             -- filled after next battery run
);
```

Prospect audits need a `clients` row before signing — use a prospect-status row
(cheap, and converts cleanly if they sign) rather than a separate table.

### Workflow registry additions (`n8n/README.md`)

| Workflow | `workflow_name` |
|---|---|
| AEO Query Battery | `aeo_query_battery` |
| AEO Monthly Report | `aeo_monthly_report` |
| AEO Review Response Drafter | `aeo_review_response` |
| AEO Optimizer | `aeo_optimizer` |
| AEO Review Request | reuse/adapt `review_request` |

---

## Risks & Honest Caveats

- **No placement guarantees.** Sell measurement + best-practice execution +
  trend, never a ranking promise. The scorecard framing handles this.
- **Gemini grounding ≈ AI Overviews, not ==.** It's a defensible proxy sharing
  the same index and similar synthesis, but say "AI answer presence," not
  "your AI Overview ranking." Perplexity/ChatGPT spot-checks widen coverage.
- **GBP API approval friction.** Everything ships without it (manual posting,
  approval-loop responses); the API is an efficiency unlock, not a dependency.
- **Query battery noise.** AI answers are non-deterministic — run each query
  2–3× and score mention rate, trend over quarters, don't oversell single-month
  swings.
- **Client-owned websites we don't control** limit the website pillar to a
  snippet handoff — which doubles as the site-rebuild upsell (Cloudflare
  Worker pattern, ~$0 hosting marginal cost).

## Success Metrics

- Pilot: 507 Air baseline audit + 90-day delta (review count, GBP completeness,
  query-battery mentions)
- Sales: audits delivered/mo · audit → retainer conversion ≥25%
- Client outcome: query-battery mention rate up quarter-over-quarter · review
  velocity ≥4/mo · response rate ~100%
- Business: AEO retainer MRR; target 3 retainers inside 2 quarters of launch
