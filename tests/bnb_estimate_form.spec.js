const { test, expect } = require('@playwright/test');

const FORM_URL = '/bnb_estimate_form.html';

async function fillRequired(page) {
  await page.fill('#name', 'John Smith');
  await page.fill('#email', 'john@oemcorp.com');
  await page.fill('#company', 'OEM Corp');
  await page.fill('#part_name', 'Hydraulic Tank Bracket');
  await page.selectOption('#material_type', 'mild_steel');
  await page.fill('#thickness', '0.25');
  await page.fill('#length', '12');
  await page.fill('#width', '8');
  await page.fill('#height', '4');
  await page.fill('#quantity', '5');
  // Check at least one service
  await page.check('#svc_laser_cutting');
}

function mockWebhook(page, status = 200) {
  return page.route('**/webhook/**', route =>
    route.fulfill({ status, body: 'ok', contentType: 'text/plain' })
  );
}

// ─── 1. Page load ─────────────────────────────────────────────────────────────

test('page loads with correct title', async ({ page }) => {
  await page.goto(FORM_URL);
  await expect(page).toHaveTitle(/B&B Manufacturing/);
});

test('no JS errors on load', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FORM_URL);
  expect(errors).toHaveLength(0);
});

// ─── 2. Required field validation ─────────────────────────────────────────────

test.describe('Required field validation', () => {
  const requiredFields = [
    { id: 'name',          fill: 'John Smith' },
    { id: 'email',         fill: 'john@oemcorp.com' },
    { id: 'part_name',     fill: 'Bracket' },
    { id: 'thickness',     fill: '0.25' },
    { id: 'length',        fill: '12' },
    { id: 'width',         fill: '8' },
    { id: 'height',        fill: '4' },
    { id: 'quantity',      fill: '5' },
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

  test('blocks submit when no service is selected', async ({ page }) => {
    await mockWebhook(page);
    let fetched = false;
    page.on('request', req => { if (req.url().includes('webhook')) fetched = true; });

    await page.goto(FORM_URL);
    await fillRequired(page);
    // Uncheck the service that fillRequired checked
    await page.uncheck('#svc_laser_cutting');
    await page.click('#submit-btn');

    expect(fetched).toBe(false);
  });
});

// ─── 3. Email validation ───────────────────────────────────────────────────────

test('rejects invalid email format', async ({ page }) => {
  await mockWebhook(page);
  let fetched = false;
  page.on('request', req => { if (req.url().includes('webhook')) fetched = true; });

  await page.goto(FORM_URL);
  await fillRequired(page);
  await page.fill('#email', 'notanemail');
  await page.click('#submit-btn');

  expect(fetched).toBe(false);
});

// ─── 4. Conditional service detail fields ─────────────────────────────────────

test.describe('Conditional service detail fields', () => {
  test('laser cutting details hidden by default', async ({ page }) => {
    await page.goto(FORM_URL);
    await expect(page.locator('#details_laser_cutting')).toBeHidden();
  });

  test('laser cutting details appear when checked', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.check('#svc_laser_cutting');
    await expect(page.locator('#details_laser_cutting')).toBeVisible();
  });

  test('laser cutting details hide when unchecked', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.check('#svc_laser_cutting');
    await page.uncheck('#svc_laser_cutting');
    await expect(page.locator('#details_laser_cutting')).toBeHidden();
  });

  test('welding details appear when welding checked', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.check('#svc_welding');
    await expect(page.locator('#details_welding')).toBeVisible();
  });

  test('powder coating details appear when powder coating checked', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.check('#svc_powder_coating');
    await expect(page.locator('#details_powder_coating')).toBeVisible();
  });
});

// ─── 5. Payload shape ─────────────────────────────────────────────────────────

test('payload contains all required top-level fields', async ({ page }) => {
  let payload;
  await page.route('**/webhook/**', async route => {
    payload = JSON.parse(route.request().postData());
    await route.fulfill({ status: 200, body: 'ok', contentType: 'text/plain' });
  });

  await page.goto(FORM_URL);
  await fillRequired(page);
  await Promise.all([
    page.waitForRequest(req => req.url().includes('webhook')),
    page.click('#submit-btn'),
  ]);

  expect(payload).toHaveProperty('name', 'John Smith');
  expect(payload).toHaveProperty('email', 'john@oemcorp.com');
  expect(payload).toHaveProperty('company', 'OEM Corp');
  expect(payload).toHaveProperty('part_name', 'Hydraulic Tank Bracket');
  expect(payload).toHaveProperty('material_type', 'mild_steel');
  expect(payload).toHaveProperty('thickness', 0.25);
  expect(payload).toHaveProperty('length', 12);
  expect(payload).toHaveProperty('width', 8);
  expect(payload).toHaveProperty('height', 4);
  expect(payload).toHaveProperty('quantity', 5);
  expect(payload).toHaveProperty('services');
  expect(Array.isArray(payload.services)).toBe(true);
});

test('payload services array contains selected service with name field', async ({ page }) => {
  let payload;
  await page.route('**/webhook/**', async route => {
    payload = JSON.parse(route.request().postData());
    await route.fulfill({ status: 200, body: 'ok', contentType: 'text/plain' });
  });

  await page.goto(FORM_URL);
  await fillRequired(page);
  await Promise.all([
    page.waitForRequest(req => req.url().includes('webhook')),
    page.click('#submit-btn'),
  ]);

  const laserService = payload.services.find(s => s.name === 'laser_cutting');
  expect(laserService).toBeDefined();
});

test('payload includes service detail fields when filled', async ({ page }) => {
  let payload;
  await page.route('**/webhook/**', async route => {
    payload = JSON.parse(route.request().postData());
    await route.fulfill({ status: 200, body: 'ok', contentType: 'text/plain' });
  });

  await page.goto(FORM_URL);
  await fillRequired(page);
  await page.fill('#laser_max_cut_length', '12');
  await page.fill('#laser_holes', '4');

  await Promise.all([
    page.waitForRequest(req => req.url().includes('webhook')),
    page.click('#submit-btn'),
  ]);

  const laserService = payload.services.find(s => s.name === 'laser_cutting');
  expect(laserService.max_cut_length).toBe(12);
  expect(laserService.holes).toBe(4);
});

test('payload sends X-Norr-Token header', async ({ page }) => {
  let headers;
  await page.route('**/webhook/**', async route => {
    headers = route.request().headers();
    await route.fulfill({ status: 200, body: 'ok', contentType: 'text/plain' });
  });

  await page.goto(FORM_URL);
  await fillRequired(page);
  await Promise.all([
    page.waitForRequest(req => req.url().includes('webhook')),
    page.click('#submit-btn'),
  ]);

  expect(headers['x-norr-token']).toBeDefined();
  expect(headers['x-norr-token'].length).toBeGreaterThan(0);
});

// ─── 6. UI states ─────────────────────────────────────────────────────────────

test('shows success banner after successful submit', async ({ page }) => {
  await mockWebhook(page, 200);
  await page.goto(FORM_URL);
  await fillRequired(page);
  await Promise.all([
    page.waitForRequest(req => req.url().includes('webhook')),
    page.click('#submit-btn'),
  ]);
  await expect(page.locator('#status.success')).toBeVisible();
});

test('shows error banner on webhook failure', async ({ page }) => {
  await mockWebhook(page, 500);
  await page.goto(FORM_URL);
  await fillRequired(page);
  await Promise.all([
    page.waitForRequest(req => req.url().includes('webhook')),
    page.click('#submit-btn'),
  ]);
  await expect(page.locator('#status.error')).toBeVisible();
});

test('submit button disabled during submission', async ({ page }) => {
  await page.route('**/webhook/**', async route => {
    await new Promise(r => setTimeout(r, 200));
    await route.fulfill({ status: 200, body: 'ok', contentType: 'text/plain' });
  });

  await page.goto(FORM_URL);
  await fillRequired(page);
  page.click('#submit-btn'); // intentionally not awaited
  await expect(page.locator('#submit-btn')).toBeDisabled();
});
