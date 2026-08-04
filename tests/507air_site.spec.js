// Tests for client-sites/507-air/ — 507 Air Heating & Cooling client website.
// Medium risk per CLAUDE.md: marketing pages, no webhook forms (booking is
// call/email only). Coverage: pages load, nav resolves, contact links correct,
// key content present, mobile nav works, no JS errors.

const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3001';
const PHONE_HREF = 'tel:+15074913063';
const EMAIL_HREF = 'mailto:airheatingandcooling507@outlook.com';
// the "Ask for reviews" short link from the Google Business Profile dashboard,
// set as REVIEW_URL in client-sites/507-air/js/review-link.js
const REVIEW_URL = 'https://g.page/r/CS6mxtsUw3ujEBM/review';

const PAGES = [
  { path: '/index.html', title: /507 Air Heating & Cooling.*Faribault/ },
  { path: '/services.html', title: /Services — 507 Air/ },
  { path: '/deals.html', title: /Seasonal Deals — 507 Air/ },
  { path: '/about.html', title: /About Us — 507 Air/ },
  { path: '/contact.html', title: /Contact & Booking — 507 Air/ },
];

for (const { path, title } of PAGES) {
  test.describe(`${path}`, () => {
    test('loads with correct title and no JS errors', async ({ page }) => {
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      const response = await page.goto(`${BASE}${path}`);
      expect(response.status()).toBe(200);
      await expect(page).toHaveTitle(title);
      expect(errors).toEqual([]);
    });

    test('header call button and footer contact links are correct', async ({ page }) => {
      await page.goto(`${BASE}${path}`);
      await expect(page.locator('.site-nav .call-btn')).toHaveAttribute('href', PHONE_HREF);
      await expect(page.locator(`.site-footer a[href="${PHONE_HREF}"]`)).toBeVisible();
      await expect(page.locator(`.site-footer a[href="${EMAIL_HREF}"]`)).toBeVisible();
    });

    // the footer hours block is duplicated on all 5 pages and must match the
    // Google Business Profile (Open 24 hours) — stale copies are the drift risk
    test('footer hours read 24/7, not the old 8am–4pm', async ({ page }) => {
      await page.goto(`${BASE}${path}`);
      const footer = page.locator('.site-footer');
      await expect(footer).toContainText('Open 24/7');
      await expect(footer).not.toContainText('8am–4pm');
    });

    // The owner hit a Google 404 from a hardcoded placeholder review URL. Every
    // review CTA must get its href from review-link.js and nowhere else.
    test('footer review CTA is wired to review-link.js', async ({ page, request }) => {
      await page.goto(`${BASE}${path}`);
      expect(await page.locator('script[src="js/review-link.js"]').count()).toBe(1);

      // the served markup must carry no review URL of its own — inert until JS runs
      const html = await (await request.get(`${BASE}${path}`)).text();
      expect(html, 'no review URL hardcoded in markup').not.toMatch(/g\.page|writereview|REPLACE_WITH/);

      const footerLink = page.locator('.site-footer a[data-review-url]');
      await expect(footerLink).toBeVisible();
      await expect(footerLink).toHaveAttribute('href', REVIEW_URL);
    });
  });
}

test('nav links from home resolve to real pages', async ({ page, request }) => {
  await page.goto(`${BASE}/index.html`);
  const hrefs = await page.locator('.site-nav a:not(.call-btn)').evaluateAll(
    (links) => links.map((a) => a.getAttribute('href'))
  );
  expect(hrefs).toEqual(['index.html', 'services.html', 'deals.html', 'about.html', 'contact.html']);
  for (const href of hrefs) {
    const res = await request.get(`${BASE}/${href}`);
    expect(res.status(), `${href} should resolve`).toBe(200);
  }
});

test('home: hero headline, trust chips, and brands are present', async ({ page }) => {
  await page.goto(`${BASE}/index.html`);
  // the logo is the hero; a hidden H1 keeps the name for SEO/screen readers
  await expect(page.locator('.hero-logo')).toHaveAttribute('alt', /507 Air Heating & Cooling/);
  await expect(page.locator('.hero h1')).toContainText('507 Air Heating & Cooling');
  await expect(page.locator('.hero-tagline')).toContainText(/cooling & heating needs/i);
  await expect(page.locator('.trust-chips')).toContainText('Family-owned');
  await expect(page.locator('.trust-chips')).toContainText('Se habla español');
  await expect(page.locator('.trust-chips')).toContainText('24/7');
  for (const brand of ['GE', 'Goodman', 'Cooper & Hunter', 'Durastar']) {
    await expect(page.locator('.brand-row')).toContainText(brand);
  }
});

// structured data is what Google reads for hours — it has to say 24/7 too, or
// the profile and the site disagree on the one signal that drives "open now"
test('home: LocalBusiness schema declares 24/7 opening hours', async ({ page }) => {
  await page.goto(`${BASE}/index.html`);
  const raw = await page.locator('script[type="application/ld+json"]').textContent();
  const schema = JSON.parse(raw);
  expect(schema.openingHours).toBe('Mo-Su 00:00-23:59');
});

test('services: full service list from owner email is covered', async ({ page }) => {
  await page.goto(`${BASE}/services.html`);
  const body = page.locator('main');
  for (const svc of [
    'Heating & Cooling Systems',
    'Ductless Mini-Splits',
    'Garage Heaters',
    'Mobile Homes',
    'Fireplaces',
    'Water Heaters',
    'Boilers',
    'Gas Lines',
    'Light Plumbing',
    'Humidification Systems',
    'Exhaust Fans',
  ]) {
    await expect(body, `services page should list "${svc}"`).toContainText(svc);
  }
});

test('home: service area lists both regions with named towns for local SEO', async ({ page }) => {
  await page.goto(`${BASE}/index.html`);
  const groups = page.locator('.area-group');
  expect(await groups.count()).toBe(3);
  await expect(groups.nth(0).locator('h3')).toContainText('Southern Minnesota');
  await expect(groups.nth(1).locator('h3')).toContainText('Mankato Area');
  await expect(groups.nth(2).locator('h3')).toContainText('South Metro');
  for (const town of ['Faribault', 'Cannon Falls', 'Mankato', 'Le Sueur', 'Lakeville', 'Apple Valley']) {
    const count = await page.locator('.area-list li', { hasText: town }).count();
    expect(count, `area list should name ${town}`).toBeGreaterThan(0);
  }
});

test('contact: service area groups present with catchall call link', async ({ page }) => {
  await page.goto(`${BASE}/contact.html`);
  expect(await page.locator('.area-group').count()).toBe(3);
  await expect(page.locator('.brand-note a[href="' + PHONE_HREF + '"]')).toBeVisible();
});

test('deals: at least one offer card with a phone CTA', async ({ page }) => {
  await page.goto(`${BASE}/deals.html`);
  const cards = page.locator('.deal-card');
  expect(await cards.count()).toBeGreaterThanOrEqual(1);
  await expect(cards.first().locator(`a[href="${PHONE_HREF}"]`)).toBeVisible();
});

test('about: family story and Ruger the mascot', async ({ page }) => {
  await page.goto(`${BASE}/about.html`);
  await expect(page.locator('main')).toContainText('family-owned');
  await expect(page.locator('main')).toContainText('Ruger');
  await expect(page.locator('img[src="images/billboard.png"]')).toBeVisible();
});

test('contact: booking info, 24/7 hours, Spanish', async ({ page }) => {
  await page.goto(`${BASE}/contact.html`);
  await expect(page.locator(`.info-card a[href="${PHONE_HREF}"]`)).toBeVisible();
  await expect(page.locator(`.info-card a[href="${EMAIL_HREF}"]`)).toBeVisible();
  await expect(page.locator('table.hours')).toContainText('Monday–Sunday');
  await expect(page.locator('table.hours .emergency-flag')).toContainText('Open 24 hours');
  // hours must read 24/7 everywhere — they mirror the Google Business Profile
  await expect(page.locator('table.hours')).not.toContainText('8am–4pm');
  await expect(page.locator('main')).toContainText('Se habla español');
  // PO Box mailing address (not the owner's home) per client request
  await expect(page.locator('.info-card', { hasText: 'By Mail' })).toContainText('PO Box 355');
  // no booking form — booking is call/email only per scope
  expect(await page.locator('form').count()).toBe(0);
});

test('mobile nav toggle opens and closes the menu', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto(`${BASE}/index.html`);
  const nav = page.locator('.site-nav');
  const toggle = page.locator('.nav-toggle');
  await expect(nav).toBeHidden();
  await toggle.click();
  await expect(nav).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(nav).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

// Google review CTAs. The owner reported a 404 from a hardcoded placeholder
// URL; these guard against ever shipping a review link that points nowhere.
test('review-link.js is served and holds a real review URL', async ({ request }) => {
  const res = await request.get(`${BASE}/js/review-link.js`);
  expect(res.status()).toBe(200);
  const src = await res.text();
  // read the assigned value only — the file's header documents a `<PLACE_ID>`
  // example URL, so scanning the whole source for placeholders false-positives
  const assigned = src.match(/var REVIEW_URL = '([^']*)';/);
  expect(assigned, 'review-link.js must assign REVIEW_URL').not.toBeNull();
  expect(assigned[1]).toBe(REVIEW_URL);
});

test('review URL is one of the two forms Google actually issues', async () => {
  expect(REVIEW_URL).toMatch(
    /^https:\/\/(g\.page\/r\/[\w-]+\/review|search\.google\.com\/local\/writereview\?placeid=[\w-]+)$/,
  );
});

test('home: reviews section is visible and both CTAs point at the review URL', async ({ page }) => {
  await page.goto(`${BASE}/index.html`);
  await expect(page.locator('#reviews')).toBeVisible();
  const links = page.locator('a[data-review-url]');
  expect(await links.count()).toBe(2); // reviews card + footer
  for (let i = 0; i < 2; i++) {
    await expect(links.nth(i)).toBeVisible();
    await expect(links.nth(i)).toHaveAttribute('href', REVIEW_URL);
  }
});

// The ask card is a solicitation, not a review — stars on it would read as a
// 5-star rating 507 Air wrote about itself.
test('home: the "leave us a review" card shows no star rating', async ({ page }) => {
  await page.goto(`${BASE}/index.html`);
  const askCard = page.locator('.review-card', { has: page.locator('a[data-review-url]') });
  expect(await askCard.locator('.stars').count(), 'ask card must not carry stars').toBe(0);
});

test('home: CTAs stay inert if review-link.js never runs', async ({ page }) => {
  // no-JS / script-blocked visitors must not see a dead link
  await page.route('**/js/review-link.js', (route) => route.abort());
  await page.goto(`${BASE}/index.html`);
  await expect(page.locator('#reviews')).toBeHidden();
  await expect(page.locator('.site-footer a[data-review-url]')).toBeHidden();
});

test('images referenced on pages exist', async ({ request }) => {
  for (const img of ['logo.jpg', 'logo-wide.jpg', 'logo-hero.jpg', 'billboard.png', 'ge-install.jpg']) {
    const res = await request.get(`${BASE}/images/${img}`);
    expect(res.status(), `images/${img} should exist`).toBe(200);
  }
});
