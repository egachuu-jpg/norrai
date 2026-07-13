# Spec 05 — `Norr AI Ops Sweep` (weekly proactive-failure workflow)

## Problem

Every silent production failure to date was discovered reactively, roughly a week late:

- `claude-sonnet-4-20250514` retired 06-15 → every Claude node 404'd → diagnosed 06-22 when nurture visibly failed.
- SendGrid free trial lapsed 06-18 → sends 401'd (swallowed by `continueOnFail`) → root-caused 06-24.
- Clients going "yellow" (7-day silence) are only visible if someone opens the dashboard.

The Red Alert Scheduler covers red (failures) twice daily. Nothing watches the *pre-failure* conditions: model retirements, quota exhaustion, silence, and stale high-priority tasks.

## Goal

One scheduled n8n workflow, Monday 07:00 CT, that checks four conditions and posts a single Slack digest. Zero findings → post a one-line "all clear" (so a dead sweep is itself detectable).

## Deliverable

`n8n/workflows/Norr AI Ops Sweep.json`, registered as `ops_sweep` in `n8n/README.md` and in the Error Logger `WORKFLOW_NAME_MAP`; imported, credentialed, and activated in n8n.

## Design

### Graph

```
Schedule Trigger (Mon 07:00, workflow timezone America/Chicago)
  → Log Triggered (Postgres, continueOnFail, client norrai_internal e2f9934c-4d28-4bb4-ac90-4284c1123517)
  → Fetch Anthropic Models   (HTTP, continueOnFail)
  → Fetch Live Workflows     (HTTP, continueOnFail)
  → Check Models             (Code)
  → Fetch SendGrid Stats     (HTTP, continueOnFail)
  → Check Quota              (Code)
  → Query Silent Clients     (Postgres, alwaysOutputData)
  → Query Stale Tasks        (Postgres, alwaysOutputData)
  → Build Digest             (Code)
  → Post to Slack            (HTTP — NO continueOnFail; a failed post must hit the Error Logger)
  → Log Completed            (Postgres, continueOnFail)
```

Linear chain (n8n passes items through), each Check node reading its upstream by name (`$('Node Name').first().json`) per the project's data-flow rule. All `continueOnFail` nodes must be *checks* whose failure degrades to a "check errored" line in the digest — never the Slack post or the logging bookends' semantics.

### Check 1 — Model retirement (the 06-22 incident, made impossible)

- **Fetch Anthropic Models**: `GET https://api.anthropic.com/v1/models` with headers `x-api-key` (reuse the existing Anthropic header credential) + `anthropic-version: 2023-06-01`. Response: `{data: [{id: "claude-..."}, ...]}`.
- **Fetch Live Workflows**: `GET https://norrai.app.n8n.cloud/api/v1/workflows?limit=250` with header `X-N8N-API-KEY` (create/reuse an n8n Header Auth credential; the key exists in `.env` as `Norr-ai-api-key-1` — enter it in the n8n UI, never commit it). This returns full node JSON per workflow.
- **Check Models** (Code): for each workflow where `active === true` and `isArchived !== true`, scan `JSON.stringify(workflow.nodes)` with `/claude-[a-z0-9-]+/g` and `/gemini-[a-z0-9.-]+/g`. Any Claude match not present in the live models list → finding `{workflow: name, id, model}`. (Gemini has no equivalent list-models auth here — check Gemini matches against a hardcoded array `['gemini-2.5-flash']`, and treat unknowns as WARN.)
- Guard: if either fetch failed (`$('Fetch Anthropic Models').first().json.error` etc. — continueOnFail passes error objects), emit finding `"model check errored: <msg>"` instead of results. Never let a fetch failure read as "no findings".

### Check 2 — SendGrid quota (the 06-24 incident)

- **Fetch SendGrid Stats**: `GET https://api.sendgrid.com/v3/stats?start_date={{first day of current month, YYYY-MM-DD}}&aggregated_by=month` with the existing SendGrid Bearer credential. Build the date in a preceding expression: `={{ new Date().toISOString().slice(0,8) + '01' }}`.
- **Check Quota** (Code): sum `requests` across the response. Plan limit: hardcode `PLAN_LIMIT = 50000` (Essentials 50K) as a const at the top of the Code node with a comment to update on plan change. Findings: usage > 80% of limit → alert line with numbers; API errored → "quota check errored".
- Also do a **live-credit canary by proxy**: the stats API succeeding proves auth but not send credits. Cheapest reliable signal: `POST /v3/mail/send` with a real one-recipient email to `hello@norrai.co`, subject `Ops Sweep canary — {{date}}`. 202 → healthy; anything else → CRITICAL finding "SendGrid send path failing: <status/body>". This mirrors the Weekly Drip canary and directly detects the credits-exhausted 401 class. This canary node also must NOT swallow errors — wrap logic instead: set `onError: continueRegularOutput` ONLY on this canary node (its failure IS the finding, handled by the next Code node checking `$json.error`), matching the Weekly Drip pattern.

### Check 3 — Silent clients (yellow before it matters)

**Query Silent Clients** (Postgres, `alwaysOutputData: true`):

```sql
SELECT c.business_name, c.id,
       max(we.created_at) AS last_event
FROM clients c
LEFT JOIN workflow_events we ON we.client_id = c.id
WHERE c.status = 'active'
GROUP BY c.business_name, c.id
HAVING max(we.created_at) < now() - interval '7 days'
    OR max(we.created_at) IS NULL;
```

(Adjust the `status='active'` filter to the actual `clients.status` values — check `db/schema.sql` first; if there is no status column filter, drop the WHERE.) Exclude `norrai_internal` from findings.

### Check 4 — Stale flagged work

**Query Stale Tasks** (Postgres, `alwaysOutputData: true`):

```sql
SELECT t.title, t.priority, t.updated_at::date, s.title AS story
FROM tasks t LEFT JOIN stories s ON t.story_id = s.id
WHERE t.status NOT IN ('completed', 'done', 'cancelled')
  AND t.priority = 'high'
  AND t.updated_at < now() - interval '14 days'
ORDER BY t.updated_at
LIMIT 10;
```

(Verify the `tasks.status`/`priority` value vocabulary against the DB before hardcoding — `SELECT DISTINCT status FROM tasks` — the stories CHECK constraint incident shows these enums bite.)

### Digest + delivery

**Build Digest** (Code): assemble one Slack `text` payload:

```
:mag: Ops Sweep — 2026-07-13
MODELS: ok            (or) :rotating_light: 3 active workflows on retired claude-sonnet-4-20250514: <names>
SENDGRID: 3,912/50,000 this month; canary 202
SILENT CLIENTS (7d): none    (or) list
STALE HIGH-PRIORITY TASKS (14d): 2 — <titles>
```

**Post to Slack** (HTTP POST to the incoming-webhook URL): repo copy uses placeholder `https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK` (Push Protection blocks real URLs); real URL entered in the live instance only.

### Standards compliance

- Log Triggered / Log Completed per CLAUDE.md pattern, `workflow_name = 'ops_sweep'`, hardcoded `norrai_internal` client id.
- Settings → Error Workflow = `Norr AI Workflow Error Logger`; add `ops_sweep` to its `WORKFLOW_NAME_MAP`.
- Run `/n8n-audit` (and lint, Spec 02) on the new JSON before import.
- Import via REST `POST /api/v1/workflows` (create persists params reliably on this instance, unlike PUT), then transfer to the Norr AI project (`dHMe2aoOwTztDaWE`) and wire credentials in the UI (API-created credentials land in Personal — lessons-learned).

## Acceptance criteria

- Manual execution in n8n produces one Slack message containing all four sections, plus `triggered` + `completed` rows in `workflow_events`.
- Kill-test one check: temporarily add `claude-sonnet-4-20250514` to a scratch inactive workflow → it must NOT alert (inactive excluded); flip that workflow active → next manual run alerts. Revert.
- With the SendGrid credential deliberately pointed at a bad key on the canary node only (or simulated by editing the canary URL), the digest shows the CRITICAL send-path line and the workflow still completes.
- All findings-generating fetches failing (disconnect network scenario) → digest says which checks errored; never a false "ok".

## Non-goals

- Not replacing the Red Alert Scheduler (failures, 2×/day) — this is the weekly pre-failure sweep.
- No auto-remediation (no model auto-swap, no workflow deactivation).
