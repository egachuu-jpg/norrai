const { test, expect } = require('@playwright/test');

const FORM_URL   = '/clients/weichert_open_house_setup.html';
const TOKEN      = 'c1a35bff-5894-4511-b003-34bd40ad72e4';
const SIGNIN_URL = 'https://tools.norrai.co/open_house.html?address=123%20Maple%20St&wf=weichert';

// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fillRequired(page, email = 'jane@brokerage.com') {
  await page.fill('#agent_name', 'Jane Smith');
  await page.fill('#agent_phone', '5071234567');
  await page.fill('#agent_email', email);
  await page.fill('#street_address', '123 Maple St');
  await page.fill('#city', 'Faribault');
  await page.fill('#listing_description', 'Beautiful 3-bed ranch home. Updated kitchen with granite counters, new roof 2022, oversized garage.');
}

function mockWebhookJson(page, { status = 200, body = { ok: true, signin_url: SIGNIN_URL } } = {}) {
  return page.route('**/webhook/**', route =>
    route.fulfill({ status, body: typeof body === 'string' ? body : JSON.stringify(body), contentType: typeof body === 'string' ? 'text/plain' : 'application/json' })
  );
}

function mockQr(page) {
  return page.route('https://api.qrserver.com/**', route => route.fulfill({ status: 200, body: PNG, contentType: 'image/png' }));
}

async function submit(page) {
  const [req] = await Promise.all([
    page.waitForRequest('**/webhook/**'),
    page.click('#submit-btn'),
  ]);
  return req;
}

// ─── 1. Page load ─────────────────────────────────────────────────────────────

test.describe('Page load', () => {
  test('loads with no JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(FORM_URL);
    await expect(page).toHaveTitle(/Open House Setup/);
    expect(errors).toEqual([]);
  });

  test('result section is hidden until a flyer is created', async ({ page }) => {
    await page.goto(FORM_URL);
    await expect(page.locator('#result')).not.toBeVisible();
  });
});

// ─── 2. Required fields + type enforcement ────────────────────────────────────

test.describe('Validation', () => {
  for (const id of ['agent_name', 'agent_phone', 'agent_email', 'street_address', 'city', 'listing_description']) {
    test(`blocks submit when ${id} is empty`, async ({ page }) => {
      await mockWebhookJson(page);
      await page.goto(FORM_URL);
      await fillRequired(page);
      await page.fill(`#${id}`, '');
      await page.click('#submit-btn');
      await expect(page.locator('#result.show')).not.toBeVisible();
    });
  }

  test('rejects invalid agent email format', async ({ page }) => {
    await mockWebhookJson(page);
    await page.goto(FORM_URL);
    await fillRequired(page, 'notanemail');
    await page.click('#submit-btn');
    await expect(page.locator('#result.show')).not.toBeVisible();
  });

  test('photo/headshot/when fields are optional', async ({ page }) => {
    await mockWebhookJson(page);
    await mockQr(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await submit(page);
    await expect(page.locator('#result.show')).toBeVisible();
  });
});

// ─── 3. Payload shape ─────────────────────────────────────────────────────────

test.describe('Payload shape', () => {
  test('keeps the existing contract and sends no image data', async ({ page }) => {
    await mockWebhookJson(page);
    await mockQr(page);
    await page.goto(`${FORM_URL}?agent_token=${TOKEN}`);
    await fillRequired(page);
    await page.fill('#zip', '55021');
    await page.fill('#open_house_when', 'Sat 1-3');
    await page.setInputFiles('#photos', [{ name: 'a.png', mimeType: 'image/png', buffer: PNG }]);
    await expect(page.locator('#photo-thumbs img')).toHaveCount(1);

    const req = await submit(page);
    const body = JSON.parse(req.postData());
    expect(Object.keys(body).sort()).toEqual([
      'agent_email', 'agent_name', 'agent_phone', 'agent_token', 'city', 'listing_description',
      'listing_url', 'property_address', 'source_form', 'state', 'street_address', 'zip',
    ]);
    expect(body.property_address).toBe('123 Maple St, Faribault, MN, 55021');
    expect(body.source_form).toBe('weichert_open_house_setup');
    expect(body.agent_token).toBe(TOKEN);
    expect(req.postData()).not.toContain('data:image');
  });

  test('sends the X-Norr-Token security header', async ({ page }) => {
    await mockWebhookJson(page);
    await mockQr(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    const req = await submit(page);
    expect(req.headers()['x-norr-token']).toBeTruthy();
  });

  test('agent_token persists in localStorage from the URL', async ({ page }) => {
    await mockWebhookJson(page);
    await mockQr(page);
    await page.goto(`${FORM_URL}?agent_token=${TOKEN}`);
    expect(await page.evaluate(() => localStorage.getItem('norrai_agent_token'))).toBe(TOKEN);
    await page.goto(FORM_URL);
    await fillRequired(page);
    const req = await submit(page);
    expect(JSON.parse(req.postData()).agent_token).toBe(TOKEN);
  });
});

// ─── 4. Flyer ─────────────────────────────────────────────────────────────────

test.describe('Flyer', () => {
  test('renders address, agent, description, when, and a QR for the sign-in URL', async ({ page }) => {
    await mockWebhookJson(page);
    await mockQr(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#open_house_when', 'Sat, Nov 22 · 1–3 PM');
    await submit(page);

    const flyer = page.locator('#flyer');
    await expect(flyer).toContainText('123 Maple St, Faribault, MN');
    await expect(flyer).toContainText('Jane Smith');
    await expect(flyer).toContainText('5071234567');
    await expect(flyer).toContainText('Sat, Nov 22 · 1–3 PM');
    await expect(flyer).toContainText('Updated kitchen');
    const qr = await flyer.locator('.fl-qr img').getAttribute('src');
    expect(decodeURIComponent(qr)).toContain(SIGNIN_URL);
    await expect(page.locator('#print-btn')).toBeEnabled();
  });

  test('uploaded photos appear on the flyer, capped at 4', async ({ page }) => {
    await mockWebhookJson(page);
    await mockQr(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    const files = Array.from({ length: 6 }, (_, i) => ({ name: `p${i}.png`, mimeType: 'image/png', buffer: PNG }));
    await page.setInputFiles('#photos', files);
    await expect(page.locator('#photo-thumbs img')).toHaveCount(4);
    await submit(page);
    await expect(page.locator('.fl-photos img')).toHaveCount(4);
    await expect(page.locator('.fl-photos')).toHaveClass(/n4/);
  });

  test('no photos hides the photo block', async ({ page }) => {
    await mockWebhookJson(page);
    await mockQr(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await submit(page);
    await expect(page.locator('.fl-photos')).toBeHidden();
  });

  test('known agent gets their hosted headshot', async ({ page }) => {
    await mockWebhookJson(page);
    await mockQr(page);
    await page.goto(FORM_URL);
    await fillRequired(page, 'eknutson@teamyellownow.com');
    await submit(page);
    await expect(page.locator('.fl-headshot')).toHaveAttribute('src', '/weichert_evan_headshot.jpg');
  });

  test('unknown agent with no upload gets no headshot slot', async ({ page }) => {
    await mockWebhookJson(page);
    await mockQr(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await submit(page);
    await expect(page.locator('.fl-headshot')).toHaveClass(/none/);
  });

  test('uploaded headshot is used and remembered for next time', async ({ page }) => {
    await mockWebhookJson(page);
    await mockQr(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.setInputFiles('#headshot', { name: 'me.png', mimeType: 'image/png', buffer: PNG });
    await expect.poll(() => page.evaluate(() => localStorage.getItem('norrai_oh_headshot'))).toMatch(/^data:image\/jpeg/);
    await submit(page);
    await expect(page.locator('.fl-headshot')).toHaveAttribute('src', /^data:image\/jpeg/);
  });

  test('flyer text is rendered as text, not HTML', async ({ page }) => {
    await mockWebhookJson(page);
    await mockQr(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#agent_name', '<img src=x onerror="window.__xss=1">');
    await submit(page);
    await expect(page.locator('#flyer')).toContainText('<img src=x');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('very long descriptions are trimmed to fit the page', async ({ page }) => {
    await mockWebhookJson(page);
    await mockQr(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#listing_description', 'Lovely home. '.repeat(200));
    await submit(page);
    const len = (await page.locator('.fl-desc').innerText()).length;
    expect(len).toBeLessThan(1200);
  });

  test('print view shows only the flyer', async ({ page }) => {
    await mockWebhookJson(page);
    await mockQr(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await submit(page);
    await expect(page.locator('#flyer')).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.site-header')).toBeHidden();
    await expect(page.locator('#print-btn')).toBeHidden();
    await expect(page.locator('#flyer')).toBeVisible();
  });

  test('Start another returns to the form with agent info kept', async ({ page }) => {
    await mockWebhookJson(page);
    await mockQr(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await submit(page);
    await page.click('#another-btn');
    await expect(page.locator('#setup-form')).toBeVisible();
    await expect(page.locator('#street_address')).toHaveValue('');
    await expect(page.locator('#agent_name')).toHaveValue('Jane Smith');
  });
});

// ─── 5. UI states ─────────────────────────────────────────────────────────────

test.describe('UI states', () => {
  test('falls back to the emailed-QR message if the workflow returns no link', async ({ page }) => {
    await mockWebhookJson(page, { body: 'ok' });
    await page.goto(FORM_URL);
    await fillRequired(page);
    await submit(page);
    await expect(page.locator('#result-status')).toContainText('QR code on its way');
    await expect(page.locator('#flyer-stage')).toBeHidden();
    await expect(page.locator('#print-btn')).toBeHidden();
  });

  test('shows an error and re-enables the button on a 403', async ({ page }) => {
    await mockWebhookJson(page, { status: 403, body: { ok: false, error: 'unknown_client' } });
    await page.goto(FORM_URL);
    await fillRequired(page);
    await submit(page);
    await expect(page.locator('#status.error')).toBeVisible();
    await expect(page.locator('#submit-btn')).toBeEnabled();
    await expect(page.locator('#setup-form')).toBeVisible();
  });

  test('shows an error on a 500', async ({ page }) => {
    await mockWebhookJson(page, { status: 500, body: 'boom' });
    await page.goto(FORM_URL);
    await fillRequired(page);
    await submit(page);
    await expect(page.locator('#status.error')).toContainText('500');
  });

  test('disables the button while submitting', async ({ page }) => {
    await page.route('**/webhook/**', async route => {
      await new Promise(r => setTimeout(r, 400));
      await route.fulfill({ status: 200, body: '{}', contentType: 'application/json' });
    });
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');
    await expect(page.locator('#submit-btn')).toBeDisabled();
  });
});

// ─── 6. Returning agent + home screen ─────────────────────────────────────────

test.describe('Returning agent and home screen', () => {
  test('agent name, phone and email are prefilled on the next visit', async ({ page }) => {
    await mockWebhookJson(page);
    await mockQr(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await submit(page);
    await page.goto(FORM_URL);
    await expect(page.locator('#agent_name')).toHaveValue('Jane Smith');
    await expect(page.locator('#agent_phone')).toHaveValue('5071234567');
    await expect(page.locator('#agent_email')).toHaveValue('jane@brokerage.com');
  });

  test('manifest start_url keeps the agent token so the home-screen app stays authorized', async ({ page }) => {
    await page.goto(`${FORM_URL}?agent_token=${TOKEN}`);
    const manifest = await page.evaluate(async () => {
      const href = document.querySelector('link[rel="manifest"]').href;
      return (await fetch(href)).json();
    });
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toContain(`agent_token=${TOKEN}`);
    expect(manifest.start_url).toContain('/clients/weichert_open_house_setup.html');
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test('apple-touch-icon and app icons are served', async ({ page, request }) => {
    await page.goto(FORM_URL);
    for (const path of ['/norr_ai_apple_touch_180.png', '/norr_ai_app_192.png', '/norr_ai_app_512.png']) {
      const res = await request.get(path);
      expect(res.ok(), path).toBeTruthy();
    }
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  });

  test.describe('on a phone', () => {
    test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' });

    test('shows the add-to-home-screen tip and remembers dismissal', async ({ page }) => {
      await page.goto(FORM_URL);
      await expect(page.locator('#a2hs')).toBeVisible();
      await page.click('#a2hs-dismiss');
      await expect(page.locator('#a2hs')).toBeHidden();
      await page.reload();
      await expect(page.locator('#a2hs')).toBeHidden();
    });
  });

  test('tip is not shown on desktop', async ({ page }) => {
    await page.goto(FORM_URL);
    await expect(page.locator('#a2hs')).toBeHidden();
  });
});
