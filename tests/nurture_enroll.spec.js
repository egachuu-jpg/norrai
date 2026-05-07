const { test, expect } = require('@playwright/test');
const { mockWebhook } = require('./helpers');

const FORM_URL = '/clients/nurture_enroll.html';
const AGENT_KEY = 'norrai_agent_profile_nurture';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fillRequired(page) {
  await page.fill('#agent_name', 'Jane Smith');
  await page.fill('#agent_email', 'jane@brokerage.com');
  await page.fill('#agent_phone', '5071234567');
  await page.fill('#lead_name', 'Sarah Johnson');
  await page.fill('#phone', '5075551234');
  await page.fill('#email', 'sarah@gmail.com');
  await page.fill('#lead_message', 'I was looking at 123 Maple but went quiet after the first response.');
  await page.fill('#property_address', '123 Maple St, Faribault, MN 55021');
}

// ─── 1. Required field validation ─────────────────────────────────────────────

test.describe('Required field validation', () => {
  const requiredFields = [
    { id: 'agent_name',       fill: 'Jane Smith' },
    { id: 'agent_email',      fill: 'jane@brokerage.com' },
    { id: 'agent_phone',      fill: '5071234567' },
    { id: 'lead_name',        fill: 'Sarah Johnson' },
    { id: 'phone',            fill: '5075551234' },
    { id: 'email',            fill: 'sarah@gmail.com' },
    { id: 'lead_message',     fill: 'Looking at 123 Maple.' },
    { id: 'property_address', fill: '123 Maple St, Faribault, MN 55021' },
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

  test('rejects invalid lead email format', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#email', 'notanemail');
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).not.toBeVisible();
  });
});

// ─── 3. Payload shape ─────────────────────────────────────────────────────────

test.describe('Payload shape', () => {
  test('all required fields present in payload', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());

    expect(body.agent_name).toBe('Jane Smith');
    expect(body.agent_email).toBe('jane@brokerage.com');
    expect(body.lead_name).toBe('Sarah Johnson');
    expect(body.phone).toBe('5075551234');
    expect(body.email).toBe('sarah@gmail.com');
    expect(body.property_address).toBe('123 Maple St, Faribault, MN 55021');
    expect(body.source_form).toBe('nurture_enroll_web');
  });

  test('numeric beds/baths are numbers when filled', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#beds', '3');
    await page.fill('#baths', '2');

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(typeof body.beds).toBe('number');
    expect(body.beds).toBe(3);
    expect(typeof body.baths).toBe('number');
    expect(body.baths).toBe(2);
  });

  test('empty beds/baths are null', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.beds).toBeNull();
    expect(body.baths).toBeNull();
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

// ─── 4. Agent persistence ─────────────────────────────────────────────────────

test.describe('Agent persistence', () => {
  test('agent profile saves to localStorage on success', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });

    const saved = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), AGENT_KEY);
    expect(saved.agent_name).toBe('Jane Smith');
    expect(saved.agent_email).toBe('jane@brokerage.com');
    expect(saved.agent_phone).toBe('5071234567');
  });

  test('agent fields restore from localStorage on load', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.evaluate((k) => {
      localStorage.setItem(k, JSON.stringify({
        agent_name: 'Jane Smith',
        agent_email: 'jane@brokerage.com',
        agent_phone: '5071234567',
      }));
    }, AGENT_KEY);

    await page.reload();

    await expect(page.locator('#agent_name')).toHaveValue('Jane Smith');
    await expect(page.locator('#agent_email')).toHaveValue('jane@brokerage.com');
    await expect(page.locator('#agent_phone')).toHaveValue('5071234567');
    await expect(page.locator('#agent-saved-badge')).toBeVisible();
  });

  test('clear button wipes agent profile', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.evaluate((k) => {
      localStorage.setItem(k, JSON.stringify({
        agent_name: 'Jane Smith',
        agent_email: 'jane@brokerage.com',
        agent_phone: '5071234567',
      }));
    }, AGENT_KEY);

    await page.reload();
    await page.click('#clear-agent');

    await expect(page.locator('#agent_name')).toHaveValue('');
    await expect(page.locator('#agent_email')).toHaveValue('');
    await expect(page.locator('#agent_phone')).toHaveValue('');
    await expect(page.locator('#agent-saved-badge')).not.toBeVisible();

    const stored = await page.evaluate(k => localStorage.getItem(k), AGENT_KEY);
    expect(stored).toBeNull();
  });

  test('lead and property fields clear on success, agent fields persist', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);

    await expect(page.locator('#lead_name')).toHaveValue('');
    await expect(page.locator('#phone')).toHaveValue('');
    await expect(page.locator('#property_address')).toHaveValue('');
    await expect(page.locator('#agent_name')).toHaveValue('Jane Smith');
    await expect(page.locator('#agent_email')).toHaveValue('jane@brokerage.com');
  });
});

// ─── 5. Submit UI states ──────────────────────────────────────────────────────

test.describe('Submit UI states', () => {
  test('button disables and shows Enrolling… while in-flight', async ({ page }) => {
    let resolve;
    await page.route('**/webhook/**', async route => {
      await new Promise(r => { resolve = r; });
      route.fulfill({ status: 200, body: 'ok' });
    });

    await page.goto(FORM_URL);
    await fillRequired(page);
    page.click('#submit-btn');

    await expect(page.locator('#submit-btn')).toBeDisabled({ timeout: 2000 });
    await expect(page.locator('#submit-btn')).toHaveText('Enrolling…');

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

// ─── 6. Success and error banners ─────────────────────────────────────────────

test.describe('Success and error banners', () => {
  test('shows success banner with lead name and agent email on 200', async ({ page }) => {
    await mockWebhook(page, 200);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#status')).toContainText('Sarah Johnson');
    await expect(page.locator('#status')).toContainText('jane@brokerage.com');
  });

  test('shows error banner on 500, form does not reset', async ({ page }) => {
    await mockWebhook(page, 500);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#agent_name')).toHaveValue('Jane Smith');
  });

  test('shows error banner on network failure', async ({ page }) => {
    await page.route('**/webhook/**', route => route.abort());
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.error')).toBeVisible({ timeout: 5000 });
  });
});
