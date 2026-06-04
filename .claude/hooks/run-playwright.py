#!/usr/bin/env python3
"""
PostToolUse hook — after editing an HTML file in website/, runs the matching
Playwright spec if one exists. Prints a pass/fail summary inline.
"""
import sys
import json
import subprocess
import os

data = json.load(sys.stdin)
fp = data.get("tool_input", {}).get("file_path", "")

if not fp or "website/" not in fp or not fp.endswith(".html"):
    sys.exit(0)

spec_name = os.path.basename(fp).replace(".html", ".spec.js")
project_root = "/Users/Egan/Documents/Claude/Projects/NorrAI"
spec_path = os.path.join(project_root, "tests", spec_name)

if not os.path.exists(spec_path):
    sys.exit(0)

print(f"\n[hook] Running {spec_name}...")
result = subprocess.run(
    ["npx", "playwright", "test", f"tests/{spec_name}", "--reporter=line"],
    cwd=project_root,
    capture_output=True,
    text=True,
)

output = (result.stdout + result.stderr).strip()
if output:
    lines = output.splitlines()
    print("\n".join(lines[-20:]))

if result.returncode != 0:
    print(f"\n[hook] TESTS FAILED — fix before committing")
else:
    print(f"[hook] Tests passed")
