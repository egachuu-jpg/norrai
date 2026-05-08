# Norr AI Chief of Staff — Design Spec

**Date:** 2026-05-07
**Type:** Internal tool (not client-facing)
**Status:** Approved design, not yet implemented

---

## Overview

A lightweight internal automation that reminds Egan of open tasks in the Norr AI project twice a week via Slack. CLAUDE.md is the source of truth — the workflow reads it directly from GitHub, parses unchecked task items, and posts a structured Slack message. No new infrastructure required.

---

## Why This Before Real Estate Chief of Staff

The Real Estate AI OS spec is designed and ready. It should be implemented when a real estate agent client commits — not speculatively. The Norr AI Chief of Staff delivers immediate, zero-dependency value in a fraction of the build time.

---

## Architecture

One n8n workflow, 5 nodes:

```
Schedule Trigger
    → HTTP Request (GitHub API — fetch raw CLAUDE.md)
    → Code node (parse unchecked [ ] items by section)
    → Code node (build Slack Block Kit message)
    → HTTP Request (Slack Incoming Webhook — post)
```

### Node Details

**1. Schedule Trigger**
- Monday and Thursday at 8:00am CT
- n8n cron expression: `0 13 * * 1,4` (UTC)

**2. HTTP Request — GitHub API**
- Fetches raw `CLAUDE.md` from `egachuu-jpg/norrai` repo
- Endpoint: GitHub Contents API, returns base64-encoded content
- Auth: GitHub Personal Access Token stored as n8n HTTP Header Auth credential
- Decodes base64 → plain text in downstream Code node

**3. Code Node — Parser**
- Finds the `## Open Tasks` section in CLAUDE.md
- Extracts all lines matching `- [ ]` (unchecked items only; `- [x]` lines skipped)
- Groups items by subsection (`### Immediate`, `### Security`, `### Near Term`, etc.)
- Returns structured object: `{ sectionName: [task strings] }`

**4. Code Node — Message Builder**
- Builds Slack Block Kit payload
- Header block: "Norr AI — Open Tasks" + today's date
- One section block per subsection that has open items (empty subsections omitted)
- Each section shows up to 5 items; if more exist, appends "+ N more"
- Items rendered as plain text bullet list

**5. HTTP Request — Slack Incoming Webhook**
- Posts Block Kit JSON payload to Slack Incoming Webhook URL
- Auth: Webhook URL stored as n8n credential (HTTP Header Auth or plain URL in body)
- No Slack bot or app approval required — Incoming Webhook is self-contained

---

## Message Format

```
Norr AI — Open Tasks  |  Thu, May 8 2026

Immediate
• Upgrade Twilio account, buy local 507 number
• Open Relay bank account once MN LLC approval arrives

Security
• Fix innerHTML → textContent in open_house_setup.html
• Add token check to event_ops_discovery.html n8n workflow
• Add rate limiting to n8n webhook endpoints
  + 4 more

Near Term
• Smoke test B&B workflow
• Smoke test Lead Cleanser pipeline
  + 5 more
```

Rules:
- Only `- [ ]` items included — completed `- [x]` items are excluded
- Sections with zero open items are omitted entirely
- Sections with more than 5 items show first 5 + "+ N more" count
- Header includes the day and date the workflow ran

---

## Credentials Required

| Credential | Type | Where used |
|---|---|---|
| GitHub PAT | HTTP Header Auth (`Authorization: token <PAT>`) | GitHub API node |
| Slack Incoming Webhook URL | n8n HTTP Request URL | Slack post node |

Both are created once at setup time and stored in n8n credentials. No secrets in workflow JSON.

---

## What This Is Not

- Not interactive — no buttons, no task completion from Slack
- Not a replacement for CLAUDE.md — CLAUDE.md remains the canonical task list
- Not client-facing — internal to Egan only

---

## Growth Path

When the task reminder is working, natural next steps (in order of value):

1. **Prospect follow-up reminders** — surface warm leads from Neon that haven't been contacted in N days
2. **Client health alerts** — flag active clients with no recent workflow events
3. **Weekly business summary** — leads added, workflows fired, revenue pipeline

Each addition is a new Code node + additional Neon query. The Slack delivery and schedule infrastructure stays the same.
