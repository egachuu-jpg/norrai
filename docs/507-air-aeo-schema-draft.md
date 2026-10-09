# 507 Air — AEO schema + FAQ draft (for review, NOT applied to the site)

Drafted 2026-10-09. Nothing here is live: `client-sites/507-air/index.html` is unchanged.
Lives in `docs/` on purpose — the 507 Air Worker serves its whole directory (`assets.directory: "."`),
so a draft saved there would be publicly fetchable.

## What the live site has today

`index.html` has one `HVACBusiness` JSON-LD block: name, phone, email, PO Box address, 35-town
`areaServed`, `openingHours` (`Mo-Su 00:00-23:59`), `knowsLanguage`. It has **no** `url`, `sameAs`,
`logo`/`image`, service catalog, or `FAQPage`, and no visible FAQ content anywhere.

## 1. Blocked on facts we don't have yet

| Needed | Why | Where to get it |
|---|---|---|
| ~~**GBP profile URL**~~ **Received 2026-10-09:** `https://share.google/v0nK6iGUhTkTlm5av` (not resolved from this environment — click it once to confirm it opens the 507 Air profile; a canonical `google.com/maps/place/...` URL is a slightly better `sameAs` value if you can grab one). Originally: (the Maps/Search share link, e.g. `https://www.google.com/maps/place/...` or `https://maps.app.goo.gl/...`) | The one `sameAs` link that matters. **Not** the `g.page/r/CS6mxtsUw3ujEBM/review` link — that's the review form | Profile dashboard → Share profile |
| Facebook / Instagram URLs | `sameAs` | Pages don't exist yet — add only after created |
| Place ID | Audit config `place_id` | [Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id) |
| License #, insurance, certifications | Strong trust/entity signals; PRD lists them | Oscar. Not on the site today, so I did not invent any |

Per `docs/lessons-learned.md`: never ship a placeholder in live markup. The GBP link is now in the `sameAs`
array below; Facebook/Instagram entries get added only once those pages exist.

## 2. Proposed replacement for the `index.html` JSON-LD block

Changes vs. today: adds `@id`, `url`, `logo`, `image`, `description`, `hasMap`/`sameAs` (fill in),
`hasOfferCatalog` (services copied from `services.html` / `GBP_SETUP.md` §7). **Kept unchanged** so
`tests/507air_site.spec.js` stays green: `openingHours` string, phone, email, address, `areaServed`.

```json
{
  "@context": "https://schema.org",
  "@type": "HVACBusiness",
  "@id": "https://507air.com/#business",
  "name": "507 Air Heating & Cooling, LLC",
  "url": "https://507air.com",
  "logo": "https://507air.com/images/logo.jpg",
  "image": "https://507air.com/images/logo-hero.jpg",
  "description": "Family-owned HVAC contractor in Faribault, MN serving southern Minnesota, the Mankato area and the south metro. Furnace and AC installation, repair, tune-ups and inspections. Open 24/7. Se habla español.",
  "telephone": "+1-507-491-3063",
  "email": "airheatingandcooling507@outlook.com",
  "address": { "@type": "PostalAddress", "postOfficeBoxNumber": "PO Box 355", "addressLocality": "Faribault", "addressRegion": "MN", "postalCode": "55021", "addressCountry": "US" },
  "areaServed": ["Faribault", "Northfield", "Owatonna", "Medford", "Warsaw", "Morristown", "Waterville", "Kenyon", "Cannon Falls", "Lonsdale", "Montgomery", "Elko New Market", "Mankato", "Skyline", "Eagle Lake", "St. Clair", "Madison Lake", "Elysian", "Janesville", "Pemberton", "Mapleton", "Good Thunder", "Garden City", "Lake Crystal", "Nicollet", "Kasota", "St. Peter", "Le Center", "Le Sueur", "Lakeville", "Farmington", "Apple Valley", "Burnsville", "Rosemount", "Prior Lake"],
  "openingHours": "Mo-Su 00:00-23:59",
  "knowsLanguage": ["en", "es"],
  "sameAs": [
    "https://share.google/v0nK6iGUhTkTlm5av"
  ],
  "hasOfferCatalog": {
    "@type": "OfferCatalog",
    "name": "HVAC services",
    "itemListElement": [
      { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Furnace installation and repair" } },
      { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Air conditioning installation and repair" } },
      { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Ductless mini-split installation and service" } },
      { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Water heater installation and repair" } },
      { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Boiler service" } },
      { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Garage heater installation and repair" } },
      { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Heating and cooling for mobile and manufactured homes" } },
      { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Tune-ups and inspections" } },
      { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "24/7 emergency HVAC service" } }
    ]
  }
}
```

Open questions before applying:
- `sameAs` now holds the real GBP share link; verify it opens the right profile before shipping.
- `logo`/`image` paths exist in `client-sites/507-air/images/`; confirm `logo.jpg` is the one Oscar wants as the logo.
- The schema address is **PO Box 355**, while the GBP is a service-area business with a hidden address.
  Not necessarily a problem, but it's the first thing to compare in the NAP check.

## 3. FAQ: visible content + `FAQPage` schema

**Be realistic about the payoff.** Google restricted FAQ rich results in 2023 to well-known
government and health sites, so a `FAQPage` block will not give 507 Air an expanded search result.
Its value is (a) plain, quotable answers on the page for people and AI tools, and (b) machine-readable
structure — a plausible but unproven help. The visible FAQ is what matters; the schema must mirror it exactly
(Google requires marked-up Q&A to be visible on the page).

All answers use only facts already on the site or in `GBP_SETUP.md`. **No prices, no license numbers,
no response times, no brand list** — none of those are documented. Oscar should read every answer
before it goes live.

### Draft Q&A (add as an `<section>` on `index.html` or a new `faq.html`)

1. **Do you offer emergency HVAC service?**
   Yes. 507 Air is open 24 hours a day, 7 days a week, including nights, weekends and holidays. Call (507) 491-3063.
2. **What areas do you serve?**
   We're based in Faribault and serve southern Minnesota, including Northfield, Owatonna, Mankato, St. Peter, Lakeville, Farmington and the south metro. See the full town list on our Contact page.
3. **What heating and cooling services do you offer?**
   We install, repair and maintain furnaces, air conditioners, ductless mini-splits, water heaters, boilers, garage heaters and fireplaces, and we do tune-ups and inspections.
4. **Do you work on all makes and models?**
   Yes, we repair all makes and models. We aren't locked into any one brand, and if you prefer a specific brand for a new system, we'll obtain it for you.
5. **Do you service mobile and manufactured homes?**
   Yes. We service heating and cooling in mobile and manufactured homes.
6. **Do you work on both homes and businesses?**
   Yes. We work on residential and commercial heating and cooling.
7. **¿Hablan español?**
   Sí. Se habla español — servicio completo en su idioma.

(Check #2 against Oscar's confirmed town list; `README.md` flags the list as needing his sign-off.
Check #3 "fireplaces" and "boilers" against `services.html`, which lists fireplace service and boilers.)

### Matching `FAQPage` JSON-LD (second `<script type="application/ld+json">` block)

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    { "@type": "Question", "name": "Do you offer emergency HVAC service?", "acceptedAnswer": { "@type": "Answer", "text": "Yes. 507 Air is open 24 hours a day, 7 days a week, including nights, weekends and holidays. Call (507) 491-3063." } },
    { "@type": "Question", "name": "What areas do you serve?", "acceptedAnswer": { "@type": "Answer", "text": "We're based in Faribault and serve southern Minnesota, including Northfield, Owatonna, Mankato, St. Peter, Lakeville, Farmington and the south metro." } },
    { "@type": "Question", "name": "What heating and cooling services do you offer?", "acceptedAnswer": { "@type": "Answer", "text": "We install, repair and maintain furnaces, air conditioners, ductless mini-splits, water heaters, boilers, garage heaters and fireplaces, and we do tune-ups and inspections." } },
    { "@type": "Question", "name": "Do you work on all makes and models?", "acceptedAnswer": { "@type": "Answer", "text": "Yes, we repair all makes and models. We aren't locked into any one brand, and if you prefer a specific brand for a new system, we'll obtain it for you." } },
    { "@type": "Question", "name": "Do you service mobile and manufactured homes?", "acceptedAnswer": { "@type": "Answer", "text": "Yes. We service heating and cooling in mobile and manufactured homes." } },
    { "@type": "Question", "name": "Do you work on both homes and businesses?", "acceptedAnswer": { "@type": "Answer", "text": "Yes. We work on residential and commercial heating and cooling." } },
    { "@type": "Question", "name": "¿Hablan español?", "acceptedAnswer": { "@type": "Answer", "text": "Sí. Se habla español — servicio completo en su idioma." } }
  ]
}
```

## 4. Tests to add when this is applied (`tests/507air_site.spec.js`)

- Every JSON-LD block parses; `@type`s are `HVACBusiness` and `FAQPage`.
- Every `sameAs` entry is an `https://` URL (guards against a shipped placeholder).
- Each `FAQPage` question/answer string appears verbatim in the visible page text.
- Existing `openingHours` assertion stays as is.

## 5. Audit config

`scripts/aeo-audit/clients/507-air.json` is ready except `place_id` (null — see below) and `citations` (empty).
Run: `node scripts/aeo-audit/run.js --input scripts/aeo-audit/clients/507-air.json`

- **Set `place_id` first.** The engine treats `null` as "no Google profile exists" and reports that as the
  top finding — wrong for 507 Air, so don't send a report generated with it null.
- Needs `GOOGLE_PLACES_API_KEY` and `GEMINI_API_KEY` in the repo-root `.env` (no `.env` exists in this environment).
- `citations: []` marks that pillar "not assessed" until you fill the 8-directory checklist (~30 min).
