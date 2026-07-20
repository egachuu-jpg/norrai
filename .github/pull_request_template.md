## Summary

<!-- What changed and why, in a sentence or two. -->

## Changes

<!-- Bullet the notable changes. -->

-

## Checklist

<!-- Check what applies. Delete rows that don't. -->

- [ ] `npm test` passes locally (all Playwright specs)
- [ ] New/changed form fields, JS behavior, or payloads have test coverage (see the risk table in CLAUDE.md)
- [ ] External links in pages/workflows/emails use `tools.norrai.co`, not the apex `norrai.co`

### If this PR touches an n8n workflow

- [ ] Ran `/n8n-audit` and it passes (logging standard: Lookup Client → Log Triggered → Log Completed, Error Workflow set)
- [ ] `continueOnFail` is on logging/lookup nodes only — never on a Send/action node (SendGrid, Twilio)
- [ ] Uses the `/webhook/` production path, not `/webhook-test/`
- [ ] `docs/workflows-built.md` and the `n8n/README.md` workflow_name registry are updated

### If this PR touches the database

- [ ] `db/schema.sql` reflects the change (it is canonical)
- [ ] `db/README.md` table overview updated if a table was added/changed

### If this PR touches a Polar Modern page

- [ ] Full `:root` token block copied from an existing page in the same directory (no partial copies)

## Notes

<!-- Anything a reviewer should know: follow-ups, manual deploy steps, screenshots. -->
