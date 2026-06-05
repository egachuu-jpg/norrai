Audit n8n workflow JSON files against the NorrAI logging standard.

**If $ARGUMENTS is provided**, audit only the workflow whose name contains that string (case-insensitive partial match). Look for it in `n8n/workflows/`.

**If no argument**, audit all files in `n8n/workflows/*.json`.

## Checklist — run each check per workflow

1. **Log Triggered node** — exists, fires right after Token Check, uses `continueOnFail: true`, inserts `event_type = 'triggered'`, `workflow_name` matches the snake_case registry in CLAUDE.md
2. **Log Completed node** — exists at every successful terminal branch, uses `continueOnFail: true`
3. **Error Workflow** — Settings → `errorWorkflow` is set to "Norr AI Workflow Error Logger"
4. **Client ID** — resolved via Lookup Client node, OR intentionally hardcoded UUID with a clear reason (B&B, internal)
5. **continueOnFail** — all Postgres logging nodes have it set
6. **Claude prompt nodes** — prompt built in Set node first, not inline in HTTP Request body
7. **Webhook path** (if applicable) — uses `/webhook/` not `/webhook-test/`

## Output format

For each workflow:
```
## <Workflow Name>
✅ Log Triggered — OK
⚠️  Error Workflow — not set
...

Action needed: <specific fix with node name>
```

Finish with a summary: `X/Y workflows fully compliant`.
