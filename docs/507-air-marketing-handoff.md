# Handoff: 507 Air — GBP visibility investigation + marketing/AEO plan

Written 2026-10-09 from a cloud session. Branch: `claude/507-air-google-marketing-i0f46h`
(pushed; `git fetch origin claude/507-air-google-marketing-i0f46h` and check it out first).
This session had **no API keys, no `.env`, and no `node_modules`** — that is why the audit
hasn't actually run. The new session is expected to have the keys. Read `CLAUDE.md` first.

## Who / what

- **Egan** (owner of Norr AI) is working for **Oscar Salazar**, owner of 507 Air Heating & Cooling
  (Faribault, MN). Oscar's Google Business Profile (created ~June 2026, 7 five-star reviews)
  doesn't show up for "HVAC near me", "HVAC Faribault", or "HVAC Mankato". The profile's displayed
  location is **Skyline, MN**. Oscar also wants more marketing (only billboards now, weak results; no
  social pages yet).
- Egan has not run marketing/ads before and has **not asked for a quote yet** — still deciding what
  to offer. Do not draft a quote or pricing unless asked.
- Existing context: `client-sites/507-air/` (static site, own Worker), `client-sites/507-air/GBP_SETUP.md`
  (profile spec: service-area business, address hidden, Open 24 hours, 20 service-area towns,
  review short link `https://g.page/r/CS6mxtsUw3ujEBM/review`), `PRD/aeo-service.md`
  (the AEO service plan, 507 Air is the named pilot), `scripts/aeo-audit/` (audit engine; read its
  `README.md` and `CITATIONS_CHECKLIST.md`).

## What has been established (and how sure we are)

Research was web search only; sources were mostly SEO vendor blogs, not Google documentation.

- Google local ranking = relevance, distance, prominence. A 4-month-old profile with 7 reviews is
  most likely losing on **prominence** (reviews, citations, age) and **proximity**. Not proven for
  507 Air — nobody has looked at the dashboard or a rank grid yet.
- Service-area business with hidden address: the registered address is still the distance anchor, and
  hidden-address profiles are *reported* to rank somewhat weaker. Adding more towns does not fix it.
- **Do not suggest using a fake/unoperated Faribault or Mankato address** — suspension risk. A
  different primary location is only valid if Oscar genuinely operates there.
- **Unknown, must ask Oscar:** why Skyline is the displayed location (probably his private address
  used for verification — unconfirmed).
- Web search could not verify anything Google-specific: whether the profile appears on a name search,
  competitors' Google review counts, or his impressions. Those need a human with Google / the dashboard.
- Paid benchmarks found (vendor-sourced, treat as rough): Local Services Ads ~$25–85/lead and convert
  to booked jobs far better than Facebook leads (~40% vs ~12% per one source); Meta ~$20–60/lead.
  LSA eligibility needs licensing/insurance/background checks — Minnesota requirements **not verified**.

## Strategy conclusions reached with Egan (ranked)

1. Finish the GBP investigation (checklist below).
2. Review-request automation + missed-call → SMS text-back (profile claims 24/7, so unanswered calls
   are a reputational risk). Ask **every** customer for a review — no review gating.
3. Local Services Ads (new channel for Egan; keep paid work to one channel at first).
4. Past-customer campaigns — **only if Oscar has a usable customer list** (business is young; ask).
5. Light AEO: `sameAs` + a small hand-reviewed FAQ. **Rejected:** bulk programmatic city×issue page
   generation (scaled-content spam risk), unreviewed LLM text on the site, paid citation-sync tools
   for one client, consumer cold SMS (TCPA), scraping Nextdoor/Facebook groups (ToS), an AI voice
   receptionist as a first move. Cold *email* to B2B referral sources (property managers, builders,
   agents, inspectors) is fine (CAN-SPAM).
6. Social / video last.
- Another AI's AEO plan claimed "AEO is instant vs 6–12 months for SEO" and "conflicting NAP makes
  ChatGPT refuse to recommend you" — treat both as unproven; don't repeat them to Oscar.
- Conflict to respect: `GBP_SETUP.md` §4 records Oscar's decision (2026-08-06) of **no after-hours /
  emergency-rate language anywhere public**. Do not write campaign copy that mentions emergency rates.

## Work done and committed on the branch

- `scripts/aeo-audit/clients/507-air.json` — audit input. `place_id` is **null** and `citations` is `[]`.
- `docs/507-air-aeo-schema-draft.md` — proposed `HVACBusiness` schema (adds `@id`, `url`, `logo`,
  `image`, `description`, `sameAs`, `hasOfferCatalog`) and a 7-question visible FAQ + matching
  `FAQPage` JSON-LD, built only from facts already on the site/GBP packet. **Not applied to the site.**
  `sameAs` currently holds Oscar's GBP share link `https://share.google/v0nK6iGUhTkTlm5av`, which
  could **not be resolved** from the cloud environment (403 / DNS) — verify it opens the right profile.
- The live site (`client-sites/507-air/*`) is unchanged. A test run of the audit engine in the cloud
  scored 0/100 only because every collector was skipped; that output was deleted and means nothing.

## Next steps for the new session (in order)

1. `npm install` (Playwright wasn't installed; `npm test` was never run here). Confirm `.env` has
   `GOOGLE_PLACES_API_KEY`, `GEMINI_API_KEY` (and optionally `PAGESPEED_API_KEY`).
2. **Get the Place ID** and set it in `scripts/aeo-audit/clients/507-air.json`. With the Places API
   key you can resolve it via Text Search ("507 Air Heating & Cooling Faribault MN") or from the share
   link. **Do not run the audit with `place_id: null`** — the engine then reports "no Google profile
   exists" as the top finding, which is false. Also record the canonical `google.com/maps/place/...` URL
   if obtainable (a slightly better `sameAs` value than the `share.google` short link).
3. With the Place ID, pull Place Details for 507 Air (rating, review count, status, hours, photos,
   categories, address as Google sees it) and the **top competitors** for "HVAC contractor Faribault MN"
   and "HVAC contractor Mankato MN" (review count, rating, address). This answers "how big is the review
   gap" with real data.
4. Egan fills the 8-directory citations checklist (≈30 min, by hand); put the result in `citations`.
5. Run `node scripts/aeo-audit/run.js --input scripts/aeo-audit/clients/507-air.json`; review the
   scorecard in `scripts/aeo-audit/out/` (don't commit generated output unless Egan wants it; check
   `.gitignore`). Summarize findings for Egan.
6. After Egan and Oscar approve the wording: apply the schema + FAQ from the draft to
   `client-sites/507-air/index.html` (or a new `faq.html`), keeping `openingHours: "Mo-Su 00:00-23:59"`
   and all existing assertions intact. Add the tests listed in the draft (§4) to
   `tests/507air_site.spec.js` **first/alongside**; run `npm test` before pushing (CLAUDE.md rule).
   `sameAs` must contain only real, working URLs — never a placeholder (see lessons-learned).
7. If Egan wants it: build the review-request and missed-call-text-back n8n workflows. They must follow
   the **Workflow Logging Standard** in `CLAUDE.md` (Lookup Client, Log Triggered/Completed, Error
   Workflow = `Norr AI Workflow Error Logger`; hardcode a client id only after confirming 507 Air's row
   in Neon `clients` — the B&B id in CLAUDE.md is not 507 Air's). Run the `n8n-audit` skill afterward.

## Human-only items (Egan / Oscar, can't be automated)

Per-phase checklist from the session — all still open:

- **Phase 1 health:** search the exact business name with no location; confirm profile is Verified,
  no suspension or "edits pending" banner (hours changed to 24/7 on 2026-08-04 may have triggered
  re-review); confirm Egan is a Manager; search the phone (507) 491-3063 for duplicate listings.
- **Phase 2 what Google has:** dashboard → Performance impressions and the search terms list (best
  evidence of whether it shows anywhere); confirm which address verification used and why Skyline
  displays; confirm service-area-business setting and the service-area list.
- **Phase 3 quality:** primary category "HVAC contractor" + secondaries per `GBP_SETUP.md` §3; exact
  business name; hours Open 24/7; `507air.com` actually resolves (README says the domain was pending
  ICANN email verification); site/profile phone + name match; photo count.
- **Phase 4 measure:** rank grid (BrightLocal / Local Falcon) for "HVAC", "furnace repair", "AC repair"
  across Faribault and Mankato; compare searches from different spots/incognito (Oscar's own phone is
  personalized and unreliable); competitor review counts.
- **Phase 5 decide:** not on name search → verification/suspension; shows but few impressions →
  relevance/prominence; competitors dominate near a visible pin → mostly proximity, so reviews + LSAs.
- **Ask Oscar:** size/quality of his past-customer list; license, insurance, certifications (strong
  entity signals; none are on the site, none were invented); LSA eligibility; confirm the town list.

## Cautions

- `client-sites/507-air/wrangler.jsonc` sets `assets.directory: "."`, so files in that folder
  (`GBP_SETUP.md`, `README.md`, which contain Oscar's email and internal notes) are probably
  publicly fetchable at `507air.com/<file>`. **Unconfirmed** — curl it to check. If true, move those
  files out or add an ignore. Egan has not yet decided to fix this.
- Don't put the share link, API keys, or anything credential-like into committed docs beyond what's
  here (the share link is public by design).
- Don't state AEO or ranking outcomes as promises to Oscar (PRD non-goal).
- CLAUDE.md session wrap-up ("donezo") also updates Neon `tasks`/`stories`; none were created for
  this work yet.
