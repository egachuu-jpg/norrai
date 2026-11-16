const { test, expect } = require('@playwright/test');

const PAGE = '/internal/drip_listings';
const WEICHERT_URL = 'https://northstar.weichert.com/MN/Rice/Faribault/';
const TOKEN = '8F68D963-7060-4033-BD04-7593E4B203CB';

// Mirrors the live Weichert results markup: price text runs into the bed count,
// and photos are lazy-loaded (the <img> src is a placeholder until scrolled).
function weichertCard({ mls, address, price, beds, office, lazy = true }) {
  const real = `//d36xftgacqn2p.cloudfront.net/listingphotos133/${mls}-1.jpg`;
  return `<div class="listing" data-mls="${mls}">
    <a class="propertyLink card-link" href="https://northstar.weichert.com/${mls}00/">View ${address}</a>
    <div class="card-image" data-images='{"img":"${real}"}'><img src="${lazy ? '/assets/v5/images/listings/photo-loading.png' : real}"></div>
    <div class="card-text-area">${price}<span class="bed">${beds}Beds</span><span class="bath">2.0Baths</span><span class="sq">1,632Sq.Ft.</span>
      <div class="card-text-address"><span class="card-address">${address}</span><span class="card-address2">Faribault, MN</span></div>
      <div class="card-text-misc">Courtesy of ${office}</div>
    </div>
  </div>`;
}

const WEICHERT_HTML = `<!DOCTYPE html><html><body>
  ${weichertCard({ mls: '7170710', address: '623 9th Street SW', price: '$239,900', beds: '3', office: 'Faribault - WEICHERT, REALTORS® - Heartland' })}
  ${weichertCard({ mls: '7171819', address: '319 8th Street NW', price: '$289,000', beds: '5', office: 'RE/MAX RESULTS' })}
  ${weichertCard({ mls: '7162251', address: '1520 Trailwood Lane SW', price: '$439,900', beds: '5', office: 'Faribault - WEICHERT, REALTORS® - Heartland', lazy: false })}
  ${weichertCard({ mls: '7170710', address: '623 9th Street SW', price: '$239,900', beds: '3', office: 'Faribault - WEICHERT, REALTORS® - Heartland' })}
</body></html>`;

const LISTINGS = [
  { mls_id: '7170710', address: '623 9th Street SW', price: '$239,900', beds: '3', baths: '2.0', sqft: '1,632', url: 'https://northstar.weichert.com/139327268/', photo_thumb_url: 'https://d36xftgacqn2p.cloudfront.net/listingphotos133/7170710-1.jpg' },
  { mls_id: '7162251', address: '1520 Trailwood Lane SW', price: '$439,900', beds: '5', baths: '2.1', sqft: '2,874', url: 'https://northstar.weichert.com/139063584/', photo_thumb_url: 'https://d36xftgacqn2p.cloudfront.net/listingphotos133/7162251-1.jpg' },
];

const hashFor = (listings) => '#d=' + encodeURIComponent(JSON.stringify(listings));

function mockIntake(page, { status = 200, body = { status: 'queued', queue_id: 'q-1', count: 2, superseded: 0 } } = {}) {
  return page.route('**/webhook/weekly-marketing-drip-intake', route =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  );
}

// Runs the bookmark's code on a fake Weichert page; returns what it opened/alerted.
async function runBookmarklet(page, { url = WEICHERT_URL, html = WEICHERT_HTML } = {}) {
  await page.goto(PAGE);
  const href = await page.locator('#bookmarklet').getAttribute('href');
  await page.route(url, route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto(url);
  await page.evaluate(() => {
    window.__opened = [];
    window.__alerts = [];
    window.open = (u) => { window.__opened.push(u); return {}; };
    window.alert = (m) => { window.__alerts.push(m); };
  });
  await page.evaluate(decodeURIComponent(href.replace(/^javascript:/, '')));
  return page.evaluate(() => ({ opened: window.__opened, alerts: window.__alerts }));
}

function listingsFromOpened(openedUrl) {
  return JSON.parse(decodeURIComponent(openedUrl.split('#d=')[1]));
}

// ─── 1. Page load ──────────────────────────────────────────────────────────────

test.describe('Page load', () => {
  test('loads with correct title and no console errors', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.goto(PAGE);
    await expect(page).toHaveTitle(/Drip Listings/);
    expect(errors).toHaveLength(0);
  });

  test('preview is hidden until listings arrive', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('#preview-card')).toBeHidden();
  });

  test('bookmarklet link is a javascript: bookmark', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('#bookmarklet')).toHaveAttribute('href', /^javascript:/);
  });

  test('clicking the bookmarklet on this page explains how to install it', async ({ page }) => {
    await page.goto(PAGE);
    await page.click('#bookmarklet');
    await expect(page.locator('#paste-msg')).toContainText('Drag the button');
  });
});

// ─── 2. Bookmarklet extraction ─────────────────────────────────────────────────

test.describe('Bookmarklet on the Weichert results page', () => {
  test('keeps only Heartland listings, de-duped', async ({ page }) => {
    const { opened } = await runBookmarklet(page);
    expect(opened).toHaveLength(1);
    const listings = listingsFromOpened(opened[0]);
    expect(listings.map(l => l.mls_id)).toEqual(['7170710', '7162251']);
  });

  test('opens the Drip Listings page with the listings in the hash', async ({ page }) => {
    const { opened } = await runBookmarklet(page);
    expect(opened[0]).toMatch(/^https:\/\/tools\.norrai\.co\/internal\/drip_listings#d=/);
  });

  test('extracts clean fields: price without the bed digit, numeric beds, real photo URL', async ({ page }) => {
    const { opened } = await runBookmarklet(page);
    const [lazy, loaded] = listingsFromOpened(opened[0]);
    expect(lazy).toEqual({
      mls_id: '7170710',
      address: '623 9th Street SW',
      price: '$239,900',
      beds: '3',
      baths: '2.0',
      sqft: '1,632',
      url: 'https://northstar.weichert.com/717071000/',
      photo_thumb_url: 'https://d36xftgacqn2p.cloudfront.net/listingphotos133/7170710-1.jpg',
    });
    expect(loaded.photo_thumb_url).toBe('https://d36xftgacqn2p.cloudfront.net/listingphotos133/7162251-1.jpg');
  });

  test('alerts instead of opening when no Heartland listings are on the page', async ({ page }) => {
    const html = `<html><body>${weichertCard({ mls: '7171819', address: '319 8th Street NW', price: '$289,000', beds: '5', office: 'RE/MAX RESULTS' })}</body></html>`;
    const { opened, alerts } = await runBookmarklet(page, { html });
    expect(opened).toHaveLength(0);
    expect(alerts[0]).toContain('No Heartland listings');
  });

  test('alerts when run on a non-Weichert site', async ({ page }) => {
    const { opened, alerts } = await runBookmarklet(page, { url: 'https://www.example.com/' });
    expect(opened).toHaveLength(0);
    expect(alerts[0]).toContain('Weichert');
  });
});

// ─── 3. Preview from the bookmark hash ─────────────────────────────────────────

test.describe('Preview', () => {
  test('renders one card per listing with price and details', async ({ page }) => {
    await page.goto(PAGE + hashFor(LISTINGS));
    await expect(page.locator('#preview-card')).toBeVisible();
    await expect(page.locator('.listing')).toHaveCount(2);
    await expect(page.locator('#listing-count')).toHaveText('2 listings');
    const first = page.locator('.listing').first();
    await expect(first.locator('.price')).toHaveText('$239,900');
    await expect(first.locator('.details')).toHaveText('3 bd · 2.0 ba · 1,632 sq ft');
  });

  test('drops listings without an MLS number or https link, and duplicates', async ({ page }) => {
    const bad = [
      ...LISTINGS,
      { mls_id: '', url: 'https://northstar.weichert.com/1/' },
      { mls_id: '7000001', url: 'javascript:alert(1)' },
      { ...LISTINGS[0] },
    ];
    await page.goto(PAGE + hashFor(bad));
    await expect(page.locator('.listing')).toHaveCount(2);
  });

  test('escapes HTML in listing text', async ({ page }) => {
    const evil = [{ ...LISTINGS[0], address: '<img src=x onerror="window.__xss=1">Evil St' }];
    await page.goto(PAGE + hashFor(evil));
    await expect(page.locator('.listing .address')).toHaveText('<img src=x onerror="window.__xss=1">Evil St');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('flags listings missing a price or photo', async ({ page }) => {
    await page.goto(PAGE + hashFor([{ ...LISTINGS[0], price: null, photo_thumb_url: null }]));
    await expect(page.locator('.listing .warn')).toHaveText('Missing: no price, no photo');
  });

  test('clears the payload from the URL after loading', async ({ page }) => {
    await page.goto(PAGE + hashFor(LISTINGS));
    await expect(page.locator('.listing')).toHaveCount(2);
    expect(new URL(page.url()).hash).toBe('');
  });

  test('Clear hides the preview', async ({ page }) => {
    await page.goto(PAGE + hashFor(LISTINGS));
    await page.click('#clear-btn');
    await expect(page.locator('#preview-card')).toBeHidden();
  });
});

// ─── 4. Paste fallback ─────────────────────────────────────────────────────────

test.describe('Paste fallback', () => {
  test('pasted JSON renders the preview', async ({ page }) => {
    await page.goto(PAGE);
    await page.fill('#paste-input', JSON.stringify(LISTINGS));
    await page.click('#paste-btn');
    await expect(page.locator('.listing')).toHaveCount(2);
  });

  test('invalid paste shows an error and no preview', async ({ page }) => {
    await page.goto(PAGE);
    await page.fill('#paste-input', 'not json');
    await page.click('#paste-btn');
    await expect(page.locator('#paste-msg')).toHaveClass(/error/);
    await expect(page.locator('#preview-card')).toBeHidden();
  });
});

// ─── 5. Submit ─────────────────────────────────────────────────────────────────

test.describe('Submit', () => {
  test('POSTs the listings with the expected shape and token', async ({ page }) => {
    await mockIntake(page);
    await page.goto(PAGE + hashFor(LISTINGS));
    const [req] = await Promise.all([
      page.waitForRequest(r => r.url().includes('weekly-marketing-drip-intake') && r.method() === 'POST'),
      page.click('#submit-btn'),
    ]);
    expect(req.headers()['x-norr-token']).toBe(TOKEN);
    expect(req.headers()['content-type']).toContain('application/json');
    expect(req.postDataJSON()).toEqual({ listings: LISTINGS });
  });

  test('shows success and locks the button', async ({ page }) => {
    await mockIntake(page);
    await page.goto(PAGE + hashFor(LISTINGS));
    await page.click('#submit-btn');
    await expect(page.locator('#status-msg')).toHaveText("Queued 2 listings for Monday's drip.");
    await expect(page.locator('#submit-btn')).toBeDisabled();
  });

  test('mentions when the batch replaces an earlier one', async ({ page }) => {
    await mockIntake(page, { body: { status: 'queued', queue_id: 'q-2', count: 2, superseded: 1 } });
    await page.goto(PAGE + hashFor(LISTINGS));
    await page.click('#submit-btn');
    await expect(page.locator('#status-msg')).toContainText('replaces the earlier batch');
  });

  test('webhook error shows an error and re-enables the button', async ({ page }) => {
    await mockIntake(page, { status: 500, body: { status: 'error' } });
    await page.goto(PAGE + hashFor(LISTINGS));
    await page.click('#submit-btn');
    await expect(page.locator('#status-msg')).toHaveClass(/error/);
    await expect(page.locator('#submit-btn')).toBeEnabled();
  });

  test('a 200 that did not queue is treated as an error', async ({ page }) => {
    await mockIntake(page, { body: { status: 'error', queue_id: null, count: 2 } });
    await page.goto(PAGE + hashFor(LISTINGS));
    await page.click('#submit-btn');
    await expect(page.locator('#status-msg')).toHaveClass(/error/);
  });
});
