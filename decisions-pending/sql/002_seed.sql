-- Decisions Pending — realistic demo/seed data (Task A3)
-- Applied AFTER 001_schema.sql
-- All dates relative to cos.today_chicago() for stability (never stale)
-- Re-runnable: ON CONFLICT clauses prevent duplicates on second apply

-- Insert ~8 realistic pending_decisions spanning sources and urgencies
INSERT INTO cos.pending_decisions
  (id, title, ask, detail, consequence, deadline, lead_days, urgency, status, snoozed_until, source, source_ref, draft_reply)
VALUES
  -- 1. Manual entry: critical urgency with consequence
  ('550e8400-e29b-41d4-a716-446655440001'::uuid,
   'Norr AI Q3 marketing roadmap',
   'Define 3 headline campaigns + channels + budget for Q3',
   'Waiting on client feedback from Egan''s CRO call. Needs 2h to write + review.',
   'Egan misses the July campaign launch window; loses $5k ARR and team momentum.',
   (cos.today_chicago() + interval '10 days')::date,
   7,
   'critical',
   'open',
   NULL,
   'manual',
   'manual-2024-q3-roadmap',
   NULL),

  -- 2. Email item: normal urgency with draft reply
  ('550e8400-e29b-41d4-a716-446655440002'::uuid,
   'Follow-up: AWS cost optimization proposal',
   'Send AWS TCO + ROI breakdown to acme-corp@example.com',
   'Client asked for pricing on RI and Savings Plans. Use last month''s benchmarks.',
   NULL,
   (cos.today_chicago() + interval '5 days')::date,
   3,
   'normal',
   'open',
   NULL,
   'email',
   'thread-789012',
   'Hi Sarah, I''ve attached the AWS optimization analysis. Key wins: 35% savings on compute via RIs, 8% on storage. Let''s sync next Tuesday?'),

  -- 3. Calendar item: normal urgency
  ('550e8400-e29b-41d4-a716-446655440003'::uuid,
   'Dental vertical demo call with BlueSmile',
   'Join Zoom call: review Dentrix integration demo + pricing',
   'Egan is screen-sharing the integrations. 30 min call.',
   NULL,
   (cos.today_chicago() + interval '2 days')::date,
   1,
   'normal',
   'open',
   NULL,
   'calendar',
   'event-bluesmile-demo-2024-07',
   NULL),

  -- 4. Recurring rule-derived: monthly cleanup on the 1st (no deadline, always surfaced)
  ('550e8400-e29b-41d4-a716-446655440004'::uuid,
   'Monthly client health check: record story wins',
   'Update Neon stories table with completed tasks and new wins from this month',
   'Every 1st of month. 1h work. Feeds client dashboards and team morale updates.',
   NULL,
   NULL,
   0,
   'low',
   'open',
   NULL,
   'recurring',
   'rule-monthly-health-check:2024-07-01',
   NULL),

  -- 5. Manual entry: snoozed until tomorrow (should be hidden)
  ('550e8400-e29b-41d4-a716-446655440005'::uuid,
   'Dental CRM research: Eaglesoft vs Dentrix',
   'Compile feature matrix + pricing + integration depth for Egan''s decision',
   'For the next dental client onboarding. 3h research.',
   NULL,
   (cos.today_chicago() + interval '21 days')::date,
   14,
   'normal',
   'open',
   (cos.today_chicago() + interval '1 day')::date,
   'manual',
   'manual-crmresearch-dental-2024',
   NULL),

  -- 6. Email item: low urgency, outside lead window (should be hidden)
  ('550e8400-e29b-41d4-a716-446655440006'::uuid,
   'Subscribe to Real Estate Diver newsletter',
   'Sign up for weekly real estate market trends',
   'Nice-to-have for market intelligence.',
   NULL,
   (cos.today_chicago() + interval '45 days')::date,
   7,
   'low',
   'open',
   NULL,
   'email',
   'thread-999999',
   NULL),

  -- 7. Manual entry: high urgency, deadline today (should be shown)
  ('550e8400-e29b-41d4-a716-446655440007'::uuid,
   'Approve SendGrid sender domain: hello@norrai.co',
   'Verify TXT/CNAME records with Cloudflare, confirm in SG dashboard',
   '10 min task. Blocks all outbound email workflows.',
   NULL,
   cos.today_chicago(),
   0,
   'high',
   'open',
   NULL,
   'manual',
   'manual-sendgrid-verification-2024',
   NULL),

  -- 8. System item: no-deadline insurance renewal reminder (always shown)
  ('550e8400-e29b-41d4-a716-446655440008'::uuid,
   'Norr AI liability insurance renewal window opens',
   'Check policy expiration date and get 3 quotes if renewal is <60 days',
   'Currently on XYZ policy (expires 2024-09-15). Renewal cycle: 90-60-30 days.',
   NULL,
   NULL,
   7,
   'normal',
   'open',
   NULL,
   'system',
   'system-insurance-check',
   NULL)
ON CONFLICT (source, source_ref) DO NOTHING;

-- Insert 1 decision_rules row: monthly on the 1st
INSERT INTO cos.decision_rules
  (id, title, rrule, lead_days, urgency, consequence, detail, active)
VALUES
  ('550e8400-e29b-41d4-a716-446655440101'::uuid,
   'Monthly client health check: record story wins',
   'FREQ=MONTHLY;BYMONTHDAY=1',
   0,
   'low',
   NULL,
   'Every 1st of month. 1h work. Update Neon stories table with completed tasks and new wins.',
   true)
ON CONFLICT DO NOTHING;

-- Insert 1 digest_log row for today, referencing 3 of the item ids (in order)
-- This logs that items 1, 3, and 7 were rendered in the morning digest today
INSERT INTO cos.digest_log
  (id, digest_date, rendered_text, item_ids, model, sent_at)
VALUES
  ('550e8400-e29b-41d4-a716-446655440201'::uuid,
   cos.today_chicago(),
   E'Morning digest for 2024-07-14\n\n1. Norr AI Q3 marketing roadmap\n   Ask: Define 3 headline campaigns + channels + budget for Q3\n   Consequence: Egan misses the July campaign launch window; loses $5k ARR and team momentum.\n   Deadline: 2024-07-24 (in 10 days)\n\n2. Dental vertical demo call with BlueSmile\n   Ask: Join Zoom call: review Dentrix integration demo + pricing\n   Deadline: 2024-07-16 (in 2 days)\n\n3. Approve SendGrid sender domain: hello@norrai.co\n   Ask: Verify TXT/CNAME records with Cloudflare, confirm in SG dashboard\n   Deadline: TODAY (2024-07-14)',
   ARRAY['550e8400-e29b-41d4-a716-446655440001'::uuid,
         '550e8400-e29b-41d4-a716-446655440003'::uuid,
         '550e8400-e29b-41d4-a716-446655440007'::uuid],
   'claude-fable-5',
   now())
ON CONFLICT DO NOTHING;
