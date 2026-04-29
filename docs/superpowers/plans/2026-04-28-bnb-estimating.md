# B&B Manufacturing Estimating Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web form where anyone (customer or sales rep) can submit a metal fabrication quote request and receive a line-item estimate via email within ~60 seconds.

**Architecture:** A Polar Modern HTML form submits a structured JSON payload to an n8n webhook. n8n builds a Claude prompt with a rate card and part specs, parses the JSON response, and sends a formatted email via SendGrid. Every submission is logged to Neon Postgres.

**Tech Stack:** HTML/CSS/JS (inline, no framework) · Playwright (tests) · n8n Cloud · Claude API (`claude-sonnet-4-6`) · SendGrid · Neon Postgres (n8n Postgres node)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `website/bnb_estimate_form.html` | Intake form — all fields, conditional service details, fetch submit |
| Create | `tests/bnb_estimate_form.spec.js` | Playwright tests — validation, payload shape, UI states |
| Create | `n8n/workflows/B&B Manufacturing Estimate.json` | n8n workflow export — webhook through Neon logging |

---

## Task 1: Write Playwright tests (failing)

**Files:**
- Create: `tests/bnb_estimate_form.spec.js`

These tests define the contract for the form before implementation begins. They will all fail until the form exists.

- [ ] **Step 1: Create the test file**

```javascript
// tests/bnb_estimate_form.spec.js
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
```

- [ ] **Step 2: Run tests to confirm they all fail**

```bash
npx playwright test tests/bnb_estimate_form.spec.js
```

Expected: all tests fail with "net::ERR_FILE_NOT_FOUND" or similar — the form doesn't exist yet.

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/bnb_estimate_form.spec.js
git commit -m "test: add failing Playwright tests for B&B estimate form"
```

---

## Task 2: Build the intake form HTML

**Files:**
- Create: `website/bnb_estimate_form.html`

- [ ] **Step 1: Create the file with structure, styles, and contact/part spec sections**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Get an Estimate — B&B Manufacturing</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Inter+Tight:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="icon" type="image/svg+xml" href="norr_ai_favicon.svg">
<style>
  :root {
    --bone:      #FAFAF7;
    --ink:       #0A0F1A;
    --glacial:   #7FA9B8;
    --graphite:  #3A3F48;
    --blush:     #E8D4C4;
    --surface:   #FFFFFF;
    --border:    #E5E4DE;
    --muted:     #9EA3AA;
    --secondary: #6A6F78;
    --success-bg: #F0FAF4;
    --success:   #2D7A4F;
    --error-bg:  #FEF2F2;
    --error:     #B91C1C;
    --font-display: 'Inter Tight', sans-serif;
    --font-body:    'Inter', sans-serif;
    --font-mono:    'JetBrains Mono', monospace;
    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { font-size: 16px; -webkit-font-smoothing: antialiased; }
  body { font-family: var(--font-body); background: var(--bone); color: var(--ink); line-height: 1.5; }

  .site-header { background: var(--ink); padding: 48px 24px 44px; border-bottom: 1px solid #1e2535; }
  .site-header-inner { max-width: 680px; margin: 0 auto; }
  .eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--glacial); margin-bottom: 14px; }
  .site-header h1 { font-family: var(--font-display); font-weight: 700; font-size: 34px; letter-spacing: -0.03em; line-height: 1.05; color: var(--bone); margin-bottom: 12px; }
  .site-header h1 .accent { color: var(--glacial); }
  .site-header p { font-size: 14px; color: var(--muted); line-height: 1.6; max-width: 480px; }

  .wrap { max-width: 680px; margin: 0 auto; padding: 48px 24px 80px; }
  form { display: flex; flex-direction: column; gap: 28px; }

  .section-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 28px; display: flex; flex-direction: column; gap: 20px; }
  .section-title { font-family: var(--font-display); font-weight: 600; font-size: 15px; letter-spacing: -0.01em; color: var(--ink); padding-bottom: 14px; border-bottom: 1px solid var(--border); }

  .field { display: flex; flex-direction: column; gap: 6px; }
  .field label { font-size: 13px; font-weight: 500; color: var(--ink); }
  .field label .opt { color: var(--muted); font-weight: 400; }
  .field input, .field select, .field textarea {
    font-family: var(--font-body); font-size: 14px; color: var(--ink);
    background: var(--bone); border: 1px solid var(--border);
    border-radius: var(--radius-md); padding: 10px 12px;
    transition: border-color 0.15s, box-shadow 0.15s; outline: none;
  }
  .field input:focus, .field select:focus, .field textarea:focus {
    border-color: var(--glacial); box-shadow: 0 0 0 3px rgba(127,169,184,0.15);
  }
  .field textarea { resize: vertical; min-height: 80px; }
  .field .hint { font-size: 12px; color: var(--muted); }

  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }

  /* Services */
  .services-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .svc-label { display: flex; align-items: center; gap: 10px; font-size: 14px; cursor: pointer; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bone); transition: border-color 0.15s, background 0.15s; }
  .svc-label:has(input:checked) { border-color: var(--glacial); background: rgba(127,169,184,0.08); }
  .svc-label input[type="checkbox"] { accent-color: var(--glacial); width: 16px; height: 16px; flex-shrink: 0; }

  .service-details { margin-top: 12px; padding: 16px; background: var(--bone); border: 1px solid var(--border); border-radius: var(--radius-md); display: flex; flex-direction: column; gap: 14px; }
  .service-details[hidden] { display: none; }
  .service-details-title { font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--secondary); margin-bottom: 2px; }

  /* Submit */
  .submit-wrap { display: flex; flex-direction: column; gap: 12px; }
  #submit-btn {
    font-family: var(--font-display); font-size: 15px; font-weight: 600;
    background: var(--ink); color: var(--bone);
    border: none; border-radius: var(--radius-md);
    padding: 14px 28px; cursor: pointer;
    transition: background 0.15s;
  }
  #submit-btn:hover:not(:disabled) { background: var(--graphite); }
  #submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  #status { display: none; font-size: 14px; padding: 12px 16px; border-radius: var(--radius-md); }
  #status.success { display: block; background: var(--success-bg); color: var(--success); }
  #status.error   { display: block; background: var(--error-bg);   color: var(--error); }
</style>
</head>
<body>

<header class="site-header">
  <div class="site-header-inner">
    <p class="eyebrow">B&amp;B Manufacturing &amp; Assembly</p>
    <h1>Get an <span class="accent">Estimate</span></h1>
    <p>Fill out your part specifications below. We'll email you a detailed quote within minutes.</p>
  </div>
</header>

<div class="wrap">
<form id="estimate-form" novalidate>

  <!-- Contact Info -->
  <div class="section-card">
    <div class="section-title">Contact Information</div>
    <div class="row-2">
      <div class="field">
        <label for="name">Full Name</label>
        <input type="text" id="name" name="name" required autocomplete="name">
      </div>
      <div class="field">
        <label for="company">Company <span class="opt">(optional)</span></label>
        <input type="text" id="company" name="company" autocomplete="organization">
      </div>
    </div>
    <div class="row-2">
      <div class="field">
        <label for="email">Email Address</label>
        <input type="email" id="email" name="email" required autocomplete="email">
      </div>
      <div class="field">
        <label for="phone">Phone <span class="opt">(optional)</span></label>
        <input type="tel" id="phone" name="phone" autocomplete="tel">
      </div>
    </div>
  </div>

  <!-- Part Specs -->
  <div class="section-card">
    <div class="section-title">Part Specifications</div>
    <div class="field">
      <label for="part_name">Part Name / Description</label>
      <input type="text" id="part_name" name="part_name" required placeholder="e.g. Hydraulic Tank Bracket">
    </div>
    <div class="row-2">
      <div class="field">
        <label for="material_type">Material</label>
        <select id="material_type" name="material_type" required>
          <option value="">Select material…</option>
          <option value="mild_steel">Mild Steel</option>
          <option value="stainless_steel">Stainless Steel</option>
          <option value="aluminum">Aluminum</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="field">
        <label for="thickness">Thickness (inches)</label>
        <input type="number" id="thickness" name="thickness" required min="0.03" max="1.25" step="0.01" placeholder="0.25">
      </div>
    </div>
    <div>
      <div class="section-title" style="font-size:13px; border:none; padding-bottom:10px;">Dimensions (inches)</div>
      <div class="row-3">
        <div class="field">
          <label for="length">Length</label>
          <input type="number" id="length" name="length" required min="0.1" step="0.01" placeholder="12">
        </div>
        <div class="field">
          <label for="width">Width</label>
          <input type="number" id="width" name="width" required min="0.1" step="0.01" placeholder="8">
        </div>
        <div class="field">
          <label for="height">Height</label>
          <input type="number" id="height" name="height" required min="0.01" step="0.01" placeholder="4">
        </div>
      </div>
    </div>
    <div class="row-2">
      <div class="field">
        <label for="weight">Weight Estimate (lbs) <span class="opt">(optional)</span></label>
        <input type="number" id="weight" name="weight" min="0" step="0.1" placeholder="Leave blank to auto-estimate">
      </div>
      <div class="field">
        <label for="quantity">Quantity</label>
        <input type="number" id="quantity" name="quantity" required min="1" step="1" placeholder="1">
      </div>
    </div>
    <div class="field">
      <label for="file_upload">Drawing / Sketch <span class="opt">(optional — PDF, JPG, PNG)</span></label>
      <input type="file" id="file_upload" name="file_upload" accept=".pdf,.jpg,.jpeg,.png">
      <span class="hint">Attach a reference file. Estimator will review before finalizing.</span>
    </div>
    <div class="field">
      <label for="notes">Special Requirements <span class="opt">(optional)</span></label>
      <textarea id="notes" name="notes" placeholder="Tolerances, surface finish, certifications, delivery requirements…"></textarea>
    </div>
  </div>

  <!-- Services -->
  <div class="section-card">
    <div class="section-title">Services Needed</div>
    <div class="services-grid">
      <label class="svc-label"><input type="checkbox" id="svc_laser_cutting"   name="svc_laser_cutting">   Laser Cutting</label>
      <label class="svc-label"><input type="checkbox" id="svc_waterjet"        name="svc_waterjet">        Waterjet Cutting</label>
      <label class="svc-label"><input type="checkbox" id="svc_cnc_machining"   name="svc_cnc_machining">   CNC Machining</label>
      <label class="svc-label"><input type="checkbox" id="svc_press_brake"     name="svc_press_brake">     Press Brake Forming</label>
      <label class="svc-label"><input type="checkbox" id="svc_welding"         name="svc_welding">         Welding</label>
      <label class="svc-label"><input type="checkbox" id="svc_sandblasting"    name="svc_sandblasting">    Sandblasting</label>
      <label class="svc-label"><input type="checkbox" id="svc_powder_coating"  name="svc_powder_coating">  Powder Coating</label>
      <label class="svc-label"><input type="checkbox" id="svc_plating"         name="svc_plating">         Plating</label>
      <label class="svc-label"><input type="checkbox" id="svc_deburring"       name="svc_deburring">       Deburring</label>
      <label class="svc-label"><input type="checkbox" id="svc_assembly"        name="svc_assembly">        Assembly / Kitting</label>
    </div>

    <!-- Laser Cutting details -->
    <div id="details_laser_cutting" class="service-details" hidden>
      <div class="service-details-title">Laser Cutting Details</div>
      <div class="row-2">
        <div class="field"><label for="laser_max_cut_length">Max cut length (in)</label><input type="number" id="laser_max_cut_length" name="laser_max_cut_length" min="0" step="0.1"></div>
        <div class="field"><label for="laser_holes">Number of holes / features</label><input type="number" id="laser_holes" name="laser_holes" min="0" step="1"></div>
      </div>
    </div>

    <!-- Waterjet details -->
    <div id="details_waterjet" class="service-details" hidden>
      <div class="service-details-title">Waterjet Details</div>
      <div class="row-2">
        <div class="field"><label for="waterjet_max_cut_length">Max cut length (in)</label><input type="number" id="waterjet_max_cut_length" name="waterjet_max_cut_length" min="0" step="0.1"></div>
        <div class="field"><label for="waterjet_holes">Number of holes / features</label><input type="number" id="waterjet_holes" name="waterjet_holes" min="0" step="1"></div>
      </div>
    </div>

    <!-- CNC Machining details -->
    <div id="details_cnc_machining" class="service-details" hidden>
      <div class="service-details-title">CNC Machining Details</div>
      <div class="row-2">
        <div class="field"><label for="cnc_setups">Number of setups</label><input type="number" id="cnc_setups" name="cnc_setups" min="1" step="1"></div>
        <div class="field">
          <label for="cnc_tolerance">Tolerance class</label>
          <select id="cnc_tolerance" name="cnc_tolerance">
            <option value="standard">Standard (±0.005")</option>
            <option value="precision">Precision (±0.001")</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Press Brake details -->
    <div id="details_press_brake" class="service-details" hidden>
      <div class="service-details-title">Press Brake Details</div>
      <div class="field"><label for="press_brake_bends">Number of bends</label><input type="number" id="press_brake_bends" name="press_brake_bends" min="1" step="1"></div>
    </div>

    <!-- Welding details -->
    <div id="details_welding" class="service-details" hidden>
      <div class="service-details-title">Welding Details</div>
      <div class="row-2">
        <div class="field">
          <label for="weld_type">Weld type</label>
          <select id="weld_type" name="weld_type">
            <option value="mig">MIG</option>
            <option value="tig">TIG</option>
            <option value="robotic">Robotic</option>
          </select>
        </div>
        <div class="field"><label for="weld_length">Estimated weld length (in)</label><input type="number" id="weld_length" name="weld_length" min="0" step="0.5"></div>
      </div>
    </div>

    <!-- Sandblasting details -->
    <div id="details_sandblasting" class="service-details" hidden>
      <div class="service-details-title">Sandblasting Details</div>
      <div class="field"><label for="sandblast_area">Surface area (sq ft) <span class="opt">(optional — auto-calculated from dimensions)</span></label><input type="number" id="sandblast_area" name="sandblast_area" min="0" step="0.1"></div>
    </div>

    <!-- Powder Coating details -->
    <div id="details_powder_coating" class="service-details" hidden>
      <div class="service-details-title">Powder Coating Details</div>
      <div class="row-2">
        <div class="field">
          <label for="powder_finish">Finish type</label>
          <select id="powder_finish" name="powder_finish">
            <option value="standard">Standard</option>
            <option value="custom">Custom color</option>
          </select>
        </div>
        <div class="field"><label for="powder_area">Surface area (sq ft) <span class="opt">(optional)</span></label><input type="number" id="powder_area" name="powder_area" min="0" step="0.1"></div>
      </div>
    </div>

    <!-- Plating details -->
    <div id="details_plating" class="service-details" hidden>
      <div class="service-details-title">Plating Details</div>
      <div class="field">
        <label for="plating_type">Plating type</label>
        <select id="plating_type" name="plating_type">
          <option value="zinc">Zinc</option>
          <option value="nickel">Nickel</option>
        </select>
      </div>
    </div>

    <!-- Assembly details -->
    <div id="details_assembly" class="service-details" hidden>
      <div class="service-details-title">Assembly / Kitting Details</div>
      <div class="row-2">
        <div class="field"><label for="assembly_components">Number of components</label><input type="number" id="assembly_components" name="assembly_components" min="1" step="1"></div>
        <div class="field"><label for="assembly_hours">Estimated assembly hours <span class="opt">(optional)</span></label><input type="number" id="assembly_hours" name="assembly_hours" min="0" step="0.5"></div>
      </div>
    </div>
  </div>

  <!-- Submit -->
  <div class="submit-wrap">
    <button type="submit" id="submit-btn">Send Quote Request</button>
    <div id="status" role="alert"></div>
  </div>

</form>
</div>

<script>
const WEBHOOK_URL = 'https://norrai.app.n8n.cloud/webhook/bnb-estimate';
const NORR_TOKEN  = '8F68D963-7060-4033-BD04-7593E4B203CB';

// ── Conditional service detail fields ─────────────────────────────────────────
const SERVICE_DETAIL_MAP = {
  svc_laser_cutting:  'details_laser_cutting',
  svc_waterjet:       'details_waterjet',
  svc_cnc_machining:  'details_cnc_machining',
  svc_press_brake:    'details_press_brake',
  svc_welding:        'details_welding',
  svc_sandblasting:   'details_sandblasting',
  svc_powder_coating: 'details_powder_coating',
  svc_plating:        'details_plating',
  svc_assembly:       'details_assembly',
};

Object.entries(SERVICE_DETAIL_MAP).forEach(([checkboxId, detailsId]) => {
  const checkbox = document.getElementById(checkboxId);
  const details  = document.getElementById(detailsId);
  if (!checkbox || !details) return;
  checkbox.addEventListener('change', () => {
    details.hidden = !checkbox.checked;
  });
});

// ── Form submission ────────────────────────────────────────────────────────────
document.getElementById('estimate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form   = e.target;
  const status = document.getElementById('status');
  const btn    = document.getElementById('submit-btn');

  status.className = '';
  status.style.display = 'none';
  status.textContent = '';

  // Required field validation
  const required = ['name', 'email', 'part_name', 'material_type', 'thickness', 'length', 'width', 'height', 'quantity'];
  for (const id of required) {
    const el = document.getElementById(id);
    if (!el || !el.value.trim()) {
      status.className = 'error';
      status.textContent = 'Please fill in all required fields.';
      el && el.focus();
      return;
    }
  }

  // Email format
  const emailEl = document.getElementById('email');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value.trim())) {
    status.className = 'error';
    status.textContent = 'Please enter a valid email address.';
    emailEl.focus();
    return;
  }

  // At least one service selected
  const serviceCheckboxes = Object.keys(SERVICE_DETAIL_MAP);
  const anySelected = serviceCheckboxes.some(id => document.getElementById(id)?.checked);
  if (!anySelected) {
    status.className = 'error';
    status.textContent = 'Please select at least one service.';
    return;
  }

  // Build services array
  const services = [];
  if (document.getElementById('svc_laser_cutting').checked) {
    services.push({ name: 'laser_cutting', max_cut_length: parseFloat(document.getElementById('laser_max_cut_length').value) || null, holes: parseInt(document.getElementById('laser_holes').value) || null });
  }
  if (document.getElementById('svc_waterjet').checked) {
    services.push({ name: 'waterjet', max_cut_length: parseFloat(document.getElementById('waterjet_max_cut_length').value) || null, holes: parseInt(document.getElementById('waterjet_holes').value) || null });
  }
  if (document.getElementById('svc_cnc_machining').checked) {
    services.push({ name: 'cnc_machining', setups: parseInt(document.getElementById('cnc_setups').value) || null, tolerance: document.getElementById('cnc_tolerance').value });
  }
  if (document.getElementById('svc_press_brake').checked) {
    services.push({ name: 'press_brake', bends: parseInt(document.getElementById('press_brake_bends').value) || null });
  }
  if (document.getElementById('svc_welding').checked) {
    services.push({ name: document.getElementById('weld_type').value + '_welding', weld_length_in: parseFloat(document.getElementById('weld_length').value) || null });
  }
  if (document.getElementById('svc_sandblasting').checked) {
    services.push({ name: 'sandblasting', surface_area_sqft: parseFloat(document.getElementById('sandblast_area').value) || null });
  }
  if (document.getElementById('svc_powder_coating').checked) {
    services.push({ name: 'powder_coating', finish_type: document.getElementById('powder_finish').value, surface_area_sqft: parseFloat(document.getElementById('powder_area').value) || null });
  }
  if (document.getElementById('svc_plating').checked) {
    services.push({ name: document.getElementById('plating_type').value + '_plating' });
  }
  if (document.getElementById('svc_deburring').checked) {
    services.push({ name: 'deburring' });
  }
  if (document.getElementById('svc_assembly').checked) {
    services.push({ name: 'assembly', components: parseInt(document.getElementById('assembly_components').value) || null, est_hours: parseFloat(document.getElementById('assembly_hours').value) || null });
  }

  const payload = {
    name:          document.getElementById('name').value.trim(),
    company:       document.getElementById('company').value.trim(),
    email:         document.getElementById('email').value.trim(),
    phone:         document.getElementById('phone').value.trim(),
    part_name:     document.getElementById('part_name').value.trim(),
    material_type: document.getElementById('material_type').value,
    thickness:     parseFloat(document.getElementById('thickness').value),
    length:        parseFloat(document.getElementById('length').value),
    width:         parseFloat(document.getElementById('width').value),
    height:        parseFloat(document.getElementById('height').value),
    weight:        parseFloat(document.getElementById('weight').value) || null,
    quantity:      parseInt(document.getElementById('quantity').value),
    notes:         document.getElementById('notes').value.trim(),
    services,
  };

  btn.disabled = true;
  btn.textContent = 'Sending…';

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Norr-Token': NORR_TOKEN },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    status.className = 'success';
    status.textContent = 'Your quote request has been sent. Check your email — you\'ll have an estimate within minutes.';
    form.reset();
    Object.values(SERVICE_DETAIL_MAP).forEach(id => { document.getElementById(id).hidden = true; });
  } catch (err) {
    status.className = 'error';
    status.textContent = 'Something went wrong. Please try again or email us directly.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send Quote Request';
  }
});
</script>
</body>
</html>
```

- [ ] **Step 2: Run tests — most should now pass**

```bash
npx playwright test tests/bnb_estimate_form.spec.js
```

Expected: all tests pass. Fix any failures before proceeding.

- [ ] **Step 3: Commit the form**

```bash
git add website/bnb_estimate_form.html
git commit -m "feat: add B&B Manufacturing estimate intake form"
```

---

## Task 3: Run the full test suite to confirm nothing broke

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: all 41 existing listing_form tests + all new bnb_estimate_form tests pass. Fix any failures before proceeding.

- [ ] **Step 2: Commit if any test fixes were needed**

Only commit if you had to fix something. Skip otherwise.

```bash
git add -p
git commit -m "fix: resolve test conflicts after adding bnb estimate form"
```

---

## Task 4: Build the n8n workflow

**Files:**
- Create: `n8n/workflows/B&B Manufacturing Estimate.json` (exported from n8n UI)

Build this workflow in the n8n UI at `norrai.app.n8n.cloud`. Each node is described below with exact configuration.

### Node 1: Webhook

- **Type:** Webhook
- **HTTP Method:** POST
- **Path:** `bnb-estimate`
- **Respond:** Immediately (return 200 before processing)
- **Name:** `Receive Estimate Request`

- [ ] **Step 1: Create the Webhook node and activate with test URL**

Set to `/webhook-test/bnb-estimate` during development. Switch to `/webhook/bnb-estimate` before production.

---

### Node 2: Token Check (IF node)

- **Type:** IF
- **Name:** `Valid Token?`
- **Condition:** `{{ $json.headers['x-norr-token'] }}` equals `8F68D963-7060-4033-BD04-7593E4B203CB`
- **True branch:** continue
- **False branch:** connect to a No-op / Stop node (or leave disconnected for demo)

- [ ] **Step 2: Add the Token Check IF node**

---

### Node 3: Build Prompt (Code node)

- **Type:** Code
- **Name:** `Build Claude Prompt`
- **Language:** JavaScript

- [ ] **Step 3: Add the Code node with this exact script**

```javascript
const body = $input.first().json.body;
const services = body.services || [];

// Format services for the prompt
const serviceLines = services.map(s => {
  const extra = Object.entries(s)
    .filter(([k]) => k !== 'name')
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `    ${k}: ${v}`)
    .join('\n');
  return `  - ${s.name}${extra ? '\n' + extra : ''}`;
}).join('\n');

const prompt = `You are an estimating assistant for B&B Manufacturing and Assembly, a precision metal fabrication shop in Faribault, MN.

Using the rate card and part specifications below, calculate a detailed estimate for each selected service. Return ONLY valid JSON — no explanation, no markdown code fences, no surrounding text.

RATE CARD:
Material costs (per lb): mild_steel=$0.85, stainless_steel=$2.20, aluminum=$1.90, other=$1.50
Machine rates (per hour): laser_cutting=$150, waterjet=$150, cnc_machining=$95, press_brake=$75, mig_welding=$85, tig_welding=$85, robotic_welding=$65, assembly=$45
Area rates (per sq ft): sandblasting=$3.50, powder_coating=$4.00, zinc_plating=$2.50, nickel_plating=$4.50, deburring=$1.50
Markup: 20% applied to subtotal

PART SPECIFICATIONS:
Part name: ${body.part_name}
Material: ${body.material_type}, ${body.thickness} inches thick
Dimensions: ${body.length}" L × ${body.width}" W × ${body.height}" H
Weight: ${body.weight ? body.weight + ' lbs' : 'not provided — estimate from dimensions × material density'}
Quantity: ${body.quantity}
Notes: ${body.notes || 'none'}

SELECTED SERVICES:
${serviceLines}

Instructions:
1. For material weight: if not provided, estimate — mild steel ~0.284 lb/cu in, stainless ~0.29 lb/cu in, aluminum ~0.098 lb/cu in. Use L×W×H×density for solid stock; reduce by 60% for sheet metal parts.
2. For each service, estimate time (hours) or area (sq ft) from the specs and service details.
3. Show your reasoning concisely in the "detail" field (e.g., "4 holes + perimeter cut ≈ 0.5 hrs").
4. cost = hours × rate OR sq_ft × rate.
5. material_cost = weight × material_rate × quantity.
6. subtotal = material_cost + sum of all service costs.
7. markup = subtotal × 0.20.
8. total = subtotal + markup.
9. lead_time: estimate based on services selected and quantity — e.g., laser only = 2–3 days; add welding = 4–5 days; add finishing = +2 days.

Return ONLY this JSON (no other text):
{
  "line_items": [
    { "service": "Display Name", "detail": "reasoning", "rate_label": "$150/hr", "cost": 75.00 }
  ],
  "material_cost": 42.50,
  "subtotal": 261.80,
  "markup": 52.36,
  "total": 314.16,
  "lead_time": "5–7 business days",
  "notes": "Any assumptions or caveats about this estimate."
}`;

return [{ json: { prompt, submitter_name: body.name, submitter_email: body.email, part_name: body.part_name, company: body.company, quantity: body.quantity, material_type: body.material_type } }];
```

---

### Node 4: Claude API (HTTP Request node)

- **Type:** HTTP Request
- **Name:** `Claude — Generate Estimate`
- **Method:** POST
- **URL:** `https://api.anthropic.com/v1/messages`
- **Authentication:** Predefined credential → Anthropic API
- **Headers:**
  - `anthropic-version`: `2023-06-01`
- **Body (JSON):**

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 1024,
  "messages": [
    {
      "role": "user",
      "content": "={{ $json.prompt }}"
    }
  ]
}
```

- [ ] **Step 4: Add the HTTP Request node with the configuration above**

---

### Node 5: Parse Response + Build Email HTML (Code node)

- **Type:** Code
- **Name:** `Parse + Build Email`
- **Language:** JavaScript

- [ ] **Step 5: Add the Code node with this exact script**

```javascript
const claudeResponse = $input.first().json;
const buildPromptData = $('Build Claude Prompt').first().json;

// Parse Claude's JSON response
const rawText = claudeResponse.content[0].text.trim();
let estimate;
try {
  estimate = JSON.parse(rawText);
} catch (e) {
  throw new Error('Claude returned invalid JSON: ' + rawText.slice(0, 200));
}

const { submitter_name, submitter_email, part_name, company, quantity, material_type } = buildPromptData;

// Build HTML email table rows
const itemRows = estimate.line_items.map(item => `
  <tr>
    <td style="padding:10px 14px;border-bottom:1px solid #E5E4DE;font-size:14px;">${item.service}</td>
    <td style="padding:10px 14px;border-bottom:1px solid #E5E4DE;font-size:13px;color:#6A6F78;">${item.detail}</td>
    <td style="padding:10px 14px;border-bottom:1px solid #E5E4DE;font-size:13px;color:#6A6F78;white-space:nowrap;">${item.rate_label}</td>
    <td style="padding:10px 14px;border-bottom:1px solid #E5E4DE;font-size:14px;text-align:right;white-space:nowrap;">$${item.cost.toFixed(2)}</td>
  </tr>`).join('');

const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FAFAF7;font-family:'Inter',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF7;padding:40px 20px;">
<tr><td>
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E4DE;border-radius:12px;overflow:hidden;">

  <!-- Header -->
  <tr><td style="background:#0A0F1A;padding:32px 36px;">
    <p style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#7FA9B8;margin:0 0 10px;">B&amp;B Manufacturing &amp; Assembly</p>
    <h1 style="font-size:26px;font-weight:700;color:#FAFAF7;margin:0;letter-spacing:-0.02em;">Your Estimate</h1>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:28px 36px 0;">
    <p style="font-size:15px;color:#0A0F1A;margin:0 0 8px;">Hi ${submitter_name},</p>
    <p style="font-size:14px;color:#6A6F78;margin:0;">Here is your estimate for <strong style="color:#0A0F1A;">${part_name}</strong>${company ? ' · ' + company : ''} (Qty: ${quantity}).</p>
  </td></tr>

  <!-- Line items table -->
  <tr><td style="padding:24px 36px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E4DE;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#FAFAF7;">
          <th style="padding:10px 14px;text-align:left;font-size:12px;font-weight:600;color:#3A3F48;letter-spacing:0.05em;text-transform:uppercase;">Service</th>
          <th style="padding:10px 14px;text-align:left;font-size:12px;font-weight:600;color:#3A3F48;letter-spacing:0.05em;text-transform:uppercase;">Detail</th>
          <th style="padding:10px 14px;text-align:left;font-size:12px;font-weight:600;color:#3A3F48;letter-spacing:0.05em;text-transform:uppercase;">Rate</th>
          <th style="padding:10px 14px;text-align:right;font-size:12px;font-weight:600;color:#3A3F48;letter-spacing:0.05em;text-transform:uppercase;">Cost</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:10px 14px;border-bottom:1px solid #E5E4DE;font-size:14px;">Material (${material_type.replace('_', ' ')})</td>
          <td style="padding:10px 14px;border-bottom:1px solid #E5E4DE;font-size:13px;color:#6A6F78;">estimated weight × rate × qty</td>
          <td style="padding:10px 14px;border-bottom:1px solid #E5E4DE;font-size:13px;color:#6A6F78;">/lb</td>
          <td style="padding:10px 14px;border-bottom:1px solid #E5E4DE;font-size:14px;text-align:right;">$${estimate.material_cost.toFixed(2)}</td>
        </tr>
        ${itemRows}
        <tr style="background:#FAFAF7;">
          <td colspan="3" style="padding:10px 14px;font-size:13px;color:#6A6F78;">Subtotal</td>
          <td style="padding:10px 14px;font-size:14px;text-align:right;">$${estimate.subtotal.toFixed(2)}</td>
        </tr>
        <tr style="background:#FAFAF7;">
          <td colspan="3" style="padding:10px 14px;font-size:13px;color:#6A6F78;">Markup (20%)</td>
          <td style="padding:10px 14px;font-size:14px;text-align:right;">$${estimate.markup.toFixed(2)}</td>
        </tr>
        <tr style="background:#0A0F1A;">
          <td colspan="3" style="padding:12px 14px;font-size:14px;font-weight:600;color:#FAFAF7;">Total</td>
          <td style="padding:12px 14px;font-size:16px;font-weight:700;color:#7FA9B8;text-align:right;">$${estimate.total.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>
  </td></tr>

  <!-- Lead time + notes -->
  <tr><td style="padding:20px 36px 0;">
    <p style="font-size:14px;color:#0A0F1A;margin:0 0 6px;"><strong>Estimated lead time:</strong> ${estimate.lead_time}</p>
    ${estimate.notes ? `<p style="font-size:13px;color:#6A6F78;margin:0;">${estimate.notes}</p>` : ''}
  </td></tr>

  <!-- Disclaimer + CTA -->
  <tr><td style="padding:20px 36px 28px;">
    <p style="font-size:12px;color:#9EA3AA;margin:0 0 16px;line-height:1.6;">This estimate is based on the specifications provided. Final pricing may vary upon drawing review. Quantities over 10 may qualify for volume pricing.</p>
    <p style="font-size:14px;color:#0A0F1A;margin:0;">Reply to this email to move forward or ask questions — we're happy to help.</p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#FAFAF7;border-top:1px solid #E5E4DE;padding:18px 36px;">
    <p style="font-size:12px;color:#9EA3AA;margin:0;">B&amp;B Manufacturing and Assembly · Faribault, MN</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

return [{ json: { emailHtml, submitter_name, submitter_email, part_name, estimate } }];
```

---

### Node 6: SendGrid Email

- **Type:** SendGrid
- **Name:** `Send Estimate Email`
- **Operation:** Send email
- **From:** `studio@norrai.co`
- **From Name:** `B&B Manufacturing`
- **To:** `={{ $json.submitter_email }}`
- **Subject:** `Estimate for {{ $json.part_name }} — B&B Manufacturing`
- **Email Type:** HTML
- **HTML:** `={{ $json.emailHtml }}`
- **Tracking:** Disable click tracking (prevents Promotions tab)

- [ ] **Step 6: Add the SendGrid node with the configuration above**

---

### Node 7: Neon — Insert Lead

- **Type:** Postgres
- **Name:** `Log Lead to Neon`
- **Credential:** NorrAI Postgres (DATABASE_URL from `.env`)
- **Operation:** Execute Query
- **Query:**

```sql
INSERT INTO leads (
  client_id,
  lead_name,
  email,
  phone,
  source,
  status,
  metadata
) VALUES (
  (SELECT id FROM clients WHERE name ILIKE '%B&B%' LIMIT 1),
  '{{ $('Parse + Build Email').first().json.submitter_name }}',
  '{{ $('Parse + Build Email').first().json.submitter_email }}',
  '{{ $('Receive Estimate Request').first().json.body.phone }}',
  'bnb_estimate_form',
  'new',
  '{{ JSON.stringify({
    company: $('Receive Estimate Request').first().json.body.company,
    part_name: $('Parse + Build Email').first().json.part_name,
    material: $('Receive Estimate Request').first().json.body.material_type,
    thickness: $('Receive Estimate Request').first().json.body.thickness,
    quantity: $('Receive Estimate Request').first().json.body.quantity,
    services: $('Receive Estimate Request').first().json.body.services.map(s => s.name),
    total_estimate: $('Parse + Build Email').first().json.estimate.total,
    lead_time: $('Parse + Build Email').first().json.estimate.lead_time
  }) }}'
);
```

> **Note:** In n8n's Postgres node, use the "Execute Query" operation. In the **Query** field use `$1, $2, ...` placeholders. In the **Query Parameters** field (below the query), list values as expressions — one per line — so n8n handles escaping. Never interpolate user data directly into the SQL string.

- [ ] **Step 7: Add the Neon Postgres node for lead logging**

---

### Node 8: Neon — Log Workflow Event

- **Type:** Postgres
- **Name:** `Log Workflow Event`
- **Operation:** Execute Query
- **Query:**

```sql
INSERT INTO workflow_events (
  client_id,
  workflow_name,
  event_type,
  status,
  metadata
) VALUES (
  (SELECT id FROM clients WHERE name ILIKE '%B&B%' LIMIT 1),
  'bnb_estimate',
  'estimate_sent',
  'success',
  '{{ JSON.stringify({ submitter_email: $('Parse + Build Email').first().json.submitter_email, part_name: $('Parse + Build Email').first().json.part_name, total: $('Parse + Build Email').first().json.estimate.total }) }}'
);
```

- [ ] **Step 8: Add the workflow event logging node**

---

### Wire and activate

- [ ] **Step 9: Connect all nodes in order**

```
Receive Estimate Request
  → Valid Token? [true branch]
    → Build Claude Prompt
      → Claude — Generate Estimate
        → Parse + Build Email
          → Send Estimate Email
            → Log Lead to Neon
              → Log Workflow Event
```

- [ ] **Step 10: Test with webhook-test URL using Hoppscotch**

Send this payload to `https://norrai.app.n8n.cloud/webhook-test/bnb-estimate`:

```json
{
  "name": "Test User",
  "company": "Test OEM",
  "email": "your-email@example.com",
  "phone": "5075550000",
  "part_name": "Hydraulic Tank Bracket",
  "material_type": "mild_steel",
  "thickness": 0.25,
  "length": 12,
  "width": 8,
  "height": 4,
  "weight": null,
  "quantity": 5,
  "notes": "Needs to withstand 3000 PSI",
  "services": [
    { "name": "laser_cutting", "max_cut_length": 12, "holes": 4 },
    { "name": "mig_welding", "weld_length_in": 24 },
    { "name": "powder_coating", "finish_type": "standard", "surface_area_sqft": null }
  ]
}
```

With header: `X-Norr-Token: 8F68D963-7060-4033-BD04-7593E4B203CB`

Expected: email arrives at `your-email@example.com` with a formatted line-item estimate.

- [ ] **Step 11: Switch webhook to production path and activate**

Change the Webhook node path from `webhook-test/bnb-estimate` to `webhook/bnb-estimate`. Toggle the workflow to Active.

- [ ] **Step 12: Export workflow JSON and commit**

In n8n: workflow menu → Download. Save to `n8n/workflows/B&B Manufacturing Estimate.json`.

```bash
git add n8n/workflows/"B&B Manufacturing Estimate.json"
git commit -m "feat: add B&B Manufacturing automated estimating workflow"
```

---

## Task 5: End-to-end smoke test from the form

- [ ] **Step 1: Open the form in a browser**

```bash
open website/bnb_estimate_form.html
```

Or load from the Cloudflare Pages URL if deployed.

- [ ] **Step 2: Submit a complete quote request with real email**

Fill all fields, select 3 services, submit. Verify:
- Success banner appears within ~5 seconds (webhook responds quickly)
- Estimate email arrives within 60 seconds
- Email shows correct line items, total, and lead time
- Neon `leads` table has a new row (check with `psql $DATABASE_URL -c "SELECT * FROM leads ORDER BY created_at DESC LIMIT 1;"`)

- [ ] **Step 3: Test token rejection**

Use Hoppscotch to POST to the production webhook with a wrong token. Verify the workflow stops at the IF node and no email is sent.

- [ ] **Step 4: Commit any fixes found during smoke test**

```bash
git add -p
git commit -m "fix: smoke test corrections for B&B estimate workflow"
```

---

## Task 6: Final commit and cleanup

- [ ] **Step 1: Run full test suite one final time**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Final commit**

```bash
git add website/bnb_estimate_form.html tests/bnb_estimate_form.spec.js "n8n/workflows/B&B Manufacturing Estimate.json"
git status
git commit -m "feat: B&B Manufacturing automated estimating workflow — form, n8n, tests"
```
