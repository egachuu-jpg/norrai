# Norr AI — 6 Month Roadmap
**May 2026 → October 2026**

---

## Where We Are Today

**Built:**
- Website live at norrai.co (Cloudflare Pages)
- 10+ n8n workflows across real estate, manufacturing, and event ops
- Neon Postgres schema designed and loaded with test data
- Tools live at tools.norrai.co (listing generator, lead response, open house, nurture, review request, B&B estimating)
- SendGrid verified, Twilio trial active, Claude API integrated

**Pending infrastructure:**
- LLC approval (MN SOS — filed)
- Relay business banking (waiting on LLC certificate)
- Twilio account upgrade + local 507 number
- Cloudflare Access auth on agent-facing tools
- Privacy policy + Terms of Service (just completed)

**Pipeline:**
- B&B Manufacturing — warm, demo built, pending smoke test
- Insurance broker friend — discovery call framework ready
- Trnka Wood Products — woodworking, discovery in progress
- Prep Network (event ops) — discovery form built for warm lead

**No paying clients yet.**

---

## Revenue Targets

| Month | Clients | MRR Target |
|-------|---------|------------|
| June | 1–2 | $500–1,200 |
| July | 2–3 | $1,200–2,000 |
| August | 3–5 | $2,000–3,500 |
| September | 5–7 | $3,500–5,000 |
| October | 7–10 | $5,000–7,500 |

*Assumes mix of Starter ($500–600/mo) and Growth ($1,000–1,200/mo) clients. One Pro engagement in month 5–6 would meaningfully accelerate these numbers.*

---

## Month 1 — May 2026: Close the Gap

**Goal: First paying client. Infrastructure production-ready.**

- [ ] LLC certificate arrives → open Relay account
- [ ] Upgrade Twilio trial → buy local 507 number
- [ ] Complete Twilio A2P 10DLC registration (privacy + terms now live)
- [ ] Cloudflare Access on all agent-facing tools
- [ ] Fix open_house_setup.html innerHTML → textContent (XSS)
- [ ] Smoke test B&B Manufacturing workflows — import into n8n, fire test payload
- [ ] Close B&B Manufacturing as first client OR insurance broker
- [ ] Send Trnka Wood Products technical intake form
- [ ] Begin scoping Trnka quote builder

**Milestone: First invoice sent.**

---

## Month 2 — June 2026: First Clients Live

**Goal: 1–2 clients live and delivering value. Trnka build underway.**

- [ ] First client fully onboarded — workflows active, client confirmed receiving output
- [ ] Trnka Wood Products: build job spec form + material cost calculator + PDF quote generator
- [ ] Trnka rate card finalized (Google Sheet)
- [ ] Refine onboarding process — document steps so it repeats cleanly
- [ ] Close second client (whichever of B&B / insurance broker isn't closed in Month 1)
- [ ] Add SMS consent language to all public-facing forms
- [ ] Log sms_consent + consent_timestamp in Neon leads table

**Milestone: Two clients live and paying. Onboarding is a repeatable process.**

---

## Month 3 — July 2026: Repeatability

**Goal: 3 paying clients. Sales motion systematized.**

- [ ] Trnka Wood Products live — quote builder in production
- [ ] Third client closed (dental or real estate referral)
- [ ] Build first Growth tier workflow: SOI re-engagement (real estate) or cross-sell campaign (insurance)
- [ ] Pitch first Growth tier upgrade to an existing Starter client
- [ ] Smoke test insurance Starter workflows end to end
- [ ] Re-import Real Estate Open House Follow-Up with updated prompt
- [ ] Build simple internal job tracker: active clients, workflow status, last check-in date
- [ ] Start collecting testimonials / case study data from first clients

**Milestone: $2,000+ MRR. First Growth tier client.**

---

## Month 4 — August 2026: Expand Verticals

**Goal: 5 clients across 3+ verticals. Delivery becomes systematic.**

- [ ] Fourth and fifth clients closed — target dental and/or trades
- [ ] Dental Starter package fully templatized — missed call, appointment reminder, review request, dormant reactivation
- [ ] Trades vertical productized (Trnka learnings → repeatable for plumbers, electricians, contractors)
- [ ] Move B&B rate card to Google Sheets for self-service updates
- [ ] Add Neon logging to B&B workflow
- [ ] Evaluate first contractor hire for delivery support (n8n workflow builds)
- [ ] Internal monitoring dashboard — red/green status per client

**Milestone: $3,500+ MRR. Delivery doesn't require Egan for every build.**

---

## Month 5 — September 2026: First Pro Engagement

**Goal: Land first Pro tier client. Begin custom pipeline work.**

- [ ] Identify Pro tier candidate from existing client base or pipeline
- [ ] Pro tier candidates: dental (Dentrix/Eaglesoft pipeline + production dashboard), real estate (MLS feed + deal velocity dashboard), insurance (book-of-business retention risk scoring)
- [ ] Scope and price first Pro build ($3,000–6,000 setup + $2,000–2,500/mo)
- [ ] Build client-facing reporting — monthly summary email per client showing workflow activity and ROI metrics
- [ ] Encrypt PII columns in Neon (pgcrypto) — required before Pro tier client data flows through
- [ ] 6–7 total clients

**Milestone: $5,000+ MRR. First Pro engagement scoped or signed.**

---

## Month 6 — October 2026: Scale Foundation

**Goal: 8–10 clients. Business runs without Egan in every workflow.**

- [ ] 8–10 clients across Starter, Growth, and Pro tiers
- [ ] Contractor or part-time hire handling Starter tier delivery
- [ ] Systematized sales: referral process documented, vertical one-pagers built, discovery call script refined
- [ ] Cloudflare Access fully deployed across all client-facing tools
- [ ] Add rate limiting to all n8n webhook endpoints
- [ ] Server-side input validation in n8n workflows
- [ ] Case studies written for top 2–3 verticals (dental, real estate, trades)
- [ ] Evaluate white-label partnerships — agencies referring clients to NorrAI

**Milestone: $7,500+ MRR. Business has leverage — not all hours are Egan's.**

---

## What the AI Agency Could Help With

Areas where outside help accelerates the roadmap most:

**Delivery bandwidth** — If you close 3+ clients in months 1–2, building each workflow takes time. An agency with n8n or Make expertise could handle Starter tier builds while you focus on sales and Growth/Pro.

**Vertical expansion** — You have dental, real estate, and insurance playbooks. Dental and insurance workflows aren't fully built yet. An agency could build those packages to spec while you manage the client relationship.

**Growth tier content** — The Claude prompts for SOI re-engagement and cross-sell campaigns need to be written and tested. Good prompt engineering takes iteration.

**Pro tier builds** — Custom pipelines (Dentrix/Eaglesoft, MLS feeds, retention dashboards) are the highest-margin work. If the agency has data engineering experience, they can support Pro builds so Egan doesn't have to do all of it.

**What to protect:** Client relationships, sales process, and the NorrAI brand voice. Those stay with you.

---

## Key Risks to Flag

- **Single operator bottleneck** — closing and delivering simultaneously is hard at 5+ clients without help
- **Twilio A2P approval delay** — 10DLC registration can take 2–4 weeks; start now or SMS is blocked
- **Pro tier scope creep** — custom builds can balloon; scope tightly and charge setup fees upfront
- **Client churn at month 3** — if a workflow doesn't deliver obvious ROI in 60 days, clients cancel; instrument everything so you can show the math
