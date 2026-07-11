# Weekly Marketing Drip — Send Volume Check

**Run date:** 2026-06-14
**Query (from PRD):**
```sql
SELECT client_id, COUNT(*) as send_count
FROM leads
WHERE email IS NOT NULL AND communication_opted_out != true
GROUP BY client_id;
```

## Result (Weichert agents)

| Agent | client_id | send_count |
|---|---|---|
| Michelle Jasinski | `451306d1-6437-42b8-8ffe-c16f28803490` | 522 |
| Evan Knutson | `ded234e3-1c78-45c3-8924-6036e1fcaf60` | 376 |
| **Combined** | | **898** |

## Assessment

**898 combined → 500–2,000 band.** PRD recommendation: *"Check SendGrid plan limit. Consider batching (chunks of 100 with a 1s pause)."*

**Decision taken:**
- Kept the locked per-lead send strategy with a **100ms Wait node** between sends (required for personalized opt-out URLs). 898 × 100ms ≈ 90s of pacing per agent run — acceptable for a weekly cron.
- Did **not** switch to the SendGrid Marketing Campaigns bulk API (only warranted at 2,000+).
- **Open item before go-live (task 13/14):** verify the SendGrid plan's daily/monthly send cap covers ~900 emails/week (~3,600/mo) plus existing transactional volume. The Monday send workflow is left **inactive** until this is confirmed by Egan.

## Flag

⚠️ Combined list is over 500 — flagged per task instructions. Go-live (activating the Monday cron + first live send) is gated on Egan confirming the SendGrid plan limit.
