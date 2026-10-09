# 507 Air — AEO audit + GBP findings (2026-10-09)

First audit run with live data. Supersedes the "profile may be suspended" theory in
`507-air-marketing-handoff.md`. **The profile is healthy but low-visibility — a discovery
problem, not a broken-profile problem.**

## Identity (resolved)

- **Place ID:** `ChIJdQvfzOyWCSYRLqbG2xTDe6M` (resolved from the `g.page/r/CS6mxtsUw3ujEBM/review`
  short link → `search.google.com/local/writereview?placeid=...`). Now set in
  `scripts/aeo-audit/clients/507-air.json`.
- **Canonical Maps URL:** `https://www.google.com/maps/place/?q=place_id:ChIJdQvfzOyWCSYRLqbG2xTDe6M`
  (also `https://maps.google.com/?cid=11780223744671655470`). Both verified to resolve. Used as the
  site's `sameAs`.

## GBP state (Place Details API + owner's dashboard read, 2026-10-09)

- `businessStatus: OPERATIONAL`, verified, managed. Appears on name search. **Not suspended.**
- 5.0 rating, **8 reviews**, 10 photos, hours = Open 24/7, phone `(507) 491-3063`, website `507air.com`.
- Service-area business, no location. **Skyline is a service-area entry, not an address** — mystery closed.
- 🚩 **Primary category = "General Contractor," not "HVAC Contractor."**
- Dashboard: **324 views / 32 interactions (4 calls, 28 website clicks) since July, trending down.**
  Top search terms (each <15 impressions): "507", "ac repair", "general contractor in faribault,
  minnesota", "mobile home repair hvac cottage grove", "who owns 507 air heating and cooling in faribault".

### Interpretation

- The **category is the smoking gun**: "general contractor in faribault" is a live top term — Google is
  sending him general-contractor intent, not HVAC. Discovery is being spent on the wrong category.
- Visibility is **almost entirely branded / billboard-driven** ("507", "who owns 507 air…"). That decays,
  which explains the downward trend; there's little organic HVAC discovery underneath.
- Conversion is fine (~10% of views interact). The gap is **top-of-funnel discovery**, not the offer/site.

## AEO audit scorecard — 29/100 (partial: PageSpeed skipped, citations not yet filled)

Output: `scripts/aeo-audit/out/507-air-heating-cooling-2026-10-09/` (gitignored).

| Pillar | Score | Notes |
|---|---|---|
| GBP | 8/25 | ✅ operational, hours, 10 photos · ❌ wrong primary category · services/posts/Q&A need dashboard |
| Reputation | 5/25 | ✅ 5.0 rating · ❌ 8 reviews vs competitor median 452 · velocity/responses need GBP API |
| Website | 14/25 | ✅ HVACBusiness schema, 5/5 city pages, NAP match · ❌ no FAQ/FAQPage (now fixed) · missing license signal |
| Citations | 0/15 | Not assessed — fill the 8-directory checklist, then re-run |
| AI presence | 2/10 | Mentioned in 3/20 Gemini queries (15%) |

**Competitors** (Places Text Search, "HVAC contractor Faribault MN", top 3 by reviews):
Connors Plumbing/Heating/Air (1608, 4.9★), Luiken's Mechanical (452, 4.9★), Streitz Heating & Cooling (330, 5★).

## Action order (by leverage)

1. **GBP primary category → HVAC Contractor** (Oscar, dashboard, free, same-day). Keep furnace/AC/heating
   as secondaries.
2. Add GBP Services (≥8), attributes, weekly posts, seed Q&A — counter the downward view trend.
3. **Reviews:** review-request automation, ask every customer (scoped in `507-air-n8n-workflows-scope.md`).
4. Website FAQ + FAQPage schema — **applied** to `index.html` this session.
5. Fill citations checklist → re-run audit for the full 15 pts.
6. Add license #/certifications to the site (missing entity signal) once Oscar provides them.

## Note on method

Places **Text Search** returned 0 results for 507 Air on all name variants, while Place **Details** by ID
returns full data and the dashboard confirms it appears on name search. Text Search under-represents
hidden-address service-area businesses — do not read a 0 there as "profile missing."
