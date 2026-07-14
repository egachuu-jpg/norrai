# 507 Air — Google Business Profile Setup Packet

Copy-paste-ready values to create the Google Business Profile at
**https://business.google.com/create**. All facts sourced from the client site +
Oscar's email 2026-07-09. Oscar must sign in and complete Google's owner verification
(postcard / phone / video) — that step can't be delegated.

**Ownership model (decided):** the profile lives on a Google Account tied to Oscar's
own business identity (`airheatingandcooling507@outlook.com`), not a Norr AI agency
account. Norr AI gets added as a **Manager** on the profile once it's created. Cleaner
long-term — no ownership transfer needed if the engagement ever ends.

---

## 0. What's needed from Oscar to start

Confirmed via Google's sign-in check (2026-07-13): **no Google Account exists yet**
for `airheatingandcooling507@outlook.com` ("Couldn't find this account"). So this is a
fresh account creation, not a password lookup — Oscar needs to pick a password.

Only two things gate everything below. Send him something like:

> Hey Oscar — ready to get 507 Air listed on Google (the map pin that shows up in
> search with directions, hours, and reviews). Two quick things:
>
> 1. Set up a new Google account using airheatingandcooling507@outlook.com (Google
>    lets you use an existing email instead of a new Gmail) — just pick a password.
>    Once it exists, I'll build out the whole profile (categories, hours, service
>    area, description) and add myself as a manager so I can keep it updated.
> 2. Your actual street address (not the PO box) — Google requires a real address to
>    verify you as the owner, even though it won't show publicly since you're a
>    service-area business, not a storefront.
>
> Once that's in, Google sends a verification code by mail or text to
> (507) 491-3063 — I'll just need you to forward me that code when it lands, then
> we're live.

Everything in §1–9 below can be filled in the moment the account exists — none of it
needs Oscar's further input.

---

## 1. Business identity

| Field | Value |
|---|---|
| Business name | 507 Air Heating & Cooling |
| Legal entity | 507 Air Heating & Cooling, LLC |
| Phone | (507) 491-3063 |
| Email | airheatingandcooling507@outlook.com |
| Website | https://507air.com |

**Business name rule:** Google requires the *real-world* name exactly. Use
"507 Air Heating & Cooling" — do **not** stuff keywords (e.g. "…Furnace Repair Faribault").
That risks suspension.

---

## 2. Business type — CRITICAL SETTING

507 Air is a **service-area business (SAB)**, not a storefront. The README says the
street address is intentionally not published.

- When Google asks *"Do you want to add a location customers can visit?"* → **No.**
- This hides the address publicly but still requires Oscar to enter it privately for
  verification. That address is never shown on the profile.
- Then set the **service area** (see §5).

---

## 3. Categories

| Slot | Category |
|---|---|
| Primary | **HVAC contractor** |
| Additional | Heating contractor |
| Additional | Air conditioning contractor |
| Additional | Furnace repair service |
| Additional | Air conditioning repair service |
| Additional | Water heater installation / repair |

Primary category drives most of the ranking — keep it **HVAC contractor**.

---

## 4. Hours

| Day | Hours |
|---|---|
| Mon–Fri | 8:00 AM – 4:00 PM |
| Sat | Closed (set special note: emergency calls) |
| Sun | Closed (set special note: emergency calls) |

Google has no "emergency only" weekend toggle. Best practice: mark Sat/Sun **Closed**,
then add to the description + a Google Post that weekend **emergency service** is available
by phone. Optionally turn on the "Open 24 hours" attribute only if Oscar wants after-hours
calls flowing 7 days.

---

## 5. Service area

Enter these as service-area towns (from `index.html`). Google caps the list ~20;
lead with the core market:

Faribault, Northfield, Owatonna, Medford, Morristown, Warsaw, Waterville, Kenyon,
Cannon Falls, Lonsdale, Montgomery, Le Center, Le Sueur, Elko New Market, Lakeville,
Farmington, Apple Valley, Burnsville, Mankato, St. Peter

> Confirm the final list with Oscar — README flags the town list as needing his sign-off.

---

## 6. Description (750 char max)

> 507 Air Heating & Cooling is a family-owned HVAC contractor serving Faribault,
> southern Minnesota, the Mankato area, and the south metro. We install, repair, and
> maintain furnaces, air conditioners, ductless mini-splits, water heaters, boilers,
> garage heaters, and whole-home humidifiers — for houses, businesses, and mobile/
> manufactured homes. Repairs on all makes and models, plus tune-ups and inspections.
> Se habla español. Weekend emergency calls available. Call (507) 491-3063.

---

## 7. Services list (add under "Services" in the profile)

- Furnace installation
- Furnace repair
- AC installation
- AC repair
- Ductless mini-split install & service
- Water heater installation & repair
- Boiler service
- Gas line service
- Garage heater installation
- Whole-home humidifier installation & service
- Heating & cooling for mobile / manufactured homes
- Tune-ups & inspections (all makes & models)

---

## 8. Attributes to enable

- ✅ Identifies as Latino-owned (if Oscar wants it shown)
- ✅ Language spoken: **Spanish** ("Se habla español" is on every page)
- ✅ Online estimates / Onsite services
- ✅ Emergency service available

---

## 9. Photos

Pull from `client-sites/507-air/images/`. Recommended upload order:
1. Logo (square) → profile logo
2. Best job/install photo → cover
3. Equipment shots (Goodman, Cooper & Hunter, Durastar, GE furnace — per README)
4. Any truck / team photo if available

Minimum for a credible profile: logo + cover + 3 job photos.

---

## 10. After it's live — loop back to the website

The site is already wired for this — a "Leave us a review" card is live on `index.html`
(§Reviews section) and a "Leave a Google review" link is in the footer of all 5 pages.
Both currently point to:

```
https://search.google.com/local/writereview?placeid=REPLACE_WITH_GBP_PLACE_ID
```

Once the profile is created, find its **Place ID** (Google Business Profile Manager →
Info, or via the [Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id))
and find/replace `REPLACE_WITH_GBP_PLACE_ID` across `index.html`, `about.html`,
`contact.html`, `deals.html`, `services.html` with the real ID.

Once real reviews start coming in:
1. Copy a `.review-card` block in `index.html`'s Reviews section for each one (see the
   HTML comment there for the exact markup — quote + star rating + "— Name, City").
2. Remove or move the "Leave us a review" prompt card once there are 3+ real reviews.
3. Grab the **"Get more reviews" short link** Google generates and give it to Oscar for
   texting to happy customers (can replace the placeid URL above if shorter/preferred).

---

## Verification note

Google will mail a postcard with a code (or offer phone/video) to Oscar. The profile
stays unverified and low-visibility until that code is entered. This is the one step
that must be done by the owner, on his Google account.
