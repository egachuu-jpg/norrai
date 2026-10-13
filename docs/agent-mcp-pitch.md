# Agent MCP Connector — Pitch Cheat Sheet (Evan & Michelle)

Meeting: Wednesday. Goal: get them to try it on their own phone, then onboard.
**Lead with their day, not the tech.** Never say "MCP", "n8n", "Claude API", or
"automation" first. It's "your pipeline and your to-dos, by voice, in your pocket."

---

## The hook (say this)

> "You know how leads and follow-ups slip through the cracks when you're running
> between showings? Imagine just asking your phone — out loud — *'who should I
> call today?'* and it reads you your hottest leads, their numbers, and what's
> overdue. And when a deadline comes up in a contract, you say *'remind me to
> order the inspection on Elm by Thursday'* and it's logged. No new app to learn,
> no typing — you talk, it handles it."

## Their problem, in their language

- **Speed-to-lead / falling through cracks:** leads go cold when follow-up isn't
  top of mind. GCI walks out the door.
- **Deadline risk:** inspection/appraisal/financing dates buried in PAs; a missed
  one kills a deal or the trust.
- **Windshield time:** hours between showings where they can't safely type.

## What it does (frame as outcomes, 3 things)

1. **"Who do I call today?"** — their live pipeline, most promising first, with
   phone/email and whether the person opted out of texts. (`get_hot_leads`)
2. **A to-do list they talk to** — "add a task…", "what's on my plate this
   week?", "mark the inspection done." (`add_task` / `list_tasks` / `complete_task`)
3. **Hands-free** — all of it by voice in the Claude phone app while driving.

## The "wow" moment (demo live)

Do it on your phone in front of them: open voice mode and say
*"who should I call today?"* → it reads back real leads. Then
*"add a task to follow up with <name> tomorrow at 10."* Then
*"what's on my plate?"* That 30-second loop sells it better than any slide.

> Demo tip: demo against **their** book if their logins are set up (real names =
> real "oh wow"), or against the test client if not. Their `clients` rows already
> hold their leads (Evan/Michelle ≈ `eknutson@` 398 leads / `mjasinski@` 531 —
> confirm which is which).

## Likely objections → answers

- **"Is my client data safe?"** → "You log in with your own email code; you only
  ever see *your* book, never another agent's. It's scoped to you." (True — data
  is keyed to your login identity.)
- **"Another app to manage?"** → "It's the Claude app you'll already have for the
  assistant — one connector, no dashboard, nothing to maintain."
- **"I'm not techy."** → "Setup is three taps and an email code. After that you
  just talk to it."
- **"What's it cost?"** → steer to value (retained GCI from not dropping leads);
  land on the Norr AI tier conversation separately. Note: the Claude phone app
  needs a paid plan (Pro) for custom connectors — factor that in.

## What NOT to promise yet

- Voice works, but confirm it on *their* phone/plan during setup (it varies by
  app version). Don't promise voice until you've seen it on their device.
- Only these 4 abilities today. "Write the listing" / "research this property"
  are on the roadmap — tease, don't promise a date.

---

## Get them set up (assume zero Claude installed)

**Before the meeting (you, ~5 min) — REQUIRED or they can't log in:**
1. Confirm each has a `clients` row with their real email as
   `primary_contact_email` (they do: `mjasinski@teamyellownow.com`,
   `eknutson@teamyellownow.com`).
2. **Add both emails to the Cloudflare Access Allow policy** (Zero Trust → Access
   → `Norr AI Agent MCP — Authorize` app → policy → Include → Emails). Right now
   only `egachuu@gmail.com` is allowed — until you add theirs, their login is
   refused.
3. (Optional) tune each agent's `clients.enabled_tools` — defaults to the 4 core
   tools, which is right for the pitch.

**With each agent (≈5 min):**
1. **Install the Claude app** (iOS/Android/desktop) and sign in. Confirm the plan
   supports custom connectors (**Pro** or higher).
2. **Add the connector:** Settings → Connectors → Add custom connector → paste
   `https://agent-mcp.norrai.co/mcp`.
3. **Log in when it prompts:** a browser opens to `norrai.cloudflareaccess.com`;
   they enter the one-time code emailed to their work address. Done — authorized.
4. **Set profile instructions:** Settings → Profile / personal preferences →
   paste the work-scoped instructions from `docs/agent-mcp-server.md`
   (§ Agent setup → Profile instructions). This makes "who should I call today"
   hit the connector instead of the phone's Reminders — and, unlike a Project, it
   applies in the fresh voice chat the shortcut opens. Also set the connector to
   be **enabled by default in new chats**.
5. **Add the voice shortcut:** iOS Shortcuts → Claude → "Start Voice
   Conversation" → Add to Home Screen (steps in `docs/agent-mcp-server.md`
   § Agent setup → voice shortcut). This is the "tap and talk between showings"
   magic — set it up live with them.
6. **Enable Google Calendar** in the same Connectors screen (built-in) if you want
   calendar-aware answers.
7. **Test together:** tap the shortcut → voice → *"who should I call today?"*,
   then *"add a task…"*, then *"what's on my plate?"*

**After:** nothing to maintain per agent. To add/remove a tool for one of them
later, it's one `enabled_tools` edit in Neon — see `docs/agent-mcp-server.md`
(§ Adding a new tool).

---

## One-screen crib (bring this)

- Hook: *"ask your phone 'who should I call today' — out loud — between showings."*
- 3 outcomes: hot leads to call · a to-do list you talk to · hands-free by voice.
- Demo: voice → "who should I call today?" → "add a task…" → "what's on my plate?"
- Safety: your login, your book only.
- Setup: install Claude app (Pro) → add connector URL → email-code login →
  profile instructions → home-screen voice shortcut.
- Prereq you must do first: add their emails to the Access policy.
