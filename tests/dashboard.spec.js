const { test, expect } = require('@playwright/test');

const MOCK_HEALTH = {
  generated_at: '2026-05-08T12:00:00.000Z',
  clients: [
    {
      id: 'uuid-1',
      business_name: 'Johnson Realty',
      vertical: 'real_estate',
      tier: 'starter',
      status: 'red',
      workflows: [
        { workflow_name: 'instant_lead_response', status: 'red', last_triggered_at: '2026-05-01T09:00:00Z', last_failed_at: '2026-05-07T14:23:00Z', failures_7d: 2 }
      ]
    },
    {
      id: 'uuid-2',
      business_name: 'Sunrise Dental',
      vertical: 'dental',
      tier: 'growth',
      status: 'yellow',
      workflows: [
        { workflow_name: 'appointment_reminder', status: 'yellow', last_triggered_at: null, last_failed_at: null, failures_7d: 0 }
      ]
    },
    {
      id: 'uuid-3',
      business_name: 'Apex Insurance',
      vertical: 'insurance',
      tier: 'starter',
      status: 'green',
      workflows: [
        { workflow_name: 'renewal_reminder', status: 'green', last_triggered_at: '2026-05-07T10:00:00Z', last_failed_at: null, failures_7d: 0 }
      ]
    }
  ]
};

function mockHealth(page, response = MOCK_HEALTH, status = 200) {
  return page.route('**/webhook/client-health', route =>
    route.fulfill({ status, body: JSON.stringify(response), contentType: 'application/json' })
  );
}

test('page loads with correct title', async ({ page }) => {
  await mockHealth(page);
  await page.goto('/internal/dashboard.html');
  await expect(page).toHaveTitle('Client Health — Norr AI');
});

test('renders three client cards', async ({ page }) => {
  await mockHealth(page);
  await page.goto('/internal/dashboard.html');
  await expect(page.locator('.client-card')).toHaveCount(3);
});

test('red client card appears first', async ({ page }) => {
  await mockHealth(page);
  await page.goto('/internal/dashboard.html');
  const firstCard = page.locator('.client-card').first();
  await expect(firstCard).toContainText('Johnson Realty');
  await expect(firstCard.locator('.status-dot')).toHaveAttribute('data-status', 'red');
});

test('green client card appears last', async ({ page }) => {
  await mockHealth(page);
  await page.goto('/internal/dashboard.html');
  const lastCard = page.locator('.client-card').last();
  await expect(lastCard).toContainText('Apex Insurance');
  await expect(lastCard.locator('.status-dot')).toHaveAttribute('data-status', 'green');
});

test('each card shows workflow list', async ({ page }) => {
  await mockHealth(page);
  await page.goto('/internal/dashboard.html');
  const firstCard = page.locator('.client-card').first();
  await expect(firstCard).toContainText('instant_lead_response');
});

test('each card shows vertical and tier', async ({ page }) => {
  await mockHealth(page);
  await page.goto('/internal/dashboard.html');
  const firstCard = page.locator('.client-card').first();
  await expect(firstCard).toContainText('real estate');
  await expect(firstCard).toContainText('Starter');
});

test('shows error state when fetch fails', async ({ page }) => {
  await page.route('**/webhook/client-health', route => route.fulfill({ status: 500, body: '' }));
  await page.goto('/internal/dashboard.html');
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('.client-grid')).not.toBeVisible();
});

test('refresh button triggers a second fetch', async ({ page }) => {
  let fetchCount = 0;
  await page.route('**/webhook/client-health', route => {
    fetchCount++;
    return route.fulfill({ status: 200, body: JSON.stringify(MOCK_HEALTH), contentType: 'application/json' });
  });
  await page.goto('/internal/dashboard.html');
  await page.locator('.client-card').first().waitFor();
  await page.locator('#refresh-btn').click();
  await page.locator('.client-card').first().waitFor();
  expect(fetchCount).toBe(2);
});

test('sends X-Norr-Token header', async ({ page }) => {
  let tokenSent;
  await page.route('**/webhook/client-health', route => {
    tokenSent = route.request().headers()['x-norr-token'];
    return route.fulfill({ status: 200, body: JSON.stringify(MOCK_HEALTH), contentType: 'application/json' });
  });
  await page.goto('/internal/dashboard.html');
  await page.locator('.client-card').first().waitFor();
  expect(tokenSent).toBeTruthy();
});

test('shows empty state when no active clients', async ({ page }) => {
  await mockHealth(page, { generated_at: '2026-05-08T12:00:00Z', clients: [] });
  await page.goto('/internal/dashboard.html');
  await expect(page.locator('.client-grid')).toContainText('No active clients');
});
