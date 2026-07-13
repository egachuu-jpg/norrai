# Spec 06 — ZZ TEST isolation + live n8n hygiene

## Problem

Three known-hazardous leftovers flagged on 07-09/07-11 and still open:

1. **`ZZ TEST - Weekly Drip Send (egachuu only)`** (live id `y0eXw9Ac84m595T4`) shares the production `listing_queue` table with the real Send (`wSXuvtUorzoLmktv`): its `Get Pending` consumes real pending rows and its `Mark Sent` flips them to `sent` — a manual test run eats the week's real batch before Monday 9am.
2. **Dormant Apify credential** (`IEJGBQErsNtkxrYM` + the user's Norr AI copy) is still attached to the prod Send's fetch node even though the 07-11 rewrite dropped Apify for a native HTTP GET. A dormant credential ref is harmless today but is exactly the kind of latent state that confuses future debugging.
3. The live instance has accumulated archived duplicates and junk ("My workflow", superseded copies) that make every list/sync operation noisier.

## Goal

Test runs are structurally incapable of consuming production queue rows; the prod Send carries no dead credential; the live instance's non-archived list contains only real workflows.

## Design

### 1. Isolate the ZZ TEST queue (the important one)

Chosen approach: **dedicated test rows, filtered by a sentinel client/status — not a separate table** (a separate `listing_queue_test` table would drift from the real schema).

- Add a `test` boolean to the queue: `ALTER TABLE listing_queue ADD COLUMN is_test boolean NOT NULL DEFAULT false;` (one `run_sql` call; also add the column to `db/schema.sql` in the same change — schema-drift lesson).
- Prod Send `Get Pending` query: append `AND is_test = false` (belt-and-suspenders; existing rows default false).
- ZZ TEST `Get Pending` query: change to `... WHERE status = 'pending' AND is_test = true ...`; its `Mark Sent` likewise `AND is_test = true`.
- Insert one durable test fixture row: `INSERT INTO listing_queue (..., is_test) VALUES (..., true)` using listing URL `https://northstar.weichert.com/136698877/` (the known-good server-rendered detail page). After a test run flips it to `sent`, reset with `UPDATE listing_queue SET status = 'pending' WHERE is_test = true;` — document this reset line inside the ZZ TEST workflow's `Get Pending` node name or a sticky note node.

Apply both live edits via `n8n_update_partial_workflow` / full-update fallback; **read back** to confirm the SQL actually changed (this instance drops param writes — always verify). Sync the prod Send change into `n8n/workflows/Weekly Marketing Drip - Send.json`; the ZZ TEST workflow stays live-only (do NOT add it to the repo — it's a harness, and repo policy is curated workflows only).

Ordering constraint: do the prod `Get Pending` edit **first** and verify, so at no point can the ZZ TEST see prod rows while prod could also see test rows.

### 2. Remove the dormant Apify credential

- Fetch prod Send live JSON; find the listing-fetch HTTP node (post-07-11 it does a plain GET of `northstar.weichert.com/...`). If it still lists `credentials.httpQueryAuth` = "Apify API Token" AND `parameters.authentication` is not set to use it, remove the `credentials` entry for it (full-update path; credentials are sticky — a full update that merely omits them does NOT remove them, so if the omission approach doesn't stick on read-back, instruct the user to detach it in the UI: open node → Authentication → None / remove credential).
- Then ask the user before deleting the credential objects themselves (`IEJGBQErsNtkxrYM` in Personal + the Norr AI copy) — they're trivially recreatable, but deletion is destructive and the user may want to keep the Apify account wired.

### 3. Archive junk (conservative)

- List all non-archived workflows. Candidates to archive: names starting `My workflow`, superseded duplicates where an identically-named workflow with a newer `updatedAt` holds the webhook (the 06-05 class), and one-off experiment copies the user confirms are dead.
- **Present the candidate list to the user for confirmation before archiving anything** — then archive via REST `POST /api/v1/workflows/{id}/archive`. Never delete; archive only. Never archive anything `active: true`.

## Acceptance criteria

- Run the ZZ TEST workflow manually while a real pending prod row exists: the prod row is untouched (still `pending`), the test row went `sent`, exactly one email arrived at egachuu@gmail.com. Reset the test row.
- Prod Send's next scheduled run (or a read-through of its `Get Pending` SQL) shows the `is_test = false` filter; `db/schema.sql` contains the new column.
- Prod Send node JSON shows no Apify credential ref on read-back.
- `n8n_list_workflows` (non-archived) contains no "My workflow" entries; everything remaining is recognizable.

## Non-goals

- No repo export of the ZZ TEST harness. No credential deletion without explicit user confirmation. No touching the Intake or Opt-Out workflows.
