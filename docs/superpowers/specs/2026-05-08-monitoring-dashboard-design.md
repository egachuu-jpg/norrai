# NorrAI Client Health Monitoring Dashboard — Design Spec

## Goal

An internal ops dashboard at `/internal/dashboard.html` that shows red/yellow/green health status per client, backed by `workflow_events` in Neon. A scheduled n8n job posts Slack alerts at 6am and 6pm CT when any client is red.

## Architecture

Three pieces, all using the existing stack:

1. **`website/internal/dashboard.html`** — static HTML page behind Cloudflare Access (`/internal/*`). Fetches health JSON from n8n on load and on manual refresh. No auto-refresh. Follows Polar Modern design system.

2. **Health Query webhook** (`GET /webhook/client-health`) — n8n workflow. Queries Neon via Postgres node, applies health logic in a Code node, returns JSON. Token-protected with `X-Norr-Token` header.

3. **Red Alert Scheduler** — n8n workflow with two Cron triggers (6am CT = 12:00 UTC, 6pm CT = 00:00 UTC next day). Runs the same health query, filters to red clients, posts a Slack message if any are found. Silent if no red clients.

## Health Logic

Applied per client, per workflow, over the `workflow_events` table:

| Status | Condition |
|--------|-----------|
| **Red** | Any `event_type = 'failed'` in the last 7 days |
| **Yellow** | No `event_type = 'triggered'` in the last 2 days (scheduled workflows) or last 7 days (event-driven workflows) |
| **Green** | Has recent `triggered` events and no failures in the 7-day window |

**Client-level status** = worst across all its workflows (one red workflow = red client).

**Scheduled vs. event-driven classification** is applied in the Code node:
- Scheduled: `chief_of_staff`, any workflow with `_schedule` in the name
- Event-driven: everything else

**Clients included:** only `clients` where `status = 'active'`.

**Important prerequisite:** Only `B&B Lead Generator` currently writes to `workflow_events`. All real estate workflows need `workflow_events` INSERT nodes added before this dashboard reflects real data. See CLAUDE.md todo: "Audit workflow_events logging coverage."

## Health Query JSON Response

```json
{
  "generated_at": "2026-05-08T12:00:00Z",
  "clients": [
    {
      "id": "uuid",
      "business_name": "Johnson Realty",
      "vertical": "real_estate",
      "tier": "starter",
      "status": "red",
      "workflows": [
        {
          "workflow_name": "instant_lead_response",
          "status": "red",
          "last_triggered_at": "2026-05-01T09:00:00Z",
          "last_failed_at": "2026-05-07T14:23:00Z",
          "failures_7d": 2
        },
        {
          "workflow_name": "open_house_follow_up",
          "status": "green",
          "last_triggered_at": "2026-05-07T09:00:00Z",
          "last_failed_at": null,
          "failures_7d": 0
        }
      ]
    }
  ]
}
```

## Neon Query

The Postgres node runs:

```sql
SELECT
  c.id,
  c.business_name,
  c.vertical,
  c.tier,
  we.workflow_name,
  MAX(CASE WHEN we.event_type = 'triggered' THEN we.created_at END) AS last_triggered_at,
  MAX(CASE WHEN we.event_type = 'failed'    THEN we.created_at END) AS last_failed_at,
  COUNT(CASE WHEN we.event_type = 'failed'
             AND we.created_at > now() - interval '7 days' THEN 1 END) AS failures_7d
FROM clients c
LEFT JOIN workflow_events we ON we.client_id = c.id
WHERE c.status = 'active'
GROUP BY c.id, c.business_name, c.vertical, c.tier, we.workflow_name
ORDER BY c.business_name, we.workflow_name;
```

A Code node then groups rows by client, classifies each workflow's status, and computes the client-level rollup.

## Dashboard UI

**Polar Modern design system** — same tokens as all other internal pages (`--bone`, `--ink`, `--glacial`, Inter Tight / Inter / JetBrains Mono).

**Header:** dark (`--ink` background), "Client Health" title, last-fetched timestamp (e.g., "Last updated 6:02 AM"), "Refresh" button (calls the webhook again and re-renders).

**Grid:** client cards sorted red → yellow → green. On equal status, sorted alphabetically by business name.

**Each card contains:**
- Business name (prominent)
- Vertical + tier badge (e.g., "Real Estate · Starter")
- Large status dot (red / yellow / green) with label
- Inline workflow list: each workflow name + its own status dot

**States:**
- Loading: spinner while webhook is fetching
- Error: error banner if the webhook call fails, with a retry button
- Empty: "No active clients" if `clients` returns no active rows

## Slack Alert

**Trigger:** 6am CT and 6pm CT via n8n Cron node, using `America/Chicago` timezone (handles DST automatically — do not hardcode UTC offsets).

**Logic:** Run health query → filter `clients` where `status = 'red'` → if none, do nothing → if any, post to Slack.

**Message format:**
```
*Client Health Alert — [N] client(s) need attention*

🔴 Johnson Realty
  • instant_lead_response — 2 failures in last 7 days (last: May 7, 2:23 PM)

🔴 Sunrise Dental
  • appointment_reminder — no activity in 7 days
```

**No message posted** when all clients are green or yellow — silence means healthy.

## Files

| File | Action |
|------|--------|
| `website/internal/dashboard.html` | Create |
| `n8n/workflows/Norr AI Client Health Query.json` | Create |
| `n8n/workflows/Norr AI Red Alert Scheduler.json` | Create |

## Credentials Used

| Credential | Used in |
|------------|---------|
| Neon Postgres (`NEON_CREDENTIAL_ID`) | Both n8n workflows |
| Slack (`SLACK_CREDENTIAL_ID`) | Red Alert Scheduler |

## Out of Scope

- Per-workflow silence thresholds configurable via UI (hardcoded: 7 days event-driven, 2 days scheduled)
- Yellow-status Slack alerts
- Historical charts or trend data
- Client-level drill-down pages
