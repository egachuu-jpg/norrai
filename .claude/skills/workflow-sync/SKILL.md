---
name: workflow-sync
description: Export n8n workflows to n8n/workflows/ and stage for commit. Run at end of any session that touched n8n.
disable-model-invocation: true
---

# Workflow Sync

Pull the latest workflow JSON from n8n and sync it to the local `n8n/workflows/` directory.

## Steps

1. **List all workflows** using `mcp__n8n-mcp__n8n_list_workflows`

2. **Fetch each workflow** using `mcp__n8n-mcp__n8n_get_workflow` for every workflow in the list

3. **Write each workflow** to `n8n/workflows/<Workflow Name>.json` — use the workflow's `name` field as the filename (exactly as it appears in n8n, including spaces and special characters)

4. **Stage changes**:
   ```bash
   git add n8n/workflows/
   git status
   ```

5. **Report** which files were added, modified, or are unchanged. Ask the user if they want to commit now.

## Notes
- Do not delete files for workflows that weren't returned — n8n may paginate or filter
- If a workflow name has a `/` in it, replace with ` - ` in the filename to avoid path issues
- This does NOT push to remote — commit + push is a separate step
