const { test, expect } = require('@playwright/test');
const { mockWebhook } = require('./helpers');

const FORM_URL = '/event_ops_discovery.html';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fillRequired(page) {
  await page.fill('#name', 'Sarah Johnson');
  await page.fill('#email', 'sarah@prepnetwork.com');
}

// ─── 1. Required field validation ─────────────────────────────────────────────

test.describe('Required field validation', () => {
  test('blocks submit when name is empty', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#name', '');
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).not.toBeVisible();
  });

  test('blocks submit when email is empty', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#email', '');
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).not.toBeVisible();
  });

  test('rejects invalid email format', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#email', 'notanemail');
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).not.toBeVisible();
  });
});

// ─── 2. Pill checkbox interactions ────────────────────────────────────────────

test.describe('Pill checkbox interactions', () => {
  test('clicking a pill toggles active class', async ({ page }) => {
    await page.goto(FORM_URL);
    const pill = page.locator('.pill').first();
    await expect(pill).not.toHaveClass(/active/);
    await pill.click();
    await expect(pill).toHaveClass(/active/);
    await pill.click();
    await expect(pill).not.toHaveClass(/active/);
  });

  test('multiple pills can be active simultaneously', async ({ page }) => {
    await page.goto(FORM_URL);
    const pills = page.locator('#event-types .pill');
    await pills.nth(0).click();
    await pills.nth(1).click();
    await expect(pills.nth(0)).toHaveClass(/active/);
    await expect(pills.nth(1)).toHaveClass(/active/);
  });

  test('selected event_types appear as comma-separated string in payload', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    await page.locator('.pill').filter({ hasText: 'Tournaments' }).click();
    await page.locator('.pill').filter({ hasText: 'Showcases' }).click();

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.event_types).toContain('tournaments');
    expect(body.event_types).toContain('showcases');
  });

  test('no pills selected → event_types is empty string', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.event_types).toBe('');
  });

  test('pills reset after successful submit', async ({ page }) => {
    await mockWebhook(page, 200);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.locator('.pill').filter({ hasText: 'Tournaments' }).click();

    await page.click('#submit-btn');
    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });

    await expect(page.locator('.pill.active')).toHaveCount(0);
  });
});

// ─── 3. Rating scale interactions ─────────────────────────────────────────────

test.describe('Rating scale interactions', () => {
  test('clicking a rating label selects that value', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.click('label[for="reg-3"]');
    const checked = await page.$eval('#reg-3', el => el.checked);
    expect(checked).toBe(true);
  });

  test('selecting a different rating deselects the previous', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.click('label[for="comm-2"]');
    await page.click('label[for="comm-5"]');

    const two = await page.$eval('#comm-2', el => el.checked);
    const five = await page.$eval('#comm-5', el => el.checked);

    expect(two).toBe(false);
    expect(five).toBe(true);
  });
});

// ─── 4. Payload shape ─────────────────────────────────────────────────────────

test.describe('Payload shape', () => {
  test('required fields present in payload', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());

    expect(body.name).toBe('Sarah Johnson');
    expect(body.email).toBe('sarah@prepnetwork.com');
    expect(body.source).toBe('event_ops_discovery_form');
  });

  test('submitted_at is a valid ISO timestamp', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(new Date(body.submitted_at).toISOString()).toBe(body.submitted_at);
  });

  test('rating fields are null when not selected', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.time_registration).toBeNull();
    expect(body.time_communications).toBeNull();
  });

  test('all seven time rating fields appear in payload', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());

    expect('time_registration' in body).toBe(true);
    expect('time_communications' in body).toBe(true);
    expect('time_vendor' in body).toBe(true);
    expect('time_scheduling' in body).toBe(true);
    expect('time_post_event' in body).toBe(true);
    expect('time_reporting' in body).toBe(true);
    expect('time_social' in body).toBe(true);
  });

  test('no X-Norr-Token header (public form)', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    expect(req.headers()['x-norr-token']).toBeFalsy();
  });
});

// ─── 5. Success and error banners ─────────────────────────────────────────────

test.describe('Success and error banners', () => {
  test('shows success banner and resets form on 200', async ({ page }) => {
    await mockWebhook(page, 200);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#name')).toHaveValue('');
    await expect(page.locator('#email')).toHaveValue('');
  });

  test('shows error banner on 500, form does not reset', async ({ page }) => {
    await mockWebhook(page, 500);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#name')).toHaveValue('Sarah Johnson');
  });

  test('shows error banner on network failure', async ({ page }) => {
    await page.route('**/webhook/**', route => route.abort());
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.error')).toBeVisible({ timeout: 5000 });
  });

  test('button re-enables after error', async ({ page }) => {
    await mockWebhook(page, 500);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#submit-btn')).toBeEnabled({ timeout: 5000 });
  });
});
