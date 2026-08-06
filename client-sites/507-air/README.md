# 507 Air Heating & Cooling — Client Website

Static brochure site for 507 Air Heating & Cooling, LLC (Oscar Salazar, Faribault MN).
One-time build. Booking info only — no forms, no webhooks.

## Deploy

Its **own** Cloudflare Workers project (separate from the `website/` norrai.co project),
using the same static-assets pattern as `website/wrangler.jsonc`:

- **Root directory** (Cloudflare project setting): `client-sites/507-air` — the build
  must run inside this folder so wrangler finds `wrangler.jsonc` here. If it runs from the
  repo root, the deploy fails with "Missing entry-point to Worker script or to assets directory".
- `wrangler.jsonc` serves this folder (`assets.directory: "."`); no build command needed.
- The `name` in `wrangler.jsonc` (`507air`) must match the Cloudflare Worker/project name.
- Custom domain: `507air.com` (registered; pending ICANN email verification by Oscar).

## Contact facts (source: Oscar's email 2026-07-09 + billboard art)

- Phone: (507) 491-3063
- Email: airheatingandcooling507@outlook.com
- Hours: **Open 24/7** (changed 2026-08-04 at Oscar's request; was Mon–Fri 8am–4pm with
  weekend emergency calls). Hours appear in six places — the `openingHours` schema on
  `index.html`, the `contact.html` meta description, the `contact.html` hours table, a
  hero trust chip on `index.html`, and the footer block on all 5 pages. `tests/507air_site.spec.js`
  guards all of them. Google Business Profile must match — see `GBP_SETUP.md` §4.
- Spanish spoken — featured on every page
- Street address intentionally NOT published (service-area business)

## Things to update over time

1. **Seasonal deals** — edit the `.deal-card` blocks in `deals.html` (instructions in an
   HTML comment there) and the teaser card on `index.html`.
2. **Service-area towns** — the town list on `index.html` + `contact.html` is a reasonable
   first pass (Faribault + surrounding). **Confirm the exact list with Oscar.**
3. **Photos** — more job photos from Oscar's email (Goodman, Cooper & Hunter, Durastar,
   GE furnace) can be added to `images/` and worked into services/about pages.
4. **Google reviews** — the review CTAs (index.html §Reviews + the footer link on every
   page) are hidden until `js/review-link.js` has a real `REVIEW_URL`; set it there once
   the Google Business Profile is verified. See `GBP_SETUP.md` §10. Once real reviews
   come in, add `.review-card` blocks to the Reviews section on `index.html`.

## Tests

`tests/507air_site.spec.js` — served on port 3001 by the Playwright webServer config.
Run with `npm test`.
