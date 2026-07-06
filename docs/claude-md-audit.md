# CLAUDE.md Audit — 2026-07-06

Scope: `garmin-sandbox/CLAUDE.md`, `norrai/CLAUDE.md`, plus the supporting
`.claude/` config, `docs/lessons-learned.md`, and `/session-end` command in norrai.

Companion deliverables:
- `docs/global-CLAUDE.md` — install at `~/.claude/CLAUDE.md`, loads in every project
- `docs/project-CLAUDE-template.md` — starter CLAUDE.md for future projects

---

## garmin-sandbox/CLAUDE.md — grade: A-

This is the stronger of the two files. It documents *invariants and why*, which is
exactly what a CLAUDE.md is for: the prompt-caching section explains the failure mode
("if `cache_read` stays 0, caching is broken"), the MCP singleton section explains the
eviction rationale, Key Constraints lists things that fail *silently* when violated.
Stating "no test suite or ESLint exists" is also correct practice — absence is
information Claude can't infer.

### Findings

1. **Model ID pinned in prose** ("claude-sonnet-4-6" in the overview). Model IDs
   retire — norrai's lessons-learned documents exactly this scramble (13 workflows,
   6 nodes each, all 404ing). Say "model configured in `lib/agent.ts`" instead of
   naming the ID in docs.
2. **Drift-prone counts**: "Seven tables", "~110 tools but the coach only receives
   ~60", "capped at 25 rounds". Tilde-prefixed approximations are fine; exact counts
   ("Seven tables") go stale the first time a table is added. Describe the rule, not
   the tally.
3. **No session/lessons discipline.** norrai has SESSION_LOG.md + lessons-learned.md +
   `/session-end`; garmin-sandbox has none. Hard-won gotchas (the `curl_cffi`
   LD_LIBRARY_PATH constraint, the Playwright `setOffline` note) are currently mixed
   into architecture prose — the convention should be consistent across projects.
   The global file makes this the default.
4. **No `.claude/` directory at all** — no permission allowlist (more prompts per
   session), no hooks, no commands. Low-effort win: a `settings.json` allowing
   `npm run *`, `npx tsc --noEmit`.
5. Minor duplication with `DEPLOY.md` (Railway/MFA/volume details appear in both).
   Keep the one-line constraint in CLAUDE.md, link the walkthrough.

---

## norrai/CLAUDE.md — grade: C+ (great content, wrong container)

The core problem: at ~21.6 KB (~5,500 tokens loaded **every turn**), roughly half the
file is volatile state rather than instructions. The file itself already knows the
right pattern — the Open Tasks section says "tasks are tracked in Neon, not here."
That same logic needs to be applied to about half the remaining sections.

### Bugs (fix these — they cause wrong behavior)

1. **Session Wrap-Up contradicts your own schema.** The wrap-up section says
   `UPDATE stories SET status = 'completed'`, but `docs/lessons-learned.md` records
   that the `stories` CHECK constraint accepts `active | paused | done | cancelled` —
   **NOT `completed`**. Every wrap-up that finishes a story either errors or gets
   silently skipped. Change to `status = 'done'`.
2. **`/session-end` command is out of sync with CLAUDE.md.** The command says to
   extract lessons into `CLAUDE.md ## Lessons Learned` and commit CLAUDE.md — but
   lessons were moved to `docs/lessons-learned.md` (CLAUDE.md now just points there,
   and its own wrap-up section says to commit SESSION_LOG.md + docs/lessons-learned.md).
   Following the command as written would resurrect a lessons section inside CLAUDE.md.
3. **Hooks hardcode `/Users/Egan/Documents/Claude/Projects/NorrAI`**
   (`run-playwright.py`, `session-reminder.py`). In any web/remote session — like this
   one — those paths don't exist, so the hooks silently no-op or error. Use
   `os.environ["CLAUDE_PROJECT_DIR"]` instead.
4. **Hooks may not be registered at all.** The checked-in `.claude/settings.json`
   contains only `permissions` — no `hooks` block. If they're only wired in your local
   `settings.local.json` (untracked), they run on your machine only; if nowhere, they
   never run. Verify, and check in the registration if they're meant to be part of the
   project.

### Staleness / internal contradictions

5. Project Structure tree shows `tests/` containing a single spec file; the Testing
   section says 11 spec files. The tree also omits `docs/`, `scripts/`, `cos/`,
   `obsidian/`, `PRD/`, `.claude/`. Directory trees in CLAUDE.md rot fast — keep a
   shallow one (top-level dirs + one-line purpose) or drop it.
6. Research Agent section says "Gemini 2.0 Flash" in the stack; lessons-learned says
   2.0 is unavailable to new API users and 2.5 is the replacement.
7. "276 tests across 11 spec files" — exact counts drift with every test added.
8. Business-status bullets ("LLC — pending approval", "Banking: Relay — pending")
   have no dates and will read as current forever. Date them or move to a status doc.

### Volatile state that should move out of CLAUDE.md

9. **Workflow name registry (39 rows).** This is data, not instructions. It belongs
   in Neon (it already *is* the source of truth for `workflow_events.workflow_name`)
   or `n8n/README.md`. Keep the logging *standard* (the 4-node pattern) in CLAUDE.md;
   move the table.
10. **Workflows Built** — status-log entries ("Working end to end", "smoke tested
    2026-05-10", webhook URLs). This is SESSION_LOG / per-workflow doc territory.
11. **Ideas / Parking Lot** — a ~400-word prose spec. Move to `docs/ideas.md`.

Moving 9–11 plus trimming duplication cuts the file roughly in half with zero
information loss — everything keeps a one-line pointer.

### Duplication

12. n8n Operational Notes overlap `docs/lessons-learned.md` (multiline prompt
    pattern, click tracking, timezone expression all appear in both). Pick one home:
    operational *rules* in CLAUDE.md, *gotchas/history* in lessons-learned.
13. `.claude/commands/n8n-audit.md` and `.claude/skills/n8n-audit/SKILL.md` both
    exist — two invocation surfaces for the same thing to keep in sync. Keep the
    skill, delete the command stub (or make it a one-line redirect).

### docs/lessons-learned.md (quick pass)

Excellent discipline overall — one-line, domain-grouped, non-obvious. Three nits:
- Duplicate `## HTML / JavaScript` heading (appears twice; merge).
- Two entries misfiled under `## Gemini`: "Never commit .env" and the
  `appointments` table note belong under Architecture/DB.
- At 171 lines it's approaching the point where a short table of contents helps.

### What norrai does right (preserved in the global file)

Risk-based test coverage table · the logging-standard node pattern · sales principles
kept to four lines · "tasks live in Neon" pointer pattern · the donezo/session-end
ritual · lessons-learned as a separate deduped file · `block-env-edit` hook concept.

---

## The global strategy

Three layers, each with a clear job:

| Layer | File | Contains |
|---|---|---|
| Global | `~/.claude/CLAUDE.md` (from `docs/global-CLAUDE.md`) | Who you are, timezone, git/safety rails, risk-based testing, LLM-work rules, security defaults, session ritual, CLAUDE.md hygiene rules |
| Project | `<repo>/CLAUDE.md` (from `docs/project-CLAUDE-template.md`) | Commands, architecture invariants + why, constraints, pointers |
| Reference | `docs/`, DB, schema files | Everything volatile or bulky, linked from above |

The global file deliberately promotes lessons you've already paid for once so no
future project pays for them again: centralized model IDs, `[DATA]` delimiters,
markdown-fence stripping, UTC-vs-Chicago date math, fail-loud on send nodes,
idempotent confirm links, SQL/HTML escaping, double-submit guards.

## Recommended fix order

1. `stories SET status = 'done'` in Session Wrap-Up (bug, 30 seconds)
2. Sync `/session-end` command with the lessons-learned.md location (bug)
3. Fix hook paths → `CLAUDE_PROJECT_DIR`; verify hook registration
4. Install `docs/global-CLAUDE.md` → `~/.claude/CLAUDE.md`
5. Slim norrai CLAUDE.md (move registry, Workflows Built, Parking Lot out)
6. Add `.claude/settings.json` + session-end to garmin-sandbox
