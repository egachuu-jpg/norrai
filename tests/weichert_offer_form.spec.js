const { test, expect } = require('@playwright/test');
const { mockWebhook } = require('./helpers');

const BASE_URL = '/weichert_offer_form.html';

const FAKE_SEARCH = 'address=123+Maple+St%2C+Faribault%2C+MN&listing_url=https%3A%2F%2Fzillow.com%2Fhomedetails%2F123-maple&agent=Jane+Smith&agent_email=jane%40brokerage.com&agent_phone=5071234567';

async function gotoWithParams(page) {
  await page.addInitScript((fakeSearch) => {
    const Orig = window.URLSearchParams;
    window.URLSearchParams = class extends Orig {
      constructor(init) {
        super(!init ? fakeSearch : init);
      }
    };
  }, FAKE_SEARCH);
  await page.goto(BASE_URL);
}

async function fillRequired(page) {
  await page.fill('#buyer_name', 'Sarah Johnson');
  await page.fill('#buyer_phone', '5075551234');
  await page.fill('#buyer_email', 'sarah@gmail.com');
  await page.fill('#offer_amount', '275000');
  await page.selectOption('#financing_type', 'conventional');
  await page.fill('#proposed_close_date', '2026-07-15');
}

// ─── 1. URL param handling ─────────────────────────────────────────────────────

test.describe('URL param handling', () => {
  test('shows error state when address param is missing', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator('#missing-params')).toBeVisible();
    await expect(page.locator('#main-content')).not.toBeVisible();
  });

  test('shows form when address param is present', async ({ page }) => {
    await gotoWithParams(page);
    await expect(page.locator('#main-content')).toBeVisible();
    await expect(page.locator('#missing-params')).not.toBeVisible();
  });

  test('property address appears in page badge', async ({ page }) => {
    await gotoWithParams(page);
    await expect(page.locator('#property-display')).toHaveText('123 Maple St, Faribault, MN');
  });
});

// ─── 2. Required field validation ─────────────────────────────────────────────

test.describe('Required field validation', () => {
  const requiredFields = [
    { id: 'buyer_name',          fill: async (p) => p.fill('#buyer_name', '') },
    { id: 'buyer_phone',         fill: async (p) => p.fill('#buyer_phone', '') },
    { id: 'buyer_email',         fill: async (p) => p.fill('#buyer_email', '') },
    { id: 'offer_amount',        fill: async (p) => p.fill('#offer_amount', '') },
    { id: 'proposed_close_date', fill: async (p) => p.fill('#proposed_close_date', '') },
  ];

  for (const field of requiredFields) {
    test(`blocks submit when ${field.id} is empty`, async ({ page }) => {
      await mockWebhook(page);
      await gotoWithParams(page);
      await fillRequired(page);
      await field.fill(page);
      await page.click('#submit-btn');

      await expect(page.locator('#status.success')).not.toBeVisible();
    });
  }

  test('blocks submit when financing_type is not selected', async ({ page }) => {
    await mockWebhook(page);
    await gotoWithParams(page);
    await page.fill('#buyer_name', 'Sarah Johnson');
    await page.fill('#buyer_phone', '5075551234');
    await page.fill('#buyer_email', 'sarah@gmail.com');
    await page.fill('#offer_amount', '275000');
    await page.fill('#proposed_close_date', '2026-07-15');
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).not.toBeVisible();
  });
});

// ─── 3. Field type enforcement ────────────────────────────────────────────────

test.describe('Field type enforcement', () => {
  test('rejects invalid buyer email format', async ({ page }) => {
    await mockWebhook(page);
    await gotoWithParams(page);
    await fillRequired(page);
    await page.fill('#buyer_email', 'notanemail');
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).not.toBeVisible();
  });
});

// ─── 4. Payload shape ─────────────────────────────────────────────────────────

test.describe('Payload shape', () => {
  test('required buyer fields present in payload', async ({ page }) => {
    await mockWebhook(page);
    await gotoWithParams(page);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());

    expect(body.buyer_name).toBe('Sarah Johnson');
    expect(body.buyer_phone).toBe('5075551234');
    expect(body.buyer_email).toBe('sarah@gmail.com');
    expect(body.offer_amount).toBe(275000);
    expect(body.financing_type).toBe('conventional');
    expect(body.proposed_close_date).toBe('2026-07-15');
  });

  test('property_address from URL appears in payload', async ({ page }) => {
    await mockWebhook(page);
    await gotoWithParams(page);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.property_address).toBe('123 Maple St, Faribault, MN');
  });

  test('listing_url from URL appears in payload', async ({ page }) => {
    await mockWebhook(page);
    await gotoWithParams(page);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.listing_url).toBe('https://zillow.com/homedetails/123-maple');
  });

  test('agent fields from URL appear in payload', async ({ page }) => {
    await mockWebhook(page);
    await gotoWithParams(page);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.agent_name).toBe('Jane Smith');
    expect(body.agent_email).toBe('jane@brokerage.com');
    expect(body.agent_phone).toBe('5071234567');
  });

  test('source_form is weichert_offer_form', async ({ page }) => {
    await mockWebhook(page);
    await gotoWithParams(page);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.source_form).toBe('weichert_offer_form');
  });

  test('contingency fields are false when unchecked', async ({ page }) => {
    await mockWebhook(page);
    await gotoWithParams(page);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.contingency_inspection).toBe(false);
    expect(body.contingency_financing).toBe(false);
    expect(body.contingency_appraisal).toBe(false);
    expect(body.contingency_sale_of_home).toBe(false);
  });

  test('contingency_inspection is true when checked', async ({ page }) => {
    await mockWebhook(page);
    await gotoWithParams(page);
    await fillRequired(page);
    await page.check('#contingency_inspection');

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.contingency_inspection).toBe(true);
  });

  test('submitted_at is a valid ISO timestamp', async ({ page }) => {
    await mockWebhook(page);
    await gotoWithParams(page);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(new Date(body.submitted_at).toISOString()).toBe(body.submitted_at);
  });

  test('X-Norr-Token header is present', async ({ page }) => {
    await mockWebhook(page);
    await gotoWithParams(page);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    expect(req.headers()['x-norr-token']).toBeTruthy();
  });
});

// ─── 5. Submit UI states ──────────────────────────────────────────────────────

test.describe('Submit UI states', () => {
  test('button disables and shows Submitting… while in-flight', async ({ page }) => {
    let resolve;
    await page.route('**/webhook/**', async route => {
      await new Promise(r => { resolve = r; });
      route.fulfill({ status: 200, body: 'ok' });
    });

    await gotoWithParams(page);
    await fillRequired(page);
    page.click('#submit-btn');

    await expect(page.locator('#submit-btn')).toBeDisabled({ timeout: 2000 });
    await expect(page.locator('#submit-btn')).toHaveText('Submitting…');

    resolve();
    await expect(page.locator('form')).not.toBeVisible({ timeout: 5000 });
  });

  test('button re-enables after error', async ({ page }) => {
    await mockWebhook(page, 500);
    await gotoWithParams(page);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#submit-btn')).toBeEnabled({ timeout: 5000 });
  });
});

// ─── 6. Success and error banners ─────────────────────────────────────────────

test.describe('Success and error banners', () => {
  test('shows success banner and hides form on 200', async ({ page }) => {
    await mockWebhook(page, 200);
    await gotoWithParams(page);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('form')).not.toBeVisible({ timeout: 5000 });
    const hasSuccess = await page.evaluate(() => document.querySelector('#status').classList.contains('success'));
    expect(hasSuccess).toBe(true);
  });

  test('success message mentions agent name', async ({ page }) => {
    await mockWebhook(page, 200);
    await gotoWithParams(page);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('form')).not.toBeVisible({ timeout: 5000 });
    const statusText = await page.evaluate(() => document.querySelector('#status').textContent);
    expect(statusText).toContain('Jane Smith');
  });

  test('shows error banner on 500, form stays visible', async ({ page }) => {
    await mockWebhook(page, 500);
    await gotoWithParams(page);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('form')).toBeVisible();
  });

  test('shows error banner on network failure', async ({ page }) => {
    await page.route('**/webhook/**', route => route.abort());
    await gotoWithParams(page);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.error')).toBeVisible({ timeout: 5000 });
  });
});
