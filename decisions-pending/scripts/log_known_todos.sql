-- Decisions Pending — known go-live TODOs surfaced during the build/rebuild
-- (schema + API + n8n collectors + multi-inbox/multi-calendar rework).
-- Run once against the real Neon DB: psql "$DATABASE_URL" -f scripts/log_known_todos.sql
-- Idempotent: guarded by NOT EXISTS on title, safe to re-run.

DO $$
DECLARE
  v_story_id uuid;
BEGIN
  SELECT id INTO v_story_id FROM stories WHERE title = 'Decisions Pending — go-live';
  IF v_story_id IS NULL THEN
    INSERT INTO stories (title, description, status, priority)
    VALUES (
      'Decisions Pending — go-live',
      'Personal chief-of-staff system (cos API + n8n collectors + Hermes/Telegram). '
      'Schema, API, and 4 n8n workflows are built and reviewed on branch '
      'claude/chief-of-staff-prd-ocmrz1; these are the remaining manual/ops steps '
      'before it runs live.',
      'active',
      'high'
    )
    RETURNING id INTO v_story_id;
  END IF;

  INSERT INTO tasks (story_id, title, description, category, priority, status)
  SELECT v_story_id, t.title, t.description, t.category, t.priority, 'backlog'
  FROM (VALUES
    ('Set cos_api Postgres role password on the real Neon DB',
     'sql/001_schema.sql creates the cos_api role with no password. Before any '
     'production deploy: psql "$ADMIN_DB_URL" -c "ALTER ROLE cos_api PASSWORD '
     '''<openssl rand -hex 32>''". See decisions-pending/README.md runbook.',
     'ops', 'high'),

    ('Generate and set COS_API_TOKEN across API + Hermes',
     'openssl rand -hex 32, set identically in the cos API''s env and on the '
     'Hermes VPS (COS_API_TOKEN is one of only 3 secrets Hermes is allowed to hold).',
     'ops', 'high'),

    ('Provision the actual Hermes VPS',
     'hermes/README.md is a checklist, not a live install: minimal VPS separate '
     'from the Norr AI box, install Hermes, configure Telegram bot token, '
     'allowlist Egan''s chat ID only, confirm no browsing tool, Docker sandbox '
     'terminal backend, install the cos-assistant skill.',
     'ops', 'high'),

    ('Record installed Hermes version in hermes/VERSION',
     'Currently UNPINNED. Fill in at install time; upgrades are manual only, '
     'after changelog review, per PRD §6.3.',
     'ops', 'medium'),

    ('Create 8 Gmail + Google Calendar OAuth credentials in n8n',
     'One per account per service: eganbonde@gmail.com, egachuu@gmail.com, '
     'egan@norrai.co, hello@norrai.co, each needing both a Gmail and a Google '
     'Calendar OAuth connection. Wire into the credential placeholders in '
     'wf-gmail-collector.json / wf-calendar-collector.json before import — full '
     'placeholder list in decisions-pending/n8n/README.md.',
     'ops', 'high'),

    ('Set Postgres/Anthropic n8n credential placeholders',
     'NEON_CREDENTIAL_ID and ANTHROPIC_CREDENTIAL_ID appear in all 4 workflow '
     'JSON exports (wf-digest, wf-gmail-collector, wf-calendar-collector, '
     'wf-rules) and must be replaced with real n8n credential references before import.',
     'ops', 'medium'),

    ('Confirm egan@norrai.co / hello@norrai.co mailbox setup',
     'Both Gmail and Calendar collectors currently treat these as two separate '
     'accounts with two separate OAuth credentials. If they''re actually the same '
     'Workspace mailbox via a send-as alias, both collectors would poll it twice — '
     'collapse to one branch if so. See "Multi-Inbox Setup" / "Multi-Calendar '
     'Setup" sticky notes in the workflow JSON.',
     'research', 'high'),

    ('Verify Merge node input handles after n8n import',
     'wf-gmail-collector.json ("Merge Branch Completion") and '
     'wf-calendar-collector.json ("Merge Calendar Batches") are both configured '
     'for numberInputs: 4 in the JSON, but n8n''s Merge-node UI has been '
     'inconsistent about rendering the configured input count — confirm 4 '
     'handles actually appear after import.',
     'testing', 'medium'),

    ('Run Gmail collector dry-run, then enable writes',
     'wf-gmail-collector.json''s Config.dry_run starts true across all 4 inbox '
     'branches. Run for 2 days, review the logged would-be actions in '
     'cos.command_log (source_agent=''collector-dryrun''), then flip Config.dry_run '
     'to false.',
     'ops', 'medium'),

    ('Verify python-dateutil availability in n8n''s Pyodide runtime',
     'wf-rules.json''s "Expand Occurrences" Code node imports dateutil.rrule per '
     'the dev spec, but n8n''s Python Code node runs on Pyodide, which does not '
     'ship python-dateutil by default. Confirm availability or swap to a '
     'JS-based RRULE library before relying on cos_rules in production.',
     'dev', 'medium'),

    ('Keep wf-digest.json''s embedded escalation SQL in sync',
     'The "Escalation + Expiry (sync sql/003)" Postgres node in wf-digest.json '
     'is a byte-for-byte paste of sql/003_escalation_expiry.sql as of when the '
     'workflow was generated. If that file changes, re-paste its contents into '
     'the node before the next import — do not hand-edit the query in the n8n UI.',
     'ops', 'low'),

    ('Reconcile schema against the canonical decisions-pending-prd.md §7 DDL',
     'sql/001_schema.sql was reconstructed from every schema reference in the '
     'dev spec, since decisions-pending-prd.md itself was never uploaded to this '
     'repo. If/when that PRD file becomes available, diff its §7 DDL against '
     'sql/001_schema.sql and reconcile any differences before first production deploy.',
     'research', 'low')
  ) AS t(title, description, category, priority)
  WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE tasks.title = t.title);
END $$;

-- Sanity check after running:
-- SELECT t.title, t.category, t.priority, t.status
-- FROM tasks t JOIN stories s ON s.id = t.story_id
-- WHERE s.title = 'Decisions Pending — go-live'
-- ORDER BY array_position(ARRAY['urgent','high','medium','low'], t.priority);
