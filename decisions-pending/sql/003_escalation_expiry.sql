-- Decisions Pending — nightly escalation and expiry job (Task A4)
-- Idempotent: safe to run multiple times in one day.
-- Three stages: ESCALATION, EXPIRY, ANTI-STALENESS.

DO $$
DECLARE
  v_today date;
BEGIN
  v_today := cos.today_chicago();

  -- =========================================================================
  -- 3a. ESCALATION
  -- =========================================================================

  -- Absolute urgency assignment: today >= deadline - 3 days
  -- Set all rows at or past 3-day mark to 'critical' (idempotent: same value each run)
  UPDATE cos.pending_decisions
  SET urgency = 'critical', updated_at = now()
  WHERE status = 'open'
    AND deadline IS NOT NULL
    AND v_today >= (deadline - 3)
    AND urgency != 'critical';

  -- One-tier promotion on deadline - 7 days, guarded by escalated_at
  -- Only runs if NOT already promoted (escalated_at IS NULL)
  -- low → normal, normal → high, high → critical (one tier only)
  UPDATE cos.pending_decisions
  SET
    urgency = CASE
      WHEN urgency = 'low' THEN 'normal'
      WHEN urgency = 'normal' THEN 'high'
      WHEN urgency = 'high' THEN 'critical'
      ELSE urgency  -- safety: keep as-is if somehow in unexpected state
    END,
    escalated_at = now(),
    updated_at = now()
  WHERE status = 'open'
    AND deadline IS NOT NULL
    AND v_today >= (deadline - 7)
    AND v_today < (deadline - 3)
    AND escalated_at IS NULL;

  -- =========================================================================
  -- 3b. EXPIRY
  -- =========================================================================

  -- Mark as expired and capture the IDs for synthetic notice creation
  WITH expired_rows AS (
    UPDATE cos.pending_decisions
    SET status = 'expired', resolved_at = now(), updated_at = now()
    WHERE status = 'open'
      AND deadline IS NOT NULL
      AND deadline < v_today
    RETURNING id, title
  )
  INSERT INTO cos.pending_decisions
    (title, ask, detail, consequence, deadline, urgency, status, source, source_ref, lead_days)
  SELECT
    left('Expired unactioned: ' || e.title, 200),
    NULL,
    NULL,
    NULL,
    NULL,
    'high',
    'open',
    'system',
    'expired:' || e.id::text,
    7  -- default lead_days
  FROM expired_rows e
  ON CONFLICT (source, source_ref) DO NOTHING;

  -- =========================================================================
  -- 3c. ANTI-STALENESS
  -- =========================================================================

  -- Set nag_pending=true on open decisions that appear in ALL 5 most recent
  -- digest_log rows AND have zero command_log rows.
  -- Also set nag_pending=false for all others (where condition no longer holds).
  WITH recent_digests AS (
    -- Get the 5 most recent digests (ordered by sent_at DESC)
    SELECT sent_at, item_ids
    FROM cos.digest_log
    ORDER BY sent_at DESC LIMIT 5
  ),
  digest_count AS (
    -- Count of recent digests (must be exactly 5)
    SELECT COUNT(*) as cnt FROM recent_digests
  ),
  should_be_flagged AS (
    -- Open decisions that appear in ALL 5 most recent digests and have no command_log
    -- Only flag if there are exactly 5 digests
    SELECT DISTINCT p.id
    FROM cos.pending_decisions p
    CROSS JOIN digest_count
    WHERE p.status = 'open'
      AND digest_count.cnt = 5
      AND NOT EXISTS (
        SELECT 1 FROM cos.command_log
        WHERE decision_id = p.id
      )
      AND (
        SELECT COUNT(DISTINCT rd.sent_at)
        FROM recent_digests rd
        WHERE p.id = ANY(rd.item_ids)
      ) = 5
  )
  UPDATE cos.pending_decisions p
  SET nag_pending = (p.id IN (SELECT id FROM should_be_flagged)),
      updated_at = now()
  WHERE (p.status = 'open' OR (p.status != 'open' AND p.nag_pending = true))
    -- only touch rows whose flag actually changes (keeps updated_at honest
    -- and the nightly run idempotent in the strict sense)
    AND p.nag_pending IS DISTINCT FROM (p.id IN (SELECT id FROM should_be_flagged));

END $$;
