# Real Estate Review Request Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an agent-facing review request form and n8n workflow that sends a Claude-personalized SMS + email to a recently closed client after a configurable 1/3/7-day delay.

**Architecture:** Web form → n8n webhook (responds immediately) → Wait node (1/3/7 days) → Claude API → Parse + send SMS via Twilio → if email present, send via SendGrid v3 HTTP Request.

**Tech Stack:** HTML/JS (Polar Modern design), n8n Cloud (10 nodes), Claude API (Anthropic), Twilio SMS, SendGrid v3 API, Playwright tests.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `tests/review_request.spec.js` | Create | Playwright tests for the form |
| `website/review_request.html` | Create | Agent-facing form with localStorage profile |
| `n8n/workflows/Real Estate Review Request.json` | Create | 10-node n8n workflow |
| `n8n/TESTING_NOTES.md` | Modify | Add review request section |

---

### Task 1: Write failing tests

**Files:**
- Create: `tests/review_request.spec.js`

- [ ] **Step 1: Create the test file**

```javascript
// tests/review_request.spec.js
const { test, expect } = require('@playwright/test');

const FORM_URL  = '/review_request.html';
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
```

- [ ] **Step 2: Run tests — confirm they all fail (form doesn't exist yet)**

```bash
cd /Users/Egan/Documents/Claude/Projects/NorrAI
npx playwright test tests/review_request.spec.js
```

Expected: all tests fail with "page.goto: net::ERR_FILE_NOT_FOUND" or similar — the HTML file doesn't exist yet.

---

### Task 2: Build website/review_request.html

**Files:**
- Create: `website/review_request.html`

- [ ] **Step 1: Create the form**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Review Request — Norr AI</title>
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

  .site-header {
    background: var(--ink);
    padding: 48px 24px 44px;
    border-bottom: 1px solid #1e2535;
  }
  .site-header-inner { max-width: 680px; margin: 0 auto; }
  .eyebrow {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--glacial);
    margin-bottom: 14px;
  }
  .site-header h1 {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 34px;
    letter-spacing: -0.03em;
    line-height: 1.05;
    color: var(--bone);
    margin-bottom: 12px;
  }
  .site-header h1 .accent { color: var(--glacial); }
  .site-header p {
    font-size: 14px;
    color: var(--muted);
    line-height: 1.6;
    max-width: 480px;
  }

  .wrap {
    max-width: 680px;
    margin: 0 auto;
    padding: 48px 24px 80px;
  }

  form { display: flex; flex-direction: column; gap: 28px; }

  .section {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .section-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 24px;
    border-bottom: 1px solid var(--border);
    background: var(--bone);
  }
  .section-num {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--glacial);
    background: rgba(127,169,184,0.12);
    border: 1px solid rgba(127,169,184,0.25);
    border-radius: 4px;
    padding: 2px 6px;
    letter-spacing: 0.05em;
  }
  .section-title {
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--ink);
  }
  .section-body { padding: 24px; }

  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 18px; }
  .field:last-child { margin-bottom: 0; }

  label {
    font-size: 12px;
    font-weight: 500;
    color: var(--secondary);
    letter-spacing: 0.01em;
  }
  label .req { color: var(--glacial); margin-left: 2px; }
  label .opt { font-weight: 400; color: var(--muted); margin-left: 4px; }

  input, select, textarea {
    width: 100%;
    background: var(--bone);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 10px 12px;
    color: var(--ink);
    font-family: var(--font-body);
    font-size: 14px;
    transition: border-color 0.15s, box-shadow 0.15s;
    appearance: none;
  }
  input::placeholder, textarea::placeholder { color: var(--muted); }
  input:focus, select:focus, textarea:focus {
    outline: none;
    border-color: var(--glacial);
    box-shadow: 0 0 0 3px rgba(127,169,184,0.15);
    background: var(--surface);
  }
  select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239EA3AA' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 36px;
  }

  .hint {
    font-size: 11px;
    color: var(--muted);
    line-height: 1.5;
    margin-top: 5px;
  }

  .submit-area { display: flex; flex-direction: column; gap: 12px; }

  button[type="submit"] {
    width: 100%;
    background: var(--ink);
    color: var(--bone);
    border: none;
    padding: 15px 24px;
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background 0.15s, transform 0.1s;
  }
  button[type="submit"]:hover:not(:disabled) { background: var(--graphite); }
  button[type="submit"]:active:not(:disabled) { transform: scale(0.99); }
  button[type="submit"]:disabled { opacity: 0.5; cursor: not-allowed; }

  .status {
    display: none;
    padding: 14px 16px;
    border-radius: var(--radius-md);
    font-size: 14px;
    line-height: 1.5;
  }
  .status.show { display: block; }
  .status.success { background: var(--success-bg); border: 1px solid #A7F3C4; color: var(--success); }
  .status.error   { background: var(--error-bg);   border: 1px solid #FECACA; color: var(--error); }

  footer {
    margin-top: 40px;
    text-align: center;
    font-size: 12px;
    color: var(--muted);
  }
  footer a { color: var(--muted); text-decoration: none; }
  footer a:hover { color: var(--secondary); }

  @media (max-width: 580px) {
    .row { grid-template-columns: 1fr; }
    .site-header { padding: 36px 18px 32px; }
    .wrap { padding: 32px 18px 64px; }
    .section-body { padding: 18px; }
  }
</style>
</head>
<body>

<header class="site-header">
  <div class="site-header-inner">
    <div class="eyebrow">Norr AI · Real Estate</div>
    <h1>Review<br><span class="accent">Request</span></h1>
    <p>After closing, send a warm, personalized review request via SMS and email. Claude writes it — you just fill in the details.</p>
  </div>
</header>

<div class="wrap">
  <form id="review-form" novalidate>

    <!-- 01 Agent Profile -->
    <div class="section">
      <div class="section-head">
        <span class="section-num">01</span>
        <span class="section-title">Your Profile</span>
        <span id="agent-saved-badge" style="display:none; font-family:var(--font-mono); font-size:10px; color:var(--glacial); margin-left:auto; align-items:center; gap:6px;">
          · saved
          <button type="button" id="clear-agent" style="font-family:var(--font-mono); font-size:10px; color:var(--muted); background:none; border:none; cursor:pointer; padding:0; text-decoration:underline;">clear</button>
        </span>
      </div>
      <div class="section-body">
        <div class="field">
          <label for="agent_name">Your name <span class="req">*</span></label>
          <input type="text" id="agent_name" name="agent_name" autocomplete="name" placeholder="Jane Smith" required>
        </div>
        <div class="field">
          <label for="google_url">Google review link <span class="req">*</span></label>
          <input type="url" id="google_url" name="google_url" placeholder="https://g.page/r/your-review-link" required>
          <div class="hint">Find this in your Google Business Profile → Ask for reviews.</div>
        </div>
        <div class="field">
          <label for="zillow_url">Zillow review link <span class="opt">(optional)</span></label>
          <input type="url" id="zillow_url" name="zillow_url" placeholder="https://zillow.com/profile/your-name">
        </div>
      </div>
    </div>

    <!-- 02 Closed Client -->
    <div class="section">
      <div class="section-head">
        <span class="section-num">02</span>
        <span class="section-title">Closed Client</span>
      </div>
      <div class="section-body">
        <div class="field">
          <label for="client_name">Client first name <span class="req">*</span></label>
          <input type="text" id="client_name" name="client_name" placeholder="Sarah" required>
        </div>
        <div class="row">
          <div class="field">
            <label for="client_phone">Client phone <span class="req">*</span></label>
            <input type="tel" id="client_phone" name="client_phone" placeholder="5075551234" required>
          </div>
          <div class="field">
            <label for="client_email">Client email <span class="opt">(optional)</span></label>
            <input type="email" id="client_email" name="client_email" placeholder="sarah@gmail.com">
          </div>
        </div>
      </div>
    </div>

    <!-- 03 Transaction -->
    <div class="section">
      <div class="section-head">
        <span class="section-num">03</span>
        <span class="section-title">Transaction</span>
      </div>
      <div class="section-body">
        <div class="row">
          <div class="field">
            <label for="transaction_type">Transaction type <span class="req">*</span></label>
            <select id="transaction_type" name="transaction_type" required>
              <option value="buyer">Buyer</option>
              <option value="seller">Seller</option>
            </select>
          </div>
          <div class="field">
            <label for="delay_days">Send review request</label>
            <select id="delay_days" name="delay_days">
              <option value="1">In 1 day</option>
              <option value="3" selected>In 3 days</option>
              <option value="7">In 7 days</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label for="property_address">Property address <span class="req">*</span></label>
          <input type="text" id="property_address" name="property_address" placeholder="123 Maple St, Faribault, MN 55021" required>
        </div>
      </div>
    </div>

    <!-- Submit -->
    <div class="submit-area">
      <div id="status" class="status" role="alert"></div>
      <button type="submit" id="submit-btn">Send Review Request →</button>
    </div>

  </form>

  <footer>
    <p>Norr AI &nbsp;·&nbsp; <a href="mailto:hello@norrai.co">hello@norrai.co</a> &nbsp;·&nbsp; <a href="https://norrai.co">norrai.co</a></p>
  </footer>
</div>

<script>
  // ─── Config ───────────────────────────────────────────────────────────────
  const WEBHOOK_URL = 'https://norrai.app.n8n.cloud/webhook/review-request';
  const AGENT_KEY   = 'norrai_agent_profile_review';

  // ─── Agent persistence ────────────────────────────────────────────────────
  const agentBadge = document.getElementById('agent-saved-badge');

  function showAgentBadge() { agentBadge.style.display = 'flex'; }
  function hideAgentBadge() { agentBadge.style.display = 'none'; }

  function loadAgent() {
    const saved = JSON.parse(localStorage.getItem(AGENT_KEY) || 'null');
    if (!saved) return;
    document.getElementById('agent_name').value = saved.agent_name || '';
    document.getElementById('google_url').value  = saved.google_url  || '';
    document.getElementById('zillow_url').value  = saved.zillow_url  || '';
    if (saved.agent_name) showAgentBadge();
  }

  function saveAgent(payload) {
    localStorage.setItem(AGENT_KEY, JSON.stringify({
      agent_name: payload.agent_name,
      google_url: payload.google_url,
      zillow_url: payload.zillow_url,
    }));
  }

  document.getElementById('clear-agent').addEventListener('click', () => {
    localStorage.removeItem(AGENT_KEY);
    ['agent_name', 'google_url', 'zillow_url'].forEach(id => {
      document.getElementById(id).value = '';
    });
    hideAgentBadge();
  });

  loadAgent();

  // ─── Form submission ──────────────────────────────────────────────────────
  const form   = document.getElementById('review-form');
  const btn    = document.getElementById('submit-btn');
  const status = document.getElementById('status');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const fd = new FormData(form);

    const payload = {
      agent_name:       fd.get('agent_name')       || '',
      google_url:       fd.get('google_url')        || '',
      zillow_url:       fd.get('zillow_url')        || '',
      client_name:      fd.get('client_name')       || '',
      client_phone:     fd.get('client_phone')      || '',
      client_email:     fd.get('client_email')      || '',
      transaction_type: fd.get('transaction_type')  || 'buyer',
      property_address: fd.get('property_address')  || '',
      delay_days:       Number(fd.get('delay_days') || 3),
      submitted_at:     new Date().toISOString(),
      source_form:      'review_request_web',
    };

    status.className = 'status';
    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Norr-Token': '8F68D963-7060-4033-BD04-7593E4B203CB',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`Server returned ${res.status}`);

      saveAgent(payload);
      showAgentBadge();

      const delayText = payload.delay_days === 1 ? 'tomorrow' : `in ${payload.delay_days} days`;
      status.textContent = `✓ Review request for ${payload.client_name} is scheduled — it goes out ${delayText} via SMS${payload.client_email ? ' and email' : ''}.`;
      status.className = 'status success show';

      // Clear client + transaction fields, keep agent profile
      ['client_name', 'client_phone', 'client_email', 'property_address'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      document.getElementById('transaction_type').value = 'buyer';
      document.getElementById('delay_days').value = '3';

      status.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    } catch (err) {
      status.textContent = `Something went wrong: ${err.message}. Try again or email hello@norrai.co.`;
      status.className = 'status error show';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send Review Request →';
    }
  });
</script>
</body>
</html>
```

- [ ] **Step 2: Run tests — confirm they pass**

```bash
npx playwright test tests/review_request.spec.js
```

Expected: all tests pass. If any fail, fix the HTML before proceeding.

- [ ] **Step 3: Run full suite — confirm nothing regressed**

```bash
npm test
```

Expected: all tests pass (previously 132; now 132 + new review request tests).

- [ ] **Step 4: Commit**

```bash
git add website/review_request.html tests/review_request.spec.js
git commit -m "feat: add review request form and tests"
```

---

### Task 3: Build n8n/workflows/Real Estate Review Request.json

**Files:**
- Create: `n8n/workflows/Real Estate Review Request.json`

- [ ] **Step 1: Create the workflow JSON**

```json
{
  "name": "Real Estate Review Request",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "review-request",
        "responseMode": "onReceived",
        "options": {}
      },
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2.1,
      "position": [240, 144],
      "id": "d1e2f3a4-0001-4000-8000-000000000001",
      "name": "Receive Review Request",
      "webhookId": "review-request-webhook-001"
    },
    {
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": true,
            "leftValue": "",
            "typeValidation": "loose",
            "version": 3
          },
          "conditions": [
            {
              "id": "token-check-review-001",
              "leftValue": "={{ $json.headers[\"x-norr-token\"] }}",
              "rightValue": "8F68D963-7060-4033-BD04-7593E4B203CB",
              "operator": {
                "type": "string",
                "operation": "equals"
              }
            }
          ],
          "combinator": "and"
        },
        "looseTypeValidation": true,
        "options": {}
      },
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.3,
      "position": [432, 224],
      "id": "d1e2f3a4-0002-4000-8000-000000000002",
      "name": "Token Check"
    },
    {
      "parameters": {
        "jsCode": "const body = $input.first().json.body;\n\nreturn [{\n  json: {\n    agent_name:       body.agent_name       || '',\n    google_url:       body.google_url       || '',\n    zillow_url:       body.zillow_url       || '',\n    client_name:      body.client_name      || '',\n    client_phone:     '+1' + (body.client_phone || '').replace(/\\D/g, ''),\n    client_email:     body.client_email     || '',\n    transaction_type: body.transaction_type || 'buyer',\n    property_address: body.property_address || '',\n    delay_days:       Number(body.delay_days) || 3,\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [640, 144],
      "id": "d1e2f3a4-0003-4000-8000-000000000003",
      "name": "Prep Fields"
    },
    {
      "parameters": {
        "resume": "timeInterval",
        "amount": "={{ $json.delay_days }}",
        "unit": "days",
        "options": {}
      },
      "type": "n8n-nodes-base.wait",
      "typeVersion": 1.1,
      "position": [848, 144],
      "id": "d1e2f3a4-0004-4000-8000-000000000004",
      "name": "Wait"
    },
    {
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "id": "set-prompt-review-001",
              "name": "prompt",
              "value": "=You are a real estate assistant helping agent {{ $('Prep Fields').first().json.agent_name }} request a review from a recently closed client.\n\nClient: {{ $('Prep Fields').first().json.client_name }}\nTransaction: {{ $('Prep Fields').first().json.transaction_type }} (buyer = they purchased a home; seller = they sold a home)\nProperty: {{ $('Prep Fields').first().json.property_address }}\nAgent: {{ $('Prep Fields').first().json.agent_name }}\n\nWrite three things in exactly this format:\n\nSMS:\n<A warm, conversational message under 160 characters. For buyers, reference 'your new home at [property]'. For sellers, reference 'a successful sale at [property]'. Ask for an honest review and say it only takes a minute. Do NOT include any URLs — they will be appended automatically.>\n\nEMAIL_SUBJECT:\n<Warm subject line under 60 characters>\n\nEMAIL_BODY:\n<2-3 short paragraphs. Warm congratulations on the transaction. Explain that a review helps other families find trusted help, and that it takes just a minute. Sign off from {{ $('Prep Fields').first().json.agent_name }}. Do NOT include any URLs — they will be added automatically.>\n\nReturn ONLY these three labeled sections. No extra commentary, no quotation marks.",
              "type": "string"
            }
          ]
        },
        "options": {}
      },
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [1056, 144],
      "id": "d1e2f3a4-0005-4000-8000-000000000005",
      "name": "Build Claude Prompt"
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.anthropic.com/v1/messages",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "anthropicApi",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "anthropic-version", "value": "2023-06-01" },
            { "name": "content-type",      "value": "application/json" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"model\": \"claude-sonnet-4-20250514\",\n  \"max_tokens\": 400,\n  \"messages\": [\n    {\n      \"role\": \"user\",\n      \"content\": {{ JSON.stringify($json.prompt) }}\n    }\n  ]\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [1264, 144],
      "id": "d1e2f3a4-0006-4000-8000-000000000006",
      "name": "Claude API",
      "credentials": {
        "anthropicApi": {
          "id": "gXqu8TiqvDY4mUPZ",
          "name": "Anthropic account 2"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "const text = $input.first().json.content[0].text;\nconst prep = $('Prep Fields').first().json;\n\nfunction extract(label, str) {\n  const re = new RegExp(label + ':\\\\s*([\\\\s\\\\S]*?)(?=\\\\n[A-Z_]+:|$)');\n  const m = str.match(re);\n  return m ? m[1].trim() : '';\n}\n\nconst smsText      = extract('SMS', text);\nconst emailSubject = extract('EMAIL_SUBJECT', text);\nconst emailBodyRaw = extract('EMAIL_BODY', text);\n\n// Build SMS — append links\nconst linkLines = ['', '\\u2b50 Leave a review:'];\nif (prep.google_url) linkLines.push('Google: ' + prep.google_url);\nif (prep.zillow_url) linkLines.push('Zillow: ' + prep.zillow_url);\nconst smsMessage = smsText + linkLines.join('\\n');\n\n// Build email HTML\nconst esc = s => (s || '').replace(/&/g, '&amp;');\nconst linkHtml = [\n  prep.google_url ? `<a href=\"${esc(prep.google_url)}\" style=\"color:#7FA9B8;\">Leave a Google review</a>` : '',\n  prep.zillow_url ? `<a href=\"${esc(prep.zillow_url)}\" style=\"color:#7FA9B8;\">Leave a Zillow review</a>` : '',\n].filter(Boolean).join(' &nbsp;&middot;&nbsp; ');\n\nconst bodyHtml = emailBodyRaw\n  .replace(/&/g, '&amp;')\n  .replace(/</g, '&lt;')\n  .replace(/>/g, '&gt;')\n  .replace(/\\n\\n/g, '</p><p style=\"font-size:15px;color:#3A3F48;line-height:1.6;margin:0 0 16px;\">')\n  .replace(/\\n/g, '<br>');\n\nconst emailHtml = [\n  '<div style=\"font-family:\\'Inter\\',Arial,sans-serif;max-width:520px;margin:0 auto;color:#0A0F1A;\">',\n  '  <div style=\"background:#0A0F1A;padding:32px 32px 28px;border-radius:8px 8px 0 0;\">',\n  '    <p style=\"font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#7FA9B8;margin:0 0 10px;\">Review Request</p>',\n  `    <h1 style=\"font-size:22px;font-weight:700;color:#FAFAF7;margin:0;letter-spacing:-0.02em;\">${emailSubject.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</h1>`,\n  '  </div>',\n  '  <div style=\"background:#FFFFFF;padding:32px;border:1px solid #E5E4DE;border-top:none;border-radius:0 0 8px 8px;\">',\n  `    <p style=\"font-size:15px;color:#3A3F48;line-height:1.6;margin:0 0 16px;\">${bodyHtml}</p>`,\n  `    <p style=\"font-size:14px;margin:0 0 28px;\">${linkHtml}</p>`,\n  '    <hr style=\"border:none;border-top:1px solid #E5E4DE;margin:0 0 20px;\">',\n  '    <p style=\"font-size:12px;color:#9EA3AA;margin:0;\">Norr AI &nbsp;&middot;&nbsp; <a href=\"https://norrai.co\" style=\"color:#9EA3AA;\">norrai.co</a></p>',\n  '  </div>',\n  '</div>',\n].join('\\n');\n\nreturn [{\n  json: {\n    sms_message:   smsMessage,\n    email_subject: emailSubject,\n    email_html:    emailHtml,\n    client_phone:  prep.client_phone,\n    client_email:  prep.client_email,\n  }\n}];"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1472, 144],
      "id": "d1e2f3a4-0007-4000-8000-000000000007",
      "name": "Parse + Build Email"
    },
    {
      "parameters": {
        "from": "+18XXXXXXXXXX",
        "to": "={{ $json.client_phone }}",
        "message": "={{ $json.sms_message }}",
        "options": {}
      },
      "type": "n8n-nodes-base.twilio",
      "typeVersion": 1,
      "position": [1680, 144],
      "id": "d1e2f3a4-0008-4000-8000-000000000008",
      "name": "Send SMS",
      "credentials": {
        "twilioApi": {
          "id": "TWILIO_CREDENTIAL_ID",
          "name": "Twilio account"
        }
      }
    },
    {
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": false,
            "leftValue": "",
            "typeValidation": "loose",
            "version": 3
          },
          "conditions": [
            {
              "id": "has-email-review-001",
              "leftValue": "={{ $('Parse + Build Email').first().json.client_email }}",
              "rightValue": "",
              "operator": {
                "type": "string",
                "operation": "notEquals"
              }
            }
          ],
          "combinator": "and"
        },
        "looseTypeValidation": true,
        "options": {}
      },
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.3,
      "position": [1888, 224],
      "id": "d1e2f3a4-0009-4000-8000-000000000009",
      "name": "Has Email?"
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.sendgrid.com/v3/mail/send",
        "authentication": "genericCredentialType",
        "nodeCredentialType": "httpHeaderAuth",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Content-Type", "value": "application/json" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"personalizations\": [{\"to\": [{\"email\": \"{{ $('Parse + Build Email').first().json.client_email }}\"}]}],\n  \"from\": {\"email\": \"studio@norrai.co\", \"name\": \"Norr AI\"},\n  \"subject\": {{ JSON.stringify($('Parse + Build Email').first().json.email_subject) }},\n  \"content\": [{\"type\": \"text/html\", \"value\": {{ JSON.stringify($('Parse + Build Email').first().json.email_html) }}}]\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.4,
      "position": [2096, 144],
      "id": "d1e2f3a4-0010-4000-8000-000000000010",
      "name": "Send Email",
      "credentials": {
        "httpHeaderAuth": {
          "id": "SENDGRID_HEADER_AUTH",
          "name": "SendGrid Header Auth"
        }
      }
    }
  ],
  "pinData": {},
  "connections": {
    "Receive Review Request": {
      "main": [[{ "node": "Token Check", "type": "main", "index": 0 }]]
    },
    "Token Check": {
      "main": [[{ "node": "Prep Fields", "type": "main", "index": 0 }]]
    },
    "Prep Fields": {
      "main": [[{ "node": "Wait", "type": "main", "index": 0 }]]
    },
    "Wait": {
      "main": [[{ "node": "Build Claude Prompt", "type": "main", "index": 0 }]]
    },
    "Build Claude Prompt": {
      "main": [[{ "node": "Claude API", "type": "main", "index": 0 }]]
    },
    "Claude API": {
      "main": [[{ "node": "Parse + Build Email", "type": "main", "index": 0 }]]
    },
    "Parse + Build Email": {
      "main": [[{ "node": "Send SMS", "type": "main", "index": 0 }]]
    },
    "Send SMS": {
      "main": [[{ "node": "Has Email?", "type": "main", "index": 0 }]]
    },
    "Has Email?": {
      "main": [
        [{ "node": "Send Email", "type": "main", "index": 0 }],
        []
      ]
    }
  },
  "active": false,
  "settings": {
    "executionOrder": "v1",
    "binaryMode": "separate"
  },
  "versionId": "review-request-v1-001",
  "meta": {
    "templateCredsSetupCompleted": false,
    "instanceId": "0d4efb408d47ca7fe5f9bfa9b6b5b1a6e6f8fcb31cb2584a172b735d47653914"
  },
  "id": "",
  "tags": []
}
```

- [ ] **Step 2: After import into n8n, fix credentials**

In n8n after importing:
1. **Anthropic node** → verify "Anthropic account 2" (`gXqu8TiqvDY4mUPZ`) is linked. Should auto-resolve if on the same n8n instance.
2. **Twilio node** → open node, select your Twilio credential, replace `+18XXXXXXXXXX` with your actual number.
3. **Send Email node** → select "SendGrid Header Auth" credential (create it if not yet done: Header Auth → Name: `Authorization` → Value: `Bearer SG.your-api-key`).
4. Activate the workflow.

- [ ] **Step 3: Commit the workflow JSON**

```bash
git add "n8n/workflows/Real Estate Review Request.json"
git commit -m "feat: add review request n8n workflow (10 nodes)"
```

---

### Task 4: Update n8n/TESTING_NOTES.md

**Files:**
- Modify: `n8n/TESTING_NOTES.md`

- [ ] **Step 1: Add review request section** — append to the end of the file (before the Production Promotion Checklist section):

```markdown
---

## Real Estate Review Request

**Workflow file:** `n8n/workflows/Real Estate Review Request.json`
**Form file:** `website/review_request.html`
**Webhook path:** `/webhook/review-request`

### Before testing
1. Open **Send SMS** node → select your Twilio credential, replace `+18XXXXXXXXXX` with your number.
2. Open **Send Email** node → select "SendGrid Header Auth" credential. Create it in n8n Credentials if needed: type "Header Auth", Name: `Authorization`, Value: `Bearer SG.your-api-key`.
3. Open **Claude API** node → verify "Anthropic account 2" credential is linked.
4. Activate the workflow.

### Wait node testing
The Wait node pauses execution for 1, 3, or 7 days. To test without waiting: go to **Executions**, find the paused execution, click **Resume**. This fires the Claude → SMS → Email path immediately.

### Test checklist
- [ ] Submit as Buyer — verify Claude message says "new home" not "sale"
- [ ] Submit as Seller — verify Claude message says "sale" not "new home"
- [ ] Submit with no Zillow URL — verify only Google link appears in SMS and email
- [ ] Submit with no client email — verify SMS fires, Has Email? node routes to false branch (no SendGrid error)
- [ ] Submit with 1-day delay → manually resume → confirm messages arrive
- [ ] Submit with 3-day delay (default) → manually resume → confirm messages arrive
- [ ] Submit with 7-day delay → manually resume → confirm messages arrive
- [ ] Submit with invalid token → confirm no execution runs (check Executions log)

### Known gaps / edge cases
- **Phone double-prefix** — Prep Fields strips non-digits and prepends `+1`. If client enters `15075551234`, you'll get `+115075551234` which Twilio rejects. Document this for agents: enter 10-digit numbers only.
- **No unsubscribe handling** — Twilio honors STOP replies at the carrier level. n8n will log an error for opted-out numbers but won't halt.
```

- [ ] **Step 2: Commit**

```bash
git add n8n/TESTING_NOTES.md
git commit -m "docs: add review request section to TESTING_NOTES"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run the full test suite one more time**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Confirm new test count is reported in output**

The test count should be higher than the previous 132. Playwright will print the total count at the end of the run.
