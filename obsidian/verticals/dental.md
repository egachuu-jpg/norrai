# Dental Playbook

## Pitch

**Lead with:** no-show math.

"If you see 20 patients a day and 10% no-show, that's 2 empty chairs. At $200 average production value, that's $400/day, $8,000/month walking out the door. We cut no-shows with automated reminders — the system pays for itself in the first week."

**Never say:** "automation," "AI," "n8n."

---

## Pain points to listen for

- "We have a lot of no-shows"
- "We spend time calling to confirm appointments"
- "We're not getting enough Google reviews"
- "We have patients we haven't seen in over a year"

---

## Qualifying questions

- How many chairs do you have? How many are active?
- What's your no-show rate right now?
- What's your average production value per appointment?
- What practice management software do you use? (Dentrix, Eaglesoft, Open Dental)
- Do you have someone at the front desk whose job touches reminders/recall?

---

## ROI math

_No-show reduction × appointments/day × production value = monthly recovery_

If they run 30 appointments/day at 12% no-show = 3.6 no-shows/day. Cutting that to 5% = 2.1 saved appointments/day × $200 = $420/day = $8,400/month.
Starter at $600/mo. Very easy math.

---

## Starter workflows (to build)

- Appointment reminders (24hr + 2hr before)
- Missed appointment follow-up SMS
- Post-appointment review request
- Missed call → auto SMS
- New patient intake form

## Growth anchor

Dormant patient reactivation — patients who haven't booked in 12+ months.

## Pro

Dentrix/Eaglesoft data pipeline → production dashboard. Requires API access negotiation.

---

## Gotchas

- Practice management software APIs vary wildly — Dentrix has an API, Open Dental is more open, Eaglesoft is harder
- HIPAA considerations: be careful about what goes in SMS vs. email; never include PHI in SMS
- Front desk staff will be the day-to-day users — design for non-technical people
