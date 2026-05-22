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
