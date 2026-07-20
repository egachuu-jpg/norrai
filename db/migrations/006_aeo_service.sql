-- 006: AEO service — tables + remaining build-out seeded into Mission Control
--
-- Run against Neon with psql (run_sql MCP is one statement per call — don't use it):
--   psql "$DATABASE_URL" -f db/migrations/006_aeo_service.sql
--
-- Idempotent: tables/indexes use IF NOT EXISTS, the trigger and the story
-- seed are guarded, so re-running is safe.
-- DDL mirrors db/schema.sql § AEO SERVICE TABLES (canonical).

-- ============================================================
-- 1. AEO SERVICE TABLES
-- ============================================================

-- Monthly (or on-demand) audit score run for a client. Append-only —
-- one row per run, so month-over-month deltas are just a self-join on
-- client_id ordered by run_at. Prospects get a 'prospect'-status clients
-- row before the audit runs, so client_id is NOT NULL here too.
CREATE TABLE IF NOT EXISTS aeo_audits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES clients(id),
  run_at        timestamptz NOT NULL DEFAULT now(),
  total_score   int,
  pillar_scores jsonb,                    -- {gbp, reputation, website, citations, ai_presence}
  raw           jsonb,                    -- full check results for the report
  report_url    text                      -- https://tools.norrai.co/clients/aeo/<slug>/<YYYY-MM-DD>.html
);

CREATE INDEX IF NOT EXISTS idx_aeo_audits_client_run ON aeo_audits(client_id, run_at);


-- One row per query battery question per run. Append-only. engine is left
-- unconstrained (new engines get added without a migration).
CREATE TABLE IF NOT EXISTS aeo_queries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES clients(id),
  run_at           timestamptz NOT NULL DEFAULT now(),
  engine           text NOT NULL,         -- 'gemini_grounded' | 'perplexity' | ...
  query            text NOT NULL,
  client_mentioned boolean NOT NULL,
  mentioned_names  jsonb,                 -- competitors named in the answer
  cited_urls       jsonb
);

CREATE INDEX IF NOT EXISTS idx_aeo_queries_client_run ON aeo_queries(client_id, run_at);


-- Optimizer output: one row per proposed/applied action, linked to the
-- query or pillar it targets so the next battery run can score it.
-- Not append-only — status moves proposed -> applied/declined -> done.
CREATE TABLE IF NOT EXISTS aeo_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES clients(id),
  action_type   text NOT NULL             -- who applies it
    CHECK (action_type IN ('auto_apply', 'norr_applies', 'recommend_only')),
  surface       text NOT NULL             -- what it changes
    CHECK (surface IN ('website', 'gbp', 'citations', 'client')),
  description   text NOT NULL,
  target_query  text,                     -- query battery question this targets, if any
  target_pillar text,                     -- pillar this targets, if any
  status        text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'applied', 'declined', 'done')),
  applied_at    timestamptz,
  outcome_note  text,                     -- filled after next battery run
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'aeo_actions_updated_at'
  ) THEN
    CREATE TRIGGER aeo_actions_updated_at
      BEFORE UPDATE ON aeo_actions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_aeo_actions_client_created ON aeo_actions(client_id, created_at);


-- ============================================================
-- 2. SEED: remaining AEO build-out → Mission Control
-- ============================================================
-- Phase 1 (audit CLI, scorecard renderer, operator docs, schema) shipped on
-- branch claude/aeo-service-design-gfabel. Everything still to do lives here.
--
-- Decisions encoded in these tasks (also recorded in PRD/aeo-service.md):
--   * Reports are HOSTED at tools.norrai.co/clients/aeo/<slug>/<YYYY-MM-DD>.html
--     (website/clients/ dir → Cloudflare Pages, gated by the Cloudflare Access
--     'clients' group), and a LINK IS EMAILED via SendGrid from hello@norrai.co.
--   * External links always use tools.norrai.co, never the apex.

DO $$
DECLARE
  s uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM stories WHERE title = 'AEO Service — Phase 2+ build-out') THEN
    RAISE NOTICE 'AEO story already seeded, skipping';
    RETURN;
  END IF;

  INSERT INTO stories (title, description, outcome, priority)
  VALUES (
    'AEO Service — Phase 2+ build-out',
    'Everything after the Phase 1 audit CLI: Neon persistence, report hosting under clients/aeo with emailed links, the four n8n retainer workflows, GBP API access, 507 Air pilot, and the sales surface. Design: PRD/aeo-service.md; engine: scripts/aeo-audit/.',
    'AEO sellable end-to-end: audit → saved to Neon → report live on tools.norrai.co/clients/aeo → link emailed → monthly battery/report/optimizer running in n8n → 507 Air case study',
    'high'
  ) RETURNING id INTO s;

  INSERT INTO tasks (story_id, title, description, category, priority, status, seq) VALUES
    (s, 'Add API keys to .env and shakedown a live audit run',
        'GOOGLE_PLACES_API_KEY + GEMINI_API_KEY (optional PAGESPEED_API_KEY) per scripts/aeo-audit/README.md. First run with real keys will surface API-shaped surprises — budget an hour, fix collectors as needed.',
        'ops', 'high', 'ready', 1),

    (s, 'Audit CLI --save: persist results to Neon (aeo_audits + aeo_queries)',
        'Zero-dep options: emit an inserts.sql next to audit.json for psql -f, or use Neon''s HTTP SQL endpoint via built-in fetch. Resolve client_id from a clients row (create status=''prospect'' rows for prospects). Store report_url when --publish also ran.',
        'dev', 'high', 'backlog', 2),

    (s, 'Audit CLI --publish: write report to website/clients/aeo/<slug>/<YYYY-MM-DD>.html',
        'DECIDED hosting model: reports live under the Cloudflare Access-gated clients/ dir on tools.norrai.co. --publish copies report.html into website/clients/aeo/, prints the public URL (always tools.norrai.co, never apex); commit + push triggers the Pages deploy. Also write/refresh a latest.html alias per client so the emailed link can be stable.',
        'dev', 'high', 'backlog', 3),

    (s, 'Cloudflare Access: confirm clients policy covers /clients/aeo/* and enroll AEO client emails',
        'The clients Access group (7-day session) must gate the new subpath; add each AEO client''s email to the group at onboarding. Verify a non-enrolled browser gets the Access wall, not the report.',
        'ops', 'high', 'backlog', 4),

    (s, 'Client config: manual GBP-check fields to close the 6 unassessed checks',
        'Places API doesn''t expose services list, attributes, posts, Q&A, review velocity, or owner response rate — scoring marks them assessed:false. Add an operator-filled gbp_manual block to the client config (5 min eyeballing the profile) that scoring.js prefers when present. Takes the audit from ~78 assessable points to 100.',
        'dev', 'medium', 'backlog', 5),

    (s, 'n8n: build aeo_query_battery workflow',
        'Monthly cron per active AEO client → Gemini grounded battery (reuse scripts/aeo-audit/lib/collect/battery.js logic) → INSERT rows into aeo_queries. Standard workflow_events logging; Error Workflow set; register name in n8n/README.md.',
        'dev', 'high', 'backlog', 6),

    (s, 'n8n: build aeo_monthly_report workflow',
        'DECIDED delivery model: monthly re-audit → render scorecard → publish under website/clients/aeo/ → SendGrid email FROM hello@norrai.co with the tools.norrai.co/clients/aeo/... link (link, not attachment) → store link in aeo_audits.report_url. Standard logging; register in n8n/README.md.',
        'dev', 'high', 'backlog', 7),

    (s, 'n8n: build aeo_review_response workflow',
        'Poll new Google reviews via Places API → Claude drafts response in owner voice → owner approves via SMS/email → Egan posts as profile Manager (API auto-post once GBP API access lands). Standard logging; register in n8n/README.md.',
        'dev', 'medium', 'backlog', 8),

    (s, 'n8n: build aeo_optimizer workflow',
        'Monthly, after battery + report: diff vs last month + competitor state → query-loss attribution (Claude reads winning answers'' cited URLs + winner GBP data) → typed action list INSERTed into aeo_actions (auto_apply / norr_applies / recommend_only). Next battery run fills outcome_note. Standard logging; register in n8n/README.md.',
        'dev', 'medium', 'backlog', 9),

    (s, 'Playwright smoke coverage for published AEO report pages',
        'Reports under website/clients/aeo/ are static display pages → low-risk smoke per testing rules: loads, title, no console errors. One spec against a checked-in sample report.',
        'testing', 'medium', 'backlog', 10),

    (s, '507 Air pilot: baseline audit, publish, email',
        'Blocked on Oscar: Google account + GBP creation + verification (client-sites/507-air/GBP_SETUP.md). Then run the full loop: audit → --save → --publish → emailed link. Re-run at 90 days for the before/after case study.',
        'ops', 'high', 'backlog', 11),

    (s, 'Apply for Google Business Profile API access',
        'Under the Norr AI agency Google account once 2–3 profiles are managed. Unlocks GBP auto-posting, review auto-response, and the 6 manual checks going automated.',
        'ops', 'low', 'backlog', 12),

    (s, 'Add AEO Audit offer to tools.norrai.co',
        '$99 audit (free with booked discovery call) on services/pricing pages, per PRD Packaging & Pricing. Medium-risk page work → tests per repo rules.',
        'dev', 'medium', 'backlog', 13);

END $$;
