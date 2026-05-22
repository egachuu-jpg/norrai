# Weichert Realty Client Onboarding Materials — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a client guide page for Evan Knutson (Weichert Realty) at `website/clients/weichert_guide.html` and an internal Obsidian client record at `obsidian/clients/evan-knutson-weichert.md`.

**Architecture:** Single HTML page in the existing client portal (Cloudflare Access protected) with a `@media print` stylesheet for leave-behind PDF output. No JavaScript — static reference document. Obsidian file follows the existing `_template.md` structure. Playwright smoke test (low-risk static page) added per project testing standards.

**Tech Stack:** HTML/CSS, Playwright (smoke test only), Polar Modern design system (matching existing `/clients/` pages)

**Client details:**
- Name: Evan Knutson
- Neon client_id: `ded234e3-1c78-45c3-8924-6036e1fcaf60`
- Email: eknutson@teamyellownow.com
- Phone: 507-210-9140
- Business: Weichert, Realtors® - Heartland - Faribault
- Support contact: hello@norrai.co · 507-210-9774

---

## File Map

| Action | Path |
|--------|------|
| Create | `website/clients/weichert_guide.html` |
| Create | `tests/weichert_guide.spec.js` |
| Create | `obsidian/clients/evan-knutson-weichert.md` |

---

## Task 1: Write Playwright smoke test

**Files:**
- Create: `tests/weichert_guide.spec.js`

This is a low-risk static page (no JS, no form submission) — smoke test only per the project's risk-based coverage rules.

- [ ] **Step 1.1: Create the test file**

Create `tests/weichert_guide.spec.js` with this exact content:

```js
const { test, expect } = require('@playwright/test');

const URL = '/clients/weichert_guide.html';

test.describe('weichert_guide.html', () => {
  test('page loads with correct title', async ({ page }) => {
    await page.goto(URL);
    await expect(page).toHaveTitle('Your Automation System — Norr AI');
  });

  test('no JavaScript errors on load', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(URL);
    expect(errors).toHaveLength(0);
  });

  test('all 6 workflow sections present', async ({ page }) => {
    await page.goto(URL);
    for (const id of ['instant-lead-response', 'listing-description', 'open-house', 'cold-nurture', 'review-request', 'birthday-anniversary']) {
      await expect(page.locator(`#${id}`)).toBeVisible();
    }
  });

  test('5 tool buttons link to client pages', async ({ page }) => {
    await page.goto(URL);
    const buttons = page.locator('a.tool-btn');
    await expect(buttons).toHaveCount(5);
    const hrefs = await buttons.evaluateAll(els => els.map(el => el.getAttribute('href')));
    for (const href of hrefs) {
      expect(href).toMatch(/^\/clients\//);
    }
  });
});
```

- [ ] **Step 1.2: Run the test — confirm it fails**

```bash
npx playwright test tests/weichert_guide.spec.js
```

Expected: all 4 tests FAIL — `weichert_guide.html` does not exist yet. If any test passes unexpectedly, investigate before continuing.

---

## Task 2: Build `weichert_guide.html`

**Files:**
- Create: `website/clients/weichert_guide.html`

- [ ] **Step 2.1: Create the HTML file**

Create `website/clients/weichert_guide.html` with this exact content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your Automation System — Norr AI</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Inter+Tight:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="icon" type="image/svg+xml" href="/norr_ai_favicon.svg">
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

  /* ─── Header ─────────────────────────────────────────────────── */
  .site-header {
    background: var(--ink);
    padding: 48px 24px 44px;
    border-bottom: 1px solid #1e2535;
  }
  .site-header-inner { max-width: 720px; margin: 0 auto; }
  .eyebrow {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--glacial);
    margin-bottom: 12px;
  }
  .site-title {
    font-family: var(--font-display);
    font-size: 28px;
    font-weight: 700;
    color: #FFFFFF;
    line-height: 1.2;
  }

  /* ─── Layout ─────────────────────────────────────────────────── */
  .main { max-width: 720px; margin: 0 auto; padding: 40px 24px 80px; }

  /* ─── Intro ──────────────────────────────────────────────────── */
  .intro {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 24px 28px;
    margin-bottom: 40px;
  }
  .intro p { color: var(--secondary); font-size: 15px; margin-bottom: 12px; }
  .intro p:last-child { margin-bottom: 0; }
  .support-line { font-size: 14px; color: var(--muted); font-family: var(--font-mono); }
  .support-line a { color: var(--glacial); text-decoration: none; }

  /* ─── Table of contents ──────────────────────────────────────── */
  .toc { margin-bottom: 48px; }
  .toc-label {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 14px;
  }
  .toc-list { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; }
  .toc-list a {
    display: inline-block;
    font-size: 13px;
    color: var(--glacial);
    text-decoration: none;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 5px 12px;
    transition: border-color 0.15s;
  }
  .toc-list a:hover { border-color: var(--glacial); }

  /* ─── Workflow cards ─────────────────────────────────────────── */
  .workflow {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 28px 28px 24px;
    margin-bottom: 24px;
  }
  .workflow-number {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 8px;
  }
  .workflow-title {
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 700;
    color: var(--ink);
    margin-bottom: 16px;
  }
  .workflow-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
  @media (max-width: 560px) { .workflow-meta { grid-template-columns: 1fr; } }
  .meta-block-label {
    font-size: 11px;
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .meta-block p, .meta-block li { font-size: 14px; color: var(--secondary); }
  .meta-block ul { padding-left: 16px; }
  .meta-block li { margin-bottom: 2px; }
  .meta-block-full { margin-bottom: 20px; }
  .tool-btn {
    display: inline-block;
    background: var(--ink);
    color: #FFFFFF;
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 600;
    padding: 10px 20px;
    border-radius: var(--radius-md);
    text-decoration: none;
    transition: background 0.15s;
  }
  .tool-btn:hover { background: var(--graphite); }

  /* ─── Birthday & Anniversary callout ─────────────────────────── */
  .bday-callout {
    background: #F7F0EA;
    border: 1px solid #DECDBD;
    border-radius: var(--radius-md);
    padding: 16px 20px;
    margin-bottom: 20px;
  }
  .bday-callout p { font-size: 14px; color: var(--secondary); }

  /* ─── Google Sheet table ─────────────────────────────────────── */
  .sheet-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 12px; }
  .sheet-table th {
    text-align: left;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
  }
  .sheet-table td { padding: 7px 10px; border-bottom: 1px solid var(--border); color: var(--secondary); }
  .sheet-table tr:last-child td { border-bottom: none; }
  .sheet-table code {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink);
    background: var(--bone);
    padding: 1px 5px;
    border-radius: 3px;
  }
  .system-fills { color: var(--muted); font-style: italic; }

  /* ─── Footer ─────────────────────────────────────────────────── */
  .footer {
    margin-top: 64px;
    padding-top: 24px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }
  .footer-brand { font-family: var(--font-display); font-size: 14px; font-weight: 600; color: var(--muted); }
  .footer-support { font-size: 13px; color: var(--muted); }
  .footer-support a { color: var(--glacial); text-decoration: none; }

  /* ─── Print ──────────────────────────────────────────────────── */
  @media print {
    @page { margin: 0.9in; size: letter; }

    body { background: #fff; font-size: 12px; }

    .print-header {
      font-size: 10px;
      color: #888;
      text-align: right;
      margin-bottom: 8px;
      display: block;
    }

    .site-header {
      background: #fff !important;
      border-bottom: 2px solid #000;
      padding: 12px 0 10px;
    }
    .site-title { color: #000 !important; font-size: 20px; }
    .eyebrow { color: #555 !important; }

    .toc { display: none; }
    .main { padding: 20px 0; }

    .intro { border: 1px solid #ccc; padding: 12px 16px; margin-bottom: 20px; }
    .intro p { color: #333; }
    .support-line { color: #555; }
    .support-line a { color: #000; }

    .workflow {
      border: 1px solid #ccc;
      border-radius: 4px;
      padding: 14px;
      margin-bottom: 14px;
      break-inside: avoid;
    }
    .workflow-number { color: #999; }
    .workflow-title { font-size: 15px; }
    .meta-block p, .meta-block li { color: #333; }
    .meta-block-label { color: #888; }

    .tool-btn { display: none; }
    .tool-url {
      display: block;
      font-size: 11px;
      color: #333;
      margin-top: 6px;
      font-family: monospace;
    }

    .bday-callout { background: #f5f5f5; border: 1px solid #ccc; }
    .bday-callout p { color: #333; }

    .sheet-table th { color: #888; }
    .sheet-table td { color: #333; }
    .sheet-table code { background: #eee; }

    .footer { display: none; }
  }

  @media screen {
    .tool-url { display: none; }
    .print-header { display: none; }
  }
</style>
</head>
<body>

<div class="print-header">Norr AI — Evan Knutson · Weichert Realty</div>

<header class="site-header">
  <div class="site-header-inner">
    <div class="eyebrow">Evan Knutson · Weichert Realty</div>
    <h1 class="site-title">Your Automation System</h1>
  </div>
</header>

<main class="main">

  <div class="intro">
    <p>Your system runs 24/7 in the background — responding to new leads the moment they come in, following up with prospects who've gone quiet, and reaching past clients on the dates that matter. The tools below let you trigger specific workflows manually, enroll leads, and generate listing content.</p>
    <p class="support-line">Questions or issues: <a href="mailto:hello@norrai.co">hello@norrai.co</a> &nbsp;·&nbsp; <a href="tel:5072109774">507-210-9774</a></p>
  </div>

  <nav class="toc">
    <div class="toc-label">Jump to</div>
    <ul class="toc-list">
      <li><a href="#instant-lead-response">Lead Response</a></li>
      <li><a href="#listing-description">Listing Description</a></li>
      <li><a href="#open-house">Open House</a></li>
      <li><a href="#cold-nurture">Cold Nurture</a></li>
      <li><a href="#review-request">Review Request</a></li>
      <li><a href="#birthday-anniversary">Birthday &amp; Anniversary</a></li>
    </ul>
  </nav>

  <!-- ── 01: Instant Lead Response ─────────────────────────────── -->
  <section class="workflow" id="instant-lead-response">
    <div class="workflow-number">01</div>
    <h2 class="workflow-title">Instant Lead Response</h2>
    <div class="workflow-meta">
      <div class="meta-block">
        <div class="meta-block-label">What it does</div>
        <p>Sends a personalized text to a new lead within seconds, referencing their property inquiry by name and address. You get an email preview of the exact message that went out.</p>
      </div>
      <div class="meta-block">
        <div class="meta-block-label">When to use it</div>
        <p>Runs automatically when a lead arrives through BoldTrail. Use the form to manually trigger it for leads you want to re-engage the same day.</p>
      </div>
    </div>
    <div class="meta-block meta-block-full">
      <div class="meta-block-label">What to fill in</div>
      <ul>
        <li>Your name, email, and phone number</li>
        <li>Lead name, phone, and email</li>
        <li>Where the lead came from (Zillow, website, etc.)</li>
        <li>Property address and price range</li>
        <li>Beds, baths, and any standout features</li>
      </ul>
    </div>
    <a class="tool-btn" href="/clients/lead_response.html">→ Open Tool</a>
    <span class="tool-url">norrai.co/clients/lead_response.html</span>
  </section>

  <!-- ── 02: Listing Description Generator ─────────────────────── -->
  <section class="workflow" id="listing-description">
    <div class="workflow-number">02</div>
    <h2 class="workflow-title">Listing Description Generator</h2>
    <div class="workflow-meta">
      <div class="meta-block">
        <div class="meta-block-label">What it does</div>
        <p>Takes your property details and writes a full MLS description, a headline, and a social media post. Results land in your email inbox within about a minute.</p>
      </div>
      <div class="meta-block">
        <div class="meta-block-label">When to use it</div>
        <p>Any time you're writing copy for a new listing. Fill it in once — the system handles the writing.</p>
      </div>
    </div>
    <div class="meta-block meta-block-full">
      <div class="meta-block-label">What to fill in</div>
      <ul>
        <li>Property address</li>
        <li>Beds, baths, square footage, year built</li>
        <li>Key features — the more specific, the better</li>
        <li>Your email address for delivery</li>
      </ul>
    </div>
    <a class="tool-btn" href="/clients/listing_form.html">→ Open Tool</a>
    <span class="tool-url">norrai.co/clients/listing_form.html</span>
  </section>

  <!-- ── 03: Open House ─────────────────────────────────────────── -->
  <section class="workflow" id="open-house">
    <div class="workflow-number">03</div>
    <h2 class="workflow-title">Open House</h2>
    <div class="workflow-meta">
      <div class="meta-block">
        <div class="meta-block-label">What it does</div>
        <p>Generates a QR code and sign-in page for your open house. Attendees scan it at the door and fill in their contact info. The next morning, each attendee automatically gets a personalized follow-up text and email.</p>
      </div>
      <div class="meta-block">
        <div class="meta-block-label">When to use it</div>
        <p>Run Setup the day before each open house — print the QR code and post it at the entrance. Follow-up fires automatically the next morning. Nothing to do afterward.</p>
      </div>
    </div>
    <div class="meta-block meta-block-full">
      <div class="meta-block-label">What to fill in (Setup)</div>
      <ul>
        <li>Property address</li>
        <li>Your name and phone number</li>
        <li>Optional: a short note about the property shown on the sign-in page</li>
      </ul>
    </div>
    <a class="tool-btn" href="/clients/open_house_setup.html">→ Open Tool</a>
    <span class="tool-url">norrai.co/clients/open_house_setup.html</span>
  </section>

  <!-- ── 04: Cold Nurture Enrollment ───────────────────────────── -->
  <section class="workflow" id="cold-nurture">
    <div class="workflow-number">04</div>
    <h2 class="workflow-title">Cold Nurture Enrollment</h2>
    <div class="workflow-meta">
      <div class="meta-block">
        <div class="meta-block-label">What it does</div>
        <p>Enrolls a lead in a 7-touch, 60-day follow-up sequence. Each message is personalized to the lead's property interest and sent automatically — nothing to do after enrolling.</p>
      </div>
      <div class="meta-block">
        <div class="meta-block-label">When to use it</div>
        <p>When a lead has gone quiet after your initial outreach. Don't use it for brand-new leads — the instant response handles those.</p>
      </div>
    </div>
    <div class="meta-block meta-block-full">
      <div class="meta-block-label">What to fill in</div>
      <ul>
        <li>Your name, email, and phone</li>
        <li>Lead name, phone, and email</li>
        <li>Property address or area of interest</li>
        <li>Where the lead originally came from</li>
        <li>Their original inquiry message (if you have it)</li>
      </ul>
    </div>
    <a class="tool-btn" href="/clients/nurture_enroll.html">→ Open Tool</a>
    <span class="tool-url">norrai.co/clients/nurture_enroll.html</span>
  </section>

  <!-- ── 05: Review Request ─────────────────────────────────────── -->
  <section class="workflow" id="review-request">
    <div class="workflow-number">05</div>
    <h2 class="workflow-title">Review Request</h2>
    <div class="workflow-meta">
      <div class="meta-block">
        <div class="meta-block-label">What it does</div>
        <p>Sends your client a warm post-close message asking for a review, with a direct link to your Google or Zillow profile. Text and email, both sent at once.</p>
      </div>
      <div class="meta-block">
        <div class="meta-block-label">When to use it</div>
        <p>Within 1–2 days of closing. The client is happiest right after the keys change hands — that's the moment to ask.</p>
      </div>
    </div>
    <div class="meta-block meta-block-full">
      <div class="meta-block-label">What to fill in</div>
      <ul>
        <li>Client name, phone, and email</li>
        <li>Property address</li>
        <li>Your name and phone number</li>
      </ul>
    </div>
    <a class="tool-btn" href="/clients/review_request.html">→ Open Tool</a>
    <span class="tool-url">norrai.co/clients/review_request.html</span>
  </section>

  <!-- ── 06: Birthday & Anniversary Outreach ───────────────────── -->
  <section class="workflow" id="birthday-anniversary">
    <div class="workflow-number">06</div>
    <h2 class="workflow-title">Birthday &amp; Anniversary Outreach</h2>

    <div class="bday-callout">
      <p><strong>This one runs itself.</strong> Every morning at 9am, the system checks your contact list and automatically sends a warm email to anyone with a birthday or home purchase anniversary that day. No form to fill out — just keep your Google Sheet up to date.</p>
    </div>

    <div class="workflow-meta">
      <div class="meta-block">
        <div class="meta-block-label">What it does</div>
        <p>Sends a brief, personal email to past clients on their birthday and on the anniversary of their home purchase. No calls to action — pure relationship maintenance.</p>
      </div>
      <div class="meta-block">
        <div class="meta-block-label">When to use it</div>
        <p>Add new past clients to your Google Sheet any time after closing. The system picks them up on the next relevant date automatically.</p>
      </div>
    </div>

    <div class="meta-block">
      <div class="meta-block-label">Your Google Sheet — required columns</div>
      <table class="sheet-table">
        <thead>
          <tr>
            <th>Column name</th>
            <th>Format</th>
            <th>Example</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>lead_name</code></td>
            <td>Full name</td>
            <td>Sarah Johnson</td>
          </tr>
          <tr>
            <td><code>email</code></td>
            <td>Email address</td>
            <td>sarah@email.com</td>
          </tr>
          <tr>
            <td><code>phone</code></td>
            <td>10 digits, no dashes</td>
            <td>5075551234</td>
          </tr>
          <tr>
            <td><code>birthday</code></td>
            <td>MM-DD</td>
            <td>03-14</td>
          </tr>
          <tr>
            <td><code>transaction_anniversary</code></td>
            <td>YYYY-MM-DD</td>
            <td>2022-07-15</td>
          </tr>
          <tr>
            <td><code>property_address</code></td>
            <td>Street address</td>
            <td>412 Oak St, Faribault MN</td>
          </tr>
          <tr>
            <td><code>birthday_sent_year</code></td>
            <td class="system-fills" colspan="2">Leave blank — system fills this in</td>
          </tr>
          <tr>
            <td><code>anniversary_sent_year</code></td>
            <td class="system-fills" colspan="2">Leave blank — system fills this in</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <footer class="footer">
    <div class="footer-brand">Norr AI</div>
    <div class="footer-support">
      Questions: <a href="mailto:hello@norrai.co">hello@norrai.co</a> &nbsp;·&nbsp; <a href="tel:5072109774">507-210-9774</a>
    </div>
  </footer>

</main>
</body>
</html>
```

- [ ] **Step 2.2: Run the test — confirm it passes**

```bash
npx playwright test tests/weichert_guide.spec.js
```

Expected: all 4 tests PASS. If any fail, check:
- Title mismatch → verify `<title>` tag is exactly `Your Automation System — Norr AI`
- Section IDs missing → verify each `<section id="...">` matches the IDs in the test
- Button count wrong → count `<a class="tool-btn">` elements — should be exactly 5 (birthday section has no button)
- Href pattern failure → verify all 5 buttons link to `/clients/...`

- [ ] **Step 2.3: Run the full test suite to check for regressions**

```bash
npm test
```

Expected: all pre-existing tests continue to pass. This page has no JS and no shared resources — regressions are unlikely but always verify.

- [ ] **Step 2.4: Commit**

```bash
git add website/clients/weichert_guide.html tests/weichert_guide.spec.js
git commit -m "feat: add Weichert client guide page with print stylesheet"
```

---

## Task 3: Create Obsidian client record

**Files:**
- Create: `obsidian/clients/evan-knutson-weichert.md`

- [ ] **Step 3.1: Create the client file**

Create `obsidian/clients/evan-knutson-weichert.md` with this content:

```markdown
# Evan Knutson — Weichert Realty

**Tier:** Starter
**Vertical:** Real Estate
**Status:** active
**Since:** 2026-05-22

---

## Contact

| Field | Value |
|---|---|
| Primary contact | Evan Knutson |
| Email | eknutson@teamyellownow.com |
| Phone | 507-210-9140 |
| Business name | Weichert, Realtors® - Heartland - Faribault |
| City | Faribault, MN |

---

## Stack

| Field | Value |
|---|---|
| Neon `client_id` | `ded234e3-1c78-45c3-8924-6036e1fcaf60` |
| Twilio number | TBD — assign and record here |
| Twilio subaccount SID | TBD — assign and record here |
| Active workflows | Instant Lead Response, Listing Description Generator, Open House Setup, Open House Follow-Up, 7-Touch Cold Nurture, Review Request, Birthday & Anniversary Outreach |
| n8n workflow names | `instant_lead_response`, `listing_description`, `open_house_setup`, `open_house_follow_up`, `cold_nurture`, `review_request`, `bday_anniversary_outreach` |

---

## CRM & Integrations

- **CRM:** BoldTrail (kvCORE) — Weichert brokerage controls outbound webhooks directly
- **Webhook delivery:** Zapier Starter ($20/mo) required — free tier pauses after 2 weeks
- **BoldTrail lead field names:** `firstname`, `lastname`, `email`, `phone`, `origin`, `street`, `city`, `state`, `zip`
- **Nurture approach:** SMS-dominant — BoldTrail already sends automated listing alert emails, so email-heavy nurture creates overlap and looks automated

---

## Birthday & Anniversary

- Google Sheet ID: TBD — wire into workflow at onboarding, record here
- Evan maintains the Sheet directly (add past clients after each close)
- Sheet column format documented in `website/clients/weichert_guide.html`

---

## Why they hired us

Speed-to-lead and consistent follow-up. BoldTrail doesn't automate personalized outreach — leads were falling through while Evan was in showings. Wanted past clients to feel remembered between transactions without manual effort.

---

## Quirks & preferences

- Confirm Evan is on Zapier Starter plan (not free) at every check-in — free tier silently pauses
- Nurture is SMS-dominant — avoid stacking email sequences on top of BoldTrail's automated listing alerts
- Michelle Jasinski also at this office (same business name in Neon, `client_id: 451306d1-6437-42b8-8ffe-c16f28803490`) — potential future client

---

## History

- 2026-05-22 — Onboarding call, system handoff

---

## Open items

- [ ] Record Twilio subaccount number and SID above
- [ ] Get Google Sheet ID from Evan, wire into birthday & anniversary workflow, record above
- [ ] Confirm Evan is on Zapier Starter plan
```

- [ ] **Step 3.2: Commit**

```bash
git add obsidian/clients/evan-knutson-weichert.md
git commit -m "docs: add Evan Knutson Weichert client record"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] `weichert_guide.html` — Task 2
- [x] Print stylesheet — in Task 2 HTML (full `@media print` block)
- [x] All 6 workflow sections — Tasks 2 (01–06)
- [x] Birthday & Anniversary Google Sheet format — Task 2, section 06 table
- [x] Support contact (hello@norrai.co, 507-210-9774) — Task 2, intro and footer
- [x] Table of contents — Task 2, nav.toc
- [x] Obsidian client file — Task 3
- [x] Evan's actual contact info and client_id — wired into both files

**Placeholder scan:** No TBD, TODO, or incomplete steps in Tasks 1–3. The `TBD` values in the Obsidian file (Twilio number, Sheet ID) are real operational unknowns — not plan gaps.

**Type consistency:** No shared types or function signatures — this is HTML/CSS/Markdown only.
