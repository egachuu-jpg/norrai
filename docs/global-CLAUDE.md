<!--
  GLOBAL CLAUDE.md — install by copying this file to ~/.claude/CLAUDE.md
  It loads in EVERY Claude Code session, in every project, so everything here
  must be project-agnostic. Project-specific facts belong in that project's
  CLAUDE.md (see docs/project-CLAUDE-template.md for the starter).
-->

# Global Instructions — Egan

## About Me

- Data engineer by day (dbt + SQL Server). Comfortable with technical depth — skip beginner explanations, show me the actual error output when something fails.
- I build side projects with Claude Code: web apps, n8n + Claude API automations, PWAs. Assume solo-developer scale unless told otherwise — no team process overhead, but production-grade reliability where real users or real money are involved.
- Timezone: **America/Chicago**. All user-facing dates, schedules, and "today" logic use Central time, never server-local or UTC.

## Communication

- Lead with the outcome, then the supporting detail. If I ask a question, answer it before doing anything else.
- When choosing between approaches, recommend one and say why — don't present an unweighted menu.
- Report failures honestly: paste the real error, say what you tried, don't declare success on partially working code.

## Git & Safety Rails

- **Never commit `.env` or any file containing live credentials.** `.env.example` is the only env file you may create or edit. If a secret ever lands in a diff, stop and tell me before committing.
- Run the project's test suite before pushing. If tests fail, fix or report — never push red.
- Don't create pull requests, publish, deploy, or send email/SMS unless I explicitly ask.
- Commit messages: short conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`) + what changed and why.
- Destructive operations (DROP, DELETE without WHERE review, force-push, rm -rf) require my confirmation with the exact command shown first.

## Testing Philosophy — risk-based coverage

Scope test effort to what failure actually costs:

| Risk | What qualifies | Minimum coverage |
|------|----------------|------------------|
| **High** | Anything that fires a paid or user-visible side effect (webhook → API → email/SMS pipelines, payments, DB writes from untrusted input) | Full: required fields, type enforcement, payload shape, UI states, double-submit protection |
| **Medium** | Interactive pages, internal tools, API routes with no external side effects | Key interactions, links resolve, no JS/console errors |
| **Low** | Static display pages, docs | Smoke test: loads, title correct, no console errors |

When adding functionality to a tested file, add tests alongside. When editing an untested file, create a test file scoped to its risk level. Bad data flowing into a send pipeline fails *silently* with real cost — that's always high risk.

## LLM / Claude API Work

- **Never scatter hardcoded model IDs.** One central config (env var, Set node, constants file) that everything references. A model retirement should be a one-line fix, not a multi-file scramble.
- Wrap all user-supplied text in prompts with explicit delimiters (`[DATA]...[/DATA]`) to blunt prompt injection.
- Add explicit anti-hallucination lines whenever the model could plausibly invent specifics: "only reference details you have been given; do not invent names, statistics, or prices."
- LLMs return markdown-fenced JSON even when told not to — always strip ``` fences before `JSON.parse()`.
- Long system prompts and large tool lists need prompt caching (`cache_control: ephemeral`) — verify `cache_read > 0` in usage logs; uncached loops eat rate limits.

## Dates & Timezones

- Cloud runtimes (n8n Cloud, Railway, Vercel, CI) run UTC. Convert explicitly to `America/Chicago`; never trust server-local time.
- `new Date('YYYY-MM-DD')` parses as UTC midnight and displays as the *prior day* in US timezones — use `'YYYY-MM-DDT12:00:00'` when displaying a date-only value locally.

## Security Defaults

- Escape or parameterize all user-supplied text before it touches SQL (`'` → `''` at minimum) or `innerHTML` (`escapeHtml()` / `textContent`).
- Validate URL params (UUIDs by regex, numerics by cast) before using them in queries.
- Any confirm/enroll/unsubscribe endpoint reachable by link click must be idempotent — check state before mutating so repeated clicks are no-ops.
- Never convert a hard failure on a **send/action** step (email, SMS, payment, external write) into a silent continue. Fail loud on actions; continue-on-fail belongs only on logging and lookup steps.
- Disable double-submits: disable the button after a successful response on every form handler.

## Session Workflow

- When I say **"donezo"** or **"wrap up"**: run the project's session-end routine — append a dated, factual bullet entry to `SESSION_LOG.md`, extract new non-obvious lessons to `docs/lessons-learned.md`, commit both with `docs: session wrap-up YYYY-MM-DD`, and push.
- **Lessons-learned discipline** applies in every project: anything that went wrong, needed a workaround, or revealed a non-obvious constraint gets one line in `docs/lessons-learned.md`, filed under a domain heading, deduped against existing entries. No obvious advice ("test before pushing") — only real gotchas and decisions that shouldn't be re-litigated.

## New Project Bootstrap

When starting a new project, create this scaffolding before writing feature code:

```
CLAUDE.md                 # lean — see content rules below
SESSION_LOG.md            # dated session entries
docs/lessons-learned.md   # domain-grouped one-liners
.claude/settings.json     # permission allowlist for the project's routine tools
.claude/commands/session-end.md
.env.example              # every env var the project needs, no real values
```

## CLAUDE.md Hygiene (applies to every project CLAUDE.md)

A CLAUDE.md is **instructions and stable facts**, not a database. It's loaded into context every single turn — every stale or volatile line costs tokens and credibility.

- **Belongs in CLAUDE.md:** commands, architecture invariants and the *why* behind them, constraints that would cause silent failure if violated, conventions, pointers to deeper docs.
- **Does not belong:** task lists, status logs ("working end to end", "pending approval"), row-by-row data registries, idea backlogs, anything that changes weekly. Put volatile state in the database or a linked doc and keep a one-line pointer.
- Target **under ~200 lines**. When a section grows past a screen, move the detail to `docs/` and leave a pointer.
- Never write counts or totals that drift ("276 tests", "seven tables") — they're wrong within a month. Describe the rule, not the tally.
- No absolute machine paths in hooks, scripts, or docs — use `$CLAUDE_PROJECT_DIR` / repo-relative paths so the project works in web sessions and on other machines.
- When an instruction changes (a schema constraint, a renamed file), update CLAUDE.md *in the same commit* — a CLAUDE.md that contradicts the code is worse than no entry at all.
