const { test, expect } = require('@playwright/test');
const { mockWebhook } = require('./helpers');

const FORM_URL = '/internal/contract_generator';

async function fillGenerateForm(page) {
  await page.fill('#contact_name',   'Sarah Johnson');
  await page.fill('#business_name',  'Johnson Family Dental');
  await page.fill('#contact_email',  'sarah@johnsondental.com');
  await page.fill('#monthly_price',  '500');
  await page.fill('#setup_fee',      '500');
  await page.fill('#start_date',     '2026-06-01');
}

// ─── 1. Page load ──────────────────────────────────────────────────────────────

test.describe('Page load', () => {
  test('loads with correct title and no console errors', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.goto(FORM_URL);
    await expect(page).toHaveTitle(/Contract Generator/);
    expect(errors).toHaveLength(0);
  });

  test('sign section is hidden on load', async ({ page }) => {
    await page.goto(FORM_URL);
    await expect(page.locator('#sign-section')).not.toBeVisible();
  });

  test('contract preview is hidden on load', async ({ page }) => {
    await page.goto(FORM_URL);
    await expect(page.locator('#contract-preview')).not.toBeVisible();
  });
});

// ─── 2. Generate form — required field validation ──────────────────────────────

test.describe('Generate form required fields', () => {
  const requiredFields = [
    { id: 'contact_name',  fill: 'Sarah Johnson' },
    { id: 'business_name', fill: 'Johnson Family Dental' },
    { id: 'contact_email', fill: 'sarah@johnsondental.com' },
    { id: 'monthly_price', fill: '500' },
    { id: 'setup_fee',     fill: '500' },
    { id: 'start_date',    fill: '2026-06-01' },
  ];

  for (const field of requiredFields) {
    test(`contract does not render when ${field.id} is empty`, async ({ page }) => {
      await page.goto(FORM_URL);
      await fillGenerateForm(page);
      await page.fill(`#${field.id}`, '');
      await page.click('#generate-btn');
      await expect(page.locator('#contract-preview')).not.toBeVisible();
    });
  }
});

// ─── 3. Contract rendering ─────────────────────────────────────────────────────

test.describe('Contract rendering', () => {
  test('shows contract preview and sign section after generate', async ({ page }) => {
    await page.goto(FORM_URL);
    await fillGenerateForm(page);
    await page.click('#generate-btn');
    await expect(page.locator('#contract-preview')).toBeVisible();
    await expect(page.locator('#sign-section')).toBeVisible();
  });

  test('contract body contains business name', async ({ page }) => {
    await page.goto(FORM_URL);
    await fillGenerateForm(page);
    await page.click('#generate-btn');
    await expect(page.locator('#contract-body')).toContainText('Johnson Family Dental');
  });

  test('contract body contains contact name', async ({ page }) => {
    await page.goto(FORM_URL);
    await fillGenerateForm(page);
    await page.click('#generate-btn');
    await expect(page.locator('#contract-body')).toContainText('Sarah Johnson');
  });

  test('contract body contains formatted monthly price', async ({ page }) => {
    await page.goto(FORM_URL);
    await fillGenerateForm(page);
    await page.click('#generate-btn');
    await expect(page.locator('#contract-body')).toContainText('500.00');
  });

  test('contract body contains start date month', async ({ page }) => {
    await page.goto(FORM_URL);
    await fillGenerateForm(page);
    await page.click('#generate-btn');
    await expect(page.locator('#contract-body')).toContainText('June');
  });

  test('print button is present after generate', async ({ page }) => {
    await page.goto(FORM_URL);
    await fillGenerateForm(page);
    await page.click('#generate-btn');
    await expect(page.locator('#print-btn')).toBeVisible();
  });

  test('contract output escapes HTML in user input — no XSS', async ({ page }) => {
    await page.goto(FORM_URL);
    await fillGenerateForm(page);
    await page.fill('#business_name', '<script>alert(1)</script>');
    await page.click('#generate-btn');
    const html = await page.locator('#contract-body').innerHTML();
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ─── 4. Mark as Signed ─────────────────────────────────────────────────────────

test.describe('Mark as Signed', () => {
  test('blocks record when signed_date is empty', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillGenerateForm(page);
    await page.click('#generate-btn');
    await page.click('#record-btn');
    await expect(page.locator('#sign-status.success')).not.toBeVisible();
  });

  test('signed_via dropdown has all three options', async ({ page }) => {
    await page.goto(FORM_URL);
    await fillGenerateForm(page);
    await page.click('#generate-btn');
    const options = await page.locator('#signed_via option').allTextContents();
    expect(options).toContain('Email reply ("I agree")');
    expect(options).toContain('Print, sign, scan, email back');
    expect(options).toContain('DocuSign');
  });

  test('fires POST to /webhook/contract-signed with correct payload', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillGenerateForm(page);
    await page.click('#generate-btn');
    await page.fill('#signed_date', '2026-05-20');
    await page.selectOption('#signed_via', 'email_reply');

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#record-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.contact_name).toBe('Sarah Johnson');
    expect(body.business_name).toBe('Johnson Family Dental');
    expect(body.contact_email).toBe('sarah@johnsondental.com');
    expect(body.monthly_price).toBe(500);
    expect(body.setup_fee).toBe(500);
    expect(body.start_date).toBe('2026-06-01');
    expect(body.signed_date).toBe('2026-05-20');
    expect(body.signed_via).toBe('email_reply');
    expect(body.tier).toBe('starter');
  });

  test('monthly_price and setup_fee are numbers not strings', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillGenerateForm(page);
    await page.click('#generate-btn');
    await page.fill('#signed_date', '2026-05-20');

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#record-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(typeof body.monthly_price).toBe('number');
    expect(typeof body.setup_fee).toBe('number');
  });

  test('X-Norr-Token header is present', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillGenerateForm(page);
    await page.click('#generate-btn');
    await page.fill('#signed_date', '2026-05-20');

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#record-btn'),
    ]);
    expect(req.headers()['x-norr-token']).toBeTruthy();
  });

  test('shows success state after recording', async ({ page }) => {
    await mockWebhook(page, 200);
    await page.goto(FORM_URL);
    await fillGenerateForm(page);
    await page.click('#generate-btn');
    await page.fill('#signed_date', '2026-05-20');
    await page.click('#record-btn');
    await expect(page.locator('#sign-status.success')).toBeVisible({ timeout: 5000 });
  });

  test('shows error state on 500', async ({ page }) => {
    await mockWebhook(page, 500);
    await page.goto(FORM_URL);
    await fillGenerateForm(page);
    await page.click('#generate-btn');
    await page.fill('#signed_date', '2026-05-20');
    await page.click('#record-btn');
    await expect(page.locator('#sign-status.error')).toBeVisible({ timeout: 5000 });
  });

  test('record button re-enables after error', async ({ page }) => {
    await mockWebhook(page, 500);
    await page.goto(FORM_URL);
    await fillGenerateForm(page);
    await page.click('#generate-btn');
    await page.fill('#signed_date', '2026-05-20');
    await page.click('#record-btn');
    await expect(page.locator('#record-btn')).toBeEnabled({ timeout: 5000 });
  });

  test('setup_fee of 0 is accepted — payload includes 0 not empty', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillGenerateForm(page);
    await page.fill('#setup_fee', '0');
    await page.click('#generate-btn');
    await page.fill('#signed_date', '2026-05-20');

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#record-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.setup_fee).toBe(0);
  });
});
