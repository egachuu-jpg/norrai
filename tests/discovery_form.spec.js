const { test, expect } = require('@playwright/test');

const FORM_URL = '/discovery_form.html';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fillRequired(page) {
  await page.fill('#contact_name', 'Jane Smith');
  await page.fill('#contact_email', 'jane@smithdental.com');
  await page.fill('#business_name', 'Smith Dental');
  await page.selectOption('#industry', 'Dental / Medical');
  await page.fill('#what_brings_you', 'Losing patients to no-shows and spending too much time on manual follow-up.');
  await page.fill('#success_looks_like', 'Never miss a follow-up and cut admin time in half.');
}

function mockWebhook(page, status = 200) {
  return page.route('**/webhook/**', route =>
    route.fulfill({ status, body: 'ok', contentType: 'text/plain' })
  );
}

// ─── 1. Required field validation ─────────────────────────────────────────────

test.describe('Required field validation', () => {
  const requiredFields = [
    { id: 'contact_name',     fill: 'Jane Smith' },
    { id: 'contact_email',    fill: 'jane@smithdental.com' },
    { id: 'business_name',    fill: 'Smith Dental' },
    { id: 'what_brings_you',  fill: 'Losing patients to no-shows.' },
    { id: 'success_looks_like', fill: 'Cut admin time in half.' },
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

  test('blocks submit when industry is not selected', async ({ page }) => {
    await mockWebhook(page);
    let fetched = false;
    page.on('request', req => { if (req.url().includes('webhook')) fetched = true; });

    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.selectOption('#industry', '');
    await page.click('#submit-btn');

    expect(fetched).toBe(false);
  });
});

// ─── 2. Field type enforcement ────────────────────────────────────────────────

test.describe('Field type enforcement', () => {
  test('rejects invalid email format', async ({ page }) => {
    await mockWebhook(page);
    let fetched = false;
    page.on('request', req => { if (req.url().includes('webhook')) fetched = true; });

    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#contact_email', 'notanemail');
    await page.click('#submit-btn');

    expect(fetched).toBe(false);
  });
});

// ─── 3. Payload shape ─────────────────────────────────────────────────────────

test.describe('Payload shape', () => {
  test('all required string fields are present', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());

    expect(body.contact_name).toBe('Jane Smith');
    expect(body.contact_email).toBe('jane@smithdental.com');
    expect(body.business_name).toBe('Smith Dental');
    expect(body.industry).toBe('Dental / Medical');
    expect(body.what_brings_you).toBeTruthy();
    expect(body.success_looks_like).toBeTruthy();
  });

  test('pain rating fields are integers when selected', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    // Select rating 4 for manual follow-up, 5 for no-shows
    await page.click('label[for="pain_manual_followup_4"]');
    await page.click('label[for="pain_no_shows_5"]');

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());

    expect(body.pain_manual_followup).toBe(4);
    expect(body.pain_no_shows).toBe(5);
    expect(typeof body.pain_manual_followup).toBe('number');
  });

  test('unselected pain ratings are null', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());

    expect(body.pain_missed_leads).toBeNull();
    expect(body.pain_admin_time).toBeNull();
  });

  test('numeric fields are numbers not strings', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#leads_per_month', '20');
    await page.fill('#clients_per_month', '15');

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());

    expect(typeof body.leads_per_month).toBe('number');
    expect(body.leads_per_month).toBe(20);
    expect(typeof body.clients_per_month).toBe('number');
    expect(body.clients_per_month).toBe(15);
  });

  test('empty optional numeric fields are null', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());

    expect(body.leads_per_month).toBeNull();
    expect(body.clients_per_month).toBeNull();
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

  test('source is discovery_form_web', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());

    expect(body.source).toBe('discovery_form_web');
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

// ─── 4. Rating scale interactions ────────────────────────────────────────────

test.describe('Rating scale interactions', () => {
  test('clicking a rating label selects that value', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.click('label[for="pain_missed_leads_3"]');
    const checked = await page.$eval('#pain_missed_leads_3', el => el.checked);
    expect(checked).toBe(true);
  });

  test('selecting a different rating deselects the previous', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.click('label[for="pain_admin_time_2"]');
    await page.click('label[for="pain_admin_time_5"]');

    const two = await page.$eval('#pain_admin_time_2', el => el.checked);
    const five = await page.$eval('#pain_admin_time_5', el => el.checked);

    expect(two).toBe(false);
    expect(five).toBe(true);
  });

  test('all six pain categories appear in payload', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());

    expect('pain_missed_leads' in body).toBe(true);
    expect('pain_manual_followup' in body).toBe(true);
    expect('pain_no_shows' in body).toBe(true);
    expect('pain_review_requests' in body).toBe(true);
    expect('pain_admin_time' in body).toBe(true);
    expect('pain_inconsistent_comms' in body).toBe(true);
  });
});

// ─── 5. Pill checkboxes ───────────────────────────────────────────────────────

test.describe('Communication channel pills', () => {
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
    const pills = page.locator('.pill');
    await pills.nth(0).click();
    await pills.nth(1).click();
    await expect(pills.nth(0)).toHaveClass(/active/);
    await expect(pills.nth(1)).toHaveClass(/active/);
  });

  test('selected pills appear in payload as comma-separated string', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    await page.locator('.pill[data-val="email"]').click();
    await page.locator('.pill[data-val="sms"]').click();

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.comms_channels).toBe('email, sms');
  });

  test('no pills selected → comms_channels is empty string', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.comms_channels).toBe('');
  });
});

// ─── 6. Conditional: automation experience ───────────────────────────────────

test.describe('Conditional automation experience field', () => {
  test('textarea is hidden by default', async ({ page }) => {
    await page.goto(FORM_URL);
    await expect(page.locator('#automation-experience-wrap')).not.toHaveClass(/show/);
  });

  test('selecting Yes reveals the textarea', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.click('#tried_yes');
    await expect(page.locator('#automation-experience-wrap')).toHaveClass(/show/);
  });

  test('selecting No hides the textarea again', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.click('#tried_yes');
    await page.click('#tried_no');
    await expect(page.locator('#automation-experience-wrap')).not.toHaveClass(/show/);
  });

  test('automation_experience value included in payload when visible', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#tried_yes');
    await page.fill('#automation_experience', 'Tried Zapier, broke after a week.');

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.automation_experience).toBe('Tried Zapier, broke after a week.');
    expect(body.tried_automation_before).toBe('yes');
  });
});

// ─── 7. Submit UI states ──────────────────────────────────────────────────────

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
    await expect(page.locator('#submit-btn')).toHaveText('Submitting\u2026');

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

// ─── 8. Success and error banners ─────────────────────────────────────────────

test.describe('Success and error banners', () => {
  test('shows success banner with contact name on 200', async ({ page }) => {
    await mockWebhook(page, 200);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#status')).toContainText('Jane Smith');
  });

  test('shows error banner on 500, form does not reset', async ({ page }) => {
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

  test('form resets after success', async ({ page }) => {
    await mockWebhook(page, 200);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#contact_name')).toHaveValue('');
    await expect(page.locator('#what_brings_you')).toHaveValue('');
  });
});
