# Real Estate Playbook

## Pitch

**Lead with:** speed-to-lead. Agents who respond within 5 minutes are 9x more likely to convert.

**Never say:** "automation," "n8n," "Claude."

**Say instead:** "your system responds instantly, 24/7, so you never lose a lead to a competitor who picked up first."

---

## Pain points to listen for

- "I miss leads when I'm showing houses"
- "I get leads at 10pm and don't respond until morning"
- "My follow-up is inconsistent"
- "I have old leads I never went back to"

---

## Qualifying questions

- How many leads do you get per month?
- What's your average GCI per closed deal?
- How long does it take you to respond to a new lead right now?
- What CRM are you on? (BoldTrail/kvCORE = Zapier; others vary)
- Do you work solo or with a team/ISA?

---

## ROI math

_Average GCI per deal × close rate lift = annual value_

Example: $8,000 GCI × 2 extra closings from faster follow-up = $16,000/yr.
Starter tier at $600/mo = $7,200/yr. Easy math.

---

## Starter workflows (built)

- [[instant-lead-response]] — Claude personalizes by listing, fires in seconds
- [[open-house-setup]] — QR code generator, sign-in page
- [[open-house-follow-up]] — next-morning SMS + email
- [[7-touch-cold-nurture]] — 60-day sequence, research agent wired in
- [[review-request]] — post-close review ask
- [[listing-description-generator]] — MLS copy from bullet points

## Growth anchor

Sphere of influence re-engagement — past clients who haven't heard from the agent in 6+ months.

## Pro

MLS feed → deal velocity dashboard → lead scoring. Custom Claude Code pipeline.

---

## CRM notes

- **BoldTrail/kvCORE (Weichert):** outbound webhook locked by brokerage → use Zapier Starter ($20/mo), confirmed field names: `firstname`, `lastname`, `email`, `phone`, `origin`, `street`, `city`, `state`, `zip`
- **Follow Up Boss:** has native webhook support
- **Others:** ask what they're on before promising anything

---

## Gotchas

- BoldTrail sends automated listing alert emails — Norr AI nurture should be SMS-dominant to avoid overlap
- Zapier free tier pauses after 2 weeks — always push clients to Starter tier
- Weichert agents can't configure outbound webhooks themselves — brokerage controls it
