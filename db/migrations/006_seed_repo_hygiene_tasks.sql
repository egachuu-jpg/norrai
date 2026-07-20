-- Seed story + tasks for repo organization cleanup (from 2026-07-20 org analysis)
-- Apply with: psql $DATABASE_URL -f db/migrations/006_seed_repo_hygiene_tasks.sql
-- (or a single Neon MCP run_sql call — the DO block is one statement)

DO $$
DECLARE
  s uuid;
BEGIN

INSERT INTO stories (title, description, outcome, priority)
VALUES (
  'Repo cleanup — PII scrub and deploy hygiene',
  'Follow-ups from the project organization analysis: customer PII and signed contracts were tracked in git and have been removed from the tree, but survive in history until scrubbed. Deploys also rebuild on every push regardless of what changed.',
  'No PII or contracts anywhere in git history; Cloudflare and Railway only redeploy when their app''s files change; contact CSVs queryable in leads table',
  'high'
) RETURNING id INTO s;

INSERT INTO tasks (story_id, title, description, category, priority, status, seq) VALUES
  (s, 'Merge branch claude/project-org-analysis-tbjqna',
      'Removes PII CSVs/contracts from tree, adds gitignore tripwires, CI workflow, scrub script; consolidates PRD/ into obsidian/PRDs/',
      'ops', 'urgent', 'ready', 1),
  (s, 'Save contracts and contact CSVs to Google Drive',
      'Both signed contracts, Contract Generator PDF, norrai_master_context.docx, both contact CSVs, Tina Jore .eml — recover from main history (git show) before scrubbing; unrecoverable after',
      'ops', 'urgent', 'ready', 2),
  (s, 'Run scripts/scrub-pii-history.sh to purge PII from git history',
      'Rewrites all history via git-filter-repo and force-pushes main. Close open PRs first; re-clone every local copy afterward (do not pull)',
      'ops', 'urgent', 'ready', 3),
  (s, 'Set Cloudflare Pages build watch paths to website/*',
      'Pages project settings → Builds → build watch paths. Stops docs/n8n-only commits from triggering site rebuilds',
      'ops', 'medium', 'ready', 4),
  (s, 'Set Railway watch paths for cos service to cos/**',
      'Railway service → Settings → Watch Paths. Stops unrelated commits from redeploying the COS service',
      'ops', 'medium', 'ready', 5),
  (s, 'Import Evan/Michelle contact CSVs into leads table',
      'BoldTrail exports (90+ columns) — map name/email/phone to leads columns, rest into metadata jsonb; dedupe with SELECT-then-INSERT, no ON CONFLICT',
      'dev', 'medium', 'ready', 6);

END $$;
