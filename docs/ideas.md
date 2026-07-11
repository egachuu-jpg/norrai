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
