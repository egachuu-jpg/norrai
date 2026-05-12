// tests/review_request.spec.js
const { test, expect } = require('@playwright/test');

const FORM_URL  = '/clients/review_request.html';
const AGENT_KEY = 'norrai_agent_profile_review';

async function fillRequired(page) {
  await page.fill('#agent_name',        'Jane Smith');
  await page.fill('#google_url',        'https://g.page/r/jane-review');
  await page.fill('#client_name',       'Sarah Johnson');
  await page.fill('#client_phone',      '5075551234');
  await page.selectOption('#transaction_type', 'buyer');
  await page.fill('#property_address',  '123 Maple St, Faribault, MN 55021');
}

function mockWebhook(page, status = 200) {
  return page.route('**/webhook/**', route =>
    route.fulfill({ status, body: 'ok', contentType: 'text/plain' })
  );
}

// ─── 1. Required field validation ─────────────────────────────────────────────

test.describe('Required field validation', () => {
  const requiredFields = [
    { id: 'agent_name',       fill: 'Jane Smith' },
    { id: 'google_url',       fill: 'https://g.page/r/jane-review' },
    { id: 'client_name',      fill: 'Sarah Johnson' },
    { id: 'client_phone',     fill: '5075551234' },
    { id: 'property_address', fill: '123 Maple St' },
  ];

  for (const field of requiredFields) {
    test(`blocks submit when ${field.id} is empty`, async ({ page }) => {
      await mockWebhook(page);
      let fetched = false;
      page.on('request', req => { if (req.url().includes('webhook')) fetched = true; });

      await page.goto(FORM_URL);
      await fillRequired(page);
      await page.fill(`#${field.id}`, '');
      await page.click('#submit-btn');

      expect(fetched).toBe(false);
      await expect(page.locator('#status.success')).not.toBeVisible();
    });
  }
});

// ─── 2. Optional fields don't block submission ─────────────────────────────────

test.describe('Optional fields', () => {
  test('submits without zillow_url', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    // zillow_url left empty (optional)
    await page.click('#submit-btn');
    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });
  });

  test('submits without client_email', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    // client_email left empty (optional)
    await page.click('#submit-btn');
    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });
  });
});

// ─── 3. Payload shape ─────────────────────────────────────────────────────────

test.describe('Payload shape', () => {
  test('sends all expected keys', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#zillow_url',    'https://zillow.com/profile/jane');
    await page.fill('#client_email',  'sarah@gmail.com');

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());

    expect(body).toMatchObject({
      agent_name:       'Jane Smith',
      google_url:       'https://g.page/r/jane-review',
      zillow_url:       'https://zillow.com/profile/jane',
      client_name:      'Sarah Johnson',
      client_phone:     '5075551234',
      client_email:     'sarah@gmail.com',
      transaction_type: 'buyer',
      property_address: '123 Maple St, Faribault, MN 55021',
      source_form:      'review_request_web',
    });
    expect(typeof body.delay_days).toBe('number');
    expect(typeof body.submitted_at).toBe('string');
  });

  test('delay_days is 1 when 1 day selected', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.selectOption('#delay_days', '1');

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.delay_days).toBe(1);
  });

  test('delay_days is 3 by default', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.delay_days).toBe(3);
  });

  test('delay_days is 7 when 7 days selected', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.selectOption('#delay_days', '7');

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.delay_days).toBe(7);
  });

  test('transaction_type is seller when seller selected', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.selectOption('#transaction_type', 'seller');

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.transaction_type).toBe('seller');
  });
});

// ─── 4. Security header ────────────────────────────────────────────────────────

test.describe('Security', () => {
  test('sends X-Norr-Token header', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    expect(req.headers()['x-norr-token']).toBe('8F68D963-7060-4033-BD04-7593E4B203CB');
  });
});

// ─── 5. localStorage ─────────────────────────────────────────────────────────

test.describe('Agent profile localStorage', () => {
  test('saves agent profile after successful submit', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#google_url',  'https://g.page/r/jane-review');
    await page.fill('#zillow_url',  'https://zillow.com/profile/jane');
    await page.click('#submit-btn');
    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });

    const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), AGENT_KEY);
    expect(stored.agent_name).toBe('Jane Smith');
    expect(stored.google_url).toBe('https://g.page/r/jane-review');
    expect(stored.zillow_url).toBe('https://zillow.com/profile/jane');
  });

  test('loads agent profile on page load', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.evaluate((key) => {
      localStorage.setItem(key, JSON.stringify({
        agent_name: 'Jane Smith',
        google_url: 'https://g.page/r/jane-review',
        zillow_url: 'https://zillow.com/profile/jane',
      }));
    }, AGENT_KEY);
    await page.reload();

    await expect(page.locator('#agent_name')).toHaveValue('Jane Smith');
    await expect(page.locator('#google_url')).toHaveValue('https://g.page/r/jane-review');
    await expect(page.locator('#zillow_url')).toHaveValue('https://zillow.com/profile/jane');
    await expect(page.locator('#agent-saved-badge')).toBeVisible();
  });

  test('clear button removes saved profile', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.evaluate((key) => {
      localStorage.setItem(key, JSON.stringify({
        agent_name: 'Jane Smith',
        google_url: 'https://g.page/r/jane-review',
        zillow_url: '',
      }));
    }, AGENT_KEY);
    await page.reload();
    await page.click('#clear-agent');

    await expect(page.locator('#agent_name')).toHaveValue('');
    await expect(page.locator('#google_url')).toHaveValue('');
    await expect(page.locator('#agent-saved-badge')).not.toBeVisible();
    const stored = await page.evaluate(key => localStorage.getItem(key), AGENT_KEY);
    expect(stored).toBeNull();
  });
});

// ─── 6. UI states ─────────────────────────────────────────────────────────────

test.describe('UI states', () => {
  test('button shows loading state during submit', async ({ page }) => {
    await page.route('**/webhook/**', async route => {
      await new Promise(r => setTimeout(r, 300));
      await route.fulfill({ status: 200, body: 'ok', contentType: 'text/plain' });
    });

    await page.goto(FORM_URL);
    await fillRequired(page);
    page.click('#submit-btn'); // intentionally not await

    await expect(page.locator('#submit-btn')).toBeDisabled();
    await expect(page.locator('#submit-btn')).toContainText('Sending');
  });

  test('shows success banner on 200', async ({ page }) => {
    await mockWebhook(page, 200);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');
    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#status')).toContainText('Sarah Johnson');
  });

  test('shows error banner on 500', async ({ page }) => {
    await mockWebhook(page, 500);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');
    await expect(page.locator('#status.error')).toBeVisible({ timeout: 5000 });
  });

  test('clears client fields after success, keeps agent fields', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');
    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });

    await expect(page.locator('#agent_name')).toHaveValue('Jane Smith');
    await expect(page.locator('#client_name')).toHaveValue('');
    await expect(page.locator('#client_phone')).toHaveValue('');
    await expect(page.locator('#property_address')).toHaveValue('');
  });
});

// ─── Agent token ──────────────────────────────────────────────────────────────

test.describe('Agent token', () => {
  const FORM_URL_CLEAN = '/clients/review_request?agent_token=test-token-abc123';

  test('reads agent_token from URL and persists to localStorage', async ({ page }) => {
    await page.goto(FORM_URL_CLEAN);
    const stored = await page.evaluate(() => localStorage.getItem('norrai_agent_token'));
    expect(stored).toBe('test-token-abc123');
  });

  test('includes agent_token in payload', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL_CLEAN);
    await fillRequired(page);
    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.agent_token).toBe('test-token-abc123');
  });
});
