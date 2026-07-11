Run the **n8n-audit** skill (`.claude/skills/n8n-audit/SKILL.md`) — the canonical
checklist for auditing n8n workflow JSONs against the NorrAI logging standard.

Pass any workflow name through as `$ARGUMENTS` to scope the audit to one workflow;
with no argument, audit all files in `n8n/workflows/`.
