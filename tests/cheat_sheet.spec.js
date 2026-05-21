const { test, expect } = require('@playwright/test');

test('cheat sheet loads with correct title and no JS errors', async ({ page }) => {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('net::ERR_')) errors.push(msg.text());
  });

  await page.goto('/clients/cheat_sheet.html');
  await expect(page).toHaveTitle('Your Norr AI Tools — Quick Reference');
  expect(errors).toHaveLength(0);
});

test('cheat sheet renders all five tool cards', async ({ page }) => {
  await page.goto('/clients/cheat_sheet.html');
  const cards = page.locator('.tool-name');
  await expect(cards).toHaveCount(5);
  await expect(cards.nth(0)).toContainText('Instant Lead Response');
  await expect(cards.nth(1)).toContainText('Listing Description Generator');
  await expect(cards.nth(2)).toContainText('Open House Sign-In');
  await expect(cards.nth(3)).toContainText('Cold Nurture Enrollment');
  await expect(cards.nth(4)).toContainText('Review Request');
});

test('cheat sheet shows the always-on missed call card', async ({ page }) => {
  await page.goto('/clients/cheat_sheet.html');
  await expect(page.locator('.auto-badge')).toContainText('Always on');
  await expect(page.locator('.auto-name')).toContainText('Missed Call');
});

test('tool links point to correct client pages', async ({ page }) => {
  await page.goto('/clients/cheat_sheet.html');
  const links = page.locator('.tool-link');
  await expect(links.nth(0)).toHaveAttribute('href', '/clients/lead_response.html');
  await expect(links.nth(1)).toHaveAttribute('href', '/clients/listing_form.html');
  await expect(links.nth(2)).toHaveAttribute('href', '/clients/open_house_setup.html');
  await expect(links.nth(3)).toHaveAttribute('href', '/clients/nurture_enroll.html');
  await expect(links.nth(4)).toHaveAttribute('href', '/clients/review_request.html');
});
