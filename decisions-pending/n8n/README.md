# Decisions Pending — n8n Collectors

Workflow JSON exports for the data-plane collectors described in the
decisions-pending dev spec (Phase B). Import directly into the Norr AI n8n
instance. These run alongside — and follow the same conventions as — the
main `n8n/` workflow set at the repo root (see that directory's `README.md`
for the `workflow_name` registry of client-facing workflows).

## Logging Standard

Same standard as the root `CLAUDE.md` § Workflow Logging Standard: every
workflow logs `triggered` / `completed` / `failed` to `workflow_events`,
gated by a `Lookup Client` node. Because these are internal/system workflows
with no per-client routing yet, `client_id` is hardcoded to
`e2f9934c-4d28-4bb4-ac90-4284c1123517` (`norrai_internal`) in all four —
matching the "Internal/system + Lead Cleanser + misc" rule.

All logging/lookup nodes use `continueOnFail: true` (`onError:
continueRegularOutput`) so a logging failure never breaks the main workflow.
`errorWorkflow` is set to `Norr AI Workflow Error Logger` and `timezone` to
`America/Chicago` on all four.

## `workflow_name` Registry

| Workflow | File | `workflow_name` | Schedule (America/Chicago) | Purpose |
|---|---|---|---|---|
| Decisions Pending — Digest | `wf-digest.json` | `cos_digest` (v0.1) | Daily 05:30 | Runs the escalation/expiry SQL, pulls weather + `cos.v_surfaced` + nagged items, has Claude Fable 5 synthesize the 7am Telegram digest text, logs it to `cos.digest_log`. |
| Decisions Pending — Gmail Collector | `wf-gmail-collector.json` | `cos_gmail_collector` (v1.1) | Every 30 min, 06:00–21:30 (`*/30 6-21 * * *`) | Polls 4 inboxes independently (eganbonde@gmail.com, egachuu@gmail.com, egan@norrai.co, hello@norrai.co), classifies actionability with Claude Opus 4.8 (Claude Fable 5 as a low-confidence second opinion), and upserts/resolves rows in `cos.pending_decisions`. Ships with a `dry_run` kill switch (see below). |
| Decisions Pending — Calendar Collector | `wf-calendar-collector.json` | `cos_calendar_collector` (v1.1) | Daily 05:00 | Pulls the next 14 days of events from all 4 accounts' calendars (eganbonde@gmail.com, egachuu@gmail.com, egan@norrai.co, hello@norrai.co), has Claude Opus 4.8 flag ones needing prep, upserts flagged events into `cos.pending_decisions`. |
| Decisions Pending — Rules Expander | `wf-rules.json` | `cos_rules` (v1.1) | Nightly 05:15 | Expands `cos.decision_rules` RRULEs (Python `dateutil.rrule`) and idempotently inserts due occurrences into `cos.pending_decisions`. |

`workflow_name` is the snake_case value stored in Neon — same registry
convention as the root `n8n/README.md`. Neon is the source of truth; when
this table disagrees with the DB, trust the DB.

## Gmail Collector — dry-run procedure

`wf-gmail-collector.json` has a `Config` Set node at the top with
`dry_run: true`, shared by all 4 inbox branches. While `true`, both write
paths (marking a thread resolved when Egan replied, and upserting a
classified decision) in every branch log the would-be action to
`cos.command_log` (`source_agent = 'collector-dryrun'`, `applied = false`)
instead of writing to `cos.pending_decisions`. **Run it dry for 2 days,
review the logged actions across all 4 inboxes in `cos.command_log`, then
flip `Config.dry_run` to `false`** to enable real writes everywhere at once.

## Gmail Collector — v1.1 multi-inbox rebuild

v1.0 polled a single Gmail credential (placeholder). v1.1 (current) polls
**4 independent inboxes** — eganbonde@gmail.com (Personal), egachuu@gmail.com
(Tech), egan@norrai.co (Norr AI), hello@norrai.co (Norr AI) — because n8n
Gmail-node credentials are static per node with no runtime switching, so
each inbox needs its own full Get-Threads → loop → classify → upsert
pipeline with its own SplitInBatches loop (a loopback can't cross
branches). The 4 branches share only the header (trigger through prompt
load) and fan back into one `Merge Branch Completion` node before
`Log Completed`, so "completed" logs exactly once per execution regardless
of how many threads were found across all 4 accounts. Full rationale and
the assumptions that still need verifying (aliased-mailbox collapse,
cross-inbox reply detection) are documented in the "Multi-Inbox Setup"
sticky note inside the workflow itself.

Two other things changed with the rebuild:
- **`source_ref` is now `{inbox}:{gmail_thread_id}`**, not the bare thread
  ID — `UNIQUE(source, source_ref)` is shared across all 4 inboxes under
  `source='email'`, and Gmail thread IDs are per-account, so namespacing
  guards against a theoretical cross-account collision.
- **Bug fix carried over from v1.0:** `Classification Upsert`'s
  `ON CONFLICT DO UPDATE` referenced `EXCLUDED.detail`, but `detail` was
  never in the INSERT column list — every re-classification silently
  nulled it out. Fixed by inserting `detail = 'Received in <inbox
  address>'`, which also surfaces which inbox a decision came from.

New credential placeholders (replace all 4 before import — see "Credential
placeholders" below): `GMAIL_CREDENTIAL_EGANBONDE`, `GMAIL_CREDENTIAL_EGACHUU`,
`GMAIL_CREDENTIAL_EGAN_NORRAI`, `GMAIL_CREDENTIAL_HELLO_NORRAI`.

The classifier prompt was bumped to `prompts/email_classifier_v2.md` — v1's
identity line only listed 2 of the 4 addresses (`egachuu@gmail.com` and
`hello@norrai.co`); v2 updates it to name all 4. This is a version bump,
not a silent edit — v1 is untouched and still on disk for history, per the
dev spec's "prompt changes are a version-bumped task" rule.

## Escalation/expiry sync

`wf-digest.json`'s "Escalation + Expiry (sync sql/003)" Postgres node embeds
the full contents of `sql/003_escalation_expiry.sql` as of when this workflow
was generated. **If that SQL file changes, re-paste its contents into the
node before the next import** — don't hand-edit the query in the n8n UI, or
the two copies will drift.

## Structural assumptions made during the Phase B build

- **Anthropic calls use the HTTP Request node** (`POST
  https://api.anthropic.com/v1/messages`, `anthropicApi` predefined
  credential type, `anthropic-version: 2023-06-01` header), matching every
  existing Claude-calling export in the root `n8n/` directory — no dedicated
  n8n Anthropic node is used anywhere in this repo.
- **`claude-fable-5` calls opt into the server-side refusal fallback**
  (`anthropic-beta: server-side-fallback-2026-06-01` header +
  `fallbacks: [{"model": "claude-opus-4-8"}]` body field) per current
  Anthropic API guidance for Fable 5 — a policy decline retries on Opus 4.8
  automatically instead of silently producing nothing. This applies to the
  digest-synthesis call and the Gmail collector's low-confidence second
  opinion. Remove if not desired.
- **Multiline prompts** (both system prompts and per-item user payloads) are
  built in a Set node first and referenced from the HTTP Request node's JSON
  body via `{{ JSON.stringify(...) }}`, per the house rule — this avoids
  hand-escaping newlines/quotes in the raw JSON body string.
- **Gmail inbox scope (v1.1)**: 4 independent branches, one per inbox — see
  "Gmail Collector — v1.1 multi-inbox rebuild" above.
- **Gmail "older than 48h"** is implemented as Gmail search `older_than:2d`
  (Gmail's search grammar has no hour-granularity `older_than` unit).
- **Calendar id (v1.1)**: 4 independent fetch branches, one per account's
  primary calendar — see "Calendar Collector — v1.1 multi-calendar rebuild"
  below. Unlike the Gmail collector, there's no per-item loop here (one
  `getAll` batch fetch per calendar), so only the fetch step is duplicated
  per account; classify/parse/split/upsert stay a single shared execution
  per run, fed by a `Merge Calendar Batches` node that flattens the 4
  fetches into one combined event list before the (unmodified, LOCKED)
  `calendar_prep_v1.md` prompt runs once over everything.
- **Rules expander Python runtime**: `wf-rules.json`'s "Expand Occurrences"
  Code node is set to `language: python` and imports `dateutil.rrule` per the
  dev spec. n8n's Python Code node runs on Pyodide, which does not ship
  `python-dateutil` by default — confirm availability (or swap to a
  JS-based RRULE library in a JavaScript Code node) before relying on this
  in production; flagged with a sticky note in the workflow.
- **Zero-item fan-out**: the Calendar Collector and Rules Expander both
  parse/expand into a single item first, then fan out with a Split Out node
  for the per-occurrence upsert — `Log Completed` connects from the
  pre-split single item so it always fires exactly once per execution, even
  when zero events/occurrences are flagged (a bare 0-item array reaching
  `Log Completed` directly would prevent it from firing at all, per the
  n8n zero-items-halts-the-branch gotcha).
- **Credential placeholders** (all replace before import): Postgres —
  `NEON_CREDENTIAL_ID` / "Neon norrai"; Anthropic — `ANTHROPIC_CREDENTIAL_ID`
  / "Anthropic account"; Gmail (one OAuth connection per inbox) —
  `GMAIL_CREDENTIAL_EGANBONDE` / "Gmail — eganbonde@gmail.com (Personal)",
  `GMAIL_CREDENTIAL_EGACHUU` / "Gmail — egachuu@gmail.com (Tech)",
  `GMAIL_CREDENTIAL_EGAN_NORRAI` / "Gmail — egan@norrai.co (Norr AI)",
  `GMAIL_CREDENTIAL_HELLO_NORRAI` / "Gmail — hello@norrai.co (Norr AI)";
  Google Calendar (one OAuth connection per account) —
  `GCAL_CREDENTIAL_EGANBONDE` / "Google Calendar — eganbonde@gmail.com
  (Personal)", `GCAL_CREDENTIAL_EGACHUU` / "Google Calendar —
  egachuu@gmail.com (Tech)", `GCAL_CREDENTIAL_EGAN_NORRAI` / "Google
  Calendar — egan@norrai.co (Norr AI)", `GCAL_CREDENTIAL_HELLO_NORRAI` /
  "Google Calendar — hello@norrai.co (Norr AI)".

## Calendar Collector — v1.1 multi-calendar rebuild

v1.0 polled a single calendar (egachuu@gmail.com, hardcoded). v1.1
(current) polls the primary calendar of all 4 accounts — same account list
as the Gmail collector, for the same reason (Egan reads/schedules across
all 4). Structurally lighter than the Gmail rebuild: there's no per-item
loop in this workflow, just one `getAll` batch fetch per calendar, so only
`Get Events` and `Build Event Batch` are duplicated per account (4 pairs,
8 nodes); everything from `Merge Calendar Batches` onward — flatten,
build prompt, the single shared Claude call, parse, split, upsert — runs
exactly once per execution regardless of how many calendars had events.

`event_id` is qualified as `{calendar_email}:{google_event_id}` before it's
sent to Claude (in `Build Event Batch`), not the bare Google event ID —
same `UNIQUE(source, source_ref)` collision-safety reasoning as the Gmail
collector's `source_ref` change, since the constraint is shared across all
4 calendars under `source='calendar'`. The LOCKED `calendar_prep_v1.md`
prompt is untouched — it just echoes back whatever `event_id` string it's
given, so no version bump was needed here (unlike the email classifier,
this prompt carries no per-address identity text).

Same open item as the Gmail collector: verify `egan@norrai.co` and
`hello@norrai.co` aren't the same Workspace mailbox/calendar via a send-as
alias before enabling — if they are, this polls one calendar twice.
