Sync n8n workflows to the local `n8n/workflows/` directory and stage for commit.

## Steps

1. Use `mcp__n8n-mcp__n8n_list_workflows` to list all workflows
2. For each workflow, use `mcp__n8n-mcp__n8n_get_workflow` to fetch the full JSON
3. Write each to `n8n/workflows/<Workflow Name>.json` — use the workflow's `name` field exactly as it appears in n8n (spaces and special characters included). If the name contains `/`, replace with ` - ` to avoid path issues.
4. Run `git add n8n/workflows/ && git status`
5. Report which files were added, modified, or unchanged. Ask if the user wants to commit.

Do not delete local files for workflows not returned by the list — n8n may paginate.
