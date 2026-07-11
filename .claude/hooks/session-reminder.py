#!/usr/bin/env python3
"""
Stop hook — shows a wrap-up reminder only when there are uncommitted changes.
Silent on pure conversation turns so it stays useful rather than noisy.
"""
import os
import subprocess
import sys

result = subprocess.run(
    ["git", "status", "--short"],
    capture_output=True,
    text=True,
    cwd=os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd()),
)
if result.stdout.strip():
    print("\n[reminder] Uncommitted changes — consider /workflow-sync then donezo before closing.")
