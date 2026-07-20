# AEO Audit Engine — Operator Runbook

The audit engine scores a local service business's AI-search readiness across five pillars: Google Business Profile completeness, reputation, website quality, citation consistency, and AI-answer presence. Output: a Polar Modern scorecard (HTML) + raw audit data (JSON). Run before a discovery call (prospect) or monthly (retainer client).

---

## Prerequisites

- **Node.js ≥ 22** — the script uses no npm dependencies (built-in `fetch`, `node:fs` only; no `npm install` needed)
- **Env vars** in `.env` at the repo root:
  - `GOOGLE_PLACES_API_KEY` — from Google Cloud console; enable Places API (New) on your project
  - `GEMINI_API_KEY` — from aistudio.google.com
  - `PAGESPEED_API_KEY` (optional) — from Google Cloud console; if absent, PageSpeed checks are skipped

**Finding your API keys:**
- Places API: Google Cloud console → Select your project → APIs & Services → Enable Places API (New) → Create credentials (API key)
- Gemini API: Visit aistudio.google.com → Get API Key (found in left sidebar under "API keys")
- PageSpeed Insights: Google Cloud console → APIs & Services → Enable PageSpeed Insights API → use the same project API key

---

## Step-by-step: Running an Audit

### 1. Create a client config file

Start with the template:

```bash
cp scripts/aeo-audit/fixtures/sample-client.json my-client.json
```

Open `my-client.json` and fill in these fields:

| Field | What to fill in |
|-------|---|
| `business_name` | Full legal name (e.g., "507 Air Heating & Cooling") — no keywords stuffed |
| `name_variants` | Short aliases (e.g., ["507 Air"]) for competitor searches |
| `website` | Full URL (https://example.com) |
| `place_id` | Google Business Profile Place ID — see below. **Set to `null` if no GBP exists** |
| `vertical` | Service category: hvac, plumbing, electrical, construction, etc. |
| `services` | List of 3–6 core services the business offers (e.g., ["furnace repair", "AC installation"]) |
| `cities` | Top 4–5 service-area towns; used for the query battery |
| `competitor_search` | What to search on Google Places to find local competitors (e.g., "HVAC contractor Faribault MN") |
| `citations` | Array of 8 directory checks — filled in Step 2 below |

**Finding the Place ID:**

1. Go to the [Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id)
2. Search the business name (or if no profile exists, leave blank and set `place_id: null`)
3. Copy the Place ID string into the config

If the business has no Google Business Profile yet, **set `place_id: null`** — the report will flag this as the top finding.

### 2. Fill the citations array

The `citations` field is an array of 8 directory checks — operator-filled by hand. See **CITATIONS_CHECKLIST.md** for details and the lookup checklist.

The script will not run without at least an empty array (`"citations": []`), but an empty array means the citations pillar is marked "pending" in the report.

### 3. Run the audit

```bash
node scripts/aeo-audit/run.js --input my-client.json
```

**Output directory** (default): `scripts/aeo-audit/out/<slug>-<YYYY-MM-DD>/`

To override the output directory:

```bash
node scripts/aeo-audit/run.js --input my-client.json --out /path/to/out
```

Two files are generated:

- **`audit.json`** — raw scores + check results (for storage, trending)
- **`report.html`** — standalone Polar Modern scorecard (send via email or print to PDF; no external requests except fonts)

### 4. Send the report

The HTML file is complete and self-contained — share as-is or print to PDF. No setup needed on the recipient's end.

---

## Offline / Re-scoring Mode: `--from-raw`

To skip all API collectors and re-score data from a previous run:

```bash
node scripts/aeo-audit/run.js --input my-client.json --from-raw audit.json
```

This is useful for:
- Testing report layout changes without burning API quota
- Re-scoring with updated logic or fixed data
- Offline demos

The `--from-raw` file **must** be a previous `audit.json` from this engine (with the full `raw` object).

---

## API Cost

Roughly **$0.10–0.30 per audit**:

- **Places API** (~$0.05): business profile + top 3 competitors
- **Gemini query battery** (~$0.10–0.20): 20 queries × Gemini 2.5 Flash (grounded)
- **PageSpeed Insights** (free tier; optional paid if needed)

---

## What Each Pillar Checks

| Pillar | Max Points | What's scored |
|--------|-----------|---|
| **GBP completeness & activity** | 25 | Profile verified, correct category, ≥8 services, hours set, ≥10 photos (one in last 60d), post in last 30d, Q&A seeded |
| **Reputation** | 25 | Review count vs. competitors, avg rating ≥4.6, review velocity ≥4/month, response rate ~100% |
| **Website answerability** | 25 | LocalBusiness + Service + FAQPage schema, FAQ content, service+city pages, NAP match, entity signals, Core Web Vitals |
| **Citations & consistency** | 15 | NAP exact-match across 8 directories (Yelp, BBB, Angi, Nextdoor, Google, Bing, Apple, Facebook) |
| **AI answer presence** | 10 | Query battery result: how many of ~20 queries mention the business in the AI answer |

---

## Troubleshooting

### Missing or invalid API key

**Symptom:** A collector is skipped and the report shows "Pending — manual check" for that pillar.

**Why:** If `GOOGLE_PLACES_API_KEY` is missing, the GBP pillar is marked `assessed: false`. Same for Gemini (AI presence) and PageSpeed (website). Missing keys do **not** crash the audit — the engine degrades gracefully.

**Fix:** Add the missing key to `.env` and re-run.

### No Place ID found

**Symptom:** GBP pillar shows 0 points and a "no profile found" message.

**Expected:** If the business has no Google Business Profile, this is the finding itself — it's the #1 priority. The profile must exist before any other GBP work can start.

### AI answer presence is low or zero

**Symptom:** AI presence pillar shows the business appearing in 0–5 of 20 queries.

**Expected:** This is non-deterministic. Gemini's answer may vary between runs even with the same query. **Do not oversell a single audit run.** The value is in the trend:
- Run the query battery monthly
- Track mention rate month-over-month
- Share quarterly trends with the client (e.g., "mention rate improved from 15% to 35% in Q2")

### Report shows "Partial audit"

**Symptom:** Some pillars show "assessed: false" (pending).

**Why:** One or more API keys are missing, or the citations array is empty.

**Expected:** This is OK for a prospect audit before discovery. Fill in the missing pieces and re-run to get a complete score.

---

## After the Audit

The audit is the wedge — use it in discovery:

- **Prospect:** "Here's your current AI-search scorecard. Want to improve it?"
- **Retainer:** Run monthly, trend the score, make it a standing agenda item in calls.

For retainer clients, this audit becomes part of the **AEO Starter/Growth retainer**, which includes monthly re-runs + review automation + GBP edits + answer pages. See the PRD (`PRD/aeo-service.md`) for the full roadmap.
