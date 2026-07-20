# AEO Audit Engine — Interface Contract

This file pins the interfaces between the audit engine's parts so they can be
built independently. **Source of truth for design intent: `PRD/aeo-service.md`**
(pillar weights, check lists, query battery matrix). If this contract and the
PRD disagree on a data shape, this contract wins; on scoring semantics, the PRD
wins.

## Ground rules

- Node.js ≥ 22, **zero npm dependencies** — built-in `fetch`, `node:fs`,
  `node:test`, `node:util.parseArgs` only. Do not touch the root
  `package.json`.
- All pure logic (scoring, parsing, rendering) must work offline from fixtures.
  Network happens only in `lib/collect/*` collectors.
- Unit tests live in `scripts/aeo-audit/test/` and run with
  `node --test scripts/aeo-audit/test/`. They must not hit the network.
- Env vars (read from `process.env`; a `.env` at repo root may be parsed with a
  tiny built-in-only loader): `GOOGLE_PLACES_API_KEY`, `GEMINI_API_KEY`,
  optional `PAGESPEED_API_KEY`.

## File layout & ownership

```
scripts/aeo-audit/
  CONTRACT.md                          # this file (frozen)
  README.md                            # operator runbook        [docs task]
  CITATIONS_CHECKLIST.md               # manual pillar checklist [docs task]
  run.js                               # CLI entry               [engine task]
  lib/
    collect/places.js                  # Places API collectors   [engine task]
    collect/site.js                    # website fetch + parse   [engine task]
    collect/pagespeed.js               # PSI API                 [engine task]
    collect/battery.js                 # Gemini query battery    [engine task]
    scoring.js                         # pure: raw → scores      [engine task]
    report.js                          # pure: result → HTML     [report task]
  fixtures/
    sample-audit-result.json           # canonical result fixture (frozen)
    *.json / *.html                    # additional fixtures as needed
  test/                                # node:test specs
  out/                                 # generated output (gitignored)
```

## CLI

```
node scripts/aeo-audit/run.js --input <client.json> [--out <dir>] [--from-raw <raw.json>]
```

- Default `--out`: `scripts/aeo-audit/out/<slug>-<YYYY-MM-DD>/`
- Writes `audit.json` (the audit-result shape below) and `report.html`
  (via `renderReport`).
- `--from-raw` skips all collectors and scores a previously saved
  `raw` object — this is the offline/test path.
- Missing API key ⇒ skip that collector, mark affected checks
  `"assessed": false`, keep going. Never crash on a partial run.

## Input: client config JSON

```json
{
  "business_name": "507 Air Heating & Cooling",
  "name_variants": ["507 Air"],
  "website": "https://507air.com",
  "place_id": null,
  "vertical": "hvac",
  "services": ["furnace repair", "AC installation", "water heater repair"],
  "cities": ["Faribault", "Northfield", "Owatonna", "Lakeville"],
  "competitor_search": "HVAC contractor Faribault MN",
  "citations": [
    { "directory": "Yelp", "listed": true, "nap_match": false, "url": "" }
  ]
}
```

- `place_id: null` ⇒ GBP checks not assessed (business may have no profile —
  that itself is reported as the top finding).
- `citations` is operator-filled (see CITATIONS_CHECKLIST.md). Absent/empty ⇒
  citations pillar `"assessed": false`.

## Output: audit-result JSON

Canonical example: `fixtures/sample-audit-result.json`. Shape:

```json
{
  "meta": {
    "business_name": "…", "client_id": null, "website": "…",
    "place_id": "…", "vertical": "hvac",
    "generated_at": "ISO-8601", "engine_version": "1.0.0",
    "partial": false, "skipped_collectors": []
  },
  "scores": {
    "total": 31,
    "pillars": {
      "gbp":         { "score": 9,  "max": 25, "assessed": true,  "checks": [] },
      "reputation":  { "score": 8,  "max": 25, "assessed": true,  "checks": [] },
      "website":     { "score": 12, "max": 25, "assessed": true,  "checks": [] },
      "citations":   { "score": 0,  "max": 15, "assessed": false, "checks": [] },
      "ai_presence": { "score": 2,  "max": 10, "assessed": true,  "checks": [] }
    }
  },
  "competitors": [
    { "name": "…", "place_id": "…", "rating": 4.8, "review_count": 212 }
  ],
  "battery": {
    "run_at": "ISO-8601", "engine": "gemini_grounded",
    "mention_rate": 0.17,
    "queries": [
      {
        "query": "best furnace repair near Faribault MN",
        "service": "furnace repair", "city": "Faribault", "intent": "best_near_me",
        "client_mentioned": false,
        "mentioned_names": ["Competitor A"], "cited_urls": ["https://…"],
        "answer_summary": "1–2 sentence summary of what the engine answered"
      }
    ]
  },
  "raw": { "places": {}, "site": {}, "pagespeed": {}, "citations": [] }
}
```

Each entry in a pillar's `checks`:

```json
{ "id": "gbp_photos", "label": "≥10 photos, one in last 60 days",
  "points": 0, "max_points": 3, "assessed": true,
  "value": "4 photos, newest 210d", "note": "optional detail" }
```

- Pillar `score` = sum of its checks' `points`; `total` = sum of pillar
  scores (unassessed pillars contribute 0 — do not renormalize; the report
  labels them "pending").
- Check ids are stable snake_case strings prefixed by pillar
  (`gbp_`, `rep_`, `web_`, `cit_`, `ai_`). Weights per pillar follow the PRD
  table (25/25/25/15/10); check-level point splits are the engine's choice but
  must sum to the pillar max.
- `battery.intent` ∈ `best_near_me | who_to_call | cost | emergency`.

## Report renderer

`lib/report.js` must export:

```js
/** @param {object} auditResult  audit-result JSON (shape above)
 *  @returns {string} complete standalone HTML document */
function renderReport(auditResult)
module.exports = { renderReport };
```

- Standalone single-file HTML, no external requests except Google Fonts
  (Inter / Inter Tight / JetBrains Mono, as existing pages do).
- Polar Modern design system — copy the full `:root` token block from
  `website/css/norrai.css` (per project CLAUDE.md, no partial copies).
- Must render sensibly when a pillar has `"assessed": false` (show
  "Pending — manual check" instead of a score) and when `battery.queries` is
  empty.
- Renders: total score, per-pillar bars, per-check pass/fail detail, the
  query battery table (the sales centerpiece — competitor names visible),
  competitor comparison, and a prioritized "top fixes" list derived from
  failed checks ordered by `max_points - points`.
