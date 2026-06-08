const { test, expect } = require('@playwright/test');

const BASE_URL = '/clients/lead_action_edit.html';

// Inject URL params via URLSearchParams override (same pattern as open_house.spec.js)
// because serve redirects .html URLs and strips query params.
async function gotoSms(page, overrides = {}) {
  const fakeSearch = new URLSearchParams({
    token: 'test-token-abc',
    action: 'send_sms',
    draft: 'Hi Sarah, just checking in!',
    lead_name: 'Sarah Johnson',
    phone: '5075551234',
    ...overrides,
  }).toString();
  await page.addInitScript((qs) => {
    const Orig = window.URLSearchParams;
    window.URLSearchParams = class extends Orig {
      constructor(init) { super(!init ? qs : init); }
    };
  }, fakeSearch);
  await page.goto(BASE_URL);
}

async function gotoEmail(page, overrides = {}) {
  const fakeSearch = new URLSearchParams({
    token: 'test-token-abc',
    action: 'send_email',
    draft: 'Hi Sarah, following up.',
    lead_name: 'Sarah Johnson',
    ...overrides,
  }).toString();
  await page.addInitScript((qs) => {
    const Orig = window.URLSearchParams;
    window.URLSearchParams = class extends Orig {
      constructor(init) { super(!init ? qs : init); }
    };
  }, fakeSearch);
  await page.goto(BASE_URL);
}

function mockWebhook(page, urlPattern, status = 200, body = JSON.stringify({ ok: true })) {
  return page.route(urlPattern, route =>
    route.fulfill({ status, body, contentType: 'application/json' })
  );
}

// ─── 1. Page load ─────────────────────────────────────────────────────────────

test.describe('Page load', () => {
  test('loads with correct SMS title', async ({ page }) => {
    await gotoSms(page);
    await expect(page.locator('h2')).toHaveText('Edit SMS');
  });

  test('loads with correct email title', async ({ page }) => {
    await gotoEmail(page);
    await expect(page.locator('h2')).toHaveText('Edit Email');
  });

  test('pre-fills textarea with draft param', async ({ page }) => {
    await gotoSms(page);
    await expect(page.locator('#message-text')).toHaveValue('Hi Sarah, just checking in!');
  });
});

// ─── 2. Send action ───────────────────────────────────────────────────────────

test.describe('Send action', () => {
  test('submits to lead-action webhook and shows success', async ({ page }) => {
    await mockWebhook(page, '**/webhook/**');
    await gotoSms(page);
    await page.click('#send-btn');
    await expect(page.locator('#status-msg.success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#edit-form')).not.toBeVisible();
  });

  test('shows error state on webhook failure', async ({ page }) => {
    await mockWebhook(page, '**/webhook/**', 500);
    await gotoSms(page);
    await page.click('#send-btn');
    await expect(page.locator('#status-msg.error')).toBeVisible({ timeout: 5000 });
  });
});

// ─── 3. Opt-out button visibility ────────────────────────────────────────────

test.describe('Opt-out button visibility', () => {
  test('shows opt-out button for SMS when phone param present', async ({ page }) => {
    await gotoSms(page);
    await expect(page.locator('#optout-btn')).toBeVisible();
  });

  test('hides opt-out button when action is send_email', async ({ page }) => {
    await gotoEmail(page);
    await expect(page.locator('#optout-btn')).not.toBeVisible();
  });

  test('hides opt-out button when phone param is missing', async ({ page }) => {
    await gotoSms(page, { phone: '' });
    await expect(page.locator('#optout-btn')).not.toBeVisible();
  });
});

// ─── 4. Opt-out flow ──────────────────────────────────────────────────────────

test.describe('Opt-out flow', () => {
  test('clicking opt-out button shows confirm dialog with lead name', async ({ page }) => {
    let dialogMessage = '';
    page.once('dialog', async dialog => {
      dialogMessage = dialog.message();
      await dialog.accept();
    });

    await mockWebhook(page, '**/webhook/manual-optout**');
    await gotoSms(page);
    await page.click('#optout-btn');

    expect(dialogMessage).toContain('Sarah Johnson');
  });

  test('accepting confirm sends POST to manual-optout webhook', async ({ page }) => {
    let capturedBody = null;
    await page.route('**/webhook/manual-optout**', async route => {
      capturedBody = JSON.parse(route.request().postData());
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true }), contentType: 'application/json' });
    });

    page.once('dialog', dialog => dialog.accept());
    await gotoSms(page);
    await page.click('#optout-btn');

    await expect(page.locator('#status-msg.success')).toBeVisible({ timeout: 5000 });
    expect(capturedBody).toEqual({ phone: '5075551234', agent_token: 'test-token-abc' });
  });

  test('dismissing confirm dialog does not call webhook', async ({ page }) => {
    let webhookCalled = false;
    await page.route('**/webhook/manual-optout**', route => {
      webhookCalled = true;
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true }), contentType: 'application/json' });
    });

    page.once('dialog', dialog => dialog.dismiss());
    await gotoSms(page);
    await page.click('#optout-btn');

    await page.waitForTimeout(300);
    expect(webhookCalled).toBe(false);
  });

  test('opt-out error state shown on webhook failure', async ({ page }) => {
    await page.route('**/webhook/manual-optout**', route =>
      route.fulfill({ status: 401, body: JSON.stringify({ error: 'Unauthorized' }), contentType: 'application/json' })
    );

    page.once('dialog', dialog => dialog.accept());
    await gotoSms(page);
    await page.click('#optout-btn');

    await expect(page.locator('#status-msg.error')).toBeVisible({ timeout: 5000 });
  });

  test('after successful opt-out, form and button section are hidden', async ({ page }) => {
    await page.route('**/webhook/manual-optout**', route =>
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true }), contentType: 'application/json' })
    );

    page.once('dialog', dialog => dialog.accept());
    await gotoSms(page);
    await page.click('#optout-btn');

    await expect(page.locator('#status-msg.success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#edit-form')).not.toBeVisible();
    await expect(page.locator('#optout-section')).not.toBeVisible();
  });
});
