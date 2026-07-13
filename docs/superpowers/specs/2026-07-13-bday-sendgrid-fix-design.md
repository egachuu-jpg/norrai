# Spec 04 — Fix Birthday & Anniversary Outreach SendGrid sends (415 raw-pattern)

## Problem

Both Birthday & Anniversary variants send email via an HTTP Request node using the **broken** pattern (confirmed in the repo exports on 2026-07-13):

- `n8n/workflows/Birthday & Anniversary Outreach.json` → node `SendGrid Email`: `contentType: "raw"`, body `={{ JSON.stringify({personalizations: [...` referencing `$('Parse Response')`.
- `n8n/workflows/Birthday & Anniversary Outreach - Evan.json` → node `SendGrid Email`: same pattern, referencing `$json.*`.

`contentType: "raw"` blanks the outgoing `Content-Type` header (a manual header does not survive), so SendGrid rejects with `415 "Content-Type should be application/json."` — the exact failure root-caused on the Weekly Drip on 07-10. This has been flagged as "likely 415'ing silently" since 07-11 and never fixed. This is a daily-cron workflow for a live client (Evan/Weichert): every matched birthday/anniversary since the pattern regressed may have silently not sent.

## Goal

Both variants send successfully using the project's proven SendGrid pattern; a send failure is loud (Error Logger fires); the fix is applied to the **live** workflows and synced back to the repo.

## Target pattern (copy from `Weekly Marketing Drip - Send.json` node `Send Email` — verified working end-to-end 07-11)

```json
{
  "method": "POST",
  "url": "https://api.sendgrid.com/v3/mail/send",
  "sendHeaders": true,
  "headerParameters": { "parameters": [ { "name": "Content-Type", "value": "application/json" } ] },
  "sendBody": true,
  "specifyBody": "json",
  "jsonBody": "={{ { personalizations: [...], from: {...}, ... } }}"
}
```

Key differences from the broken node: `specifyBody: "json"` with an **object expression** in `jsonBody` (NO `JSON.stringify`, NO `contentType` key at all), plus the explicit Content-Type header. Keep the node's existing `httpHeaderAuth` credential (SendGrid Bearer).

## Implementation steps

### 1. Investigate before changing (both variants)

- Fetch the LIVE versions: `n8n_list_workflows`, find both by name, `n8n_get_workflow` each. **The live graph is authoritative** — the repo export may lag (lessons-learned § live-graph-differs). Confirm the live `SendGrid Email` nodes still carry the raw pattern; if a live node was already fixed in the UI, skip it and only fix the repo file.
- Check the damage window: `mcp__Neon__run_sql` →
  `SELECT event_type, count(*), max(created_at) FROM workflow_events WHERE workflow_name = 'bday_anniversary_outreach' GROUP BY event_type;`
  (If the registry uses a different name, check `n8n/README.md` / `SELECT DISTINCT workflow_name FROM workflow_events`.) Report to the user how many `completed` runs may have been no-op sends — do NOT attempt to re-send historical messages without asking.

### 2. Edit the send node (per variant)

For each workflow, transform ONLY the `SendGrid Email` node:

1. Delete `parameters.contentType` (and `rawContentType` if present).
2. Set `parameters.specifyBody = "json"`.
3. Rename the body: the existing value is `={{ JSON.stringify({ ...obj... }) }}` — the new `jsonBody` is `={{ { ...obj... } }}` (strip the `JSON.stringify(` wrapper and its closing `)`, keep the inner object expression EXACTLY as-is, including its `$('Parse Response')` / `$json` references — do not "improve" them).
4. Ensure `sendHeaders: true` and a `Content-Type: application/json` entry in `headerParameters.parameters` (add if missing, don't duplicate if present).
5. Set node-level `onError: "stopWorkflow"` explicitly IF the node currently has any error-swallowing setting; otherwise leave absent (absent = stop, which is correct — L02). Volume is a handful of sends/day, so stop-and-alert beats a canary here.
6. Leave the `Twilio SMS` node alone (`form-urlencoded` is correct for Twilio).

### 3. Apply to live n8n

- Preferred: `n8n_update_partial_workflow` with an `updateNode` op using dot-path keys under `updates` (e.g. `"parameters.specifyBody": "json"`). Note the atomic-validation gotcha: if the workflow has unrelated pre-existing validation defects, the partial update will refuse to save — fall back to `n8n_update_full_workflow` with the fully-edited JSON (filter `settings` to the allowed key set before PUT; see lessons-learned § n8n API).
- **Read back**: `n8n_get_workflow` and confirm `specifyBody == "json"` and `contentType` is gone on the live node. This instance has silently dropped parameter writes before. If the write didn't stick, tell the user to apply the same 4 field changes in the n8n UI (list them concretely) — do not loop retrying.

### 4. Sync + repo

- Update both repo files to match (Python json.load/dump — not the Edit tool).
- Run `python3 scripts/n8n_lint.py "n8n/workflows/Birthday & Anniversary Outreach.json" "n8n/workflows/Birthday & Anniversary Outreach - Evan.json"` if Spec 02 is implemented — L03 must now pass.
- Commit: `fix(bday-anniversary): SendGrid send — specifyBody json pattern (fixes silent 415)`.

### 5. Smoke test

- In the live instance, temporarily pin a test: easiest safe path is a manual execution with pinned input data on the send node's upstream (or temporarily add a Google Sheet row with today's date (MM-DD) for `egachuu@gmail.com` and run once, then remove the row). Expected: SendGrid returns **202** and the email arrives at egachuu@gmail.com. If a Gmail MCP connector is available in the session, verify receipt by searching the inbox; otherwise ask the user to confirm.
- Verify a `completed` event landed in `workflow_events`.

## Acceptance criteria

- Live nodes show `specifyBody: "json"`, no `contentType`, Content-Type header present — confirmed by read-back, not by the API's 200 response.
- Test send returns 202 and arrives.
- Repo files match live; lint L03 clean; committed and pushed.
- User has a one-line damage report (how many runs since ~2026-06-04 likely no-op'd).

## Non-goals

- No re-sending of missed birthday/anniversary messages (user decision).
- No refactor of the rest of the workflow (dedupe, sheet parsing) — one surgical fix.
