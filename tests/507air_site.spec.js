// Tests for client-sites/507-air/ — 507 Air Heating & Cooling client website.
// Medium risk per CLAUDE.md: marketing pages, no webhook forms (booking is
// call/email only). Coverage: pages load, nav resolves, contact links correct,
// key content present, mobile nav works, no JS errors.

const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3001';
const PHONE_HREF = 'tel:+15074913063';
const EMAIL_HREF = 'mailto:airheatingandcooling507@outlook.com';

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
  // business name is the standout H1; tagline is the subheading
  await expect(page.locator('.hero h1.hero-name')).toContainText('507 Air Heating & Cooling');
  await expect(page.locator('.hero-tagline')).toContainText(/cooling & heating needs/i);
  await expect(page.locator('.trust-chips')).toContainText('Family-owned');
  await expect(page.locator('.trust-chips')).toContainText('Se habla español');
  for (const brand of ['GE', 'Goodman', 'Cooper & Hunter', 'Durastar']) {
    await expect(page.locator('.brand-row')).toContainText(brand);
  }
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

test('contact: booking info, hours, emergency weekends, Spanish', async ({ page }) => {
  await page.goto(`${BASE}/contact.html`);
  await expect(page.locator(`.info-card a[href="${PHONE_HREF}"]`)).toBeVisible();
  await expect(page.locator(`.info-card a[href="${EMAIL_HREF}"]`)).toBeVisible();
  await expect(page.locator('table.hours')).toContainText('Monday–Friday');
  await expect(page.locator('table.hours')).toContainText('8am–4pm');
  await expect(page.locator('table.hours .emergency-flag')).toContainText('Emergency calls');
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

test('images referenced on pages exist', async ({ request }) => {
  for (const img of ['logo.jpg', 'logo-wide.jpg', 'billboard.png', 'ge-install.jpg']) {
    const res = await request.get(`${BASE}/images/${img}`);
    expect(res.status(), `images/${img} should exist`).toBe(200);
  }
});
