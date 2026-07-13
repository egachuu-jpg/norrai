# Spec 01 — `/n8n-drift`: detect repo ↔ live n8n divergence

## Problem

The repo (`n8n/workflows/*.json`) and the live n8n Cloud instance drift apart, and the drift is only discovered when something breaks:

- 06-22: local Cold Nurture export showed token-validation nodes orphaned; the live graph wired them into the main path — payload contracts drafted from the repo were wrong.
- 06-24: the sonnet-4-6 model swap was committed to the repo, but 4 *active live* workflows were still on the retired model.
- 07-11: a month of repo work sat on an unmerged branch; the intake form was never deployed.
- 06-05: duplicate live workflows competed for the same webhook path.

`/workflow-sync` pushes live → repo at session end, but nothing ever *checks* for divergence.

## Goal

A skill that produces a drift report in one command, safe to run at the start of any session that touches workflows. Read-only — it never writes to n8n or modifies repo files.

## Deliverables

1. `scripts/n8n_drift.py` — deterministic comparator (stdlib only).
2. `.claude/skills/n8n-drift/SKILL.md` — orchestration instructions.
3. `.claude/commands/n8n-drift.md` — one-line stub: "Run the **n8n-drift** skill (`.claude/skills/n8n-drift/SKILL.md`)."

## Design

### Data flow

The MCP tools can't be called from Python, so the skill splits work:

1. **Claude (via MCP)**: `n8n_list_workflows` → for every workflow where `isArchived != true`, call `n8n_get_workflow` and write the raw JSON to `<scratchpad>/live/<workflow_id>.json`. (Use the session scratchpad dir, never `/tmp`.)
2. **Script**: `python3 scripts/n8n_drift.py --live-dir <scratchpad>/live --repo-dir n8n/workflows` compares and prints the report.

### Matching

- Match live workflow ↔ repo file by **workflow `name`** (exact string match against the repo file's `name` field — NOT the filename; filenames mostly match names but the JSON field is authoritative).
- If two or more live non-archived workflows share a name → report under DUPLICATES.
- Live workflows named `My workflow*` or starting with `ZZ ` are noise: list them in a one-line "ignored" footer, don't diff them.

### Normalization (the critical part — get this exactly right)

Before diffing, normalize BOTH sides with the same function:

```python
VOLATILE_TOP_KEYS = {"updatedAt", "createdAt", "versionId", "activeVersionId",
                     "versionCounter", "triggerCount", "staticData", "meta",
                     "shared", "description", "activeVersion", "nodeGroups",
                     "sourceWorkflowId", "tags", "pinData", "id", "isArchived"}

VOLATILE_NODE_KEYS = {"position", "id", "webhookId", "typeVersion", "notesInFlow", "notes"}

def normalize(wf: dict) -> dict:
    out = {k: v for k, v in wf.items() if k not in VOLATILE_TOP_KEYS}
    nodes = []
    for n in out.get("nodes", []):
        node = {k: v for k, v in n.items() if k not in VOLATILE_NODE_KEYS}
        # credentials: keep only the credential NAME per type (ids differ between export/import)
        if "credentials" in node:
            node["credentials"] = {t: c.get("name") for t, c in node["credentials"].items()}
        nodes.append(node)
    out["nodes"] = sorted(nodes, key=lambda n: n["name"])
    # settings: only compare keys that matter
    s = out.get("settings", {}) or {}
    out["settings"] = {k: s[k] for k in ("errorWorkflow", "timezone", "executionOrder") if k in s}
    return out
```

Rationale (from lessons-learned): the REST API now embeds `activeVersion`/`shared`/`description`; node `position` changes are cosmetic; credential *ids* differ across import copies while names are stable; `typeVersion` bumps happen when the UI re-saves a node.

Connections reference node **names**, so `connections` compares as-is (deep equality after JSON round-trip).

### Diff detail

For each name present on both sides where `normalize(live) != normalize(repo)`, report node-level granularity:

- Nodes only in live / only in repo (by name).
- Nodes present in both with differing `parameters` → list the node name + the top-level parameter keys that differ (e.g. `Send Email: jsonBody, contentType`). Don't print full values (Code node bodies are huge) — print a unified diff only when `--verbose` is passed.
- `active` flag mismatch (live active vs repo says inactive, or vice versa) — always report, it's the "form never deployed" class.
- `connections` differ → say "graph wiring differs" + which source-node entries differ.
- `settings.errorWorkflow` differ → report explicitly.

### Webhook collision check

Across all live non-archived workflows: collect every node of type `n8n-nodes-base.webhook` → `parameters.path`. If two **active** workflows declare the same path, report under COLLISIONS (this is the 06-05 duplicate-webhook failure). Compare paths case-sensitively, ignore leading `/`.

### Report format (script stdout)

```
# n8n Drift Report — 2026-07-13
Live non-archived: 34   Repo files: 63   Matched by name: 31

## DRIFTED (3)
### Real Estate 7-Touch Cold Nurture   [live: LNVSsULAW1WrIHz1]
- active: live=true, repo=false
- node 'Email T1': parameters differ (jsonBody)
- graph wiring differs: 'Token Check' outputs

## LIVE ONLY (2)   ← exists in n8n, no repo export; run /workflow-sync scoped to these
- Weekly Marketing Drip - Send [wSXuvtUorzoLmktv, ACTIVE]

## REPO ONLY (5)   ← repo file with no live workflow; stale or never imported
- Real Estate Instant Lead Response with Research.json

## DUPLICATES (0)
## WEBHOOK COLLISIONS (0)
Ignored: 12 archived, 3 'ZZ '/'My workflow' noise
```

Exit code: 0 when no DRIFTED/DUPLICATES/COLLISIONS, 1 otherwise (LIVE ONLY / REPO ONLY alone don't fail — many repo files are intentionally-unimported variants).

### SKILL.md content requirements

- Usage: `/n8n-drift` (all) and `/n8n-drift <name substring>` (fetch + compare only matching workflows — faster).
- Step list exactly as in Data flow above, including "create `<scratchpad>/live/`, delete stale files from a previous run first".
- After the script runs, Claude summarizes: for each DRIFTED workflow, say which side is probably right (live is source of truth for anything a user edited in the UI; repo is source of truth for anything just committed) and offer the follow-up: scoped `/workflow-sync` (live→repo) or a guided re-import/patch (repo→live). **Do not auto-fix.**
- Note: `n8n_list_workflows` may paginate — follow the cursor until exhausted.

## Acceptance criteria

- Running `/n8n-drift` today completes without error and the report's MATCHED/LIVE ONLY/REPO ONLY partition accounts for every live non-archived workflow.
- Cosmetic-only differences (node positions moved in the UI, credential ids) produce **zero** DRIFTED entries — verify by fetching one known-in-sync workflow twice and diffing live-vs-live (must be clean), then live-vs-repo.
- A deliberate test: flip `active` in a scratch copy of a repo file, point `--repo-dir` at the scratch dir → that workflow appears under DRIFTED with the `active` line.
- Script has no network access and no n8n credentials — it only reads the two directories.

## Non-goals

- No auto-remediation. No writes to n8n. No archived-workflow analysis.
