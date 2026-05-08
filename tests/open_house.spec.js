const { test, expect } = require('@playwright/test');
const { mockWebhook } = require('./helpers');

const BASE_URL = '/open_house.html';

const FAKE_SEARCH = 'address=123+Maple+St%2C+Faribault%2C+MN&agent=Jane+Smith&agent_email=jane%40brokerage.com&agent_phone=5071234567&notes=Updated+kitchen%2C+new+roof+2022';

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fillRequired(page) {
  await page.fill('#attendee_name', 'Sarah Johnson');
  await page.fill('#phone', '5075551234');
  await page.fill('#email', 'sarah@gmail.com');
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

  test('property address appears in the page badge', async ({ page }) => {
    await gotoWithParams(page);
    await expect(page.locator('#property-display')).toHaveText('123 Maple St, Faribault, MN');
  });

  test('notes param passes through to payload as property_notes', async ({ page }) => {
    await mockWebhook(page);
    await gotoWithParams(page);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.property_notes).toBe('Updated kitchen, new roof 2022');
  });

  test('agent params pass through to payload', async ({ page }) => {
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
    expect(body.property_address).toBe('123 Maple St, Faribault, MN');
  });
});

// ─── 2. Required field validation ─────────────────────────────────────────────

test.describe('Required field validation', () => {
  test('blocks submit when attendee_name is empty', async ({ page }) => {
    await mockWebhook(page);
    await gotoWithParams(page);
    await fillRequired(page);
    await page.fill('#attendee_name', '');
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).not.toBeVisible();
  });

  test('blocks submit when phone is empty', async ({ page }) => {
    await mockWebhook(page);
    await gotoWithParams(page);
    await fillRequired(page);
    await page.fill('#phone', '');
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).not.toBeVisible();
  });

  test('blocks submit when email is empty', async ({ page }) => {
    await mockWebhook(page);
    await gotoWithParams(page);
    await fillRequired(page);
    await page.fill('#email', '');
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).not.toBeVisible();
  });
});

// ─── 3. Payload shape ─────────────────────────────────────────────────────────

test.describe('Payload shape', () => {
  test('required fields present in payload', async ({ page }) => {
    await mockWebhook(page);
    await gotoWithParams(page);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());

    expect(body.attendee_name).toBe('Sarah Johnson');
    expect(body.phone).toBe('5075551234');
    expect(body.source_form).toBe('open_house_web');
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

  test('email is present in payload', async ({ page }) => {
    await mockWebhook(page);
    await gotoWithParams(page);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.email).toBe('sarah@gmail.com');
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

// ─── 4. Success and error banners ─────────────────────────────────────────────

test.describe('Success and error banners', () => {
  test('shows success banner and hides form on 200', async ({ page }) => {
    await mockWebhook(page, 200);
    await gotoWithParams(page);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#signin-form')).not.toBeVisible({ timeout: 5000 });
    const hasSuccess = await page.evaluate(() => document.querySelector('#status').classList.contains('success'));
    expect(hasSuccess).toBe(true);
  });

  test('success message mentions agent name', async ({ page }) => {
    await mockWebhook(page, 200);
    await gotoWithParams(page);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#signin-form')).not.toBeVisible({ timeout: 5000 });
    const statusText = await page.evaluate(() => document.querySelector('#status').textContent);
    expect(statusText).toContain('Jane Smith');
  });

  test('shows error banner on 500, form stays visible', async ({ page }) => {
    await mockWebhook(page, 500);
    await gotoWithParams(page);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#signin-form')).toBeVisible();
  });

  test('shows error banner on network failure', async ({ page }) => {
    await page.route('**/webhook/**', route => route.abort());
    await gotoWithParams(page);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.error')).toBeVisible({ timeout: 5000 });
  });
});
