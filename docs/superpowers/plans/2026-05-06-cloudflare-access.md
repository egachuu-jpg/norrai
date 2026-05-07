# Cloudflare Zero Trust Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `website/` into `clients/` and `internal/` subfolders and configure Cloudflare Zero Trust Access to protect them with email OTP.

**Architecture:** Move 7 client-facing pages to `website/clients/` and 2 internal pages to `website/internal/`. Update 6 Playwright test files to reference new paths. Configure two Cloudflare Access applications (one per folder prefix) backed by two Access Groups (`clients`, `internal`). No n8n changes required.

**Tech Stack:** Bash (git mv), Playwright (test path updates), Cloudflare Zero Trust dashboard

---

## File Map

**Moved to `website/clients/`:**
- `website/listing_form.html`
- `website/lead_response.html`
- `website/open_house_setup.html`
- `website/nurture_enroll.html`
- `website/review_request.html`
- `website/lead_action_edit.html`
- `website/bnb_estimate_form.html`

**Moved to `website/internal/`:**
- `website/brand_concepts.html`
- `website/norrai_style_guide.html`

**Tests updated (FORM_URL constant only):**
- `tests/listing_form.spec.js`
- `tests/lead_response.spec.js`
- `tests/open_house_setup.spec.js`
- `tests/nurture_enroll.spec.js`
- `tests/review_request.spec.js`
- `tests/bnb_estimate_form.spec.js`

**Unchanged:** All public pages, `open_house.html`, n8n workflows, Cloudflare Pages build config.

---

## Task 1: Confirm Baseline

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: All tests pass. Note the count (e.g. "132 passed"). If anything is already failing, stop and fix it before proceeding.

---

## Task 2: Update Test Paths

Update the `FORM_URL` constant in each affected test file. Tests will fail after this step — that's expected. Files stay in their current location until Task 3.

- [ ] **Step 1: Update `tests/listing_form.spec.js` line 4**

Change:
```js
const FORM_URL = '/listing_form.html';
```
To:
```js
const FORM_URL = '/clients/listing_form.html';
```

- [ ] **Step 2: Update `tests/lead_response.spec.js` line 4**

Change:
```js
const FORM_URL = '/lead_response.html';
```
To:
```js
const FORM_URL = '/clients/lead_response.html';
```

- [ ] **Step 3: Update `tests/open_house_setup.spec.js` line 4**

Change:
```js
const FORM_URL = '/open_house_setup.html';
```
To:
```js
const FORM_URL = '/clients/open_house_setup.html';
```

- [ ] **Step 4: Update `tests/nurture_enroll.spec.js` line 4**

Change:
```js
const FORM_URL = '/nurture_enroll.html';
```
To:
```js
const FORM_URL = '/clients/nurture_enroll.html';
```

- [ ] **Step 5: Update `tests/review_request.spec.js` line 4**

Change:
```js
const FORM_URL  = '/review_request.html';
```
To:
```js
const FORM_URL  = '/clients/review_request.html';
```

- [ ] **Step 6: Update `tests/bnb_estimate_form.spec.js` line 3**

Change:
```js
const FORM_URL = '/bnb_estimate_form.html';
```
To:
```js
const FORM_URL = '/clients/bnb_estimate_form.html';
```

- [ ] **Step 7: Run the test suite — confirm it fails**

```bash
npm test
```

Expected: Tests for the 6 updated files fail with 404 or navigation errors. Tests for unchanged files (discovery_form, event_ops_discovery, onboarding_form, open_house) still pass. This confirms the path updates took effect.

---

## Task 3: Move Files

- [ ] **Step 1: Create the subdirectories and move client pages**

```bash
mkdir -p website/clients website/internal

git mv website/listing_form.html website/clients/listing_form.html
git mv website/lead_response.html website/clients/lead_response.html
git mv website/open_house_setup.html website/clients/open_house_setup.html
git mv website/nurture_enroll.html website/clients/nurture_enroll.html
git mv website/review_request.html website/clients/review_request.html
git mv website/lead_action_edit.html website/clients/lead_action_edit.html
git mv website/bnb_estimate_form.html website/clients/bnb_estimate_form.html
```

- [ ] **Step 2: Move internal pages**

```bash
git mv website/brand_concepts.html website/internal/brand_concepts.html
git mv website/norrai_style_guide.html website/internal/norrai_style_guide.html
```

- [ ] **Step 3: Verify the moves**

```bash
ls website/clients/
ls website/internal/
```

Expected:
```
website/clients/: listing_form.html  lead_response.html  open_house_setup.html  nurture_enroll.html  review_request.html  lead_action_edit.html  bnb_estimate_form.html
website/internal/: brand_concepts.html  norrai_style_guide.html
```

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: All tests pass — same count as Task 1 baseline. If anything fails, check the file was moved to the correct path and the test FORM_URL matches exactly.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move client and internal pages into subfolders for Cloudflare Access"
```

---

## Task 4: Configure Cloudflare Zero Trust

These are manual steps in the Cloudflare dashboard. No code changes.

### Step 1: Enable Zero Trust

- [ ] Go to [dash.cloudflare.com](https://dash.cloudflare.com) → your account → **Zero Trust** (left sidebar)
- [ ] If first time: choose a team name (e.g. `norrai`) → select **Free plan**

### Step 2: Create Access Groups

**Zero Trust → Access → Access Groups → Add a Group**

- [ ] Create group 1:
  - Name: `clients`
  - Include rule — Selector: `Emails` → add your email + any current agent/client emails
  - Save

- [ ] Create group 2:
  - Name: `internal`
  - Include rule — Selector: `Emails` → add your email only
  - Save

### Step 3: Create Access Applications

**Zero Trust → Access → Applications → Add an application → Self-hosted**

- [ ] Application 1 — Client Tools:
  - Application name: `Norr AI Client Tools`
  - Session duration: `7 days`
  - Application domain: `tools.norrai.co` / Path: `/clients`
  - Click **Next**
  - Policy name: `Client Access` / Action: Allow / Include: Group → `clients`
  - Save

- [ ] Application 2 — Internal:
  - Application name: `Norr AI Internal`
  - Session duration: `1 day`
  - Application domain: `tools.norrai.co` / Path: `/internal`
  - Click **Next**
  - Policy name: `Internal Access` / Action: Allow / Include: Group → `internal`
  - Save

### Step 4: Test Access

- [ ] Open an incognito window → go to `https://tools.norrai.co/clients/listing_form.html`
- [ ] Expected: Cloudflare Access login screen appears, prompts for email
- [ ] Enter your email → receive OTP → enter code → page loads
- [ ] Close and reopen incognito → go to same URL → should load without prompting (session cookie active)
- [ ] Open `https://tools.norrai.co/internal/brand_concepts.html` in incognito → same login flow
- [ ] Open `https://tools.norrai.co/open_house.html` in incognito → page loads with NO login prompt (public)

---

## Task 5: Add a Client (Reference)

When onboarding a new client:

1. Zero Trust → Access → Access Groups → `clients` → Edit
2. Under Include → Emails → add the client's email
3. Save

They will automatically have access to all `/clients/*` pages. No new applications needed.
