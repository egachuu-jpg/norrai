# Norr AI — Agent Assistant · One-Pager

*Meeting reference (top) + agent setup card (bottom). Connector: `https://agent-mcp.norrai.co/mcp`*

---

## PITCH (for the room)

**Hook —** *"Between showings, you pull out your phone and just say: 'who should I
call today?' — and it reads back your hottest leads, their numbers, and what's
overdue. Need to remember a contract deadline? 'Add a task to order the
inspection on Elm by Thursday.' You talk, it handles it. No new app to learn, no
typing."*

**What it does (their words):**
- **Who to call today** — people who just reached back out, then new leads, each with a reason and a number.
- **Look up anyone** — "what's going on with the Johnsons?": what they asked for, what we've sent, what's open.
- **A to-do list you talk to** — add it, check what's due, mark it done — by voice.
- **Your week in numbers** — "what did Norr AI do for me this week?"
- **Hands-free** — all of it in the Claude phone app while you drive.

**Live demo (do it on your phone):** tap the shortcut → voice →
1. *"Who should I call today?"*
2. *"What's going on with [a name from that list]?"*
3. *"Add a task to follow up with them tomorrow at 10."*
4. *"What's on my plate this week?"*
5. *"What did Norr AI do for me this week?"* → bridge to price.

**Objections → answers:**
- *"Is my data safe?"* → "You log in as you; you only ever see **your** book, never another agent's."
- *"Another app?"* → "It's the Claude app — one connector, nothing to maintain."
- *"I'm not techy."* → "Three taps and an email code, then you just talk to it."
- *"Cost?"* → value = GCI you stop leaving on the table. (Needs Claude **Pro** on their phone.)

**Don't over-promise:** 6 abilities today; "write my listing" / "research this
property" / "add a lead" are roadmap — tease, don't date. Opt-out flags are
**email** opt-outs, not do-not-text.

**Prereqs (already done / to confirm):** their emails are allow-listed in
Cloudflare Access ✅ · their books are loaded (Evan `eknutson@` ·
Michelle `mjasinski@` — confirm which) · each needs Claude **Pro** on their phone.

---

## ✂️ AGENT SETUP CARD

*~5 minutes, once. You'll need the Claude app and your work email.*

**Set it up:**
1. **Install the Claude app** and sign in (**Pro** plan).
2. **Add the connector:** Settings → Connectors → *Add custom connector* → paste
   `https://agent-mcp.norrai.co/mcp`.
3. **Log in:** a browser opens to `norrai.cloudflareaccess.com` → enter the code
   emailed to your work address.
4. **Paste your instructions:** Settings → Profile / personal preferences → paste
   the Norr AI instruction block → make sure the Norr AI connector is **on for new
   chats**.
5. **Add the voice shortcut:** iPhone → Shortcuts app → **+** → Add Action →
   *Claude → "Start Voice Conversation"* → name it **Norr AI** → *Add to Home
   Screen*. (Android: long-press the Claude icon for a voice shortcut, or use a
   Google Assistant routine.)

**Then just tap the Norr AI icon and say:**
- *"Who should I call today?"*
- *"Add a task to order the inspection for 412 Elm by Thursday."*
- *"What's going on with [client name]?"*
- *"What's on my plate this week?"* … *"Mark the inspection done."*
- *"What did Norr AI do for me this week?"*

**If it reaches for your phone's Reminders instead of your leads:** the connector
isn't enabled for new chats, or the profile instructions didn't save — fix those
two and retry.
