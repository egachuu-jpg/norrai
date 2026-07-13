# Usage Audit — Top 10 Fixes (Index)

Source: usage audit of SESSION_LOG.md sessions 2026-04-23 → 2026-07-11 (2026-07-13).
Each spec below is self-contained and implementable independently. Priority order:

| # | Spec | Type | Fixes |
|---|------|------|-------|
| 01 | [n8n-drift skill](2026-07-13-n8n-drift-design.md) | New skill + script | Repo ↔ live n8n drift (the #1 recurring tax: 06-22, 06-24, 07-11) |
| 02 | [n8n-lint](2026-07-13-n8n-lint-design.md) | Script + extend `/n8n-audit` | Lessons-learned rules exist but aren't enforced; known failure classes recur |
| 03 | [Workflow JSON guard hook](2026-07-13-workflow-json-guard-hook-design.md) | New hook | Edit tool corrupted workflow JSON twice (06-09, 06-22) |
| 04 | [Fix Birthday & Anniversary SendGrid raw pattern](2026-07-13-bday-sendgrid-fix-design.md) | Live workflow fix | Known-broken since 07-10 — likely silently 415'ing every send |
| 05 | [Norr AI Ops Sweep workflow](2026-07-13-ops-sweep-design.md) | New n8n workflow | Model retirement + SendGrid quota + silence discovered by clients, not monitoring |
| 06 | [ZZ TEST isolation + live n8n hygiene](2026-07-13-zz-test-isolation-design.md) | Live workflow fix | Test copy consumes real `listing_queue` rows; dormant Apify credential |
| 07 | [/new-workflow scaffold](2026-07-13-new-workflow-scaffold-design.md) | New skill + generator | Every build hand-recreates Token Check / logging / registry boilerplate |
| 08 | [Smoke-test payload library](2026-07-13-smoke-test-library-design.md) | New skill + fixtures | Smoke tests hand-crafted per session, often deferred ("pending smoke test") |
| 09 | [/client-onboard skill](2026-07-13-client-onboard-design.md) | New skill | Weichert onboarding sequence lives only in the 05-16 session log entry |
| 10 | [session-end upgrade](2026-07-13-session-end-upgrade-design.md) | Skill edit | Flagged follow-ups never land on the Neon board; checkable lessons never become lint rules |

## Cross-cutting conventions (apply to every spec)

- **Repo layout**: skills in `.claude/skills/<name>/SKILL.md`; legacy command stubs in `.claude/commands/` point to skills; deterministic logic in `scripts/*.py` (Python 3, stdlib only — no pip installs).
- **n8n access**: MCP tools `mcp__n8n-mcp__n8n_list_workflows`, `n8n_get_workflow`, `n8n_update_full_workflow`, `n8n_update_partial_workflow`, `n8n_validate_workflow`. REST fallback: `https://norrai.app.n8n.cloud/api/v1/...` with header `X-N8N-API-KEY` (key in `.env` as `Norr-ai-api-key-1`). Norr AI project id: `dHMe2aoOwTztDaWE`.
- **ALWAYS read back after any n8n API write** (`n8n_get_workflow`, confirm the changed values) — this instance has silently dropped `parameters` writes before (lessons-learned § n8n Workflow Management).
- **Workflow JSON edits on disk**: never use the Edit tool for multi-line changes inside JSON string values — use Python `json.load` / modify / `json.dump(..., ensure_ascii=False, indent=2)`.
- **Neon**: MCP `mcp__Neon__run_sql` — ONE statement per call. Client ids: `norrai_internal` = `e2f9934c-4d28-4bb4-ac90-4284c1123517`, B&B = `86a01b94-ddab-4594-8afc-8212fb18fdd0`.
- **Logging standard**: every new n8n workflow follows CLAUDE.md § Workflow Logging Standard and registers its `workflow_name` in BOTH `n8n/README.md` (registry table) AND the `WORKFLOW_NAME_MAP` inside the `Extract Error Data` Code node of `n8n/workflows/Norr AI Workflow Error Logger.json`.
- **Secrets**: never commit real Slack webhook URLs, API keys, or tokens (GitHub Push Protection blocks the push). Use placeholders in repo JSON; real values live only in the live n8n instance / `.env`.
- **Tests**: `npm test` must pass before pushing. New HTML pages need a spec file per the risk tiers in CLAUDE.md § Testing. (Specs 01–10 are mostly non-HTML; only run the full suite if you touched `website/`.)
