const { test, expect } = require('@playwright/test');

const PAGE_URL = '/unsubscribe';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pageWithEmail(email) {
  return `${PAGE_URL}?email=${encodeURIComponent(email)}`;
}

// Injects a fetch mock before the page script runs.
// status: HTTP status to return; body: response JSON; abort: if true, rejects the promise
async function mockFetch(page, { status = 200, abort = false } = {}) {
  const responseBody = JSON.stringify({ status: status === 200 ? 'ok' : 'error' });
  await page.addInitScript(({ status, responseBody, abort }) => {
    window.__fetchCalls = [];
    window.fetch = function (url, options) {
      window.__fetchCalls.push({ url, body: options && options.body ? JSON.parse(options.body) : null });
      if (abort) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status: status,
        json: () => Promise.resolve(JSON.parse(responseBody)),
        text: () => Promise.resolve(responseBody),
      });
    };
  }, { status, responseBody, abort });
}

// ─── 1. Page load ─────────────────────────────────────────────────────────────

test.describe('Page load', () => {
  test('loads without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await mockFetch(page);
    await page.goto(pageWithEmail('test@example.com'));
    await expect(page.locator('#state-success.active')).toBeVisible({ timeout: 5000 });
    expect(errors).toHaveLength(0);
  });

  test('shows success state after valid email param', async ({ page }) => {
    await mockFetch(page);
    await page.goto(pageWithEmail('test@example.com'));
    await expect(page.locator('#state-success.active')).toBeVisible({ timeout: 5000 });
  });

  test('shows error state when no email param is present', async ({ page }) => {
    await page.goto(PAGE_URL);
    await expect(page.locator('#state-error.active')).toBeVisible();
    await expect(page.locator('#state-success.active')).not.toBeVisible();
  });
});

// ─── 2. Webhook call ──────────────────────────────────────────────────────────

test.describe('Webhook call', () => {
  test('calls webhook with correct email on load', async ({ page }) => {
    const email = 'lead@example.com';
    await mockFetch(page);
    await page.goto(pageWithEmail(email));
    await expect(page.locator('#state-success.active')).toBeVisible({ timeout: 5000 });

    const calls = await page.evaluate(() => window.__fetchCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.email).toBe(email);
  });

  test('calls webhook exactly once per page load', async ({ page }) => {
    await mockFetch(page);
    await page.goto(pageWithEmail('once@example.com'));
    await expect(page.locator('#state-success.active')).toBeVisible({ timeout: 5000 });

    const calls = await page.evaluate(() => window.__fetchCalls);
    expect(calls).toHaveLength(1);
  });

  test('sends email in POST body as JSON', async ({ page }) => {
    const email = 'json-test@example.com';
    await mockFetch(page);
    await page.goto(pageWithEmail(email));
    await expect(page.locator('#state-success.active')).toBeVisible({ timeout: 5000 });

    const calls = await page.evaluate(() => window.__fetchCalls);
    expect(calls[0].body).toMatchObject({ email });
  });
});

// ─── 3. Success state ─────────────────────────────────────────────────────────

test.describe('Success state', () => {
  test('shows success message after 200 response', async ({ page }) => {
    await mockFetch(page);
    await page.goto(pageWithEmail('success@example.com'));
    await expect(page.locator('#state-success.active')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#state-error.active')).not.toBeVisible();
    await expect(page.locator('#state-loading.active')).not.toBeVisible();
  });

  test('displays the email address in success state', async ({ page }) => {
    const email = 'display@example.com';
    await mockFetch(page);
    await page.goto(pageWithEmail(email));
    await expect(page.locator('#state-success.active')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#email-display')).toHaveText(email);
  });
});

// ─── 4. Error state ───────────────────────────────────────────────────────────

test.describe('Error state', () => {
  test('shows error state when webhook returns non-200', async ({ page }) => {
    await mockFetch(page, { status: 500 });
    await page.goto(pageWithEmail('fail@example.com'));
    await expect(page.locator('#state-error.active')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#state-success.active')).not.toBeVisible();
  });

  test('shows error state when webhook returns 400', async ({ page }) => {
    await mockFetch(page, { status: 400 });
    await page.goto(pageWithEmail('bad@example.com'));
    await expect(page.locator('#state-error.active')).toBeVisible({ timeout: 5000 });
  });

  test('shows error state when fetch fails (network error)', async ({ page }) => {
    await mockFetch(page, { abort: true });
    await page.goto(pageWithEmail('network-fail@example.com'));
    await expect(page.locator('#state-error.active')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#state-success.active')).not.toBeVisible();
  });
});
