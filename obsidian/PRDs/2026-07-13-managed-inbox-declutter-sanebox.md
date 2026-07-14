# Managed Inbox Declutter — SaneBox (Weichert pilot)

**Date:** 2026-07-13
**Status:** Design approved — pending execution
**Client / pilot:** Weichert, Realtors® – Heartland – Faribault — Evan Knutson (eknutson@teamyellownow.com) + Michelle Jasinski (mjasinski@teamyellownow.com)
**Model:** Buy + manage (NorrAI resells & manages a third-party tool — NOT a build)

---

## Problem

The Weichert agents have badly overflowing inboxes — hundreds of unread emails burying the messages that actually need their attention. Real client mail, lender/title correspondence, and lead notifications get lost in a sea of newsletters, promotions, and receipts.

Desired end state, in the client's words: **marketing/promotional email gets decluttered (read/filed), spam disappears, and only email that requires the agent's action stays surfaced in the inbox.**

## Decision: Buy, don't build

We evaluated building an AI triage pipeline in n8n (clone + fix the internal Email Triage system) vs. buying a commodity tool. **Decision: buy.**

Rationale:
- The goal is pure declutter — a commodity, well-solved problem. A purpose-built vendor's classifier beats anything we'd hand-tune in a Haiku prompt, with zero build or maintenance.
- We are **not** trying to extract leads here (that is the separate "Email Inbox Lead Ingestion Pipeline" story). Cleanup does not need to touch our Neon pipeline.
- Time-to-value: relief for the agents this week instead of weeks of build.

We preserve NorrAI's "own the stack, client pays for the service" principle by owning the tool account and billing through (see Account Ownership).

### Tool: SaneBox

Chosen for the closest match to the desired behavior:
- Runs in the background over Gmail OAuth — **no client switching email clients**.
- Auto-moves non-urgent mail to **SaneLater**, graymail/newsletters to a digest folder, known-junk senders to **SaneBlackHole** (deleted-on-sight).
- Net effect: only what matters stays in the inbox; everything filed is still retrievable in folders.

Alternative considered: **Fyxer AI** (adds AI reply drafting) — rejected as scope creep for a declutter play. Revisit only if the client later wants AI-assisted replies.

> **Task-1 gate:** confirm current SaneBox pricing/tiers and feature set before quoting the client. Details below may drift.

## Account ownership: NorrAI-owned

NorrAI owns the SaneBox account(s) and billing; the client is billed through NorrAI.
- **Why:** stickier (client can't trivially walk away with it), matches the infrastructure-ownership principle, and keeps the management relationship intact.
- **Tradeoff accepted:** if the client leaves, we deprovision rather than hand off. Acceptable.

## The offering

### Setup (one-time fee, per agent)
1. Connect the agent's inbox to SaneBox via OAuth.
2. Configure folder behavior (SaneLater / digest / SaneBlackHole) to match the "only actionable surfaces" goal.
3. **Backlog pass** — train SaneBox against the existing unread pile so the inbox is visibly clean on day one.
4. Tune sender lists to the agent's world: real clients / lenders / title companies / lead-provider notifications → keep in inbox; known promo senders → SaneLater / BlackHole.
5. 20–30 min walkthrough so the agent trusts it and knows where filed mail lives.

### Management (monthly recurring fee — the retainer justification)
- Monitor and correct misfiles; retrain from the agent's drag-backs so it stays sharp.
- Monthly **"here's what we cleaned"** summary — volume decluttered = visible, recurring ROI.
- Adjust rules as the agent gives feedback / new noise sources appear.
- Handle unsubscribes and bulk cleanup on request.

## Pricing (framework — final numbers are Egan's call)

- **Setup fee** per agent covering OAuth connect, backlog pass, sender-list tuning, walkthrough.
- **Monthly management fee** per agent, bundling the SaneBox subscription cost (NorrAI-paid) + the ongoing management above.
- Mark up over the raw SaneBox per-inbox cost so the recurring fee is margin-positive after the subscription.
- Position as a Starter-tier add-on.

## Safety / client considerations

- **Third-party data flow:** the agent's mail passes through SaneBox. Give the client a plain-language heads-up and get a yes before connecting — it's their business inbox. SaneBox is widely used, so this is disclosure, not a blocker.
- **Nothing NorrAI-owned is at risk** — no Neon writes, no n8n workflow, no code. This is an account + configuration + relationship.
- **Lead-provider emails must stay in the inbox** — ensure SaneBox rules never file Zillow / Realtor.com / BoldTrail / Facebook lead notifications to SaneLater/BlackHole. These are actionable by definition (and are the input to the separate lead-ingestion work).

## Pilot → expand

Weichert (Evan & Michelle) first. Measure decluttered volume + agent satisfaction after ~2–4 weeks. If it lands, it's a trivially repeatable add-on for Matt Lien and every future client — a low-effort recurring-revenue line.

## Out of scope

- Lead extraction / enrichment (separate story: Email Inbox Lead Ingestion Pipeline).
- Any n8n build, classifier, or Neon integration.
- AI reply drafting (Fyxer territory — revisit later if desired).

## Open items

1. Confirm SaneBox current pricing/features (gates the client quote).
2. Final setup + monthly price points (Egan).
3. Client consent conversation with Evan & Michelle before connecting inboxes.
