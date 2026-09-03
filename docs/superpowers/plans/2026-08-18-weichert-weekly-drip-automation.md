# Weichert Weekly Drip Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual listing-URL queue in the `Weekly Marketing Drip - Send` n8n workflow with an automated Monday-morning scrape of Weichert Heartland's own listing feed, deduped against a new Neon table, so the weekly email requires zero human input.

**Architecture:** An Apify Puppeteer actor scrapes `teamyellownow.com/index.php?showagency=1` (Cloudflare-protected) once per run and returns structured listing cards including photo URLs. A new `weichert_sent_listings` table tracks what's already gone out. The existing five-node queue-read front-end of the Send workflow is replaced with a scrape → parse → dedupe → select chain; everything from `Build Cards` onward (email build, per-lead send, opt-out) is untouched. The manual intake form and its webhook workflow are retired.

**Tech Stack:** n8n Cloud (workflow `wSXuvtUorzoLmktv`), Apify (Puppeteer Scraper actor), Neon Postgres, SendGrid v3 API.

---

## Reference details (do not re-derive — use these exact values)

- n8n Postgres credential: id `2DDeKGMIP9Ijbd9R`, name "Postgres account"
- n8n SendGrid credential (Header Auth): id `d2B1Q0ceGNVDwjqs`, name "Header Auth account"
- Internal `client_id` (workflow_events logging): `e2f9934c-4d28-4bb4-ac90-4284c1123517`
- Evan `client_id`: `ded234e3-1c78-45c3-8924-6036e1fcaf60` · Michelle `client_id`: `451306d1-6437-42b8-8ffe-c16f28803490`
- Slack webhook (hardcoded in HTTP node body, not a credential — see `docs/lessons-learned.md`): `<the live Slack webhook URL — same one already hardcoded in the existing Slack: Abort Alert node; do not commit the raw URL to git, see docs/lessons-learned.md>`
- Neon project: `gentle-hill-54285247`, database `neondb`
- Listing card DOM (confirmed live 2026-08-18 against `https://www.teamyellownow.com/index.php?showagency=1#rslt`):
  ```html
  <div class="card h-100 vertical-listing-card" data-link="https://www.teamyellownow.com/property/133-7126006-17-9th-avenue-se-faribault-MN-55021">
    <a class="map-listing-details-link" href="...same as data-link...">
      <img class="card-img-top" src="https://d36xftgacqn2p.cloudfront.net/listingphotos133/thumbnails/7126006-1.jpg" ...>
    </a>
    <div class="card-body">
      <h5 class="card-title">$ 384,900</h5>
      <div class="card-img-overlay">
        <span class="item-left">Just Listed</span>
        <a class="item-right saveListing" data-mls="133" data-mlsid="7126006" ...></a>
      </div>
      <p class="card-text"><b>4</b><small> Beds</small><b>3</b><small> Baths</small><b>2,552</b><small> Sq,Ft.</small></p>
      <p><i .../><b class="text-mute">17 9th Avenue Se</b></p>
    </div>
  </div>
  ```
  - Default sort on page load is `select#sortby` value `listings.listingdate DESC` (label "Days on Website") — **no sort param needs to be set**, the newest-first order is already the default.
  - 25 cards render on initial load (of 103 total, no pagination needed) — plenty since we only ever take the top 10.
  - Full-res photo = thumbnail URL with the `thumbnails/` path segment removed (confirmed both resolve: thumbnail 9.5KB, full-res 403KB).

---

### Task 1: Validate the Apify scrape (spike — gates everything else)

This is the one genuinely unverified piece of the design: whether an Apify actor can reach `teamyellownow.com` through its Cloudflare challenge. Confirm this before touching the n8n workflow — if it fails, the rest of the plan needs rethinking.

**Files:** none (Apify console + a scratch HTTP call)

- [x] **Step 1: Get an Apify API token** — DONE 2026-08-18. Token created and approved for full-account-access (the `apify/puppeteer-scraper` actor requires this — Apify returns `full-permission-actor-not-approved` with an approval URL on first use if it's not granted yet). Stored as an n8n Query Auth credential named `Apify API Token` (field name `token`), created directly by Egan in n8n.

- [x] **Step 2: Run the actor via a direct API call — DONE 2026-08-18, CONFIRMED WORKING**

The plain `apifyProxyGroups: ["RESIDENTIAL"]` config (no country pin) got blocked by Cloudflare after 3 retries (`403`, `429`, then a proxy tunnel failure — the `#error` wrapper item). Adding `apifyProxyCountry: "US"` fixed it on the very next call: `HTTP 201`, 25 items, 0 errors, 0 missing `mls_id`, 0 missing `photo_thumb_url`, every item's debug block shows `statusCode: 200, retryCount: 0`. **This confirms the design's central risk is resolved** — Apify + a US-pinned residential proxy reliably passes this site's Cloudflare challenge.

**Confirmed-working call:**
```bash
curl -s -X POST \
  "https://api.apify.com/v2/acts/apify~puppeteer-scraper/run-sync-get-dataset-items?token=YOUR_APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "startUrls": [{ "url": "https://www.teamyellownow.com/index.php?showagency=1" }],
    "pageFunction": "async function pageFunction(context) { const { page } = context; await page.waitForSelector(\".vertical-listing-card\", { timeout: 30000 }); return await page.$$eval(\".vertical-listing-card\", (nodes) => nodes.map((card) => { const saveEl = card.querySelector(\".saveListing\"); const priceEl = card.querySelector(\".card-title\"); const addressEl = card.querySelector(\"p b.text-mute\"); const imgEl = card.querySelector(\"img.card-img-top\"); const nums = Array.from(card.querySelectorAll(\".card-text b\")).map((b) => b.textContent.trim()); return { mls_id: saveEl ? saveEl.getAttribute(\"data-mlsid\") : null, price: priceEl ? priceEl.textContent.trim() : null, beds: nums[0] || null, baths: nums[1] || null, sqft: nums[2] || null, address: addressEl ? addressEl.textContent.trim() : null, url: card.getAttribute(\"data-link\"), photo_thumb_url: imgEl ? imgEl.getAttribute(\"src\") : null }; })); }",
    "proxyConfiguration": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"], "apifyProxyCountry": "US" },
    "maxPagesPerCrawl": 1,
    "maxResultRecords": 30,
    "pageLoadTimeoutSecs": 90
  }' | head -c 2000
```

Real sample item returned: `{"mls_id":"7127292","price":"$ 225,000","beds":"2","baths":"1.5","sqft":"927","address":"15549 Flyboat Lane # 63","url":"https://www.teamyellownow.com/property/133-7127292-15549-flyboat-lane-63-apple-valley-MN-55124","photo_thumb_url":"https://d36xftgacqn2p.cloudfront.net/listingphotos133/thumbnails/7127292-1.jpg"}` — exactly the shape `Parse Listings` (Task 4) expects.

- [x] **Step 3: Record the confirmed-working actor input — DONE.** Task 4 Step 2's node JSON below has been updated to use `apifyProxyCountry: "US"` and `pageLoadTimeoutSecs: 90` to match what was actually verified working.

---

### Task 2: Add the `weichert_sent_listings` dedupe table

**Files:**
- Modify: `db/schema.sql` (add table near `listing_queue`, around line 211)
- Modify: `db/README.md` (add to table overview)

- [ ] **Step 1: Add the table to the schema file**

In `db/schema.sql`, immediately after the existing `idx_listing_queue_status_submitted` index (around line 211), add:

```sql
-- Dedupe log for the automated Weekly Marketing Drip scrape: tracks which
-- Weichert Heartland MLS listings have already been featured, so the same
-- property isn't re-blasted week over week. PRIMARY KEY on mls_id enables a
-- clean ON CONFLICT upsert (this table has no shared-identity ambiguity like
-- `leads` does, so no SELECT-then-conditional dance is needed here).
CREATE TABLE IF NOT EXISTS weichert_sent_listings (
  mls_id        text PRIMARY KEY,
  address       text,
  first_sent_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at  timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Apply it to Neon**

Use the Neon MCP `run_sql` tool (project `gentle-hill-54285247`, database `neondb`) with exactly the `CREATE TABLE IF NOT EXISTS` statement above.

- [ ] **Step 3: Verify it exists**

Run via Neon MCP `run_sql`:
```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'weichert_sent_listings' ORDER BY ordinal_position;
```
Expected: 4 rows — `mls_id` (text, NO), `address` (text, YES), `first_sent_at` (timestamp with time zone, NO), `last_sent_at` (timestamp with time zone, NO).

- [ ] **Step 4: Document it in db/README.md**

Add a row to the table overview in `db/README.md` (follow the existing format for other tables in that file): `weichert_sent_listings` — "Dedupe log for the Weichert Weekly Drip auto-scrape; one row per MLS ID ever featured."

- [ ] **Step 5: Commit**

```bash
git add db/schema.sql db/README.md
git commit -m "feat(weichert): add weichert_sent_listings dedupe table"
```

---

### Task 3: Strip the manual-queue nodes out of the Send workflow

**Files:** n8n workflow `wSXuvtUorzoLmktv` ("Weekly Marketing Drip - Send") — edited via `n8n-mcp` tools, not a local file.

- [ ] **Step 1: Pull the current full workflow as a backup**

Call `mcp__n8n-mcp__n8n_get_workflow` with `id: "wSXuvtUorzoLmktv"`, `mode: "full"`. Save the returned JSON to `/tmp/weekly-drip-send-backup-2026-08-18.json` so there's a rollback point if something goes wrong mid-edit.

- [ ] **Step 2: Remove the five queue-read nodes**

Call `mcp__n8n-mcp__n8n_update_partial_workflow` on `wSXuvtUorzoLmktv` with operations to remove these five nodes by name: `Get Pending`, `Has Pending?`, `Log No Pending`, `Build Fetch Items`, `Fetch Listing Pages`. (Use the tool's `removeNode` operation type per node; check `mcp__n8n-mcp__tools_documentation` for the exact operation name/shape if unfamiliar — this project has not removed nodes via this tool before.)

- [ ] **Step 3: Verify the workflow still validates**

Call `mcp__n8n-mcp__n8n_validate_workflow` on `wSXuvtUorzoLmktv`. Expected: errors about `Log Triggered` and `Build Cards` now being disconnected (their old neighbors are gone) — that's expected at this halfway point. No JSON-structure errors.

---

### Task 4: Wire in the scrape → parse → dedupe → select chain

**Files:** same workflow, continued from Task 3.

- [ ] **Step 1: Create the Apify credential in n8n**

DONE — Egan created this directly in n8n. Confirmed via `n8n_manage_credentials` (action: list): name `Apify API Token`, id `IEJGBQErsNtkxrYM`, type `httpQueryAuth`. Note: the n8n credential type is `httpQueryAuth`, not `queryAuth` — confirmed via `n8n_manage_credentials` (action: getSchema, type: httpQueryAuth), which returns `{name, value, allowedHttpRequestDomains, allowedDomains}`. This matches the existing pattern in this workflow where `httpHeaderAuth` (not a shortened form) is used as both the `genericAuthType` value and the `credentials` object key (see `Canary Send`/`Send Email` nodes). Step 2 below has been corrected to use `httpQueryAuth` throughout, and the real credential id `IEJGBQErsNtkxrYM`.

- [ ] **Step 2: Add "Scrape Office Listings" (HTTP Request)**

Add a node with these parameters (position it where `Build Fetch Items` used to sit, roughly `[896, 576]`):

```json
{
  "name": "Scrape Office Listings",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "parameters": {
    "method": "POST",
    "url": "https://api.apify.com/v2/acts/apify~puppeteer-scraper/run-sync-get-dataset-items",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpQueryAuth",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={{ { startUrls: [{ url: 'https://www.teamyellownow.com/index.php?showagency=1' }], pageFunction: \"async function pageFunction(context) { const { page } = context; await page.waitForSelector('.vertical-listing-card', { timeout: 30000 }); return await page.$$eval('.vertical-listing-card', (nodes) => nodes.map((card) => { const saveEl = card.querySelector('.saveListing'); const priceEl = card.querySelector('.card-title'); const addressEl = card.querySelector('p b.text-mute'); const imgEl = card.querySelector('img.card-img-top'); const nums = Array.from(card.querySelectorAll('.card-text b')).map((b) => b.textContent.trim()); return { mls_id: saveEl ? saveEl.getAttribute('data-mlsid') : null, price: priceEl ? priceEl.textContent.trim() : null, beds: nums[0] || null, baths: nums[1] || null, sqft: nums[2] || null, address: addressEl ? addressEl.textContent.trim() : null, url: card.getAttribute('data-link'), photo_thumb_url: imgEl ? imgEl.getAttribute('src') : null }; })); }\", proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'], apifyProxyCountry: 'US' }, maxPagesPerCrawl: 1, maxResultRecords: 30, pageLoadTimeoutSecs: 90 } }}",
    "options": { "timeout": 180000 }
  },
  "credentials": { "httpQueryAuth": { "id": "IEJGBQErsNtkxrYM", "name": "Apify API Token" } },
  "onError": "continueRegularOutput"
}
```

Use the exact `pageFunction` string confirmed working in Task 1 — if it differs from the one above, use the confirmed version instead.

- [ ] **Step 3: Add "Parse Listings" (Code)**

```javascript
const inputItems = $input.all();
const isHttpError = inputItems.length === 1 && inputItems[0].json && inputItems[0].json.error;
let rawCards;
if (isHttpError) {
  rawCards = [];
} else if (inputItems.length === 1 && Array.isArray(inputItems[0].json)) {
  // n8n wrapped the whole Apify dataset-items array into one item's json
  rawCards = inputItems[0].json;
} else {
  // n8n auto-split the JSON array response into one item per element
  rawCards = inputItems.map(i => i.json);
}
const listings = rawCards
  .filter(c => c && c.mls_id)
  .map(c => ({
    mls_id: String(c.mls_id),
    address: c.address || null,
    price: c.price || null,
    beds: c.beds || null,
    baths: c.baths || null,
    sqft: c.sqft || null,
    url: c.url || null,
    photo_thumb_url: c.photo_thumb_url || null,
  }));
return [{ json: { scrape_error: !!isHttpError, listings } }];
```

Note: this node always returns exactly one item, so the downstream IF node has something reliable to check — the same defensive shape the old `Get Pending` query used (`LEFT JOIN LATERAL ... ON true`) to guarantee exactly one row even when nothing was found.

- [ ] **Step 4: Add "Scrape Failed?" (IF)**

Condition (same style as the existing `Preflight Failed?` node): `={{ $json.scrape_error === true || $json.listings.length === 0 }}`, operator: boolean `true`.

- [ ] **Step 5: Add the scrape-failure alert branch**

Add "Slack: Scrape Failed Alert" (HTTP Request), same Slack webhook as the existing `Slack: Abort Alert` node:

```json
{
  "name": "Slack: Scrape Failed Alert",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "parameters": {
    "method": "POST",
    "url": "<the live Slack webhook URL — same one already hardcoded in the existing Slack: Abort Alert node; do not commit the raw URL to git, see docs/lessons-learned.md>",
    "sendBody": true,
    "contentType": "raw",
    "rawContentType": "application/json",
    "body": "={{ JSON.stringify({ text: ':rotating_light: Weekly Marketing Drip ABORTED — the Weichert listings scrape failed or returned zero listings, so the weekly blast did NOT send (0 leads emailed). Will retry automatically next Monday.' }) }}"
  },
  "onError": "continueRegularOutput"
}
```

Add "Log Scrape Failed" (Postgres, credential `2DDeKGMIP9Ijbd9R`):

```sql
INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('e2f9934c-4d28-4bb4-ac90-4284c1123517'::uuid, 'weekly_marketing_drip', 'failed', json_build_object('execution_id', '{{ $execution.id }}', 'reason', 'scrape_failed')::jsonb)
```
`onError: continueRegularOutput`. Connect: `Scrape Failed?` (true output) → `Slack: Scrape Failed Alert` → `Log Scrape Failed`. This branch is terminal — nothing connects after `Log Scrape Failed`.

- [ ] **Step 6: Add "Get Sent MLS IDs" (Postgres)**

```sql
SELECT mls_id FROM weichert_sent_listings
```
Credential `2DDeKGMIP9Ijbd9R`, `onError: continueRegularOutput`. Connect: `Scrape Failed?` (false output) → `Get Sent MLS IDs`.

- [ ] **Step 7: Wire the front of the chain together**

Connect: `Log Triggered` → `Scrape Office Listings` → `Parse Listings` → `Scrape Failed?`.

- [ ] **Step 8: Verify with n8n_validate_workflow**

Call `mcp__n8n-mcp__n8n_validate_workflow`. Expected: no errors on the new front section. `Build Cards` will still show as disconnected — that's Task 5.

---

### Task 5: Rewrite Build Cards and everything it feeds

**Files:** same workflow, continued from Task 4.

- [ ] **Step 1: Replace the "Build Cards" Code node body**

```javascript
const parsed = $('Parse Listings').first().json.listings; // newest-first, from the scrape
const sentIds = new Set($input.all().map(i => i.json.mls_id));

let selected = parsed.filter(l => !sentIds.has(l.mls_id));
let usedFallback = false;
if (selected.length === 0) {
  selected = parsed.slice(0, 10);
  usedFallback = true;
} else {
  selected = selected.slice(0, 10);
}

const esc = (s) => String(s == null ? '' : s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sqlEsc = (s) => String(s == null ? '' : s).replace(/'/g, "''"); // SQL-literal escape — see docs/lessons-learned.md re: apostrophes in scraped/user text breaking raw query interpolation
const fullPhoto = (thumbUrl) => thumbUrl ? thumbUrl.replace('/thumbnails/', '/') : null;

const cards = selected.map((l) => {
  const photo = fullPhoto(l.photo_thumb_url);
  const photoBlock = photo ? `<tr><td style='padding:0;'><img src='${esc(photo)}' alt='${esc(l.address || 'Listing')}' width='600' style='display:block;width:100%;max-width:600px;height:auto;'></td></tr>` : '';
  const priceBlock = l.price ? `<div style='font-size:14px;color:#3A3F48;margin-top:4px;'>${esc(l.price)}</div>` : '';
  return `<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='margin:0 0 18px;border:1px solid #e5e4de;border-radius:8px;overflow:hidden;'>${photoBlock}<tr><td style='padding:14px 16px;'><div style='font-size:16px;font-weight:bold;color:#0A0F1A;'>${esc(l.address || 'New Listing')}</div>${priceBlock}<div style='margin-top:12px;'><a href='${esc(l.url)}' style='display:inline-block;background:#0A0F1A;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:10px 18px;border-radius:6px;'>View Listing &rarr;</a></div></td></tr></table>`;
}).join('');

const listingsForSql = selected.map(l => ({ mls_id: sqlEsc(l.mls_id), address: sqlEsc(l.address) }));

return [{ json: { cards_html: cards, listing_count: selected.length, listings: listingsForSql, used_fallback: usedFallback } }];
```

Connect: `Get Sent MLS IDs` → `Build Cards` (input). Leave the existing `Build Cards` → `Canary Send` connection as-is.

- [ ] **Step 2: Edit "Canary Send" body**

Replace the `jsonBody` content field's message text. Find:
```
'Queue ' + $('Build Cards').first().json.queue_id + ', ' + $('Build Cards').first().json.listing_count + ' listing(s). The blast to the CRM list follows.'
```
Replace with:
```
$('Build Cards').first().json.listing_count + ' listing(s)' + ($('Build Cards').first().json.used_fallback ? ' (fallback — no new listings this week)' : '') + '. The blast to the CRM list follows.'
```

- [ ] **Step 3: Edit "Slack: Abort Alert" body**

Find:
```
'Queue row ' + $('Build Cards').first().json.queue_id + ' left pending for retry once SendGrid is healthy.'
```
Replace with:
```
'No listings were sent this run — will retry automatically against a fresh scrape next Monday.'
```

- [ ] **Step 4: Edit "Log Preflight Failed" query**

Remove `'queue_id', '{{ $('Build Cards').first().json.queue_id }}', ` from the `json_build_object(...)` call, so it reads:
```sql
INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('e2f9934c-4d28-4bb4-ac90-4284c1123517'::uuid, 'weekly_marketing_drip', 'failed', json_build_object('execution_id', '{{ $execution.id }}', 'reason', 'sendgrid_preflight_failed')::jsonb)
```

- [ ] **Step 5: Rewrite "Mark Sent" query**

Replace entirely with:
```sql
INSERT INTO weichert_sent_listings (mls_id, address)
SELECT * FROM jsonb_to_recordset('{{ JSON.stringify($('Build Cards').first().json.listings) }}'::jsonb) AS x(mls_id text, address text)
ON CONFLICT (mls_id) DO UPDATE SET last_sent_at = now();
```

- [ ] **Step 6: Edit "Log Completed" query**

Replace `'queue_id', '{{ ... }}', 'listings', {{ ... }}` with `'listing_count', {{ $('Build Cards').first().json.listing_count }}, 'used_fallback', {{ $('Build Cards').first().json.used_fallback }}`, so it reads:
```sql
INSERT INTO workflow_events (client_id, workflow_name, event_type, payload) VALUES ('e2f9934c-4d28-4bb4-ac90-4284c1123517'::uuid, 'weekly_marketing_drip', 'completed', json_build_object('execution_id', '{{ $execution.id }}', 'listing_count', {{ $('Build Cards').first().json.listing_count }}, 'used_fallback', {{ $('Build Cards').first().json.used_fallback }})::jsonb)
```

- [ ] **Step 7: Full workflow validation**

Call `mcp__n8n-mcp__n8n_validate_workflow` on `wSXuvtUorzoLmktv`. Expected: zero errors, zero disconnected nodes.

- [ ] **Step 8: Dry-run test execution**

Use `mcp__n8n-mcp__n8n_test_workflow` (or manually trigger an execution from the n8n UI) with the workflow still **inactive** so the real `Send Email` / `Get Leads` steps don't blast the live CRM list yet. Inspect the execution trace node-by-node:
- `Scrape Office Listings` returned data (not an error item)
- `Parse Listings` output has `listings.length > 0`
- `Build Cards` output has non-empty `cards_html` and `listings` with real `mls_id`/`address` values
- `Canary Send` succeeded (check `hello@norrai.co` received the preflight email)

If this is the very first run, `weichert_sent_listings` is empty, so every scraped listing counts as "new" — expect `used_fallback: false` and up to 10 cards.

- [ ] **Step 9: Commit nothing yet**

n8n workflows aren't stored as local files in this repo, so there's no git commit for this task — the workflow lives in n8n Cloud. (If `n8n/workflows/*.json` exports are kept in sync per the `workflow-sync` skill, run that skill now to pull the updated JSON into the repo and commit it.)

---

### Task 6: Retire the manual intake path

**Files:**
- Delete: `website/clients/weichert_weekly_listings_form.html`
- Delete: `tests/weichert_weekly_listings_form.spec.js`
- Modify: whichever site-nav file links to the form (check `website/clients/` index or nav partial for the link — grep first)

- [ ] **Step 1: Find and remove the nav link**

```bash
grep -rn "weichert_weekly_listings_form" website/ --include="*.html"
```
Remove the `<a href="...weichert_weekly_listings_form.html">` entry from whatever page(s) that grep turns up (likely a clients-index or nav partial).

- [ ] **Step 2: Delete the form and its test**

```bash
git rm website/clients/weichert_weekly_listings_form.html tests/weichert_weekly_listings_form.spec.js
```

- [ ] **Step 3: Run the full test suite to confirm nothing else references the deleted files**

```bash
npm test
```
Expected: all remaining specs pass; no failures referencing the deleted form or spec file.

- [ ] **Step 4: Deactivate the Intake workflow in n8n**

Call `mcp__n8n-mcp__n8n_update_partial_workflow` on `KDWC5WwRJuNldOCY` ("Weekly Marketing Drip - Intake") to set `active: false`. Confirm via `mcp__n8n-mcp__n8n_get_workflow` with `mode: "minimal"` that `active` now reads `false`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(weichert): retire manual weekly-listings intake form"
```

---

### Task 7: Update docs and go live

**Files:**
- Modify: `docs/workflows-built.md` (§ Weekly Marketing Drip)

- [ ] **Step 1: Rewrite the Weekly Marketing Drip section**

In `docs/workflows-built.md`, replace the existing "Weekly Marketing Drip" section (lines 39-50) to describe the new architecture: Apify scrape of `teamyellownow.com/index.php?showagency=1` replacing the manual queue, `weichert_sent_listings` dedupe table, Intake workflow deactivated, form removed. Keep the SendGrid volume and opt-out details, which are unchanged.

- [ ] **Step 2: Commit the docs**

```bash
git add docs/workflows-built.md
git commit -m "docs: update Weichert weekly drip docs for auto-scrape architecture"
```

- [ ] **Step 3: Go-live**

Once Task 5 Step 8's dry run looks correct, activate `wSXuvtUorzoLmktv` (it should already be active from before this work started — confirm it's still `active: true` after all the edits) and let the next Monday 9am CT cron fire for real. Watch the first live run's `workflow_events` rows:
```sql
SELECT event_type, payload, created_at FROM workflow_events WHERE workflow_name = 'weekly_marketing_drip' ORDER BY created_at DESC LIMIT 5;
```
Confirm a `completed` event with a real `listing_count` and no `failed` events.

- [ ] **Step 4: Watch dedupe correctness over 2-3 weeks**

Each subsequent Monday, spot-check that `weichert_sent_listings` is growing (new MLS IDs added) and that the email doesn't repeat a listing sent the prior week unless the `used_fallback` flag is true that week.

---

## Self-review notes

- **Spec coverage:** data source + Apify scrape (Task 1, 4), dedupe table (Task 2), selection/cap/fallback logic (Task 5 Step 1), scrape-failure vs zero-new distinction (Task 4 Steps 4-6 vs Task 5 Step 1), retiring the manual form (Task 6), unchanged downstream send/opt-out (untouched, verified in Task 5 Step 7 validation), testing (Task 5 Step 8, Task 7 Step 3-4) — all spec sections are covered.
- **Apostrophe/SQL-escaping risk** (a known gotcha in this codebase per `docs/lessons-learned.md`) is handled explicitly in Build Cards' `sqlEsc()` before the `jsonb_to_recordset` upsert in Mark Sent.
- **Out of scope items** from the spec (per-agent content, cadence changes) are not touched anywhere in this plan.
