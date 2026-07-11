---
name: n8n-audit
description: Audit one or all n8n workflow JSONs against the NorrAI logging standard. Use after building or modifying any workflow.
---

# n8n Workflow Audit

Audit n8n workflow JSON files against the NorrAI logging standard defined in CLAUDE.md.

## Usage

- `/n8n-audit` — audits all files in `n8n/workflows/`
- `/n8n-audit <Workflow Name>` — audits one specific workflow (partial name match OK)

## Checklist (run each check per workflow)

### 1. Log Triggered node
- [ ] Node named "Log Triggered" (or similar) exists
- [ ] It fires immediately after the Token Check node
- [ ] Uses `continueOnFail: true`
- [ ] SQL inserts `event_type = 'triggered'`
- [ ] `workflow_name` value matches the registry in `n8n/README.md`

### 2. Log Completed node
- [ ] Node named "Log Completed" exists at every successful terminal branch
- [ ] Uses `continueOnFail: true`
- [ ] SQL inserts `event_type = 'completed'`

### 3. Error workflow
- [ ] Workflow Settings → `errorWorkflow` is set (non-empty)
- [ ] Should reference "Norr AI Workflow Error Logger"

### 4. Client ID resolution
- [ ] A "Lookup Client" node resolves `client_id` dynamically, OR
- [ ] A hardcoded UUID is used with a comment explaining why (B&B workflows, internal workflows)
- [ ] No raw email strings used as IDs in the log INSERT

### 5. Logging node placement
- [ ] No logging node is on the critical path in a way that could block workflow if Neon is down (all use `continueOnFail: true`)

### 6. Claude prompt nodes
- [ ] Prompts are built in a Set node first, passed as a single `$json.prompt` variable
- [ ] No multi-line prompt text directly in the HTTP Request body

## Output Format

For each workflow audited, output:

```
## <Workflow Name>
✅ Log Triggered — OK
✅ Log Completed — OK  
⚠️  Error Workflow — not set (Settings → Error Workflow is blank)
✅ Client ID resolution — hardcoded (internal workflow, expected)
✅ continueOnFail — all logging nodes OK
✅ Claude prompt nodes — OK

Action needed: Set Error Workflow to "Norr AI Workflow Error Logger"
```

Finish with a summary count: `X/Y workflows fully compliant`.
