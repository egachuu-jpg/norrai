#!/usr/bin/env python3
"""
PreToolUse hook — blocks direct edits to .env files.
Sensitive credentials live there; edit manually outside Claude Code.
"""
import sys
import json

data = json.load(sys.stdin)
fp = data.get("tool_input", {}).get("file_path", "")

if fp.endswith(".env") and not fp.endswith(".env.example"):
    print(f"BLOCKED: .env contains live credentials. Edit it manually outside Claude Code.")
    sys.exit(2)
