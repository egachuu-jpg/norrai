# Spec 10 — `session-end` upgrade: follow-ups to Neon, lessons to lint

## Problem

Two leaks in the wrap-up ritual:

1. **Flagged follow-ups die in the session log.** 07-11 flagged three known problems (B&A silent 415s, ZZ TEST eating prod queue rows, dormant Apify credential) as prose bullets — none became Neon tasks, so nothing surfaced them again. The board (`stories`/`tasks`) is the system of record for open work, but session-end never writes to it.
2. **Checkable lessons never become checks.** The `contentType:"raw"` failure was documented in lessons-learned (Apify, 07-09) and then shipped again the next day on SendGrid — because a lesson in a markdown file doesn't stop anything. Spec 02 builds the linter; this spec makes the pipeline self-feeding: every new mechanically-checkable lesson gets a lint rule at the moment it's captured.

## Goal

Amend the existing wrap-up skill so follow-ups land on the Neon board and checkable lessons land in the linter — as part of the same "donezo" motion, not as separate discipline the user has to remember.

## Deliverable

Edited `.claude/commands/session-end.md` (the live skill — note there is no `.claude/skills/session-end/`; it lives in commands). Keep the existing 3 steps; insert two new steps between current step 2 (extract lessons) and step 3 (commit).

## New step 2a — Flagged follow-ups → Neon tasks

Text to add (adapt wording to the file's existing voice):

> **2a. Push open follow-ups to the Neon board**
> - Re-scan the session for anything flagged but not fixed: "pending", "deferred", "follow-up", "known issue", "not fixed", "next session", TODO items, and anything in the SESSION_LOG entry you just wrote that describes a problem left open.
> - For each, check it isn't already on the board: `SELECT id, title, status FROM tasks WHERE title ILIKE '%<keyword>%';`
> - If new, INSERT into `tasks` — one `run_sql` statement per task: `title` (imperative, specific — "Fix B&A SendGrid raw pattern", not "SendGrid issue"), `priority` (`high` if it can silently affect a live client, else `medium`), `category` (valid values: research, analysis, dev, testing, ops), `context` (2–3 sentences: symptom, root cause if known, pointer to the SESSION_LOG date), `status` = the board's default open status (check `SELECT DISTINCT status FROM tasks` once rather than guessing).
> - Attach to an existing story via `story_id` when one clearly matches; otherwise leave standalone.
> - List the created task titles in the wrap-up summary. If the session left nothing open, say so explicitly ("no open follow-ups") — silence is not a signal.

## New step 2b — Checkable lessons → lint rules

> **2b. Convert checkable lessons to lint rules**
> - For each lesson added in step 2, ask: *could `scripts/n8n_lint.py` detect this violation from workflow JSON alone?* (Pattern present/absent in node parameters, a field-combination rule, a regex over queries/expressions → yes. Judgment calls about prompts, business logic, or live-instance state → no.)
> - If yes: add the rule to `scripts/n8n_lint.py` in the same commit — new rule id (next L##), severity per the existing table's convention (silent-failure classes = ERROR, degraded-but-visible = WARN), and append a one-line entry to the rules table in `docs/superpowers/specs/2026-07-13-n8n-lint-design.md`. Cross-reference the rule id at the end of the lesson line ("— enforced by L14").
> - Run the linter over `n8n/workflows/` after adding the rule; if it flags existing files, either fix them now (small) or create a Neon task per step 2a (large).
> - If `scripts/n8n_lint.py` does not exist yet, note "lint rule pending Spec 02" on the lesson line instead — do not skip silently.

## Update step 3 (commit)

Widen the staging list: "Stage `SESSION_LOG.md`, `docs/lessons-learned.md`, and — when step 2b touched them — `scripts/n8n_lint.py` + the lint spec." Commit message stays `docs: session wrap-up YYYY-MM-DD` unless lint rules were added, in which case use `docs: session wrap-up YYYY-MM-DD (+lint L##)`.

Also keep CLAUDE.md's existing "Additional step — update Neon tasks" instruction in mind: step 2a *adds* open work; the existing instruction *closes* finished work. Both run; don't merge them into one pass (closing uses `status='completed'`, and stories use `done` — the CHECK constraint rejects `completed` on stories).

## Retroactive seed (do once, as part of implementing this spec)

Run step 2a against the 07-09 and 07-11 SESSION_LOG entries and create the tasks that should already exist (skip any that Specs 04/06 have meanwhile fixed):

- Fix Birthday & Anniversary SendGrid raw pattern (high, dev) — Spec 04
- Isolate ZZ TEST drip copy from prod listing_queue (high, dev) — Spec 06
- Remove dormant Apify credential from Weekly Drip Send (medium, ops) — Spec 06

## Acceptance criteria

- A test wrap-up on a synthetic session transcript containing one unfixed problem and one new checkable lesson produces: a SESSION_LOG entry, a lessons-learned line ending "— enforced by L##", a new lint rule that fires on a crafted violation, and one new Neon task — all in one commit (plus the Neon writes).
- Running "donezo" on a clean session (nothing open, no lessons) produces the log entry and explicitly reports "no open follow-ups / no new lessons" without creating board noise.
- The three retroactive seed tasks exist on the board (or are verifiably already fixed).

## Non-goals

- No automation of the wrap-up trigger itself (stays on "donezo"/"wrap up"). No changes to the Stop-hook reminder.
