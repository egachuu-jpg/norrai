const { test, expect } = require('@playwright/test');
const { mockWebhook } = require('./helpers');

const FORM_URL = '/clients/open_house_setup.html';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fillRequired(page) {
  await page.fill('#agent_name', 'Jane Smith');
  await page.fill('#agent_phone', '5071234567');
  await page.fill('#agent_email', 'jane@brokerage.com');
  await page.fill('#street_address', '123 Maple St');
  await page.fill('#city', 'Faribault');
  await page.fill('#listing_description', 'Beautiful 3-bed ranch home. Updated kitchen with granite counters, new roof 2022, oversized garage. Quiet cul-de-sac location near parks and top-rated schools.');
}

// ─── 1. Required field validation ─────────────────────────────────────────────

test.describe('Required field validation', () => {
  const requiredFields = [
    { id: 'agent_name',           fill: 'Jane Smith' },
    { id: 'agent_phone',          fill: '5071234567' },
    { id: 'agent_email',          fill: 'jane@brokerage.com' },
    { id: 'street_address',       fill: '123 Maple St' },
    { id: 'city',                 fill: 'Faribault' },
    { id: 'listing_description',  fill: 'Beautiful 3-bed home.' },
  ];

  for (const field of requiredFields) {
    test(`blocks submit when ${field.id} is empty`, async ({ page }) => {
      await mockWebhook(page);
      await page.goto(FORM_URL);
      await fillRequired(page);
      await page.fill(`#${field.id}`, '');
      await page.click('#submit-btn');

      await expect(page.locator('#status.success')).not.toBeVisible();
    });
  }
});

// ─── 2. Field type enforcement ────────────────────────────────────────────────

test.describe('Field type enforcement', () => {
  test('rejects invalid agent email format', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#agent_email', 'notanemail');
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).not.toBeVisible();
  });

  test('state field enforces maxlength of 2', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.fill('#state', 'MINN');
    const val = await page.inputValue('#state');
    expect(val.length).toBeLessThanOrEqual(2);
  });
});

// ─── 3. Payload shape ─────────────────────────────────────────────────────────

test.describe('Payload shape', () => {
  test('property_address constructed from address fields', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#state', 'MN');
    await page.fill('#zip', '55021');

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.property_address).toBe('123 Maple St, Faribault, MN, 55021');
  });

  test('state defaults to MN when unchanged', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.state).toBe('MN');
  });

  test('source_form is open_house_setup', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.source_form).toBe('open_house_setup');
  });

  test('X-Norr-Token header is present', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    expect(req.headers()['x-norr-token']).toBeTruthy();
  });
});

// ─── 4. Submit UI states ──────────────────────────────────────────────────────

test.describe('Submit UI states', () => {
  test('button disables and shows Generating… while in-flight', async ({ page }) => {
    let resolve;
    await page.route('**/webhook/**', async route => {
      await new Promise(r => { resolve = r; });
      route.fulfill({ status: 200, body: 'ok' });
    });

    await page.goto(FORM_URL);
    await fillRequired(page);
    page.click('#submit-btn');

    await expect(page.locator('#submit-btn')).toBeDisabled({ timeout: 2000 });
    await expect(page.locator('#submit-btn')).toHaveText('Generating…');

    resolve();
    await expect(page.locator('form')).not.toBeVisible({ timeout: 5000 });
  });

  test('button re-enables after error', async ({ page }) => {
    await mockWebhook(page, 500);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#submit-btn')).toBeEnabled({ timeout: 5000 });
  });
});

// ─── 5. Success and error banners ─────────────────────────────────────────────

test.describe('Success and error banners', () => {
  test('shows success banner and hides form on 200', async ({ page }) => {
    await mockWebhook(page, 200);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('form')).not.toBeVisible({ timeout: 5000 });
    const hasSuccess = await page.evaluate(() => document.querySelector('#status').classList.contains('success'));
    expect(hasSuccess).toBe(true);
    const statusText = await page.evaluate(() => document.querySelector('#status').textContent);
    expect(statusText).toContain('jane@brokerage.com');
  });

  test('shows error banner on 500, form stays visible', async ({ page }) => {
    await mockWebhook(page, 500);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('form')).toBeVisible();
  });

  test('shows error banner on network failure', async ({ page }) => {
    await page.route('**/webhook/**', route => route.abort());
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.error')).toBeVisible({ timeout: 5000 });
  });
});
