const { test, expect } = require('@playwright/test');
const { mockWebhook } = require('./helpers');

const FORM_URL = '/clients/weichert_weekly_listings_form.html';
const VALID_URL = 'https://northstar.weichert.com/listing/123-maple-st';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Fill row `i` (0-indexed). Pass null/undefined to skip a field.
async function fillRow(page, i, url, address) {
  if (url != null)     await page.fill(`input[name="url_${i}"]`, url);
  if (address != null) await page.fill(`input[name="address_${i}"]`, address);
}

// Minimum valid form: one listing URL.
async function fillRequired(page) {
  await fillRow(page, 0, VALID_URL);
}

// ─── 1. Required field validation ─────────────────────────────────────────────

test.describe('Required field validation', () => {
  test('renders exactly 10 listing rows', async ({ page }) => {
    await page.goto(FORM_URL);
    await expect(page.locator('.listing-row')).toHaveCount(10);
  });

  test('blocks submit when no URLs entered, shows error', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).not.toBeVisible();
    await expect(page.locator('#status.error')).toBeVisible();
  });

  test('does not POST when no URLs entered', async ({ page }) => {
    let hit = false;
    await page.route('**/webhook/**', route => { hit = true; route.fulfill({ status: 200, body: 'ok' }); });
    await page.goto(FORM_URL);
    await page.click('#submit-btn');
    await expect(page.locator('#status.error')).toBeVisible();
    expect(hit).toBe(false);
  });

  test('address without a URL is not enough to submit', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRow(page, 0, null, '123 Maple St');
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).not.toBeVisible();
    await expect(page.locator('#status.error')).toBeVisible();
  });

  test('one valid URL is enough to submit', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });
  });
});

// ─── 2. Field type enforcement ────────────────────────────────────────────────

test.describe('Field type enforcement', () => {
  test('rejects a malformed URL in a filled row', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRow(page, 0, 'not a url');
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).not.toBeVisible();
  });

  test('url inputs are type="url"', async ({ page }) => {
    await page.goto(FORM_URL);
    const type = await page.locator('input[name="url_0"]').getAttribute('type');
    expect(type).toBe('url');
  });
});

// ─── 3. Payload shape ─────────────────────────────────────────────────────────

async function submitAndCapture(page, fill) {
  await mockWebhook(page);
  await page.goto(FORM_URL);
  await fill(page);
  const [req] = await Promise.all([
    page.waitForRequest('**/webhook/**'),
    page.click('#submit-btn'),
  ]);
  return JSON.parse(req.postData());
}

test.describe('Payload shape', () => {
  test('listings is an array of {url, address}', async ({ page }) => {
    const body = await submitAndCapture(page, async (p) => {
      await fillRow(p, 0, VALID_URL, '123 Maple St');
    });
    expect(Array.isArray(body.listings)).toBe(true);
    expect(body.listings).toHaveLength(1);
    expect(body.listings[0]).toEqual({ url: VALID_URL, address: '123 Maple St' });
  });

  test('empty address becomes null', async ({ page }) => {
    const body = await submitAndCapture(page, fillRequired);
    expect(body.listings[0].address).toBeNull();
  });

  test('empty rows are excluded, order preserved', async ({ page }) => {
    const body = await submitAndCapture(page, async (p) => {
      await fillRow(p, 0, 'https://northstar.weichert.com/listing/aaa', 'A St');
      // row 1 left blank
      await fillRow(p, 2, 'https://northstar.weichert.com/listing/ccc');
      await fillRow(p, 5, 'https://northstar.weichert.com/listing/fff', 'F Ave');
    });
    expect(body.listings).toEqual([
      { url: 'https://northstar.weichert.com/listing/aaa', address: 'A St' },
      { url: 'https://northstar.weichert.com/listing/ccc', address: null },
      { url: 'https://northstar.weichert.com/listing/fff', address: 'F Ave' },
    ]);
  });

  test('supports all 10 rows filled', async ({ page }) => {
    const body = await submitAndCapture(page, async (p) => {
      for (let i = 0; i < 10; i++) {
        await fillRow(p, i, `https://northstar.weichert.com/listing/${i}`);
      }
    });
    expect(body.listings).toHaveLength(10);
  });

  test('submitted_at is a valid ISO timestamp', async ({ page }) => {
    const body = await submitAndCapture(page, fillRequired);
    expect(new Date(body.submitted_at).toISOString()).toBe(body.submitted_at);
  });

  test('source is weichert_weekly_listings_form', async ({ page }) => {
    const body = await submitAndCapture(page, fillRequired);
    expect(body.source).toBe('weichert_weekly_listings_form');
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

// ─── 4. Success message ───────────────────────────────────────────────────────

test.describe('Success message', () => {
  test('shows the exact queued confirmation on 200', async ({ page }) => {
    await mockWebhook(page, 200);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#status')).toHaveText(
      'Listings queued — the email will send this Monday at 9am CT.'
    );
  });

  test('form resets after successful submit', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRow(page, 0, VALID_URL, '123 Maple St');
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('input[name="url_0"]')).toHaveValue('');
    await expect(page.locator('input[name="address_0"]')).toHaveValue('');
  });
});

// ─── 5. Submit UI states ──────────────────────────────────────────────────────

test.describe('Submit UI states', () => {
  test('button disables and shows Queuing… while in-flight', async ({ page }) => {
    let resolve;
    await page.route('**/webhook/**', async route => {
      await new Promise(r => { resolve = r; });
      route.fulfill({ status: 200, body: 'ok' });
    });

    await page.goto(FORM_URL);
    await fillRequired(page);
    page.click('#submit-btn'); // don't await — check in-flight state

    await expect(page.locator('#submit-btn')).toBeDisabled({ timeout: 2000 });
    await expect(page.locator('#submit-btn')).toHaveText('Queuing…');

    resolve();
    await expect(page.locator('#submit-btn')).toBeEnabled({ timeout: 5000 });
  });

  test('button re-enables after error', async ({ page }) => {
    await mockWebhook(page, 500);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#submit-btn')).toBeEnabled({ timeout: 5000 });
  });
});

// ─── 6. Error banners ─────────────────────────────────────────────────────────

test.describe('Error banners', () => {
  test('shows error banner on 500, form does not reset', async ({ page }) => {
    await mockWebhook(page, 500);
    await page.goto(FORM_URL);
    await fillRow(page, 0, VALID_URL);
    await page.click('#submit-btn');

    await expect(page.locator('#status.error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('input[name="url_0"]')).toHaveValue(VALID_URL);
  });

  test('shows error banner on network failure', async ({ page }) => {
    await page.route('**/webhook/**', route => route.abort());
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.error')).toBeVisible({ timeout: 5000 });
  });
});
