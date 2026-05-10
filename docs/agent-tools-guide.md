# Agent Tools Guide

Reference for when and why to use each tool in the Norr AI client portal (`tools.norrai.co/clients/`).

---

## Listing Description Generator

**URL:** `/clients/listing_form.html`

Use this any time you need listing copy. Fill in the property details and your previous listings for voice matching — Claude writes a headline, MLS description, and social post in about 60 seconds. Saves the deliverable to your email.

**When to use:**
- New listing going active
- Rewriting an expired listing
- Need a social post for a listing you already wrote MLS copy for

**Tips:**
- Paste 3–5 of your previous listings in the "Your Voice" section — this is what makes the copy sound like you, not generic AI
- Your profile (name, email, previous listings) saves locally so you only set it up once

---

## Instant Lead Response

**URL:** `/clients/lead_response.html`

Use this the moment a new lead comes in. Paste their name, contact info, and message — Claude drafts a personalized SMS and email reply within 60 seconds. You see the drafts before anything sends.

This is **step 1** of the new lead flow. Cold Nurture (below) is step 2 — they work in sequence, not as alternatives.

**When to use:**
- New Zillow / Realtor.com / Facebook lead just came in
- Lead left a voicemail with property interest details
- You want to respond within 5 minutes but don't want to send a generic "thanks for reaching out"

**Tips:**
- The faster you respond, the higher your conversion rate — this tool exists to close that gap
- Review the drafts before sending; Claude will personalize to the property they mentioned

---

## Open House Setup

**URL:** `/clients/open_house_setup.html`

Use this before an open house. Enter the address and paste your MLS description — Claude pulls out the 3–5 best property highlights and generates a QR code for the door. The QR takes attendees to the sign-in form on their phone. The highlights get passed through to the follow-up message automatically, so Claude writes about the actual house, not a generic one.

**When to use:**
- Any open house you're hosting
- Run it the day before or morning of — the QR code emails to you immediately

**Tips:**
- Print the QR code and tape it to the front door or a yard sign
- The sign-in form captures name, phone, and email — the follow-up sends the next morning at 9am CT

---

## Cold Lead Nurture Enrollment

**URL:** `/clients/nurture_enroll.html`

Use this for leads who didn't convert after the initial response — they're real and interested but not ready to transact for another 6–18 months. Enrolls them in a 21-day, 6-touch sequence (Day 1 email → Day 3 SMS → Day 7 email → Day 10 SMS → Day 14 email → Day 21 SMS). Claude writes each message fresh based on their details — not a generic drip.

This is **step 2** of the new lead flow, after Instant Lead Response. The typical sequence: lead comes in → respond immediately with Instant Lead Response → if they go quiet or say they're not ready yet → enroll in Cold Nurture.

**When to use:**
- You sent the initial response and the lead went quiet after 1–2 exchanges
- Lead came in, you had a real conversation, but they said "we're not ready until spring"
- New lead from a portal you haven't called yet — enroll to stay top of mind while you work your active pipeline

**When NOT to use — cold nurture vs. reactivation:**

| Situation | Use |
|-----------|-----|
| Lead just came in, no prior relationship | Cold Nurture (this tool) |
| Past client you haven't talked to in 1–2 years | SOI Re-engagement *(Growth tier — not yet built)* |
| Old lead that went cold 6+ months ago | Reactivation campaign *(Growth tier — not yet built)* |
| Someone in your sphere you want to check in with | SOI Re-engagement *(Growth tier — not yet built)* |

The cold nurture sequence is for **new leads with no prior relationship**. The tone is introductory — building trust from zero. Reactivation (when built) will be a separate Growth-tier tool for dormant contacts where a relationship already existed. The message and tone are completely different: reconnection vs. introduction.

**Tips:**
- Email is required for T1/T3/T5 (email touches) — if you only have a phone number, the email touches will fail silently *(known gap — fix pending)*
- Don't enroll the same lead twice — the system doesn't dedupe on enrollment yet

---

## Review Request

**URL:** `/clients/review_request.html`

Use this after a deal closes. Enter the client's details and Claude sends a personalized SMS + email asking for a Google or Zillow review. You set the delay (1, 3, or 7 days) — review requests convert best when the client is still in the warm glow of closing.

**When to use:**
- Transaction just closed (buyer or seller)
- You helped a client with a rental or referral and want to capture the goodwill
- Following up on a review request that didn't get a response (re-send with a longer delay)

**Tips:**
- 1-day delay works best for most clients — strike while they're still excited
- Your Google review URL and Zillow profile URL save locally so you only enter them once
- Claude personalizes by the client's name and transaction type — reads like you wrote it

---

## Lead Action Edit

**URL:** `/clients/lead_action_edit.html`

Use this when the automated pipeline has drafted an SMS or email for a lead and you want to review or tweak it before it sends. This is the "agent in the loop" step for the Lead Cleanser pipeline — the draft appears here, you edit if needed, and approve to send.

**When to use:**
- You've opted into review-before-send mode for lead responses
- A draft came through that you want to personalize further before it goes out
- You want to check what the AI wrote before it reaches a high-value lead

---

## B&B Manufacturing Estimate Form

**URL:** `/clients/bnb_estimate_form.html`  
*(B&B employees only)*

Use this when a customer inquiry comes in for custom fabrication work. Fill in the services needed and job specs — Claude generates a line-item estimate with lead times and sends it to the submitter's email within 60 seconds.

**When to use:**
- New RFQ from a customer (phone, email, or walk-in)
- Need a ballpark to share before a formal quote
- Sales rep wants a quick estimate to close a conversation

**Tips:**
- Select all services the job will need — the estimate covers every checked service
- Rates are placeholders until B&B provides the real rate card
