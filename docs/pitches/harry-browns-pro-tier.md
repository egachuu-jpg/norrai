# Harry Brown's — Pro Tier Build Summary

**Prepared by:** Norr AI  
**For:** Harry Brown's Family Dealerships, Faribault, MN  
**Date:** May 2026  
**Tier:** Pro — Custom Claude Code Pipelines + Dashboard

---

## The Core Idea

Harry Brown's has three structural advantages most dealerships don't:

1. **Six franchise brands under one roof** — inventory breadth that can be routed intelligently across leads
2. **A body shop (ABRA)** — total loss customers are warm, ready-to-buy leads that currently fall through the cracks
3. **Ten-plus years of customer data in the DMS** — purchase history, service records, trade history, finance deals — sitting unused

The Pro build connects those three advantages into a single system. The Dealer Management System (DMS) becomes the intelligence layer. Everything downstream — lead response, service-to-sales, inventory matching, management reporting — gets smarter because it knows the full customer history.

---

## What Gets Built

### Phase 1 — Foundation (Weeks 1–4)

**DMS Integration Pipeline**  
Extract customer records, repair orders, purchase history, and service intervals from the DMS into a Neon Postgres database on a scheduled sync. This is the unlock for everything else. Once customer data flows cleanly, automations stop being generic and start being genuinely personalized.

**Unified Customer Record**  
Every customer across all six brands, the service lane, and the body shop lives in one record. A customer who bought a Jeep, had their Silverado serviced, and went through ABRA after an accident is one person in the system — not three separate contacts in three separate silos.

**Service-to-Sales Intelligence Dashboard**  
A real-time internal view — monitor at the service desk or manager's tablet — that surfaces upgrade candidates as they arrive. Claude scores every open repair order: vehicle age, mileage, repair cost, estimated trade value, loan payoff. High-score ROs get flagged. Service advisors see it and have a natural, timely conversation. No pressure — just the right information at the right moment.

---

### Phase 2 — Intelligence Layer (Weeks 5–8)

**Multi-Franchise Inventory Matching**  
When a lead comes in for a vehicle that is out of stock or over budget, Claude automatically checks whether a comparable vehicle across any of the six brands fits their stated needs and price range — and routes the conversation accordingly. A customer who wanted a Chevy Silverado gets shown a GMC Sierra or RAM 1500 if the fit is there. Single-franchise dealers cannot do this.

**Totaled Vehicle → New Car Lead Pipeline**  
When ABRA marks a vehicle as a total loss, that customer needs a replacement immediately. Claude generates a personalized outreach — referencing their totaled vehicle, their history with the dealership, and relevant in-stock options — and creates a flagged lead for the sales team. Currently this handoff does not happen. These are some of the warmest leads in the building.

**AI Inventory Descriptions**  
When a pre-owned vehicle clears reconditioning and is added to inventory, Claude automatically generates a CarGurus listing, AutoTrader description, and social post — pulling from VIN data and reconditioning notes. No one writes copy. Every vehicle gets a complete listing within minutes of being marked ready.

---

### Phase 3 — Reporting + Portal (Weeks 9–12)

**White-Labeled Management Portal**  
A Harry Brown's branded dashboard for ownership and managers: active leads by brand, service pipeline, upgrade candidates in the lane, body shop throughput, workflow health, and review volume by franchise. Built on the Neon data layer established in Phase 1.

**Workflow Health Monitoring**  
Red/yellow/green status per active workflow. Failure alerts via Slack. Execution logs queryable by date and customer. Norr AI monitors and maintains the system — Harry Brown's staff sees outcomes, not infrastructure.

---

## Pricing

| | |
|---|---|
| **Build Fee** | $5,000 – $6,000 |
| **Monthly Retainer** | $2,000 – $2,500 |
| **Build Timeline** | 10 – 12 weeks |

Build fee reflects the DMS integration complexity and the number of departments touched. Monthly retainer covers maintenance, monitoring, prompt tuning, and ongoing workflow additions as the relationship grows.

**Break-even framing:** The monthly retainer is less than the gross profit on two vehicle sales. The service-to-sales dashboard alone, if it converts one additional upgrade per week, covers the cost many times over.

---

## Outstanding Questions

These need to be answered before a detailed scope and final pricing can be confirmed.

**1. Which DMS is Harry Brown's running?**  
Almost certainly CDK Global or Reynolds & Reynolds. CDK's API program (CDK Drive) requires dealer enrollment and has a defined access model. Reynolds & Reynolds is more restrictive and often requires a third-party middleware layer. The answer here determines whether Phase 1 is a 2-week build or a 6-week build — and whether the build fee lands at the low or high end of the range.

**2. Is there a CRM in place?**  
VinSolutions, DealerSocket, and similar platforms often aggregate DMS data and expose cleaner APIs than the DMS itself. If a CRM is already in use, Phase 1 may connect there instead of directly to the DMS — simpler, faster, and more stable.

**3. Is ABRA's system integrated with the main DMS, or does it run separately?**  
If ABRA runs on its own platform (common in franchised collision centers), the totaled vehicle pipeline requires a separate integration or a manual trigger point. Need to understand how repair orders flow between the body shop and the main dealership system.

**4. Who owns the technology decisions?**  
At a family-owned dealership, the DMS contract and API access are typically controlled by ownership or a general manager — not department heads. The right person to involve in the technical scoping conversation may be different from the person who initiated the sales conversation.

**5. What does current lead handling look like?**  
Understanding where internet leads land today (CRM, email inbox, DMS, all three) determines how the intake layer gets wired. If leads are already flowing into a CRM with an API, the instant lead response workflow is a fast add-on. If leads land in a shared Gmail inbox, there is more normalization work to do first.

---

## Suggested Next Step

A 60-minute technical discovery call with ownership or the general manager — and ideally whoever manages the DMS relationship. Goal: confirm the DMS platform, understand the current lead flow, and walk through the ABRA integration question. From there, a final scope and timeline can be locked within a week.

---

**Egan — Norr AI**  
hello@norrai.co  
norrai.co
