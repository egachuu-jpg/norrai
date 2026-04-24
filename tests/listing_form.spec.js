const { test, expect } = require('@playwright/test');

const FORM_URL = '/listing_form.html';
const PROFILE_KEY = 'norrai_agent_profile';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fillRequired(page) {
  await page.fill('#agent_name', 'Jane Smith');
  await page.fill('#agent_email', 'jane@brokerage.com');
  await page.fill('#street_address', '123 Maple St');
  await page.fill('#city', 'Faribault');
  await page.fill('#price', '$349,900');
  await page.fill('#beds', '3');
  await page.fill('#key_features', 'Remodeled kitchen, new roof 2022');
  await page.fill('#previous_listings', 'Beautiful home in a great location. Move-in ready.');
}

function mockWebhook(page, status = 200) {
  return page.route('**/webhook/**', route =>
    route.fulfill({ status, body: 'ok', contentType: 'text/plain' })
  );
}

// ─── 1. Required field validation ─────────────────────────────────────────────

test.describe('Required field validation', () => {
  const requiredFields = [
    { id: 'agent_name',        fill: 'Jane Smith' },
    { id: 'agent_email',       fill: 'jane@brokerage.com' },
    { id: 'street_address',    fill: '123 Maple St' },
    { id: 'city',              fill: 'Faribault' },
    { id: 'price',             fill: '$349,900' },
    { id: 'beds',              fill: '3' },
    { id: 'key_features',      fill: 'Remodeled kitchen' },
    { id: 'previous_listings', fill: 'Sample listing text here.' },
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

// ─── 2. Field type enforcement ────────────────────────────────────────────────

test.describe('Field type enforcement', () => {
  test('rejects invalid email format', async ({ page }) => {
    await mockWebhook(page);
    let fetched = false;
    page.on('request', req => { if (req.url().includes('webhook')) fetched = true; });

    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#agent_email', 'notanemail');
    await page.click('#submit-btn');

    expect(fetched).toBe(false);
  });

  test('rejects beds over max (20)', async ({ page }) => {
    await mockWebhook(page);
    let fetched = false;
    page.on('request', req => { if (req.url().includes('webhook')) fetched = true; });

    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#beds', '99');
    await page.click('#submit-btn');

    expect(fetched).toBe(false);
  });

  test('rejects baths with invalid step (e.g. 1.3)', async ({ page }) => {
    await mockWebhook(page);
    let fetched = false;
    page.on('request', req => { if (req.url().includes('webhook')) fetched = true; });

    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#baths', '1.3');
    await page.click('#submit-btn');

    expect(fetched).toBe(false);
  });

  test('rejects year_built below min (1800)', async ({ page }) => {
    await mockWebhook(page);
    let fetched = false;
    page.on('request', req => { if (req.url().includes('webhook')) fetched = true; });

    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#year_built', '1700');
    await page.click('#submit-btn');

    expect(fetched).toBe(false);
  });

  test('state field enforces maxlength of 2', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.fill('#state', 'MINN');
    const val = await page.inputValue('#state');
    expect(val.length).toBeLessThanOrEqual(2);
  });

  test('zip field enforces maxlength of 10', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.fill('#zip', '123456789012345');
    const val = await page.inputValue('#zip');
    expect(val.length).toBeLessThanOrEqual(10);
  });

  test('rejects price with non-currency text', async ({ page }) => {
    await mockWebhook(page);
    let fetched = false;
    page.on('request', req => { if (req.url().includes('webhook')) fetched = true; });

    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#price', 'not a price');
    await page.click('#submit-btn');

    expect(fetched).toBe(false);
  });

  test('accepts valid price format $349,900', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#price', '$349,900');
    await page.click('#submit-btn');
    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });
  });

  test('price auto-formats on blur: 349900 → $349,900', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.fill('#price', '349900');
    await page.locator('#price').blur();
    const val = await page.inputValue('#price');
    expect(val).toBe('$349,900');
  });

  test('lot_size rejects non-numeric input — payload value is null', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    // type="number" silently rejects non-numeric — value stays empty
    await page.evaluate(() => {
      document.getElementById('lot_size').value = 'half acre';
    });

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.lot_size).toBeNull();
  });

  test('lot_size accepts decimal value', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#lot_size', '0.35');

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.lot_size).toBe(0.35);
  });
});

// ─── 3. Payload shape ─────────────────────────────────────────────────────────

test.describe('Payload shape', () => {
  test('property_address is correctly constructed', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#street_address', '123 Maple St');
    await page.fill('#city', 'Faribault');
    await page.fill('#state', 'MN');
    await page.fill('#zip', '55021');

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.property_address).toBe('123 Maple St, Faribault, MN 55021');
  });

  test('numeric fields are numbers not strings', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#beds', '3');
    await page.fill('#baths', '2');
    await page.fill('#sqft', '1850');
    await page.fill('#year_built', '1998');

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(typeof body.beds).toBe('number');
    expect(typeof body.baths).toBe('number');
    expect(typeof body.sqft).toBe('number');
    expect(typeof body.year_built).toBe('number');
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
    expect(body.sqft).toBeNull();
    expect(body.year_built).toBeNull();
    expect(body.lot_size).toBeNull();
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

  test('source is listing_form_web', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.source).toBe('listing_form_web');
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

// ─── 4. Checkbox pills ────────────────────────────────────────────────────────

test.describe('Basement checkbox pills', () => {
  test('clicking a pill toggles active class', async ({ page }) => {
    await page.goto(FORM_URL);
    const pill = page.locator('.check-pill').first();
    await expect(pill).not.toHaveClass(/active/);
    await pill.click();
    await expect(pill).toHaveClass(/active/);
    await pill.click();
    await expect(pill).not.toHaveClass(/active/);
  });

  test('multiple pills can be active simultaneously', async ({ page }) => {
    await page.goto(FORM_URL);
    const pills = page.locator('.check-pill');
    await pills.nth(0).click();
    await pills.nth(1).click();
    await expect(pills.nth(0)).toHaveClass(/active/);
    await expect(pills.nth(1)).toHaveClass(/active/);
  });

  test('selected pills appear in payload as comma-separated string', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    // Click "Full finished" and "Walk-out"
    await page.locator('.check-pill[data-val="full finished"]').click();
    await page.locator('.check-pill[data-val="walk-out"]').click();

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.basement).toBe('full finished, walk-out');
  });

  test('no pills selected → basement is empty string', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    const body = JSON.parse(req.postData());
    expect(body.basement).toBe('');
  });
});

// ─── 5. localStorage — agent profile persistence ──────────────────────────────

test.describe('Agent profile persistence', () => {
  test('profile is saved to localStorage on successful submit', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    // Wait until the response has been processed and saveProfile has run
    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });

    const saved = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), PROFILE_KEY);
    expect(saved.agent_name).toBe('Jane Smith');
    expect(saved.agent_email).toBe('jane@brokerage.com');
    expect(saved.previous_listings).toBeTruthy();
  });

  test('profile fields restore on page reload', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.evaluate((k) => {
      localStorage.setItem(k, JSON.stringify({
        agent_name: 'Jane Smith',
        agent_email: 'jane@brokerage.com',
        previous_listings: 'Sample listing.',
      }));
    }, PROFILE_KEY);

    await page.reload();

    await expect(page.locator('#agent_name')).toHaveValue('Jane Smith');
    await expect(page.locator('#agent_email')).toHaveValue('jane@brokerage.com');
    await expect(page.locator('#previous_listings')).toHaveValue('Sample listing.');
    await expect(page.locator('#voice-saved-badge')).toBeVisible();
  });

  test('clear button wipes profile and hides badge', async ({ page }) => {
    await page.goto(FORM_URL);
    await page.evaluate((k) => {
      localStorage.setItem(k, JSON.stringify({
        agent_name: 'Jane Smith',
        agent_email: 'jane@brokerage.com',
        previous_listings: 'Sample listing.',
      }));
    }, PROFILE_KEY);

    await page.reload();
    await page.click('#clear-profile');

    await expect(page.locator('#agent_name')).toHaveValue('');
    await expect(page.locator('#agent_email')).toHaveValue('');
    await expect(page.locator('#previous_listings')).toHaveValue('');
    await expect(page.locator('#voice-saved-badge')).not.toBeVisible();

    const stored = await page.evaluate(k => localStorage.getItem(k), PROFILE_KEY);
    expect(stored).toBeNull();
  });

  test('property fields are empty after form reset, profile fields repopulate', async ({ page }) => {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#street_address', '123 Maple St');
    await page.fill('#city', 'Faribault');
    await page.fill('#price', '$349,900');

    await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);

    await expect(page.locator('#street_address')).toHaveValue('');
    await expect(page.locator('#city')).toHaveValue('');
    await expect(page.locator('#price')).toHaveValue('');
    await expect(page.locator('#agent_name')).toHaveValue('Jane Smith');
    await expect(page.locator('#agent_email')).toHaveValue('jane@brokerage.com');
    await expect(page.locator('#previous_listings')).not.toHaveValue('');
  });
});

// ─── 6. Submit UI states ──────────────────────────────────────────────────────

test.describe('Submit UI states', () => {
  test('button disables and shows Generating… while in-flight', async ({ page }) => {
    let resolve;
    await page.route('**/webhook/**', async route => {
      await new Promise(r => { resolve = r; });
      route.fulfill({ status: 200, body: 'ok' });
    });

    await page.goto(FORM_URL);
    await fillRequired(page);
    page.click('#submit-btn'); // don't await — check state while in-flight

    await expect(page.locator('#submit-btn')).toBeDisabled({ timeout: 2000 });
    await expect(page.locator('#submit-btn')).toHaveText('Generating…');

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

// ─── 7. Success and error banners ─────────────────────────────────────────────

test.describe('Success and error banners', () => {
  test('shows success banner with agent email on 200', async ({ page }) => {
    await mockWebhook(page, 200);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#status.success')).toBeVisible({ timeout: 5000 });
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

// ─── 8. Address construction edge cases ───────────────────────────────────────

test.describe('Address construction', () => {
  async function getAddress(page, { street, city, state, zip }) {
    await mockWebhook(page);
    await page.goto(FORM_URL);
    await fillRequired(page);
    await page.fill('#street_address', street);
    await page.fill('#city', city);
    await page.fill('#state', state);
    await page.fill('#zip', zip);

    const [req] = await Promise.all([
      page.waitForRequest('**/webhook/**'),
      page.click('#submit-btn'),
    ]);
    return JSON.parse(req.postData()).property_address;
  }

  test('street + city + state + zip', async ({ page }) => {
    const addr = await getAddress(page, { street: '123 Maple St', city: 'Faribault', state: 'MN', zip: '55021' });
    expect(addr).toBe('123 Maple St, Faribault, MN 55021');
  });

  test('street + city + state, no zip', async ({ page }) => {
    const addr = await getAddress(page, { street: '123 Maple St', city: 'Faribault', state: 'MN', zip: '' });
    expect(addr).toBe('123 Maple St, Faribault, MN');
  });

  test('street + city only', async ({ page }) => {
    const addr = await getAddress(page, { street: '123 Maple St', city: 'Faribault', state: '', zip: '' });
    expect(addr).toBe('123 Maple St, Faribault');
  });
});
