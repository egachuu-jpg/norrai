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

## RESOLVED (2026-10-19): why 507 doesn't rank for "HVAC near me"

**He is not missing — he ranks ~#12** for "hvac near me" from Faribault (checked on desktop). The phone
showing "nothing" was device personalization / local-pack display depth — Oscar's phone is an unreliable
test. This is a **ranking-position / prominence** problem, not filtering, classification, or a broken profile.

**Two earlier theories, both disproven — do not repeat them:**
- ~~"Category stuck / not propagated to the index"~~ — FALSE. The top-ranking competitors (Streitz 335 rev,
  K&M 233, Luiken's 458) all show `primaryType: general_contractor` in the Places API, **same as 507**. The
  Places API collapses all contractors into `general_contractor` and cannot see the real GBP category; it is
  **useless as a ranking proxy**. 507 ranking #12 proves he's fully in the HVAC pool.
- ~~"Filtered out / not classified"~~ — FALSE. He appears for "air conditioning service near me," "furnace
  repair near me," and "hvac in Skyline, MN." Discoverable and classified.

**Why he sits at #12 (and why reviews aren't the whole story):**
- **Prominence gap** vs entrenched incumbents (230–460 reviews) — can't crack the top-3 pack at 9 reviews / 4 months.
- **Service-area-business / hidden-address handicap (key).** Brian's Heating & Mechanical ranks *above* 507
  with only **4 reviews** (fewer than 507's 9) — because Brian's has a **visible Faribault street address**
  ("123 …, Faribault, MN 55021") giving a strong proximity anchor, while 507 hides its address as a SAB.
  Hidden-address SABs are structurally weaker in "near me" proximity ranking. (This is also why 507 never
  returns in Places text search.)
- **Thin/inconsistent citations + young profile** compound it.

**Levers to climb from #12 toward the pack:** reviews (biggest controllable), citation consistency + volume,
profile activity (posts/Q&A), time/age. The proximity/address handicap is largely **structural** — it only
changes if Oscar has a real, displayable Faribault business address (can't fake one; if it's his home, keep
it hidden). **Honest framing for Oscar:** he already ranks for the bread-and-butter terms (furnace/AC "near
me") — those are the near-term wins; climbing the "hvac near me" head term past 300+-review shops is a
6–12 month prominence build, not a settings fix.

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

## Citations / NAP pass — known discrepancies to fix (observed 2026-10-10)

GBP is the source of truth. Canonical NAP: name **507 Air Heating and Cooling** (GBP display;
brand/legal is "507 Air Heating & Cooling, LLC"), phone **(507) 491-3063**, **Faribault, MN**
service area (hidden street address), site **https://507air.com**. GBP category now public = HVAC contractor.

Priority order for the citations pass:

1. **Address exposure — HomeAdvisor shows a street address "17893 Alexander Ave" (Faribault).**
   GBP is a service-area business that deliberately hides the address. **Ask Oscar** whether that address
   should be public — if it's his private/home address, get it removed from HomeAdvisor. Higher priority
   than any name formatting.
2. **City mismatch — BBB lists the business under "Mankato, MN"** while GBP + site = Faribault. Correct BBB
   to Faribault (source of truth) unless Oscar genuinely operates from Mankato. City-level NAP mismatch
   matters more than punctuation.
3. **Name "&" vs "and" — LOW priority / cosmetic.** Website, BBB, HomeAdvisor use "507 Air Heating &
   Cooling"; GBP uses "...and Cooling". Search/AI normalize "&"↔"and", so this is not a real ranking risk.
   If perfecting: align GBP to "&" (it's the outlier) — but **don't stack a GBP name edit this week** while
   the category change is still propagating, and don't add "LLC" to the GBP name (Google discourages it).

### Citations checklist — completed 2026-10-19

| Directory | Listed | NAP match | Note |
|---|---|---|---|
| Google Business Profile | ✅ | ✅ | source of truth (scored under GBP pillar) |
| Bing Places | ❌ | — | create |
| Apple Maps | ❌ | — | create |
| Yelp | ❌ | — | create |
| Facebook | ❌ | — | create (no social pages yet) |
| BBB | ✅ | ❌ | city = Mankato (should be Faribault) |
| Angi / HomeAdvisor | ✅ | ❌ | address = 99 Laurinda Lane, Mankato MN 56001 |
| Nextdoor | ❌ | — | no business page (only an advertise prompt) |

Listed on 2 of 7 scored directories; 0 NAP matches. Punch list = create Bing/Apple/Yelp/Facebook/Nextdoor
listings, and fix the address/city on BBB + Angi.

### 🚩 Conflicting NAP across the web — top fix for Oscar

Three different identities are live:
- **GBP (truth):** Faribault, service-area business, hidden address.
- **HomeAdvisor + BBB:** **Mankato** — HomeAdvisor lists **99 Laurinda Lane, Mankato, MN 56001**.
- **Angi / BuildZoom (earlier search):** **17893 Alexander Ave, Faribault, MN 55021**.

Two different street addresses in two different cities. This is a stronger negative NAP signal than the
"&"/"and" name formatting. **Action:** Oscar picks one canonical address/city (matching GBP = Faribault)
and we correct every directory to it. Also a privacy question — two personal addresses are publicly exposed.

## Note on method

Places **Text Search** returned 0 results for 507 Air on all name variants, while Place **Details** by ID
returns full data and the dashboard confirms it appears on name search. Text Search under-represents
hidden-address service-area businesses — do not read a 0 there as "profile missing."
