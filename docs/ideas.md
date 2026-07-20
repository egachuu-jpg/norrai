# Ideas / Parking Lot

Unbuilt ideas worth keeping. Move to a story/task in Neon when one gets picked up.

## Real Estate — Slack-mediated SMS send (agent-in-the-loop)

Instead of the workflow sending the automated text directly to the lead, route it
through Slack first. The agent receives the pre-drafted SMS in Slack, formatted
exactly as it would be sent. Tapping the message opens it in iMessage (or the native
Android Messages app) with the lead's number and message body pre-filled — agent just
hits send.

**Mechanism:** generate an `sms:` deep link (`sms:+15075551234?body=Hey%20Sarah...`)
and post it to Slack as a button or linked message. Works on mobile — iOS and Android
both honor the `sms:` URI scheme natively with no app install required. The main n8n
implementation detail is URL-encoding the message body correctly before constructing
the link — use a Code node to run `encodeURIComponent(message)` on the Claude-generated
SMS draft before building the `sms:` URL.

**Benefit:** agent stays in the loop for the actual send (trust, compliance, personal
touch) without having to draft anything. **Tradeoff:** adds one manual step vs. full
automation. Could be an opt-in mode per agent — "auto-send" vs. "review in Slack first."

**Applies to:** instant lead response, open house follow-up, any outbound SMS in the
nurture sequence.

## Decisions Pending v2 — Household CFO (finance in the data plane)

**Date:** 2026-07-15 · **Source:** Egan, during the Decisions Pending build session

Egan wants the personal chief-of-staff to have a comprehensive view of household
finances: Community Resource Bank (checking), Citi credit card, Apple Card,
two Vanguard accounts, Robinhood.

**Locked architectural constraint** (carried from the Decisions Pending dev spec):
bank credentials live ONLY in the data plane — n8n on the Norr AI box, same as
Twilio/SendGrid keys. They must never reach the Hermes VPS; `decisions-pending/
scripts/audit_vps.sh` already treats bank/Plaid tokens found there as audit
failures, and the cos-assistant skill's guardrail says Hermes has no bank access.
Hermes only ever reads summaries through the cos API, and the digest grows a
finance section.

**Realistic ingestion shape** (aggregator coverage is uneven):
- Community Resource Bank + Citi → aggregator sync (Plaid; SimpleFIN Bridge as
  the fallback if the community bank isn't on Plaid) → daily n8n workflow into
  new `cos.accounts` / `cos.transactions` tables.
- Apple Card → no aggregator support exists; monthly CSV/OFX export from the
  Wallet app → import workflow.
- Vanguard ×2 + Robinhood → aggregator support is historically flaky; monthly
  statement import, or weekly balance-only snapshots (enough for a digest).

**Digest integration:** finance section in the morning digest = version bump to
`digest_synthesis` prompt (v2), per the prompt-versioning rule.

**Per dev spec §7:** finance is v2 — schema only when asked, design doc before
any scaffolding. Nothing built yet; this entry is the parking spot.
