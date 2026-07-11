# n8n Workflows

Workflow JSON exports live in `n8n/workflows/`. Import directly into n8n.
Testing gotchas: `TESTING_NOTES.md`. Step-by-step testing: `TESTING_GUIDE.md`.

## Logging Standard

Every workflow must log `triggered`, `completed`, and `failed` events to
`workflow_events` in Neon (powers the dashboard red/yellow/green health logic).
The canonical node pattern lives in the root `CLAUDE.md` (§ Workflow Logging
Standard) — this file holds the `workflow_name` registry that pattern references.

`workflow_name` is the snake_case value stored in Neon. **Neon is the source of
truth** — this table is a convenience mirror. When it disagrees with the DB,
trust the DB:

```sql
SELECT DISTINCT workflow_name FROM workflow_events ORDER BY workflow_name;
```

## `workflow_name` Registry

| Workflow | `workflow_name` |
|---|---|
| Real Estate Instant Lead Response | `instant_lead_response` |
| Real Estate Open House Follow-Up | `open_house_follow_up` |
| Real Estate Open House Setup | `open_house_setup` |
| Real Estate Listing Description Generator | `listing_description` |
| Real Estate Review Request | `review_request` |
| Real Estate 7-Touch Cold Nurture | `cold_nurture` |
| B&B Lead Generator | `bnb_lead_generator` |
| B&B Manufacturing Estimate | `bnb_estimate` |
| Norr AI Chief of Staff | `norrai_chief_of_staff` |
| Norr AI Client Health Query | `client_health_query` |
| Norr AI Red Alert Scheduler | `red_alert_scheduler` |
| Real Estate Lead Cleanser | `lead_cleanser` |
| Real Estate Zillow Intake | `zillow_intake` |
| Real Estate Realtor Intake | `realtor_intake` |
| Real Estate Facebook Intake | `facebook_intake` |
| Real Estate Custom Form Intake | `custom_form_intake` |
| Real Estate Lead Response Auto | `lead_response_auto` |
| Real Estate Lead Action Handler | `lead_action_handler` |
| Client Discovery → Claude Analysis | `client_discovery` |
| Client Onboarding → Claude Analysis | `client_onboarding` |
| Event Ops Discovery | `event_ops_discovery` |
| Real Estate Research Agent | `research_agent` |
| Buyer Briefing Generator | `buyer_briefing` |
| Price Sanity Checker | `price_sanity_checker` |
| Lead Scoring at Intake | `lead_scoring` |
| Nurture Prompt Scheduler | `nurture_prompt_scheduler` |
| Nurture Prompt Confirm | `nurture_prompt_confirm` |
| Nurture De-Enroll Prompt | `nurture_deenroll_prompt` |
| Nurture De-Enroll Confirm | `nurture_deenroll_confirm` |
| Weichert Nurture Auto-Scheduler | `weichert_nurture_auto_scheduler` |
| Birthday & Anniversary Outreach | `bday_anniversary_outreach` |
| PropertyBoost Intake | `property_boost_intake` |
| PropertyBoost Parser | `property_boost_parser` |
| BoldTrail CSV Import | `boldtrail_csv_import` |
| Manual Opt-Out Handler | `manual_optout_handler` |
| Real Estate BoldTrail Intake | `boldtrail_intake` |
| Norr AI Contract Signed | `contract_signed` |
| Email Triage Sweep | `email_triage_sweep` |
| Email Triage Reply Handler | `email_triage_reply` |
| Weekly Marketing Drip — Intake | `weekly_marketing_drip_intake` |
| Weekly Marketing Drip — Send | `weekly_marketing_drip` |
| Marketing Opt-Out | `marketing_opt_out` |
