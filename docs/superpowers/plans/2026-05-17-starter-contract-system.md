# Starter Contract System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a contract generator page and n8n recording workflow for Norr AI's Starter tier service agreement.

**Architecture:** An internal HTML page (`/internal/contract_generator`) lets Egan fill in client details, renders a formatted printable contract in-browser, and records the signed contract in Neon via an n8n webhook. No e-signature service required — client signs via email reply, print/scan, or their own DocuSign.

**Tech Stack:** HTML/CSS/JS (Polar Modern design system), Playwright (tests), n8n (workflow), Neon Postgres

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `tests/contract_generator.spec.js` | Create | Playwright tests — form validation, contract rendering, payload shape, UI states |
| `website/internal/contract_generator.html` | Create | Generator form, contract rendering, Mark as Signed section |
| `n8n/workflows/Norr AI Contract Signed.json` | Create | Webhook — upserts client in Neon, inserts service_contracts row |
| `CLAUDE.md` | Modify | Add `contract_signed` to workflow_name registry |

---

### Task 1: Write failing Playwright tests

**Files:**
- Create: `tests/contract_generator.spec.js`

- [ ] **Step 1: Write the test file**

```javascript
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
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/Egan/Documents/Claude/Projects/NorrAI
npx playwright test tests/contract_generator.spec.js --reporter=line
```

Expected: All tests fail — page does not exist yet. Error like `net::ERR_ABORTED` or `page.goto: net::ERR_FAILED`.

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/contract_generator.spec.js
git commit -m "test: add failing tests for contract_generator

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Build contract_generator.html

**Files:**
- Create: `website/internal/contract_generator.html`

- [ ] **Step 1: Create the HTML file**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Contract Generator — Norr AI</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Inter+Tight:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="icon" type="image/svg+xml" href="/norr_ai_favicon.svg">
<style>
  :root {
    --bone: #FAFAF7; --ink: #0A0F1A; --glacial: #7FA9B8; --graphite: #3A3F48;
    --blush: #E8D4C4; --surface: #FFFFFF; --border: #E5E4DE; --muted: #9EA3AA;
    --secondary: #6A6F78;
    --font-display: 'Inter Tight', sans-serif;
    --font-body: 'Inter', sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
    --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { font-size: 16px; -webkit-font-smoothing: antialiased; }
  body { font-family: var(--font-body); background: var(--bone); color: var(--ink); line-height: 1.5; min-height: 100dvh; }

  .site-header { background: var(--ink); padding: 40px 24px 36px; border-bottom: 1px solid #1e2535; }
  .site-header-inner { max-width: 800px; margin: 0 auto; }
  .eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--glacial); margin-bottom: 12px; }
  .site-header h1 { font-family: var(--font-display); font-weight: 700; font-size: 28px; letter-spacing: -0.03em; line-height: 1.1; color: var(--bone); }

  .wrap { max-width: 800px; margin: 0 auto; padding: 36px 24px 72px; display: flex; flex-direction: column; gap: 32px; }

  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 28px 32px; }
  .card h2 { font-family: var(--font-display); font-weight: 600; font-size: 18px; letter-spacing: -0.01em; margin-bottom: 20px; }

  .field-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
  .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  label { font-size: 13px; font-weight: 500; color: var(--secondary); }
  input, select {
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    padding: 10px 12px; font-size: 14px; font-family: var(--font-body);
    background: var(--surface); color: var(--ink);
    transition: border-color 0.15s; width: 100%;
  }
  input:focus, select:focus { outline: none; border-color: var(--glacial); }

  .btn-primary {
    background: var(--ink); color: var(--bone);
    border: none; border-radius: var(--radius-sm);
    padding: 12px 24px; font-family: var(--font-display); font-weight: 600;
    font-size: 14px; letter-spacing: -0.01em; cursor: pointer;
    transition: background 0.15s; margin-top: 8px;
  }
  .btn-primary:hover { background: var(--graphite); }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-secondary {
    background: transparent; color: var(--ink);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    padding: 10px 20px; font-family: var(--font-display); font-weight: 500;
    font-size: 13px; cursor: pointer; transition: border-color 0.15s;
  }
  .btn-secondary:hover { border-color: var(--glacial); }

  .contract-actions { display: flex; justify-content: flex-end; margin-bottom: 20px; }

  .contract-document {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-md); padding: 48px 56px;
    font-size: 13px; line-height: 1.65; color: var(--ink);
  }
  .contract-document .contract-header { text-align: center; margin-bottom: 32px; border-bottom: 2px solid var(--ink); padding-bottom: 20px; }
  .contract-document .contract-header h1 { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
  .contract-document .contract-header p { font-size: 13px; color: var(--secondary); margin-top: 4px; }
  .contract-document p { margin-bottom: 12px; }
  .contract-document h3 { font-family: var(--font-display); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; margin: 24px 0 8px; color: var(--ink); }
  .contract-document ul { margin: 8px 0 12px 20px; }
  .contract-document ul li { margin-bottom: 4px; }
  .contract-document .contract-intro { margin-bottom: 24px; }

  .signature-block { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 48px; padding-top: 32px; border-top: 1px solid var(--border); }
  .sig-col p { font-size: 13px; margin-bottom: 4px; line-height: 1.4; }
  .sig-line { border-bottom: 1px solid var(--ink); margin: 28px 0 8px; }
  .sig-date { margin-top: 16px !important; color: var(--secondary); }

  .status-msg { display: none; padding: 12px 16px; border-radius: var(--radius-sm); font-size: 13px; margin-top: 12px; }
  .status-msg.success { display: block; background: #F0FDF4; border: 1px solid #BBF7D0; color: #166534; }
  .status-msg.error   { display: block; background: #FEF2F2; border: 1px solid #FECACA; color: #B91C1C; }

  @media (max-width: 600px) {
    .field-row { grid-template-columns: 1fr; }
    .contract-document { padding: 28px 24px; }
    .signature-block { grid-template-columns: 1fr; gap: 32px; }
  }

  @media print {
    .no-print { display: none !important; }
    body { background: white; }
    .wrap { padding: 0; max-width: 100%; }
    #contract-preview { display: block !important; }
    .contract-actions { display: none !important; }
    .contract-document {
      border: none; padding: 0;
      font-size: 11pt; line-height: 1.6;
    }
    .contract-document .contract-header h1 { font-size: 16pt; }
    .contract-document h3 { font-size: 9pt; }
    .signature-block { break-inside: avoid; }
  }
</style>
</head>
<body>

<header class="site-header no-print">
  <div class="site-header-inner">
    <p class="eyebrow">Internal</p>
    <h1>Contract Generator</h1>
  </div>
</header>

<main class="wrap">

  <!-- Section A: Generate form -->
  <div class="card no-print" id="generate-card">
    <h2>Generate Contract</h2>
    <div class="field-row">
      <div class="field-group">
        <label for="contact_name">Client Name</label>
        <input type="text" id="contact_name" placeholder="Sarah Johnson" required>
      </div>
      <div class="field-group">
        <label for="business_name">Business Name</label>
        <input type="text" id="business_name" placeholder="Johnson Family Dental" required>
      </div>
    </div>
    <div class="field-group">
      <label for="contact_email">Contact Email</label>
      <input type="email" id="contact_email" placeholder="sarah@johnsondental.com" required>
    </div>
    <div class="field-row">
      <div class="field-group">
        <label for="monthly_price">Monthly Retainer ($)</label>
        <input type="number" id="monthly_price" placeholder="500" min="1" step="1" required>
      </div>
      <div class="field-group">
        <label for="setup_fee">Setup Fee ($)</label>
        <input type="number" id="setup_fee" placeholder="500" min="0" step="1" required>
      </div>
    </div>
    <div class="field-group">
      <label for="start_date">Contract Start Date</label>
      <input type="date" id="start_date" required>
    </div>
    <button type="button" class="btn-primary" id="generate-btn">Generate Contract</button>
  </div>

  <!-- Section B: Contract preview -->
  <div id="contract-preview" style="display:none">
    <div class="contract-actions no-print">
      <button type="button" class="btn-secondary" id="print-btn" onclick="window.print()">Print / Save as PDF</button>
    </div>
    <div id="contract-body" class="contract-document"></div>
  </div>

  <!-- Section C: Mark as Signed -->
  <div class="card no-print" id="sign-section" style="display:none">
    <h2>Mark as Signed</h2>
    <div class="field-row">
      <div class="field-group">
        <label for="signed_date">Signed Date</label>
        <input type="date" id="signed_date" required>
      </div>
      <div class="field-group">
        <label for="signed_via">Signed Via</label>
        <select id="signed_via">
          <option value="email_reply">Email reply ("I agree")</option>
          <option value="print_scan">Print, sign, scan, email back</option>
          <option value="docusign">DocuSign</option>
        </select>
      </div>
    </div>
    <button type="button" class="btn-primary" id="record-btn">Record Signature</button>
    <div id="sign-status" class="status-msg"></div>
  </div>

</main>

<script>
const WEBHOOK_URL = 'https://norrai.app.n8n.cloud/webhook/contract-signed';
const NORR_TOKEN  = '8F68D963-7060-4033-BD04-7593E4B203CB';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMoney(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function renderContract({ contact_name, business_name, contact_email, monthly_price, setup_fee, start_date }) {
  const n  = escapeHtml(contact_name);
  const b  = escapeHtml(business_name);
  const e  = escapeHtml(contact_email);
  const mp = fmtMoney(monthly_price);
  const sf = fmtMoney(setup_fee);
  const sd = fmtDate(start_date);

  return `
    <div class="contract-header">
      <h1>Service Agreement</h1>
      <p>Norr AI LLC</p>
    </div>

    <p class="contract-intro">This Service Agreement ("Agreement") is entered into as of <strong>${sd}</strong> between <strong>Norr AI LLC</strong>, a Minnesota limited liability company ("Norr AI"), and <strong>${b}</strong> ("Client").</p>

    <h3>1. Services</h3>
    <p>Norr AI will provide automation workflow services using n8n and Claude API technology, as mutually agreed upon in writing ("Services"). Services are template-based and do not include custom software development.</p>

    <h3>2. Fees and Payment</h3>
    <p>Client agrees to pay:</p>
    <ul>
      <li>A one-time setup fee of <strong>$${sf}</strong>, due upon execution of this Agreement.</li>
      <li>A monthly retainer of <strong>$${mp}</strong>, due on the same date each month beginning ${sd}.</li>
    </ul>
    <p>The setup fee is non-refundable. Invoices not paid within 15 days of the due date may result in suspension of services.</p>

    <h3>3. Term and Cancellation</h3>
    <p>This Agreement begins on ${sd} and continues month-to-month until terminated. Either party may terminate this Agreement with 30 days written notice to the other party. Upon termination, Client is responsible for fees accrued through the end of the notice period. The setup fee is non-refundable.</p>

    <h3>4. Ownership of Work Product</h3>
    <p>Norr AI retains ownership of all automation workflows, templates, infrastructure, and tooling developed or used in connection with the Services. Client retains ownership of its own business data processed through the Services.</p>

    <h3>5. Confidentiality</h3>
    <p>Each party agrees to keep confidential the other party's non-public business information disclosed in connection with this Agreement and to use such information solely for the purpose of fulfilling obligations hereunder.</p>

    <h3>6. No Guarantee of Results</h3>
    <p>Norr AI will apply reasonable skill and care in delivering the Services. Norr AI makes no guarantee of specific outcomes, including but not limited to lead volume, revenue, conversion rates, or any other business metric.</p>

    <h3>7. Limitation of Liability</h3>
    <p>Norr AI's total liability to Client for any claim arising out of or related to this Agreement shall not exceed the fees paid by Client to Norr AI in the 30 days preceding the claim. In no event shall Norr AI be liable for indirect, incidental, or consequential damages.</p>

    <h3>8. Governing Law</h3>
    <p>This Agreement is governed by the laws of the State of Minnesota. Any disputes shall be resolved in Rice County, Minnesota.</p>

    <h3>9. Entire Agreement</h3>
    <p>This Agreement constitutes the entire agreement between the parties regarding the Services and supersedes all prior discussions and agreements.</p>

    <div class="signature-block">
      <div class="sig-col">
        <p><strong>NORR AI LLC</strong></p>
        <div class="sig-line"></div>
        <p>Egan</p>
        <p>Norr AI LLC</p>
        <p>hello@norrai.co</p>
        <p class="sig-date">Date: _______________</p>
      </div>
      <div class="sig-col">
        <p><strong>CLIENT: ${b}</strong></p>
        <div class="sig-line"></div>
        <p>${n}</p>
        <p>${b}</p>
        <p>${e}</p>
        <p class="sig-date">Date: _______________</p>
      </div>
    </div>
  `;
}

document.getElementById('generate-btn').addEventListener('click', function () {
  const ids = ['contact_name', 'business_name', 'contact_email', 'monthly_price', 'setup_fee', 'start_date'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el.value.trim() || !el.checkValidity()) {
      el.reportValidity();
      return;
    }
  }

  const data = {
    contact_name:  document.getElementById('contact_name').value.trim(),
    business_name: document.getElementById('business_name').value.trim(),
    contact_email: document.getElementById('contact_email').value.trim(),
    monthly_price: document.getElementById('monthly_price').value,
    setup_fee:     document.getElementById('setup_fee').value,
    start_date:    document.getElementById('start_date').value,
  };

  document.getElementById('contract-body').innerHTML = renderContract(data);
  document.getElementById('contract-preview').style.display = 'block';
  document.getElementById('sign-section').style.display    = 'block';
  document.getElementById('contract-preview').scrollIntoView({ behavior: 'smooth' });
});

document.getElementById('record-btn').addEventListener('click', async function () {
  const signedDate = document.getElementById('signed_date').value;
  if (!signedDate) {
    document.getElementById('signed_date').reportValidity();
    return;
  }

  const btn      = this;
  const statusEl = document.getElementById('sign-status');
  btn.disabled    = true;
  btn.textContent = 'Recording\u2026';
  statusEl.className   = 'status-msg';
  statusEl.textContent = '';

  const payload = {
    contact_name:  document.getElementById('contact_name').value.trim(),
    business_name: document.getElementById('business_name').value.trim(),
    contact_email: document.getElementById('contact_email').value.trim(),
    monthly_price: parseFloat(document.getElementById('monthly_price').value),
    setup_fee:     parseFloat(document.getElementById('setup_fee').value),
    start_date:    document.getElementById('start_date').value,
    signed_date:   signedDate,
    signed_via:    document.getElementById('signed_via').value,
    tier:          'starter',
  };

  try {
    const res = await fetch(WEBHOOK_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Norr-Token': NORR_TOKEN,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    statusEl.textContent = 'Contract recorded in Neon.';
    statusEl.className   = 'status-msg success';
    btn.textContent      = 'Recorded';
  } catch {
    statusEl.textContent = 'Error recording contract. Try again or check n8n.';
    statusEl.className   = 'status-msg error';
    btn.disabled         = false;
    btn.textContent      = 'Record Signature';
  }
});
</script>
</body>
</html>
```

- [ ] **Step 2: Run contract generator tests**

```bash
npx playwright test tests/contract_generator.spec.js --reporter=line
```

Expected: All 20 tests pass.

- [ ] **Step 3: Run full test suite to confirm no regressions**

```bash
npm test
```

Expected: All tests pass (276 existing + 20 new).

- [ ] **Step 4: Commit**

```bash
git add website/internal/contract_generator.html
git commit -m "feat: add Starter contract generator page

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Build n8n Contract Signed workflow

**Files:**
- Create: `n8n/workflows/Norr AI Contract Signed.json`

- [ ] **Step 1: Create the workflow JSON**

The workflow: Webhook → Token Check → Sanitize Input → Upsert Client → Log Triggered → Insert Contract → Log Completed → Respond.

The "Sanitize Input" Code node escapes single quotes in string fields to prevent SQL errors on business names like "O'Brien Dental".

```json
{
  "name": "Norr AI Contract Signed",
  "nodes": [
    {
      "id": "node-webhook",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [250, 300],
      "webhookId": "contract-signed-webhook-001",
      "parameters": {
        "httpMethod": "POST",
        "path": "contract-signed",
        "responseMode": "responseNode",
        "options": {}
      }
    },
    {
      "id": "node-token-check",
      "name": "Token Check",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [450, 300],
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": true,
            "leftValue": "",
            "typeValidation": "strict"
          },
          "conditions": [
            {
              "id": "cond-token",
              "leftValue": "={{ $json.headers['x-norr-token'] }}",
              "rightValue": "8F68D963-7060-4033-BD04-7593E4B203CB",
              "operator": {
                "type": "string",
                "operation": "equals"
              }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      }
    },
    {
      "id": "node-sanitize",
      "name": "Sanitize Input",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [650, 300],
      "parameters": {
        "jsCode": "const body = $input.first().json.body;\nconst s = str => String(str || '').replace(/'/g, \"''\");\nreturn [{\n  json: {\n    contact_name:  s(body.contact_name),\n    business_name: s(body.business_name),\n    contact_email: s(body.contact_email),\n    monthly_price: parseFloat(body.monthly_price) || 0,\n    setup_fee:     parseFloat(body.setup_fee) || 0,\n    start_date:    s(body.start_date),\n    signed_date:   s(body.signed_date),\n    signed_via:    s(body.signed_via),\n    tier:          s(body.tier)\n  }\n}];"
      }
    },
    {
      "id": "node-upsert-client",
      "name": "Upsert Client",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [850, 300],
      "parameters": {
        "operation": "executeQuery",
        "query": "WITH existing AS (\n  SELECT id FROM clients\n  WHERE primary_contact_email = '{{ $json.contact_email }}'\n  LIMIT 1\n),\ninserted AS (\n  INSERT INTO clients (business_name, vertical, tier, status, primary_contact_name, primary_contact_email)\n  SELECT '{{ $json.business_name }}', 'tbd', 'starter', 'active', '{{ $json.contact_name }}', '{{ $json.contact_email }}'\n  WHERE NOT EXISTS (SELECT 1 FROM existing)\n  RETURNING id\n)\nSELECT COALESCE((SELECT id FROM existing), (SELECT id FROM inserted)) AS client_id",
        "options": {}
      },
      "credentials": {
        "postgres": {
          "id": "NEON_CREDENTIAL_ID",
          "name": "Neon Postgres"
        }
      }
    },
    {
      "id": "node-log-triggered",
      "name": "Log Triggered",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [1050, 300],
      "onError": "continueRegularOutput",
      "parameters": {
        "operation": "executeQuery",
        "query": "INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)\nVALUES (\n  '{{ $('Upsert Client').first().json.client_id }}'::uuid,\n  'contract_signed',\n  'triggered',\n  json_build_object('execution_id', '{{ $execution.id }}')\n)",
        "options": {}
      },
      "credentials": {
        "postgres": {
          "id": "NEON_CREDENTIAL_ID",
          "name": "Neon Postgres"
        }
      }
    },
    {
      "id": "node-insert-contract",
      "name": "Insert Contract",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [1250, 300],
      "parameters": {
        "operation": "executeQuery",
        "query": "INSERT INTO service_contracts (client_id, tier, monthly_price, setup_fee, start_date, status, notes)\nVALUES (\n  '{{ $('Upsert Client').first().json.client_id }}'::uuid,\n  'starter',\n  {{ $('Sanitize Input').first().json.monthly_price }},\n  {{ $('Sanitize Input').first().json.setup_fee }},\n  '{{ $('Sanitize Input').first().json.start_date }}'::date,\n  'active',\n  'Signed {{ $('Sanitize Input').first().json.signed_date }} via {{ $('Sanitize Input').first().json.signed_via }}'\n)",
        "options": {}
      },
      "credentials": {
        "postgres": {
          "id": "NEON_CREDENTIAL_ID",
          "name": "Neon Postgres"
        }
      }
    },
    {
      "id": "node-log-completed",
      "name": "Log Completed",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 2.5,
      "position": [1450, 300],
      "onError": "continueRegularOutput",
      "parameters": {
        "operation": "executeQuery",
        "query": "INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)\nVALUES (\n  '{{ $('Upsert Client').first().json.client_id }}'::uuid,\n  'contract_signed',\n  'completed',\n  json_build_object('execution_id', '{{ $execution.id }}')\n)",
        "options": {}
      },
      "credentials": {
        "postgres": {
          "id": "NEON_CREDENTIAL_ID",
          "name": "Neon Postgres"
        }
      }
    },
    {
      "id": "node-respond",
      "name": "Respond to Webhook",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [1650, 300],
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({success: true}) }}",
        "options": {}
      }
    }
  ],
  "connections": {
    "Webhook": {
      "main": [[{"node": "Token Check", "type": "main", "index": 0}]]
    },
    "Token Check": {
      "main": [
        [{"node": "Sanitize Input", "type": "main", "index": 0}],
        []
      ]
    },
    "Sanitize Input": {
      "main": [[{"node": "Upsert Client", "type": "main", "index": 0}]]
    },
    "Upsert Client": {
      "main": [[{"node": "Log Triggered", "type": "main", "index": 0}]]
    },
    "Log Triggered": {
      "main": [[{"node": "Insert Contract", "type": "main", "index": 0}]]
    },
    "Insert Contract": {
      "main": [[{"node": "Log Completed", "type": "main", "index": 0}]]
    },
    "Log Completed": {
      "main": [[{"node": "Respond to Webhook", "type": "main", "index": 0}]]
    }
  },
  "settings": {
    "errorWorkflow": "Norr AI Workflow Error Logger",
    "saveManualExecutions": true,
    "callerPolicy": "workflowsFromSameOwner"
  },
  "staticData": null,
  "meta": { "templateCredsSetupCompleted": true },
  "tags": []
}
```

- [ ] **Step 2: Commit**

```bash
git add "n8n/workflows/Norr AI Contract Signed.json"
git commit -m "feat: add Contract Signed n8n workflow

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Update CLAUDE.md registry and final commit

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add contract_signed to the workflow_name registry table in CLAUDE.md**

Find the table under `### Workflow Logging Standard` → `**workflow_name registry**` and add this row:

```
| Norr AI Contract Signed | `contract_signed` |
```

- [ ] **Step 2: Run full test suite one final time**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 3: Commit CLAUDE.md update**

```bash
git add CLAUDE.md
git commit -m "docs: add contract_signed to workflow_name registry

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Post-Implementation: n8n Setup Steps

After importing the workflow into n8n:
1. Open `Norr AI Contract Signed` in n8n
2. Click each Postgres node → update credential from `NEON_CREDENTIAL_ID` to your actual Neon Postgres credential
3. Settings tab → set Error Workflow to `Norr AI Workflow Error Logger`
4. Activate the workflow
5. Smoke test: fill the contract generator form, click Record Signature, verify row appears in `service_contracts` in Neon
