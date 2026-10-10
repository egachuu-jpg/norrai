# 507 Air — GBP Posts program (scope)

Drafted 2026-10-09. Goal: keep the Google Business Profile **active** with a weekly post, to counter the
*trending-down* views and feed Google a freshness signal. This is a **content cadence**, not a one-time
task. Can be run by Oscar or (better) by Norr AI as a managed service — Egan is a profile Manager, so he
can post directly.

## Why weekly

A GBP "Update" post drops out of prominence after ~7 days, so a weekly post is the minimum to keep the
profile looking alive. It's one of the few free, repeatable signals 507 Air fully controls. Don't expect
posts alone to move rankings — they're a supporting signal alongside category (done) and reviews.

## Cadence & ownership

- **1 post/week**, same day each week (e.g. Monday AM). Seasonal bursts (pre-winter, pre-summer) can go 2x.
- **Owner:** Norr AI drafts + posts (recommended — reliable), or Oscar posts from drafts. Decide with Oscar.
- **Channel:** GBP app or business.google.com → Promote → Add update / Offer / Event.

## Content pillars (rotate — never scramble for ideas)

| Week slot | Pillar | Example |
|---|---|---|
| 1 | **Recent job + photo** | "Installed a new high-efficiency furnace in a Faribault home this week." |
| 2 | **Seasonal reminder / tip** | "Heading into winter — a quick furnace tune-up now prevents a cold-night breakdown." |
| 3 | **Service spotlight** | "We service heating & cooling in mobile and manufactured homes." (he already gets this search) |
| 4 | **Offer / CTA** | The seasonal tune-up special already on the site → link to `507air.com`. |

Rotate 1→2→3→4 and repeat. Each post: 1–2 sentences, 1 photo, a CTA button (Call / Learn more →
`tel:+15074913063` or `https://507air.com`).

## Hard rules (copy)

- **No after-hours / emergency *rate* language** anywhere — Oscar's standing decision (`GBP_SETUP.md §4`).
  "Open 24/7" is fine; pricing for after-hours is not.
- Real photos only (507 Air's own jobs), never stock that implies work they didn't do.
- Keep claims consistent with the site/NAP (same phone, same service list).
- English primary; a periodic Spanish post is a plus ("Se habla español").

## Build options (pick one with Oscar)

1. **Manual (start here).** A rolling 8-week content calendar (table above) in a doc; Norr AI/Oscar
   posts weekly by hand. Zero infra, lowest risk. Recommended for launch.
2. **Draft-assist (fast follow).** An n8n + Claude workflow that drafts next week's post from the pillar
   rotation and drops it in Slack/email for one-click approval; a human still posts to GBP. Removes the
   "what do I write" friction without needing GBP API access.
3. **Full auto-post (later, only if justified).** The Google Business Profile API can publish local posts,
   but it needs OAuth + API approval and is heavy for one client. Not worth it until there are several
   GBP-posting clients; revisit then. Must still follow the logging standard if built in n8n.

## Measure

Watch GBP dashboard **views/interactions** and **search terms** monthly — the point of posting is to
arrest the downward view trend and support discovery, not a direct rank lever. Pair with the review
automation (`507-air-n8n-workflows-scope.md`) and the category fix for compounding effect.

## Open decisions for Oscar / Egan

1. Who posts — Norr AI (managed) or Oscar?
2. Start manual (option 1) or go straight to draft-assist (option 2)?
3. Confirm there's a supply of real job photos to draw from (pillar 1 needs them).
