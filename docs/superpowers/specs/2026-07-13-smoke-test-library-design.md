# Spec 08 — Smoke-test payload library + `/smoke-test`

## Problem

Smoke tests are hand-crafted per session and routinely deferred ("Pending: smoke test" appears in the 04-29, 05-18, and 05-26 session entries; the 05-18 three-scenario test never has a recorded completion). Each test requires re-deriving the payload shape from the workflow JSON — and payload contracts have drifted (the 06-22 discovery that live Cold Nurture requires body `agent_token`, which the repo export didn't show).

## Goal

Checked-in, versioned test payloads per workflow, fired with one command, with response assertions and optional Neon-side verification — so "smoke test it" costs one minute instead of twenty.

## Deliverables

1. `n8n/smoke-tests/` — one JSON fixture per testable webhook workflow (seed set below).
2. `scripts/smoke_test.py` — fires fixtures, asserts, reports (stdlib only: `urllib.request`, `json`, `os`).
3. `.claude/skills/smoke-test/SKILL.md` + `.claude/commands/smoke-test.md` stub.

## Fixture format (`n8n/smoke-tests/<workflow_name>.json`)

```json
{
  "workflow_name": "instant_lead_response",
  "description": "Fires ILR with a synthetic lead; expects 200 + agent copy email.",
  "webhook_path": "lead-response",
  "method": "POST",
  "headers": { "X-Norr-Token": "${NORR_TOKEN}" },
  "query": {},
  "payload": {
    "agent_email": "egachuu@gmail.com",
    "agent_token": "${TEST_AGENT_TOKEN}",
    "lead_name": "ZZ Smoke Test",
    "email": "egachuu@gmail.com",
    "phone": "5075550100",
    "property_street": "123 Test St", "property_city": "Faribault",
    "property_state": "MN", "property_zip": "55021",
    "lead_message": "SMOKE TEST — safe to ignore"
  },
  "expect": {
    "status": 200,
    "body_contains": []
  },
  "verify_neon": [
    "SELECT count(*) AS n FROM workflow_events WHERE workflow_name = 'instant_lead_response' AND event_type = 'completed' AND created_at > now() - interval '5 minutes'"
  ],
  "verify_manual": "Email arrives at egachuu@gmail.com within ~60s (agent copy).",
  "danger": "Sends a REAL email via SendGrid. Never change lead email/phone to a real lead."
}
```

Rules:

- `${VAR}` placeholders resolve from `.env` (the script parses `.env` itself — KEY=VALUE lines, ignore comments; it must NOT print resolved secret values). Required vars documented per fixture. `NORR_TOKEN` = the shared `X-Norr-Token`; `TEST_AGENT_TOKEN` = a dedicated test client's `clients.token` (see "test client" below).
- Every fixture's synthetic identity uses `egachuu@gmail.com` / a `555` phone / a `ZZ Smoke Test` name so test artifacts are greppable and deletable.
- Base URL constant in the script: `https://norrai.app.n8n.cloud/webhook/` — production path, per CLAUDE.md (never `/webhook-test/`).
- `verify_neon` queries are **read-only SELECTs** the *skill* runs via `mcp__Neon__run_sql` (one per call); the script only prints them — it has no DB access.

### Test client (one-time setup, part of this spec)

Create a dedicated Neon client row for smoke tests so fixtures never borrow a real client's token:
`INSERT INTO clients (business_name, primary_contact_email, status, ...) VALUES ('ZZ Smoke Test Client', 'egachuu@gmail.com', ...)` — copy required-column shape from an existing row (`SELECT * FROM clients WHERE id = 'e2f9934c-...'`). Record its `id` and `token` in `.env` as `TEST_CLIENT_ID` / `TEST_AGENT_TOKEN` (user adds them — the `.env` edit hook blocks Claude; print the exact lines for the user to paste).

## Script behavior

```
python3 scripts/smoke_test.py <workflow_name|fixture path>   # fire one
python3 scripts/smoke_test.py --list                          # table of fixtures + danger notes
```

- Loads fixture, resolves `${VARS}` (error clearly if missing), fires the request, prints: status, elapsed ms, response body (first 500 chars), PASS/FAIL per `expect` assertion, then the `verify_neon` queries and `verify_manual` note as a checklist.
- **No `--all` flag.** Each smoke test costs real side effects (Claude API calls, SendGrid sends). Firing everything at once is exactly the "bad data produces silent failures with real cost" risk CLAUDE.md warns about. One fixture per invocation, deliberately.
- Exit 0 only if all `expect` assertions pass.

## SKILL.md flow

1. `--list`, confirm which fixture the user wants (or take it from the command args).
2. Show the fixture's `danger` line; for anything that sends email/SMS, state it plainly before firing.
3. Fire via the script.
4. Run each `verify_neon` SELECT via Neon MCP; report results.
5. If a Gmail MCP connector is available in the session, verify `verify_manual` email receipt by searching for the subject/recipient; otherwise leave it to the user as a checklist item.
6. On FAIL: fetch the live workflow's recent executions (`n8n_list_executions` if available, else REST `GET /api/v1/executions?workflowId=...`) and report the failing node — but remember the executions API can lag hours (lessons-learned); a webhook 200 `Workflow was started` is the acceptance signal for async workflows.

## Seed fixtures (build these 6)

| Fixture | Path | Notes |
|---|---|---|
| `listing_description.json` | `listing-description` | Response is async email; expect 200. |
| `instant_lead_response.json` | `lead-response` | As above. Confirm live payload contract from the LIVE graph first (agent_token requirement — 06-22 lesson). |
| `cold_nurture_enroll.json` | `cn-enroll` | DANGER note: enrolls a 21-day sequence — fixture must use the test client token; verify a `Wait Day 1` waiting execution, then instruct how to cancel it in n8n UI. |
| `research_agent.json` | `research-agent` | Synchronous JSON response: `expect.body_contains: ["insight_block"]`. Second fire within 7 days should hit cache (note in description). |
| `email_unsubscribe.json` | Email Unsubscribe Handler's POST path (read it from the live workflow) | verify_neon: `email_opt_out = TRUE` on the test lead; include a reset UPDATE in `verify_manual` text. |
| `contract_signed.json` | `contract-signed` (confirm from workflow JSON) | Upserts a client — payload uses `ZZ Smoke Test Client` so the upsert hits the test row, not a real client. |

For each: **derive `webhook_path`, method, and required fields from the LIVE workflow** (`n8n_get_workflow`), not the repo export. Where live requires fields the repo doesn't show, that's drift — note it and feed Spec 01.

## Acceptance criteria

- `smoke_test.py --list` shows all fixtures; firing `research_agent` returns PASS with a real `insight_block` in the response.
- Firing `instant_lead_response` yields 200, a `completed` event in Neon, and an email at egachuu@gmail.com.
- A fixture with a missing env var fails with a clear message naming the var, without firing the request.
- No secrets appear in stdout or in committed fixtures (only `${VAR}` placeholders).

## Non-goals

- Not load testing, not scheduled — on-demand only. Cron-triggered workflows (schedulers, sweeps) are out of scope; test those with manual n8n executions.
