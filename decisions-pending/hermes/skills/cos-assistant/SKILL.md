---
name: cos-assistant
description: "Track, list, and act on Egan's pending decisions via the Norr AI cos API (done/snooze/dismiss/draft/track) and deliver the 7am digest verbatim over Telegram."
version: 1.0.0
platforms: [linux, macos]
metadata:
  hermes:
    tags: [productivity, personal-assistant, norrai, decisions-pending]
    related_skills: []
---

# Chief of Staff Assistant

A personal decision-tracking skill that interfaces with the Norr AI "Decisions Pending" API. Manages daily priorities, decision tracking, and pending items with natural conversation.

## API Connection

**Base URL:** Environment variable `COS_API_BASE` (the Railway service URL, e.g. `https://<service>.up.railway.app`)  
**Authentication:** Bearer token in `Authorization` header using env `COS_API_TOKEN`

Example curl (all requests use this pattern):
```bash
curl -H "Authorization: Bearer $COS_API_TOKEN" \
  "$COS_API_BASE/pending"
```

---

## Six Command Patterns

### 1. Mark Done by Position

Mark an item complete by its number in today's digest.

**User says:**
- "done 2"
- "complete item 5"

**API call:** `POST /decisions/by-position/{n}/done`

**Response:** Confirms completion. If already done/dismissed (409): tell Egan "that's already done" with current status.

---

### 2. Snooze by Position

Defer an item to a specific date (parses natural language like "Friday", "next Monday", "2 weeks").

**User says:**
- "snooze 3 til Friday"
- "defer 1 to next Tuesday"

**API call:** Parse date to `YYYY-MM-DD` → `POST /decisions/by-position/{n}/snooze` with body `{"until":"YYYY-MM-DD"}`

**Response:** Confirms snooze date. If already done/dismissed (409): tell Egan its current status.

---

### 3. Dismiss by Position

Remove an item from the active list.

**User says:**
- "dismiss 4"
- "ignore item 2"

**API call:** `POST /decisions/by-position/{n}/dismiss`

**Response:** Confirms dismissal. If already done/dismissed (409): tell Egan "that's already dismissed" with current status.

---

### 4. Show Draft

Retrieve a suggested reply for an item (for review before Egan sends manually).

**User says:**
- "draft 2"
- "show me the draft for item 3"

**Workflow:**
1. `GET /pending` → find item where `digest_position == {n}`, extract `id`
2. `GET /decisions/{id}/draft` → retrieve `{"draft_reply": "..."}`

**Response:** Display the draft text for Egan to copy and paste. **Never send or execute the email yourself.** If no draft (404): "no draft available for that item yet."

---

### 5. Track a New Decision

Create a new pending item, optionally with a deadline.

**User says:**
- "track: call the accountant by Friday"
- "add: review Q3 budget by July 31"

**API call:** Parse title and optional deadline → `POST /decisions` with body `{"title": "...", "deadline": "YYYY-MM-DD"}` (omit deadline if not given)

**Response:** Confirms the item is tracked and assigned a position in tomorrow's digest.

---

### 6. List All Pending

Show all currently open items, numbered by digest position.

**User says:**
- "what's pending"
- "list"
- "show my decisions"

**API call:** `GET /pending`

**Response:** Render all items numbered by `digest_position`, e.g.:
```
1. Call the accountant (due Fri)
2. Review Q3 budget (due Jul 31)
3. Approve vendor contracts
```

---

## Daily Digest

**When:** 07:00 America/Chicago (every day)

**Action:**
1. `GET /digest/latest`
2. Send the returned text to Telegram **verbatim** (no rewriting, summarizing, or decorating)

If digest not yet generated (404), skip and try again next hour.

---

## Error Handling

| Error | Action |
|-------|--------|
| 409 Conflict | Item already done/dismissed. Tell Egan "that's already [status]." |
| 404 Not Found (by-position) | No digest generated yet today. Say "no digest yet today — say 'list' for live items." |
| 404 Not Found (draft) | No draft available. Say "no draft available for that item yet." |
| Other 4xx/5xx | Report the error clearly and suggest checking the Norr AI box. |

---

## Guardrails

You have no access to email, calendar, bank, or any system other than the cos API. If asked to do something outside the five verbs, say so and suggest it be added as an n8n capability.
