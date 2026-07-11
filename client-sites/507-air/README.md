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
- Hours: Mon–Fri 8am–4pm; Sat–Sun emergency calls
- Spanish spoken — featured on every page
- Street address intentionally NOT published (service-area business)

## Things to update over time

1. **Seasonal deals** — edit the `.deal-card` blocks in `deals.html` (instructions in an
   HTML comment there) and the teaser card on `index.html`.
2. **Service-area towns** — the town list on `index.html` + `contact.html` is a reasonable
   first pass (Faribault + surrounding). **Confirm the exact list with Oscar.**
3. **Photos** — more job photos from Oscar's email (Goodman, Cooper & Hunter, Durastar,
   GE furnace) can be added to `images/` and worked into services/about pages.
4. **Google reviews** — once the Google Business Profile has reviews, add a testimonials
   section to `index.html`.

## Tests

`tests/507air_site.spec.js` — served on port 3001 by the Playwright webServer config.
Run with `npm test`.
