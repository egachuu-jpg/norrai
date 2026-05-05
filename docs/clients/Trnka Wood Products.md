# Trnka Wood Products — Client Notes

## Client Profile

- **Business type:** Solo custom woodworking shop
- **Specialty:** Cabinets, staircases, custom built-ins
- **Employees:** None — owner-operated
- **Accounting:** QuickBooks 2017 Desktop (local, no API)
- **Scheduling:** No calendar app — short-term schedule in his head (1–2 weeks), big picture on a whiteboard
- **Client communication:** Texts clients personally at night

---

## Pain Points Identified

### 1. Bookwork / QuickBooks (Primary Pain)
Manual entry into QB 2017 Desktop. No integration possible via API — it's the local installed version, not QuickBooks Online. Everything goes in by hand.

### 2. Post-Spec Quote Generation
His estimating process is **deliberately slow and consultative** — multiple back-and-forth conversations with clients about materials, dimensions, doors, drawers, slides, finishes, countertops, all while creating drawings. **Do not touch this process.** It's his craft and quality differentiator.

The pain is what happens *after* specs are locked: manual material cost math + educated guess on labor → informal quote document. No clean PDF, no structured record.

### 3. Client Communication
He texts clients at night when he has time. He's already doing this and clients likely appreciate the personal touch. **This is probably not worth automating.** The habit exists and works. Risk of automation: replacing a differentiating personal touch with a Twilio message that feels like a system.

The real question before building anything here: *Is he dropping balls — forgetting to update someone for weeks — or is the texting just slightly annoying?* If no balls are being dropped, don't touch it.

---

## What to Build

### Phase 1 — Job Spec Form + Quote Generator
A form **he fills out himself** (not the client) once specs are finalized. Inputs:

- Job type (cabinets, staircase, built-ins, etc.)
- Material quantities + types (pulls from his rate card)
- Hardware line items (drawer slides, hinges, handles — counts)
- Finish type
- His labor hour estimate

**Output:** Professional PDF quote emailed to the client + a job record stored in the system with client contact info.

**Note:** Before the calculator can work, he needs a rate card. If his material costs are all in his head, the first deliverable is helping him get it into a Google Sheet. That's the foundation.

### Phase 2 — QB Bridge
Once job records exist digitally from Phase 1, generate a CSV or formatted summary he can import into QB or copy-paste. Removes the manual entry step without requiring API access to QB Desktop.

### Phase 3 (Natural Extension) — Client Update Tool
If Phase 1 is working and job records exist, a quick-update form on his phone becomes easy to build: select a job, pick an update type, add a short note, Claude writes the message, sends via Twilio. Only worth building if he confirms he's actually dropping balls on client communication — don't build it speculatively.

---

## What NOT to Build

- **Automated calendar-based client updates** — his schedule is dictated by other contractors and supply chain. Not predictable enough for calendar triggers.
- **AI-assisted estimating** — his consultation process is intentional and deliberate. Automating it would be the wrong pitch.
- **QuickBooks direct integration** — QB 2017 Desktop has no API. Work around it with CSV exports, not through it.

---

## Tier & Pricing

**Starter — $500–600/mo + $500–600 setup**

Single operator, low complexity. The quote builder + job record system is template-able and repeatable across other trades (plumbers, electricians, contractors).

---

## Sales Approach

Lead with the quote generator demo. Fill it out in 2 minutes during the meeting, show him a professional PDF arrive in his inbox while you're still sitting across from him. That closes it.

Don't pitch Phase 2 or 3 at the first meeting. Let him use Phase 1 for a month and let the other pain points resurface naturally.

**Pitch framing:**
> "You keep doing what you do — the detailed conversations, the drawings, the craft. Once you've locked the specs, that's where we come in. You punch in the final numbers, we do the math and send the client a professional quote in 2 minutes."

---

## Discovery Form — Technical Intake

Send before scoping the build. Keep it short — he's a solo craftsman.

### Jobs & Volume
- How many active projects do you typically have running at once?
- How many new quotes do you write per month on average?
- Most common job types? *(cabinets, staircase, built-ins, countertop only, other)*
- Do you do finish work yourself or sub it out?
- Do you source and install countertops, or is that the client's responsibility?

### Estimating & Materials
- Do you have your material costs written down anywhere, or are they in your head?
- What materials do you typically price per job? *(lumber, sheet goods, drawer slides, hinges, handles, paint/stain, countertop, other hardware)*
- How do you estimate labor — by job type, by hour, flat fee, or gut feel?
- Do you charge a deposit? Progress payments? Or final on completion?

### Current Quote & Invoice Process
- What does your quote look like when you hand it to a client? *(handwritten, Word doc, verbal, napkin math)*
- Do you itemize materials and labor separately, or give one total?
- How do you invoice after a job is done?
- How long does it take to put together a quote after specs are finalized?

### QuickBooks
- What do you currently enter into QB — invoices only, or expenses too?
- How often are you in QB — daily, weekly, in batches?
- Do you track job profitability anywhere, or just overall income/expenses?
- Have you ever imported data into QB from a spreadsheet or CSV, or always manual entry?

---

## Key Listening Signals from Discovery

| Answer | Implication |
|--------|-------------|
| "Material costs are all in my head" | First deliverable is a rate card (Google Sheet), not an app |
| "I hand them a handwritten sheet" | Big gap — PDF quote alone may close the deal |
| "I've never imported into QB" | CSV export probably won't get used; focus on the quote side |
| "Yeah I've forgotten to update someone before" | Client update tool is worth scoping |
| "The texting is fine, just part of the routine" | Don't build the update tool |

---

## Open Questions

- [ ] What does his current quote document actually look like?
- [ ] Does he have material costs written down anywhere?
- [ ] How many quotes/month — is volume high enough to feel the pain?
- [ ] Has he ever had a client frustrated by lack of updates?
- [ ] Is he open to a Google Sheet rate card as the starting point?

---

## Next Steps

- [ ] Send technical intake / discovery form
- [ ] Review responses — confirm rate card situation before scoping build
- [ ] Build job spec form + quote generator demo
- [ ] Demo in person: fill out form, show PDF arrive in inbox in real time
