# Spec 03 — Workflow JSON guard hook

## Problem

Editing `n8n/workflows/*.json` with the Edit tool has corrupted files twice:

- 06-09: writing multi-line JavaScript into a Code-node string value inserted raw newlines inside a JSON string → invalid file, rebuilt via Python.
- 06-22: a trailing comma (left by an earlier edit) blocked n8n import with "file does not contain valid JSON data".

The lesson ("use Python json.load/dump for any Code-node replacement involving newlines") is written down but nothing enforces it.

## Goal

A PostToolUse hook that strict-parses any workflow JSON immediately after Claude writes it, and bounces the failure back to Claude with recovery instructions — so corruption is caught at write time, not at import time days later.

## Deliverables

1. `.claude/hooks/validate-workflow-json.py`
2. Updated `.claude/settings.json` (add the hook to the existing PostToolUse entry list).

## Design

### Hook script (complete implementation)

```python
#!/usr/bin/env python3
"""
PostToolUse hook — strict-validates n8n workflow JSON after Edit/Write/MultiEdit.
Catches raw newlines in strings, trailing commas, and truncated writes at write
time instead of at n8n import time. Exit 2 feeds stderr back to Claude.
"""
import sys
import json

data = json.load(sys.stdin)
fp = data.get("tool_input", {}).get("file_path", "")

if "n8n/workflows/" not in fp or not fp.endswith(".json"):
    sys.exit(0)

try:
    with open(fp, encoding="utf-8") as f:
        wf = json.loads(f.read())  # strict: rejects trailing commas, control chars in strings
except FileNotFoundError:
    sys.exit(0)  # deletion/rename — not this hook's problem
except json.JSONDecodeError as e:
    print(
        f"BLOCKED: {fp} is no longer valid strict JSON after this edit "
        f"(line {e.lineno} col {e.colno}: {e.msg}).\n"
        f"n8n will refuse to import this file. Recover now:\n"
        f"  1. git checkout -- \"{fp}\"   (restore last good version)\n"
        f"  2. Re-apply the change via Python json.load/modify/json.dump — NEVER the "
        f"Edit tool for multi-line content inside JSON string values "
        f"(see docs/lessons-learned.md § n8n).",
        file=sys.stderr,
    )
    sys.exit(2)

# Cheap structural sanity: a workflow export must have nodes + connections.
if not isinstance(wf.get("nodes"), list) or "connections" not in wf:
    print(
        f"WARNING: {fp} parsed but is missing 'nodes' or 'connections' — "
        f"is this a complete workflow export?",
        file=sys.stderr,
    )
    sys.exit(2)

sys.exit(0)
```

### settings.json wiring

In `.claude/settings.json`, the PostToolUse matcher `Edit|Write|MultiEdit` already exists (it runs `run-playwright.py`). **Append** a second hook object to that same entry's `hooks` array — do not create a duplicate matcher entry:

```json
{
  "type": "command",
  "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/validate-workflow-json.py\""
}
```

### Behavior notes

- Exit code 2 on PostToolUse returns stderr to Claude as feedback (same convention the project's PreToolUse `.env` block uses). The write has already happened — the hook can't prevent it — so the message *instructs restoration*, which is why step 1 is `git checkout --`.
- The hook must never crash on unexpected stdin: if `json.load(sys.stdin)` itself fails, exit 0 silently (fail open — a broken hook must not block unrelated edits). Wrap it in try/except.
- Optional (recommended, one extra line): if `scripts/n8n_lint.py` exists (Spec 02), the hook may additionally run it on the single file with `--json` and surface ERRORs. Keep this OFF for L11/L13 (registry + heuristics) — only L01–L05 — so the hook stays fast and low-noise. If lint isn't implemented yet, ship the hook without it; don't block this spec on Spec 02.

## Acceptance criteria

- Manual test: `echo '{"tool_input":{"file_path":"n8n/workflows/X.json"}}' | python3 .claude/hooks/validate-workflow-json.py` after (a) copying a valid workflow to X.json → exit 0; (b) appending a trailing comma inside it → exit 2 with the recovery message; (c) X.json absent → exit 0. Clean up X.json afterwards.
- Editing a non-workflow JSON (e.g. `package.json`) triggers nothing.
- The existing Playwright hook still fires for HTML edits (both hooks in the array run).
