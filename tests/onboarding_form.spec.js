const { test, expect } = require('@playwright/test');
const { mockWebhook } = require('./helpers');

const FORM_URL = '/onboarding_form.html';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fillRequired(page) {
  await page.fill('#contact_name', 'Jane Smith');
  await page.fill('#contact_email', 'jane@smithplumbing.com');
  await page.fill('#contact_phone', '507-555-1234');
  await page.fill('#business_name', 'Smith Plumbing');
  await page.selectOption('#industry', 'Home Services (Plumbing, Electrical, HVAC, etc.)');
  await page.fill('#service_area', 'Faribault');
  await page.selectOption('#primary_crm', 'HubSpot');
  await page.fill('#message_opener', 'Hey {{first_name}}, thanks for reaching out — wanted to personally follow up.');
  await page.click('input[name="approach_style"][value="value_first"]');
  await page.fill('#sms_opener', 'Hey {{first_name}}, this is Jane from Smith Plumbing. What\'s a good time to connect?');
  await page.fill('#writing_samples', 'Hi Sarah, thanks for contacting us. We\'d love to help with your plumbing issue.');
  await page.fill('#biggest_gap', 'Leads going cold before I can follow up.');
  await page.fill('#twelve_month_vision', 'Double monthly clients without adding headcount.');
}

// ─── 1. Required field validation ─────────────────────────────────────────────

test.describe('Required field validation', () => {
  const textFields = [
    { id: 'contact_name',       fill: 'Jane Smith' },
    { id: 'contact_email',      fill: 'jane@smithplumbing.com' },
    { id: 'contact_phone',      fill: '507-555-1234' },
    { id: 'business_name',      fill: 'Smith Plumbing' },
    { id: 'service_area',       fill: 'Faribault' },
    { id: 'message_opener',     fill: 'Hey, thanks for reaching out.' },
    { id: 'sms_opener',         fill: 'Hey {{first_name}}, this is Jane.' },
    { id: 'writing_samples',    fill: 'Sample message text here.' },
    { id: 'biggest_gap',        fill: 'Leads going cold.' },
    { id: 'twelve_month_vision', fill: 'Double monthly clients.' },
  ];

  for (const field of textFields) {
    test(`blocks submit when ${field.id} is empty`, async ({ page }) => {
      await mockWebhook(page);
      await page.goto(FORM_URL);
      await fillRequired(page);
      await page.fill(`#${field.id}`, '');
      await page.click('#submit-btn');

      await expect(page.locator('#status.success')).not.toBeVisible();
    });
  }

  test('blocks submit when industry is not selected', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.evaluate(() => { document.getElementById('industry').value = ''; });
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).not.toBeVisible();
  });

  test('blocks submit when primary_crm is not selected', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.evaluate(() => { document.getElementById('primary_crm').value = ''; });
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).not.toBeVisible();
  });

  test('blocks submit when approach_style radio is not selected', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.evaluate(() => {
      document.querySelectorAll('input[name="approach_style"]').forEach(r => { r.checked = false; });
    });
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).not.toBeVisible();
  });
});

// ─── 2. Field type enforcement ────────────────────────────────────────────────

test.describe('Field type enforcement', () => {
  test('rejects invalid email format', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#contact_email', 'notanemail');
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).not.toBeVisible();
  });

  test('voice_tags max 4 — 5th pill click is ignored', async ({ page }) => {
    await page.goto(FORM_URL);
    const pills = page.locator('[data-group="voice_tags"]');
    const count = await pills.count();

    for (let i = 0; i < Math.min(5, count); i++) {
      await pills.nth(i).click();
    }

    const active = page.locator('[data-group="voice_tags"].active');
    await expect(active).toHaveCount(4);
  });

  test('voice_tags allows deselecting and reselecting within limit', async ({ page }) => {
    await page.goto(FORM_URL);
    const pills = page.locator('[data-group="voice_tags"]');

    for (let i = 0; i < 4; i++) await pills.nth(i).click();
    await expect(page.locator('[data-group="voice_tags"].active')).toHaveCount(4);

    await pills.nth(0).click(); // deselect
    await pills.nth(4).click(); // select new one
    await expect(page.locator('[data-group="voice_tags"].active')).toHaveCount(4);
  });
});

// ─── 3. Payload shape ─────────────────────────────────────────────────────────

test.describe('Payload shape', () => {
  test('lead_sources is an array of selected pill values', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    await page.locator('[data-group="lead_sources"][data-val="website"]').click();
    await page.locator('[data-group="lead_sources"][data-val="referrals"]').click();

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(Array.isArray(body.lead_sources)).toBe(true);
    expect(body.lead_sources).toContain('website');
    expect(body.lead_sources).toContain('referrals');
    expect(body.lead_sources.length).toBe(2);
  });

  test('lead_sources is empty array when nothing selected', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(Array.isArray(body.lead_sources)).toBe(true);
    expect(body.lead_sources.length).toBe(0);
  });

  test('voice_tags is an array of selected pill values', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    await page.locator('[data-group="voice_tags"][data-val="warm"]').click();
    await page.locator('[data-group="voice_tags"][data-val="punchy"]').click();

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(Array.isArray(body.voice_tags)).toBe(true);
    expect(body.voice_tags).toContain('warm');
    expect(body.voice_tags).toContain('punchy');
  });

  test('voice_tags is empty array when nothing selected', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(Array.isArray(body.voice_tags)).toBe(true);
    expect(body.voice_tags.length).toBe(0);
  });

  test('numeric fields are numbers when filled', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#current_monthly_clients', '8');
    await page.fill('#target_monthly_clients', '16');

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(typeof body.current_monthly_clients).toBe('number');
    expect(body.current_monthly_clients).toBe(8);
    expect(typeof body.target_monthly_clients).toBe('number');
    expect(body.target_monthly_clients).toBe(16);
  });

  test('empty numeric fields are null', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.current_monthly_clients).toBeNull();
    expect(body.target_monthly_clients).toBeNull();
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

  test('source is onboarding_form_web', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.source).toBe('onboarding_form_web');
  });

  test('industry value is included in payload', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.industry).toBe('Home Services (Plumbing, Electrical, HVAC, etc.)');
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
  test('button disables and shows Submitting… while in-flight', async ({ page }) => {
    let resolve;
    await page.route('**/webhook/**', async route => {
      await new Promise(r => { resolve = r; });
      route.fulfill({ status: 200, body: 'ok' });
    });

    await page.goto(FORM_URL);
    await fillRequired(page);
    page.click('#submit-btn'); // don't await — check state while in-flight

    await expect(page.locator('#submit-btn')).toBeDisabled({ timeout: 2000 });
    await expect(page.locator('#submit-btn')).toHaveText('Submitting…');

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

// ─── 5. Success and error banners ─────────────────────────────────────────────

test.describe('Success and error banners', () => {
  test('shows success banner with contact name on 200', async ({ page }) => {
    await mockWebhook(page, 200);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#status')).toContainText('Jane Smith');
  });

  test('resets form on success', async ({ page }) => {
    await mockWebhook(page, 200);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#contact_name')).toHaveValue('');
    await expect(page.locator('#business_name')).toHaveValue('');
  });

  test('clears active pills on success', async ({ page }) => {
    await mockWebhook(page, 200);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.locator('[data-group="lead_sources"][data-val="website"]').click();
    await page.locator('[data-group="voice_tags"][data-val="warm"]').click();

    await page.click('#submit-btn');
    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });

    await expect(page.locator('[data-group="lead_sources"].active')).toHaveCount(0);
    await expect(page.locator('[data-group="voice_tags"].active')).toHaveCount(0);
  });

  test('shows error banner on 500, form is not reset', async ({ page }) => {
    await mockWebhook(page, 500);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#contact_name')).toHaveValue('Jane Smith');
  });

  test('shows error banner on network failure', async ({ page }) => {
    await page.route('**/webhook/**', route => route.abort());
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.error')).toBeVisible({ timeout: 5000 });
  });
});

// ─── 6. Check pill interactions ───────────────────────────────────────────────

test.describe('Check pill interactions', () => {
  test('clicking a pill toggles active class', async ({ page }) => {
    await page.goto(FORM_URL);
    const pill = page.locator('[data-group="lead_sources"]').first();
    await expect(pill).not.toHaveClass(/active/);
    await pill.click();
    await expect(pill).toHaveClass(/active/);
    await pill.click();
    await expect(pill).not.toHaveClass(/active/);
  });

  test('multiple lead_sources pills can be active simultaneously', async ({ page }) => {
    await page.goto(FORM_URL);
    const pills = page.locator('[data-group="lead_sources"]');
    await pills.nth(0).click();
    await pills.nth(1).click();
    await expect(pills.nth(0)).toHaveClass(/active/);
    await expect(pills.nth(1)).toHaveClass(/active/);
  });
});
