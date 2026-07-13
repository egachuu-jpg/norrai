# Spec 02 — `n8n-lint`: mechanically enforce lessons-learned

## Problem

`docs/lessons-learned.md` contains ~15 rules that are pure JSON linting — yet `/n8n-audit` only checks the logging standard, so known failure classes recur (the `contentType: "raw"` 415 bug shipped on 07-10 *after* the identical Apify lesson was already written; `continueOnFail` on send nodes silently swallowed 9 nurture sends in June). Every lesson written but not enforced gets paid for twice.

## Goal

A deterministic lint script covering every mechanically-checkable lesson, wired into the existing `/n8n-audit` skill so one command runs both the logging-standard checklist and the lint.

## Deliverables

1. `scripts/n8n_lint.py` — stdlib-only linter over `n8n/workflows/*.json` (or any file/dir passed as argv).
2. `scripts/models_allowed.json` — allow-list of live Claude model ids.
3. Updated `.claude/skills/n8n-audit/SKILL.md` — adds a "Run the lint" step and folds lint output into the report.
4. Updated `.claude/agents/n8n-workflow-reviewer.md` — reviewer must run the lint script first, then do the judgment-call review on what scripts can't check.

## Design

### Node classification helpers (used by several rules)

```python
def is_send_node(node) -> bool:
    """A node whose failure must NEVER be swallowed (lessons-learned L33)."""
    t = node.get("type", "")
    if t in ("n8n-nodes-base.twilio", "n8n-nodes-base.sendGrid"):
        return True
    if t == "n8n-nodes-base.httpRequest":
        url = str(node.get("parameters", {}).get("url", ""))
        return "api.sendgrid.com" in url or "api.twilio.com" in url
    return False

def is_logging_node(node) -> bool:
    """Postgres INSERT into workflow_events, or lookup — continueOnFail is REQUIRED here."""
    if node.get("type") != "n8n-nodes-base.postgres":
        return False
    q = str(node.get("parameters", {}).get("query", ""))
    return "workflow_events" in q or node.get("name", "").lower().startswith(("log ", "lookup"))

def swallows_errors(node) -> bool:
    return node.get("continueOnFail") is True or node.get("onError") == "continueRegularOutput"
```

### Rules

Each rule has an id, severity (`ERROR` blocks, `WARN` informs), and cites its lessons-learned origin. Output one finding per (file, node, rule).

| ID | Sev | Check |
|----|-----|-------|
| L01 | ERROR | File parses with **strict** `json.loads` (catches trailing commas, raw newlines in strings — both have blocked n8n import). |
| L02 | ERROR | No send node (`is_send_node`) has `swallows_errors()` true. Exception: a send node may use `onError: continueRegularOutput` ONLY if the workflow also contains a node whose name contains `Canary` (the pre-flight-canary pattern from Weekly Drip) — downgrade to WARN in that case with a note. |
| L03 | ERROR | No `httpRequest` node has `parameters.contentType == "raw"` with `sendBody: true` unless `parameters.rawContentType` is set. Message must say: use `specifyBody: "json"` + object `jsonBody` (no `JSON.stringify`) + `Content-Type: application/json` header — see lessons-learned § SendGrid. |
| L04 | ERROR | In `postgres` nodes, if `parameters.query` contains `{{` it must start with `=`. (Missing `=` logs the literal `{{ $execution.id }}` — found 4 of these on 07-11.) |
| L05 | ERROR | IF-node unary boolean operators: any condition whose `operator.operation` is `"true"`/`"false"` (or `type:"boolean"` with those ops) must have `operator.singleValue: true` and must NOT have a `rightValue` key. |
| L06 | ERROR | Model ids: regex `claude-[a-z0-9-]+` over the whole file; every match must be in `scripts/models_allowed.json`. Also flag `gemini-[a-z0-9.-]+` not in the same file's `gemini` list. |
| L07 | WARN | `postgres` node has non-empty `options.queryParams` — this n8n API silently drops it on deploy; use a Code node to put values into `$json` + plain SQL. |
| L08 | WARN | SQL string contains `$('` inside single quotes (the "invalid sequence" gotcha): regex `'[^']*\$\('` against `parameters.query`. |
| L09 | ERROR | Webhook workflows: if any node name matches `/token check/i`, its FALSE output (`connections["<name>"]["main"][1]` for a standard IF) must lead (directly or transitively) to a `respondToWebhook` node — a dead-end false branch hangs HTTP connections. If the false branch is empty → ERROR. |
| L10 | WARN | `respondToWebhook` node with `options == {}` and no `respondWith` — returns `{"success": true}` instead of data. |
| L11 | ERROR | Registry: the `workflow_name` literal used in any `workflow_events` INSERT (regex `VALUES\s*\(.*?'([a-z0-9_]+)'\s*,\s*'(?:triggered|completed|failed)` — capture group 1 is actually the 2nd positional value; simpler: regex `'([a-z_][a-z0-9_]*)'\s*,\s*'(?:triggered|completed)'`) must appear in `n8n/README.md`. WARN (not ERROR) if it's missing from the `WORKFLOW_NAME_MAP` in `Norr AI Workflow Error Logger.json`. |
| L12 | WARN | Any expression string containing `}}}` (triple-brace) — parse hazard. |
| L13 | WARN | Node references `$json.` in a Code/Set node that is a direct downstream of a `postgres`, `httpRequest`, or `wait` node (walk `connections`). Heuristic — high false-positive rate is acceptable at WARN; message: "verify this isn't reading the upstream query/HTTP result; prefer `$('Node Name').first().json`". |

`scripts/models_allowed.json` initial content:

```json
{
  "claude": ["claude-sonnet-5", "claude-haiku-4-5-20251001", "claude-opus-4-8", "claude-sonnet-4-6"],
  "gemini": ["gemini-2.5-flash"]
}
```

(Implementer: verify current ids against https://api.anthropic.com/v1/models before committing; keep this file as the single source the Ops Sweep — Spec 05 — also reads.)

### Output

- Human report grouped by file, findings sorted ERROR-first, each with node name, rule id, one-line message.
- `--json` flag emits machine-readable findings (used by Spec 03's hook and Spec 05 if desired).
- Exit 1 if any ERROR, else 0.
- Summary line: `N files, E errors, W warnings — top offenders: <file> (n)`.

### Wiring into `/n8n-audit`

Add as **step 0** of the SKILL.md checklist: run `python3 scripts/n8n_lint.py n8n/workflows/` (or the single matched file), paste the findings into the report *before* the manual checklist items, and count lint ERRORs in the final `X/Y compliant` summary. The existing checklist items that the lint now covers (continueOnFail placement) can reference the lint instead of being re-checked by hand.

### Known-existing violations (expected on first run — do NOT "fix the linter" to hide them)

- `Birthday & Anniversary Outreach.json` + `- Evan.json`: L03 on `SendGrid Email` (fix is Spec 04).
- Possibly stale model ids in older exports (L06).
- Several older workflows may fail L11 (unregistered names). Triage: fix the file or the registry, whichever is wrong.

## Acceptance criteria

- `python3 scripts/n8n_lint.py n8n/workflows/` runs in <5s, exits 1, and flags BOTH B&A files with L03 (this is the ground-truth test — the bug is confirmed present).
- Feeding it `Weekly Marketing Drip - Send.json` produces no L02/L03 ERROR (its send nodes use the canary pattern + `specifyBody: "json"`).
- A file with a trailing comma (create a scratch copy, add one) → single L01 ERROR, no crash, other files still linted.
- No false L02 on logging/lookup Postgres nodes (they *require* continueOnFail).

## Non-goals

- Not a graph simulator: L13 stays a heuristic WARN. Judgment calls (prompt quality, dedupe correctness) remain with the `n8n-workflow-reviewer` agent.
