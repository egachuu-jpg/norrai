# Workflow Execution Logging — Design Spec

## Goal

Log `triggered`, `completed`, and `failed` events to `workflow_events` in Neon for all 20 n8n workflows. Powers the monitoring dashboard health logic and makes red/yellow/green client status reflect real data.

## Architecture

Three components:

1. **`db/migrations/002_norrai_internal_client.sql`** — INSERTs the `norrai_internal` client row (UUID `e2f9934c-4d28-4bb4-ac90-4284c1123517`) into the `clients` table. Required before any internal workflow can log.

2. **`n8n/workflows/Norr AI Workflow Error Logger.json`** — New shared workflow. n8n calls it automatically when any workflow execution fails (each workflow's "Error Workflow" setting points here). Maps the workflow display name → `client_id` + `workflow_name`, then INSERTs a `failed` event.

3. **Updates to all 20 existing workflow JSON files** — Each gets three new nodes: Lookup Client, Log Triggered, Log Completed. Each also gets its "Error Workflow" setting pointed at the error logger.

All logging nodes use `continueOnFail: true` — logging failures never break the main workflow.

## Client Resolution

`workflow_events.client_id` is `NOT NULL`. Each workflow group resolves it differently:

| Group | Workflows | Resolution |
|---|---|---|
| Real estate webhooks (6) | Instant Lead Response, Open House Follow-Up, Open House Setup, Listing Description, Review Request, 7-Touch Nurture | `SELECT id FROM clients WHERE primary_contact_email = $agent_email` |
| B&B (2) | Lead Generator, Estimate | Hardcode `86a01b94-ddab-4594-8afc-8212fb18fdd0` |
| Internal/system (3) | Chief of Staff, Client Health Query, Red Alert Scheduler | Hardcode `e2f9934c-4d28-4bb4-ac90-4284c1123517` (norrai_internal) |
| Lead Cleanser pipeline (7) + misc (3) | Zillow/Realtor/Facebook/Custom Intake, Lead Cleanser, Lead Response Auto, Lead Action Handler, Client Discovery, Client Onboarding, Event Ops Discovery | norrai_internal for now — update when per-client routing exists |

If the agent email lookup returns no row (agent not yet in `clients`), the logging nodes skip gracefully via `continueOnFail`. The main workflow still runs.

## Node Pattern Per Workflow

### Position in the workflow
```
Token Check → Lookup Client → Log Triggered → [existing nodes] → Log Completed
```

For B&B and internal workflows with no token check, Lookup Client + Log Triggered fire as the first nodes.

### Lookup Client (Postgres, `continueOnFail: true`)
Real estate:
```sql
SELECT id FROM clients WHERE primary_contact_email = '{{ $json.body.agent_email }}'
```
B&B and internal: no lookup node — `client_id` is set directly in the Log Triggered Code node.

### Log Triggered (Postgres, `continueOnFail: true`)
```sql
INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)
VALUES (
  '{{ $('Lookup Client').first().json.id }}',
  'instant_lead_response',
  'triggered',
  '{"execution_id": "{{ $execution.id }}", "agent_email": "{{ $json.body.agent_email }}"}'::jsonb
)
```

### Log Completed (Postgres, `continueOnFail: true`)
```sql
INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)
VALUES (
  '{{ $('Lookup Client').first().json.id }}',
  'instant_lead_response',
  'completed',
  '{"execution_id": "{{ $execution.id }}"}'::jsonb
)
```

### B&B Lead Generator (existing partial logging)
Already logs `completed` at end with leads/counts summary. Changes:
- Add Log Triggered at start with `execution_id` in payload
- Update existing `completed` payload to include `execution_id`
- No Lookup Client node needed (client_id hardcoded in Code node)

## Error Logger Workflow

**`Norr AI Workflow Error Logger`** — 4 nodes:

### Node 1: Error Trigger
Receives n8n's error payload:
```json
{
  "execution": {
    "id": "abc123",
    "workflowName": "Real Estate Instant Lead Response",
    "error": { "message": "...", "node": { "name": "..." } },
    "startedAt": "...",
    "stoppedAt": "..."
  }
}
```

### Node 2: Resolve Client (Code node)
Static map of workflow display name → `{ client_id, workflow_name }`.

- B&B and internal workflows: hardcoded `client_id`
- Real estate and pipeline workflows: `client_id: null` — resolved in Node 3

```js
const map = {
  'Real Estate Instant Lead Response': { client_id: null, workflow_name: 'instant_lead_response' },
  'Real Estate Open House Follow-Up':  { client_id: null, workflow_name: 'open_house_follow_up' },
  'Real Estate Open House Setup':      { client_id: null, workflow_name: 'open_house_setup' },
  'Real Estate Listing Description Generator': { client_id: null, workflow_name: 'listing_description' },
  'Real Estate Review Request':        { client_id: null, workflow_name: 'review_request' },
  'Real Estate 7-Touch Cold Nurture':  { client_id: null, workflow_name: 'cold_nurture' },
  'B&B Lead Generator':                { client_id: '86a01b94-ddab-4594-8afc-8212fb18fdd0', workflow_name: 'bnb_lead_generator' },
  'B&B Manufacturing Estimate':        { client_id: '86a01b94-ddab-4594-8afc-8212fb18fdd0', workflow_name: 'bnb_estimate' },
  'Norr AI Chief of Staff':            { client_id: 'e2f9934c-4d28-4bb4-ac90-4284c1123517', workflow_name: 'norrai_chief_of_staff' },
  'Norr AI Client Health Query':       { client_id: 'e2f9934c-4d28-4bb4-ac90-4284c1123517', workflow_name: 'client_health_query' },
  'Norr AI Red Alert Scheduler':       { client_id: 'e2f9934c-4d28-4bb4-ac90-4284c1123517', workflow_name: 'red_alert_scheduler' },
  // Lead Cleanser pipeline + misc → norrai_internal
};
const executionId = $json.execution.id;
const workflowName = $json.execution.workflowName;
const entry = map[workflowName] || { client_id: 'e2f9934c-4d28-4bb4-ac90-4284c1123517', workflow_name: workflowName.toLowerCase().replace(/\s+/g, '_') };
return [{ json: { ...entry, execution_id: executionId, error_message: $json.execution.error.message, error_node: $json.execution.error?.node?.name || '' } }];
```

### Node 3: Lookup client_id from triggered event (Postgres, `continueOnFail: true`)
Only runs when `client_id` is null. Uses `execution_id` for an exact match — reliable even for long-running workflows (e.g., 7-Touch Cold Nurture with 21-day Wait nodes):

```sql
SELECT client_id FROM workflow_events
WHERE workflow_name = '{{ $json.workflow_name }}'
  AND event_type = 'triggered'
  AND payload->>'execution_id' = '{{ $json.execution_id }}'
LIMIT 1
```

Falls back to norrai_internal UUID if no row found (e.g., failure occurred before Log Triggered fired).

### Node 4: Log Failed (Postgres, `continueOnFail: true`)
```sql
INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)
VALUES (
  '{{ $json.client_id || 'e2f9934c-4d28-4bb4-ac90-4284c1123517' }}',
  '{{ $json.workflow_name }}',
  'failed',
  '{"execution_id": "{{ $json.execution_id }}", "error": "{{ $json.error_message }}", "node": "{{ $json.error_node }}"}'::jsonb
)
```

## `workflow_name` Registry

| Workflow | `workflow_name` |
|---|---|
| Real Estate Instant Lead Response | `instant_lead_response` |
| Real Estate Open House Follow-Up | `open_house_follow_up` |
| Real Estate Open House Setup | `open_house_setup` |
| Real Estate Listing Description Generator | `listing_description` |
| Real Estate Review Request | `review_request` |
| Real Estate 7-Touch Cold Nurture | `cold_nurture` |
| B&B Lead Generator | `bnb_lead_generator` |
| B&B Manufacturing Estimate | `bnb_estimate` |
| Norr AI Chief of Staff | `norrai_chief_of_staff` |
| Norr AI Client Health Query | `client_health_query` |
| Norr AI Red Alert Scheduler | `red_alert_scheduler` |
| Real Estate Lead Cleanser | `lead_cleanser` |
| Real Estate Zillow Intake | `zillow_intake` |
| Real Estate Realtor Intake | `realtor_intake` |
| Real Estate Facebook Intake | `facebook_intake` |
| Real Estate Custom Form Intake | `custom_form_intake` |
| Real Estate Lead Response Auto | `lead_response_auto` |
| Real Estate Lead Action Handler | `lead_action_handler` |
| Client Discovery → Claude Analysis | `client_discovery` |
| Client Onboarding → Claude Analysis | `client_onboarding` |
| Event Ops Discovery | `event_ops_discovery` |

## Files

| File | Action |
|---|---|
| `db/migrations/002_norrai_internal_client.sql` | Create |
| `n8n/workflows/Norr AI Workflow Error Logger.json` | Create |
| All 20 workflow JSON files | Modify — add Lookup Client, Log Triggered, Log Completed nodes + Error Workflow setting |

## Credentials Used

| Credential | Used in |
|---|---|
| Neon Postgres (`NEON_CREDENTIAL_ID`) | All logging nodes in all workflows + Error Logger |

## Known Limitations

- Lead Cleanser pipeline and misc workflows log against norrai_internal — no per-client attribution until per-client routing is built.
- If a workflow fails before the Log Triggered node fires (e.g., Token Check rejects the request), no `triggered` event exists. The error logger falls back to norrai_internal for the `failed` event.
- B&B Lead Generator currently logs `completed` only. This update adds `triggered` and updates the `completed` payload to include `execution_id`.

## Out of Scope

- Per-workflow silence thresholds (dashboard hardcodes: 7 days event-driven, 2 days scheduled)
- Retry event type
- Enriching payload with lead-specific data beyond `agent_email` and `execution_id`
