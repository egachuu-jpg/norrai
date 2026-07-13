# Spec 09 — `/client-onboard`: codify the client onboarding runbook

## Problem

The full onboarding sequence was executed once (Weichert, 05-16: Neon INSERT, Cloudflare Access, tokens, Zapier, Error Logger wiring, personalized URLs) and exists only as that session-log entry plus a 10-task Neon story that's now marked done. The next client means re-deriving it. Some steps are automatable (Neon, URLs, records); some are inherently manual (Cloudflare UI, Zapier) — today nothing distinguishes them or tracks completion.

## Goal

`/client-onboard <Business Name>` walks the full sequence: executes every automatable step, prints exact click-paths for manual steps, creates a tracking story in Neon, and produces the client record file — idempotently, so it can resume a half-done onboarding.

## Deliverable

`.claude/skills/client-onboard/SKILL.md` (+ `.claude/commands/client-onboard.md` stub). No scripts needed — this is an orchestration skill over existing MCP tools.

## Inputs (gather up front, ask once)

business_name, vertical, tier (starter/growth/pro), primary contact name/email/phone, brokerage/company if real-estate, which workflows they're buying (menu from `n8n/README.md` registry), CRM (BoldTrail? → Zapier branch), and whether a contract is already signed (→ skip step 1 if the Contract Signed workflow already upserted them).

## Steps (SKILL.md must list these in order, each marked AUTO or MANUAL)

1. **AUTO — Neon client row.** Check first: `SELECT id, token FROM clients WHERE primary_contact_email = '<email>'` (idempotency — the Contract Signed workflow may have upserted already). If absent, INSERT with tier/vertical/status/contact fields (copy column shape from an existing row) and re-SELECT to capture `id` and `token`. One statement per `run_sql` call.
2. **AUTO — Tracking story.** Create a Neon story `"<Business> Onboarding"` (status `active` — the CHECK constraint rejects `completed`; use `done` at the end) with one task per remaining step below, so a half-finished onboarding is visible on Mission Control. Skip if a story with that title already exists.
3. **MANUAL — Cloudflare Access.** Print verbatim: "Zero Trust → Access → Access Groups → `clients` → add `<email>` — grants all `/clients/*` pages. Session length 7 days." (If a Cloudflare MCP connector is available in the session, offer to do it; otherwise it's a user step.)
4. **AUTO — Personalized tool URLs.** Generate the list from the client's `token`: for each purchased workflow's form page (`listing_form`, `lead_response`, `open_house_setup`, `nurture_enroll`, `review_request` — all under `https://tools.norrai.co/clients/`), emit `<url>?agent_token=<token>`. Output as a copy-paste block for the welcome email. Always `tools.norrai.co`, never the apex.
5. **CONDITIONAL — CRM intake.** If BoldTrail: print the Zapier runbook — Zapier **Starter** ($20/mo, never free tier — Zaps pause after 2 weeks idle), copy the existing Zap, swap `agentemail`, target webhook `https://norrai.app.n8n.cloud/webhook/boldtrail-intake`; note that BoldTrail Intake resolves the client dynamically by `agentemail`, so no workflow edit is needed — but the client row from step 1 MUST exist first or leads log to `norrai_internal` as unknown-agent.
6. **AUTO — Workflow readiness check.** For each purchased workflow, verify against the LIVE instance: it exists, is active, `settings.errorWorkflow` is set, and (if applicable) client-specific placeholders are gone. Use `n8n_get_workflow`; report a ✅/❌ table. Do not edit workflows here — flag gaps as tasks in the story.
7. **AUTO — Client record file.** Create `obsidian/clients/<slug>.md` mirroring `obsidian/clients/evan-knutson-weichert.md`'s structure (read it as the template): client_id, token (partial — first 8 chars + "see Neon"), contact info, purchased workflows, open items, Active Stories table.
8. **MANUAL — Twilio subaccount** (if any SMS workflow purchased): print the runbook — create subaccount under the master account, buy a local 507 number, insert into `twilio_subaccounts`. (AUTO the Neon insert once the user supplies the SIDs.)
9. **AUTO — Smoke test.** If Spec 08 is implemented, fire the relevant fixture(s) with the new client's token swapped in via a temp env var; otherwise print the manual test checklist from `n8n/TESTING_GUIDE.md`.
10. **AUTO — Welcome email draft.** Draft (do NOT send) a non-technical welcome email listing their tool URLs and what happens next — modeled on the 05-22 Evan/Michelle email. Leave sending to the user.

Finish by updating each completed step's task to `completed` in the story and printing the remaining MANUAL checklist.

## Idempotency rule (applies to every AUTO step)

SELECT/check before INSERT/create; if the artifact exists, say "already done — skipping" and continue. The skill must be safely re-runnable mid-onboarding — that's the whole point of the tracking story.

## Acceptance criteria

- Dry run against the existing client: `/client-onboard` with Evan Knutson's details performs zero writes (every step reports already-done) and prints the correct URL list for his existing token.
- Fresh run with a fictitious `ZZ Test Client` creates the client row, story + tasks, record file, and URL block; second invocation is a no-op; cleanup SQL (delete client/story/tasks, delete record file) is printed at the end of the test.
- Every MANUAL step's instructions are copy-paste executable without opening SESSION_LOG.md.

## Non-goals

- No contract generation (that's `website/internal/contract_generator.html`). No automatic email sending. No Cloudflare API automation unless a connector is present.
