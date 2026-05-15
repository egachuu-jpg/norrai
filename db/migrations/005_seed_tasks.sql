-- Seed tasks and stories for Mission Control
-- Uses DO $$ block so stories and tasks can reference each other via UUID variables

DO $$
DECLARE
  s1  uuid; -- Build Buyer Briefing Generator
  s2  uuid; -- Build Price Sanity Checker
  s3  uuid; -- Build Lead Scoring at Intake
  s4  uuid; -- Voice Bot Interface for Chief of Staff
  s5  uuid; -- Client Birthday and Anniversary Outreach
  s6  uuid; -- Email Inbox Lead Ingestion Pipeline
  s7  uuid; -- Workflow Logging Audit and Wiring
  s8  uuid; -- Pre-First Client Security Hardening
BEGIN

-- ── Story 1: Buyer Briefing Generator ──────────────────────────────────────────
INSERT INTO stories (title, description, outcome, priority)
VALUES (
  'Build Buyer Briefing Generator',
  'Pre-showing briefing emailed to buyer automatically; form + n8n workflow',
  'buyer_briefing.html form live, n8n workflow deployed, Playwright tests passing',
  'high'
) RETURNING id INTO s1;

INSERT INTO tasks (story_id, title, category, priority, status, seq) VALUES
  (s1, 'Research form fields, UX flow, and research agent output shape', 'research', 'high', 'ready',       1),
  (s1, 'Build buyer_briefing.html form',                                 'dev',      'high', 'backlog',     2),
  (s1, 'Build n8n workflow JSON',                                         'dev',      'high', 'backlog',     3),
  (s1, 'Write Playwright tests',                                          'testing',  'high', 'backlog',     4),
  (s1, 'Deploy and smoke test',                                           'ops',      'high', 'backlog',     5);


-- ── Story 2: Price Sanity Checker ──────────────────────────────────────────────
INSERT INTO stories (title, description, outcome, priority)
VALUES (
  'Build Price Sanity Checker',
  'Inline comp verdict in 60 seconds; form + n8n workflow',
  'price_check.html live, workflow deployed, tests passing',
  'medium'
) RETURNING id INTO s2;

INSERT INTO tasks (story_id, title, category, priority, status, seq) VALUES
  (s2, 'Research comp sources and workflow design', 'research', 'medium', 'backlog', 1),
  (s2, 'Build price_check.html form',               'dev',      'medium', 'backlog', 2),
  (s2, 'Build n8n workflow JSON',                   'dev',      'medium', 'backlog', 3),
  (s2, 'Write Playwright tests',                    'testing',  'medium', 'backlog', 4),
  (s2, 'Deploy and smoke test',                     'ops',      'medium', 'backlog', 5);


-- ── Story 3: Lead Scoring at Intake ───────────────────────────────────────────
INSERT INTO stories (title, description, outcome, priority)
VALUES (
  'Build Lead Scoring at Intake',
  'Parallel scoring branch in Lead Cleanser pipeline + dashboard hot-lead indicator',
  'Lead scores appear in leads.metadata, monitoring dashboard shows hot leads',
  'medium'
) RETURNING id INTO s3;

INSERT INTO tasks (story_id, title, category, priority, status, seq) VALUES
  (s3, 'Research scoring criteria and model design',          'research', 'medium', 'backlog', 1),
  (s3, 'Add scoring branch to Lead Cleanser workflow',        'dev',      'medium', 'backlog', 2),
  (s3, 'Add hot-lead indicator to client dashboard',          'dev',      'medium', 'backlog', 3),
  (s3, 'Test scoring pipeline end to end',                    'testing',  'medium', 'backlog', 4);


-- ── Story 4: Voice Bot Interface for Chief of Staff ───────────────────────────
INSERT INTO stories (title, description, outcome, priority)
VALUES (
  'Voice Bot Interface for Chief of Staff',
  'Agent can call in on their phone and have a spoken conversation to kick off tasks',
  'Voice endpoint live, CoS handles voice sessions same as Slack',
  'medium'
) RETURNING id INTO s4;

INSERT INTO tasks (story_id, title, category, priority, status, seq) VALUES
  (s4, 'Evaluate Vapi vs Bland vs Twilio Voice for voice agent layer', 'research', 'medium', 'ready',   1),
  (s4, 'Design voice adapter architecture over existing CoS logic',    'analysis', 'medium', 'backlog', 2),
  (s4, 'Build voice endpoint',                                          'dev',      'medium', 'backlog', 3),
  (s4, 'Smoke test voice sessions end to end',                          'testing',  'medium', 'backlog', 4);


-- ── Story 5: Client Birthday and Anniversary Outreach ─────────────────────────
INSERT INTO stories (title, description, outcome, priority)
VALUES (
  'Client Birthday and Anniversary Outreach',
  'Daily scheduled job queries leads table, Claude drafts personalized SMS/email',
  'n8n workflow live, birthday/transaction_anniversary fields in leads.metadata',
  'low'
) RETURNING id INTO s5;

INSERT INTO tasks (story_id, title, category, priority, status, seq) VALUES
  (s5, 'Add birthday and transaction_anniversary fields to leads schema', 'dev',     'low', 'backlog', 1),
  (s5, 'Build n8n scheduled workflow JSON',                               'dev',     'low', 'backlog', 2),
  (s5, 'Smoke test with test lead data',                                  'testing', 'low', 'backlog', 3);


-- ── Story 6: Email Inbox Lead Ingestion Pipeline ──────────────────────────────
INSERT INTO stories (title, description, outcome, priority)
VALUES (
  'Email Inbox Lead Ingestion Pipeline',
  'Monitor agent inbox, parse lead emails from providers, normalize and enroll',
  'Gmail trigger → Lead Cleanser pipeline working for Zillow and Realtor.com',
  'medium'
) RETURNING id INTO s6;

INSERT INTO tasks (story_id, title, category, priority, status, seq) VALUES
  (s6, 'Research Gmail API vs IMAP and Claude parsing vs Mailparser for email ingestion', 'research', 'medium', 'ready',   1),
  (s6, 'Decide provider detection strategy',                                               'analysis', 'medium', 'backlog', 2),
  (s6, 'Build Gmail trigger and Claude parsing workflow',                                  'dev',      'medium', 'backlog', 3),
  (s6, 'Connect parsed leads to existing Lead Cleanser pipeline',                         'dev',      'medium', 'backlog', 4),
  (s6, 'Smoke test with Zillow and Realtor.com sample emails',                            'testing',  'medium', 'backlog', 5);


-- ── Story 7: Workflow Logging Audit and Wiring ────────────────────────────────
INSERT INTO stories (title, description, outcome, priority)
VALUES (
  'Workflow Logging Audit and Wiring',
  'All real estate workflows need workflow_events INSERT nodes before the monitoring dashboard can show real data',
  'Every active workflow logs triggered/completed/failed; Error Logger wired',
  'high'
) RETURNING id INTO s7;

INSERT INTO tasks (story_id, title, category, priority, status, seq) VALUES
  (s7, 'Audit all workflows for logging coverage gaps',                   'analysis', 'high', 'ready',   1),
  (s7, 'Add logging nodes to Instant Lead Response',                      'dev',      'high', 'backlog', 2),
  (s7, 'Add logging nodes to Open House Follow-Up',                       'dev',      'high', 'backlog', 3),
  (s7, 'Add logging nodes to Open House Setup',                           'dev',      'high', 'backlog', 4),
  (s7, 'Add logging nodes to Listing Description Generator',              'dev',      'high', 'backlog', 5),
  (s7, 'Add logging nodes to 7-Touch Cold Nurture',                       'dev',      'high', 'backlog', 6),
  (s7, 'Add logging nodes to Review Request workflow',                    'dev',      'high', 'backlog', 7),
  (s7, 'Add logging nodes to Lead Cleanser pipeline',                     'dev',      'high', 'backlog', 8),
  (s7, 'Wire Error Logger credentials in n8n',                            'ops',      'high', 'backlog', 9),
  (s7, 'Set Error Workflow in every workflow Settings tab',                'ops',      'high', 'backlog', 10);


-- ── Story 8: Pre-First Client Security Hardening ──────────────────────────────
INSERT INTO stories (title, description, outcome, priority)
VALUES (
  'Pre-First Client Security Hardening',
  'Address remaining security gaps before first live client goes live',
  'Rate limiting added, PII encrypted, Token Check decision made and implemented',
  'high'
) RETURNING id INTO s8;

INSERT INTO tasks (story_id, title, category, priority, status, seq) VALUES
  (s8, 'Evaluate Token Check approach: remove and rely on Cloudflare Access, vs per-client, vs keep as-is', 'research', 'high', 'ready',   1),
  (s8, 'Add rate limiting to n8n webhook endpoints',                                                         'ops',      'high', 'backlog', 2),
  (s8, 'Encrypt PII columns in Neon with pgcrypto',                                                          'dev',      'high', 'backlog', 3);


-- ── Standalone Tasks ──────────────────────────────────────────────────────────
INSERT INTO tasks (title, category, priority, status) VALUES
  ('Upgrade Twilio account and buy local 507 area code number', 'ops', 'medium', 'backlog'),
  ('Open Relay business bank account once MN LLC approval arrives', 'ops', 'low', 'backlog'),
  ('Re-import Real Estate Open House Follow-Up workflow in n8n with updated prompt', 'ops', 'medium', 'backlog'),
  ('Write Growth tier Claude prompts: SOI re-engagement and cross-sell campaign', 'dev', 'medium', 'backlog'),
  ('Audit and reorganize CLAUDE.md open tasks', 'ops', 'low', 'backlog'),
  ('Move B&B rate card to Google Sheets for production', 'ops', 'low', 'backlog'),
  ('Swap B&B placeholder rates with real rates once obtained', 'ops', 'low', 'backlog'),
  ('Add optional property details field to nurture_enroll.html', 'dev', 'low', 'backlog');

INSERT INTO tasks (title, category, priority, status, description) VALUES
  (
    'Fix nurture_enroll.html: make email field required',
    'dev', 'medium', 'ready',
    'T1/T3/T5 are email-only, no guard exists; one-line HTML fix'
  ),
  (
    'Smoke test B&B estimating workflow in n8n',
    'testing', 'medium', 'ready',
    NULL
  ),
  (
    'Research real estate lead reply handling architecture',
    'research', 'medium', 'ready',
    'Autonomous AI vs agent handoff vs hybrid; how do Ylopo/Sierra handle this'
  );

END $$;
