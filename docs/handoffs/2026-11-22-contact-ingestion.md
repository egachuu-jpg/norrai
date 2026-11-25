# Handoff — Contact ingestion for Evan Knutson (Weichert) + mailing labels

**Date:** 2026-11-22 · **Branch:** `claude/ecstatic-euler-vyqrh5` (pushed, not merged, no PR)
**Client:** Evan Knutson, Weichert Realtors – Heartland – Faribault · Neon `clients.id` per `obsidian/clients/evan-knutson-weichert.md` = `ded234e3-1c78-45c3-8924-6036e1fcaf60` (**verify against `SELECT id, business_name FROM clients` before any `--apply`**)

## Goal

Evan mails letters/flyers to past clients and to rural homeowners (Rice, Steele, Goodhue, Le Sueur counties) and spends hours hand-writing addresses and stamping. Build: (1) a clean, deduped **past-client list** in Neon, (2) a **label PDF tool** (Avery sheets), (3) later: prospect lists of farmsteads/acreages and handwriting-style labels. The client-facing open house flyer work is a separate thread (see "Other open items").

## Hard rules for this work

- **Client data never goes in the repo.** Keep exports in `~/norrai-data/` (outside the checkout) or the git-ignored `/data/` / `clients_out/`. `.gitignore` now blocks those, but check `git status` before every commit.
- Dry run first; `--apply` only after the counts look right.
- Do not mail anything from unverified data (see "Address trust").
- Tests: `npm test` must pass before pushing (CLAUDE.md). Playwright covers HTML only; the Python scripts below have no automated tests — they were verified by hand against a throwaway Postgres.

## What is done (all pushed)

| Commit | What |
|---|---|
| `f779a99` | `scripts/clean_contacts.py` — merges a Back Agent transaction CSV + a contacts export into households |
| `7ff459b` | `contacts` + `contact_transactions` tables in `db/schema.sql`; `scripts/load_contacts.py` |
| `dbf6685` | `db/migrations/007_contacts.sql` (standalone, idempotent); `scripts/make_labels.py` |
| (this commit) | `scripts/backagent_scrape.console.js`, this doc, `.gitignore` guard |

Design decisions already made with Egan:
- Table named **`contacts`** (not `past_clients`) because active clients will arrive from BrokerSumo. Flat table in the existing schema, scoped by `client_id`, like `leads`. Norr AI's own would be `norrai_contacts`.
- `stage` = `past_client | active_client | sphere | prospect`. One row per **household**; deals live in `contact_transactions`.
- Loader never overwrites `stage`, opt-outs/`do_not_mail`, or addresses marked `verified`/`undeliverable` on re-run.

## NOT done yet — in order

1. **Apply the migration to Neon** (could not be done from the cloud session — no DB access there):
   ```bash
   set -a; . ./.env; set +a
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/007_contacts.sql
   ```
   Do **not** run all of `db/schema.sql` against the live DB — older tables use plain `CREATE TABLE` and will error. (Neon MCP `run_sql` is one statement per call; use psql for the migration.)
2. **Get the inputs on your machine** (originals are in Egan's Downloads; the cloud copies are gone with that session):
   - Back Agent transactions CSV (437 rows, closings 2016-04 → 2023-12). If missing, re-scrape with `scripts/backagent_scrape.console.js` (instructions in its header).
   - Contacts export (`...Contacts-....xlsx`, 923 rows, vCard-style).
3. **Rebuild the cleaned files:**
   ```bash
   pip install "psycopg[binary]" reportlab openpyxl
   python3 scripts/clean_contacts.py --transactions ~/norrai-data/backagent_transactions.csv \
     --contacts ~/norrai-data/contacts.xlsx --out ~/norrai-data/out --office-street "1801 Green"
   ```
   Expected (from the cloud run): 437 deals → **322 households**; 191 `buyer_property`, 131 `needs_lookup`; 250 exact + 29 probable contact matches; 484 contacts left over. If your numbers differ materially, stop and investigate.
4. **Load (dry run, then apply):**
   ```bash
   python3 scripts/load_contacts.py --client-id <evan uuid> \
     --households ~/norrai-data/out/households.csv --transactions ~/norrai-data/out/transactions_clean.csv \
     --unmatched ~/norrai-data/out/contacts_unmatched.csv          # dry run (rolls back, prints counts)
   # same command + --apply  → expect 806 contacts (322 past_client + 484 sphere), 437 transactions
   ```
   Re-running should insert 0 and update everything.
5. **Spot-check in Neon:** `SELECT stage, address_status, count(*) FROM contacts GROUP BY 1,2;` and confirm no household has `deal_count` ≠ its `contact_transactions` rows.
6. **Print a test sheet** on plain paper: `python3 scripts/make_labels.py --csv ~/norrai-data/out/households.csv --test-grid -o grid.pdf`, hold it against a real Avery 5160 sheet to a light. Template geometry (5160/8160/5161/5162/5163) is from the Avery spec and verified only on screen.
7. **BrokerSumo pull** (below), then re-run steps 3–5 with both sources combined.
8. **Address verification** (below) before Evan mails anything.

## Address trust — read before mailing

Labels use the **home the client bought** as the mailing address. That is only a guess:
- `needs_lookup` (131 households): sellers/landlords — they moved; no current address in either source. Not printed.
- `buyer_property` (191): 130 closed >5 years ago and may have moved. Flagged `purchase_5plus_years_ago_may_have_moved`.
- 32 have no ZIP (city isn't in the single-ZIP defaults); 133 got a **city-default ZIP** placeholder (`zip_is_city_default_validate_with_usps`); 12 were truncated by the source (`…`).
- `make_labels.py` skips unmailable rows and writes `<output>.skipped.csv` with reasons. Current real result: **151 printable of 322 (6 sheets)**.

Planned verification, in order of value:
1. **USPS address validation + NCOA** (change-of-address) via a mail house or list tool — standard, cheap per list. Marks `verified`/`undeliverable` (set `address_status`, `address_verified_at`).
2. **County owner records:** for buyers, confirm the current parcel owner matches the client. **Unconfirmed** whether Rice/Steele/Goodhue/Le Sueur publish owner names openly. Findings so far: Rice County has a free parcel layer on the MN Geospatial Commons (`gisdata.mn.gov`, which now redirects to `gis.data.mn.gov`); a statewide compilation lists owner/taxpayer name fields, but it's unverified that they're populated, and nothing was confirmed for the other three counties. The cloud session's network blocked these hosts (an environment named `norrai` was created allowing `gisdata.mn.gov`, `mn.gov`, `gis.data.mn.gov`; it can be removed in settings). From a normal machine just open the dataset pages and check the field list/licensing.
3. **Evan reviews the sellers** (~215 rows) — he likely knows where many went.

## BrokerSumo (the current transaction system) — how to pull it

**Why:** Back Agent is the *old* system and our export stops at 2023-12. The 2026 "Production" report pulled from the newer system showed all zeros (and has only commission totals — no client names or addresses, so useless for this). Evan's 2024+ closings and any **active** clients are in BrokerSumo. That's also where `active_client` rows will come from.

**What is known (limited — from web search, no vendor docs found):**
- BrokerSumo is a back-office / commission / accounting platform for brokerages; now sold as **CORE BackOffice** (CoreLogic). Confirm the current product name before searching docs.
- Third-party listings say it has an **Open API** and an Integration Marketplace; **no public endpoints/auth docs were found.** It also syncs transactions from dotloop.
- **Back Agent** is now **Propertybase Back Office**; no public API found either. Weichert offices control integrations at the brokerage level (same situation as BoldTrail webhooks — see lessons-learned).

**Approach, cheapest first:**
1. **Built-in export.** In BrokerSumo look under Transactions / Reports for a closed-transactions or contacts export (CSV/Excel). Ask the office admin if Evan's login can't see it. Needed fields: client name(s), **side** (buyer/seller), closing date, property address (street, city, state, ZIP), status (open/pending/closed/terminated), and ideally client email/phone. A report that shows only commissions won't work (that's what the Production report was).
2. **Ask for API access.** Email the brokerage admin / BrokerSumo rep: "Evan Knutson wants his own closed + open transaction data with client names via the API or a scheduled export." Ask for docs, auth method, rate limits, and whether it's per-agent or office-wide. If an API exists, prefer it (and write an n8n workflow that upserts into `contacts` so active clients stay current).
3. **Browser scrape (fallback, worked for Back Agent).** Pattern that worked: open the list while signed in, DevTools → Console, run a script that **fetches each `?page=N` URL with the logged-in cookies, parses the rows, and downloads a CSV**. Steps used:
   - First a diagnostic snippet that prints only element counts/class names/structure (text replaced by lengths) to learn the markup without exposing client data: check `<table>` count, iframes, `[role=row]`, repeating row classes, pagination `<a href>` patterns.
   - Then adapt `scripts/backagent_scrape.console.js` (row selector, pagination, field selectors).
   - Gotchas hit: no `<table>` (rows were `<div class="TransactionListingContainer">`); no "Next" text (pagination was plain `?page=N` URLs, so fetching beats clicking); long runs lose the user-gesture so **auto-download is blocked — render a visible Download button**, and keep `window.__csv` as a `copy(__csv)` backup; paste the whole script including the final `})();`.
   - Be polite (≈1 request / 0.5 s), single user session, only the agent's own data, and don't reload the tab before saving. Check the brokerage/vendor terms; this is Evan's own data in his own session, but prefer (1)/(2) if available.
4. Don't use the Production/commission report for contacts.

**Mapping BrokerSumo output into the pipeline.** `clean_contacts.py` expects a transactions CSV with these columns (see `read_table`/the `txs` build): `side` (Buyer/Seller/Landlord/Tenant), `display_name` (address as `street, city, ST[ ZIP]`), `client` (e.g. `Jane Doe`, `John & Jane Doe`, `David & Jenny Campbell`), `closing` (a string containing `Mon DD, YYYY`), `started`, `phase`, `agent`, `detail_url` (unique per deal — used as the idempotency key). Either make the BrokerSumo export match, or add a small mapping step.

**Code changes needed to combine both systems (not yet written):**
- `clean_contacts.py` takes **one** transactions CSV. Add `--transactions` as repeatable, or concatenate and add a `source_system` column, so the same household appearing in both systems **merges into one household** (it already merges across deals by name).
- `load_contacts.py` hardcodes `source="back_agent"` for households and transactions, and `source_key` is a hash of the household's names. If you load Back Agent and BrokerSumo as separate sources, the same family becomes **two rows**. Use a single household source (e.g. `deal_history`) and keep the per-deal `source`/`source_ref` for transactions.
- **Stage:** the cleaner currently marks everyone `past_client`. For BrokerSumo, derive `active_client` from open/pending status and `past_client` from closed. Existing rows keep their stage on re-load by design, so a client who becomes active needs an explicit `UPDATE` (or change that rule).
- Decide on **terminated** deals (5 in Back Agent, phase `Termination`): currently included as past clients; probably should be excluded or tagged.
- Re-run the dry-run after any of this; compare counts to the cloud-run numbers above.

## Other contact data already in the repo (read this)

`docs/clients/evan_contacts_combined.csv` (372 rows) and `michelle_contacts_combined.csv` (522) are **BoldTrail lead exports** (ratings, preferred city, etc.), **committed to the repo**. They have city/state/ZIP only — **no street addresses**, so they can't feed labels — and they contain emails, **IP addresses and device fingerprints**. Not touched by this work. Worth deciding separately whether they should be in git, and whether the 7 Weichert workflows' Google Sheet (birthday/anniversary) should now read from `contacts` instead.

## Known limitations of the scripts

- `clean_contacts.py`: nickname matching is a small hand list; surname-only matches are flagged `probable`, never auto-merged. ~40 surnames appear in >1 household — some may be spouses listed separately; a pass merging households that share a mailing address is a worthwhile TODO. Single-ZIP defaults exist only for Faribault, Owatonna, Northfield, Kenyon, Waterville, Medford, Morristown, Cannon Falls, Waseca.
- `load_contacts.py`: needs `DATABASE_URL`; opt-out flags default false (no DNC data exists yet for these people).
- `make_labels.py`: only Helvetica by default; `--font` accepts a TTF (handwriting idea). Characters outside Latin-1 are accent-stripped. Names/addresses that can't fit at ≥8 pt are **skipped and listed**, never clipped.
- **PII is stored plaintext** in `contacts`, same as `leads` today. `db/migrations/002_pii_encryption.sql` adds encrypted shadow columns for `leads`/`appointments`/`clients` but the plaintext was never dropped and `contacts` has no shadow columns. Egan to decide.

## Later (from the original ask)

- **Prospect lists:** farmsteads/acreages in Rice, Steele, Goodhue, Le Sueur. Use county parcel data (owner, mailing address, class, acreage, homestead, tenure), not scraping Zillow-type sites (ToS, no owner mailing addresses). Paid fallback: PropStream / BatchData / ATTOM. Load as `stage='prospect'`.
- **Handwriting labels:** `--font` with a handwriting TTF made from a sample of Evan's writing (Calligraphr etc.); or a pen-robot print-and-mail service (Handwrytten, Lob), which would also remove stamps/envelopes (~$1+/piece) — likely a Growth-tier upsell.
- **Pricing:** label/mailing work is probably a Growth add-on, not part of Evan's Starter plan.

## Other open items from this session (not contact-related)

- **Open house flyer + home-screen app** (commit `b30c263`): requires **importing the updated `n8n/workflows/Real Estate Open House Setup.json` into n8n** (it now returns `signin_url` via Respond to Webhook and 403s bad tokens). Until then the page falls back to the old emailed-QR message. Also: lengthen the Cloudflare Access session for `/clients/*` (dashboard action; not done), test the installed home-screen app on a real iPhone (does it keep `agent_token`?), and note both Weichert guides now link to `weichert_open_house_setup.html` (turns on the "make an offer" option on the sign-in page).
- **`npm test`:** in the cloud sandbox 83 tests failed — **identically on a clean checkout without these changes** (likely blocked fonts/CDNs). Run the full suite on a normal machine before merging. The new `tests/weichert_open_house_setup.spec.js` passes (32/32).
- The Open House Setup workflow still lacks the standard `workflow_events` logging nodes (CLAUDE.md § Workflow Logging Standard) — pre-existing, not addressed.
- No PR has been opened.
