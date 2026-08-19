# Weichert Weekly Marketing Drip — Automated New-Listings Pull

**Date:** 2026-08-18
**Client:** Weichert, Realtors® — Heartland (Evan Knutson + Michelle Jasinski)
**Neon story:** Weichert Realty — Weekly Marketing Drip (task seq 16)
**Related:** `obsidian/PRDs/2026-05-22-weekly-marketing-drip.md` (original build), `docs/workflows-built.md` § Weekly Marketing Drip

## Problem

The Weekly Marketing Drip ships listings agents manually curate: an agent fills
`weichert_weekly_listings_form.html` with up to 10 listing URLs, which lands in
`listing_queue`; every Monday 9am CT the `Weekly Marketing Drip - Send` workflow
(n8n `wSXuvtUorzoLmktv`, **currently active** — `docs/workflows-built.md` calling it
"inactive pending go-live" is stale) reads the latest queued row, scrapes each URL's
`og:image`, and blasts the built email to both agents' full lead lists.

That means the email only goes out when someone remembers to fill the form. The goal
is to remove the human step: scrape Weichert's own listing inventory directly, detect
what's newly listed, and drive the same downstream send off that — no queue, no form.

## Data source (researched 2026-08-18)

The individual-listing `og:image` trick only worked because agents supplied specific,
already-known URLs on `northstar.weichert.com`, which is unprotected. There is no
equivalent "browse new listings" page on that domain — `northstar.weichert.com/MN/Faribault/`
is a regional MLS broker-reciprocity search covering a ~50mi radius and **every**
brokerage (RE/MAX, EXIT Realty, Coldwell Banker, etc.), not Weichert's own inventory.

The correct source is the Heartland office's own IDX site:

```
https://www.teamyellownow.com/index.php?showagency=1#rslt
```

Confirmed by browsing it: 103 results, labeled "Our Listings", every card branded
"Weichert, REALTORS- Heartland" (office-wide, not per-agent — matches today's shared-content
model where both agents' emails feature the same listings). It sorts by "Days on Website"
by default, newest first, with a "Just Listed" badge on the newest cards — exactly the
signal needed, no date-math required.

**This domain is Cloudflare-protected.** `curl` (any UA) gets `403` with
`cf-mitigated: challenge` — the existing plain `HTTP Request` node pattern will not
reach it. A real/headless browser is required. The project already has an Apify
account (from the original PRD's research task); a browser-based actor (Puppeteer/Playwright
Scraper style, Apify Proxy) is the intended fetch mechanism.

**Photos do not need a second protected fetch.** Each card's thumbnail image resolves to
a plain, unprotected CloudFront URL:
```
https://d36xftgacqn2p.cloudfront.net/listingphotos133/thumbnails/{mls_id}-1.jpg   (9.5KB thumbnail)
https://d36xftgacqn2p.cloudfront.net/listingphotos133/{mls_id}-1.jpg              (403KB full-res)
```
Dropping the `thumbnails/` path segment gives the full-res image — confirmed both URLs
return `200` via plain `curl`. So one Apify run against the `showagency=1` listing page
yields address, price, beds/baths/sqft, MLS ID, listing URL, **and** a usable photo URL
per listing, in a single pass. The per-listing `Fetch Listing Pages` og:image-regex step
in the current workflow is no longer needed and is removed.

**Unverified risk:** whether Apify's actor/proxy combination reliably passes Cloudflare's
challenge on this specific site has not been tested end-to-end (only a Claude-driven
headless browser was confirmed to pass it silently, which used different fingerprint/proxy
signals than Apify will). Validating this is the first implementation task, before any
other node work — same shape as the original PRD's "create Apify account and test
scraping a live listing URL" spike.

## Selection logic

Each Monday run:

1. Scrape `showagency=1`, parse into structured cards, already sorted newest-first.
2. Look up `weichert_sent_listings` for MLS IDs already sent.
3. `new_listings` = parsed cards whose `mls_id` is not in that set.
4. **If `new_listings` is non-empty:** take up to 10 (newest first) — these are today's email content.
5. **If `new_listings` is empty** (a genuinely slow week, not a scrape failure): fall back
   to the 10 most-recently-listed cards overall, even if previously sent, so the email
   still goes out. These get upserted into `weichert_sent_listings`, refreshing `last_sent_at`.
6. **If the scrape itself fails, or returns zero listings total** (site down, Apify
   blocked, actor error): this is a hard failure, not "zero new". Treat it exactly like
   today's `Preflight Failed?` branch — Slack abort alert, `Log Preflight Failed`, **no
   email sent**. A broken scrape must never silently fall through to the zero-new fallback
   and blast stale or garbage content.

Cap stays at 10 to match the form's old row limit. Weeks with 1–9 new listings send
exactly that many — no padding to reach 10.

## Schema change

New table, additive migration to `db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS weichert_sent_listings (
  mls_id        text PRIMARY KEY,
  address       text,
  first_sent_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at  timestamptz NOT NULL DEFAULT now()
);
```

`PRIMARY KEY(mls_id)` is intentional and safe here (unlike `leads`, which has no
unique constraint suitable for `ON CONFLICT` and needs SELECT-then-conditional dedupe
per `docs/lessons-learned.md`) — this is a brand-new table Norr AI owns outright, so the
`Mark Sent` step can do a clean upsert:

```sql
INSERT INTO weichert_sent_listings (mls_id, address)
VALUES ($1, $2)
ON CONFLICT (mls_id) DO UPDATE SET last_sent_at = now();
```

`listing_queue` is not dropped — it stops receiving writes but stays in the schema as
historical record of the manual era.

## Workflow changes — `Weekly Marketing Drip - Send` (`wSXuvtUorzoLmktv`)

**Removed nodes:**
- `Get Pending` (Postgres — read latest `listing_queue` row)
- `Has Pending?` (IF)
- `Log No Pending`
- `Build Fetch Items` (Code — fan out queue URLs)
- `Fetch Listing Pages` (HTTP Request — og:image scrape)

**New nodes, replacing the above in the same position in the graph:**

1. **Scrape Office Listings** (HTTP Request → Apify actor run, synchronous) — targets
   `teamyellownow.com/index.php?showagency=1`, sort confirmed/forced to "Days on Website"
   ascending by days-on-market value (fewest days first = newest listed first). Exact
   Apify actor + input schema is an implementation-time decision, pending the validation
   spike above.
2. **Parse Listings** (Code) — extract `{mls_id, address, price, beds, baths, sqft, url,
   photo_url}` per card from the Apify result; derive full-res photo URL from the
   thumbnail URL (`thumbnails/` strip); preserve scrape order (already newest-first).
3. **Get Sent MLS IDs** (Postgres, `continueOnFail: true`) — `SELECT mls_id FROM weichert_sent_listings`.
4. **Filter New** (Code) — diff parsed cards against the sent-ID set; cap at 10.
5. **Has New Listings?** (IF) — `new_listings.length > 0`
   - **True →** `new_listings` (≤10) flows forward as today's content.
   - **False →** fallback branch takes top 10 from the full parsed list regardless of
     sent status, then rejoins the same downstream path.
6. **Scrape Failed?** (IF, evaluated right after step 1/2, before the new/fallback
   branching) — if the Apify run errored or returned zero total listings, route to the
   existing `Slack: Abort Alert` → `Log Preflight Failed` path and stop. This check sits
   ahead of `Has New Listings?` so a broken scrape can never be mistaken for "just no new
   listings this week."

**Unchanged downstream (same nodes, same order):** `Build Cards` (now sourced from
scraped fields instead of regex-parsed HTML — logic simplifies, no more `og:image`/
`<title>` parsing), `Canary Send`, `Preflight Failed?`, `Get Leads`, `Build Email`,
`Loop Over Leads`, `Send Email`, `Wait 100ms`, `Mark Sent` (now upserts
`weichert_sent_listings` instead of updating `listing_queue.status`), `Log Completed`.

Opt-out handling, the per-agent contact-info/signature split, and the
`communication_opted_out`/`email_opt_out` send filters are entirely unchanged.

## Retiring the manual path

- Deactivate `Weekly Marketing Drip - Intake` (n8n `KDWC5WwRJuNldOCY`) in n8n.
- Remove `website/clients/weichert_weekly_listings_form.html` and its nav entry.
- Delete `tests/weichert_weekly_listings_form.spec.js` (dead once the form is gone).
- `Marketing Opt-Out` (n8n `oiefZVdPfLPRsTZM`) is untouched — still needed for the
  automated send.

## Logging / registry

Same `workflow_name` (`weekly_marketing_drip`) — internal logic changes, not an identity
change, so no new registry entry in `n8n/README.md`. Existing `Log Triggered` /
`Log Completed` / `Log Preflight Failed` nodes and the workflow's Error Workflow setting
are unaffected by this change.

## Testing

- No Playwright coverage needed for the workflow itself (backend-only, no UI). The one
  UI surface being touched (the form) is being deleted, not modified.
- Before flipping the automated path live: a manual end-to-end validation pass —
  Apify scrape → parse → dedupe → email preview → test send to `hello@norrai.co` —
  mirroring the original go-live task 13, run against the real `teamyellownow.com`
  listing feed.
- Watch the first 2–3 live Monday runs for dedupe correctness (no listing repeats across
  weeks) and for the fallback branch actually triggering correctly on a slow week.

## Out of scope

- Per-agent (rather than office-wide) listing content — explicitly rejected during
  design; both agents keep sharing the same featured listings, differing only in
  contact info/signature as today.
- Changing the Monday 9am CT cadence, the per-lead SendGrid send strategy, or the
  opt-out token mechanism.
