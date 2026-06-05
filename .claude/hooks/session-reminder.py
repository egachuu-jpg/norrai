#!/usr/bin/env python3
"""
Stop hook — shows a wrap-up reminder only when there are uncommitted changes.
Silent on pure conversation turns so it stays useful rather than noisy.
"""
import subprocess
import sys

result = subprocess.run(
    ["git", "status", "--short"],
    capture_output=True,
    text=True,
    cwd="/Users/Egan/Documents/Claude/Projects/NorrAI",
)
if result.stdout.strip():
    print("\n[reminder] Uncommitted changes — consider /workflow-sync then donezo before closing.")
