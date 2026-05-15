const { test, expect } = require('@playwright/test');

const MOCK_DATA = {
  generated_at: '2026-05-15T12:00:00.000Z',
  stories: [
    {
      id: 'story-1',
      title: 'Build Buyer Briefing Generator',
      description: 'Pre-showing briefing emailed to buyer automatically',
      outcome: 'buyer_briefing.html live, tests passing',
      status: 'active',
      priority: 'high',
      tags: [],
      tasks: [
        { id: 'task-1', story_id: 'story-1', title: 'Research form fields', category: 'research', priority: 'high', status: 'ready', seq: 1, description: 'What fields?', context: 'See PRD', output: null, tags: [] },
        { id: 'task-2', story_id: 'story-1', title: 'Build buyer_briefing.html', category: 'dev', priority: 'high', status: 'backlog', seq: 2, description: null, context: null, output: null, tags: [] }
      ]
    },
    {
      id: 'story-2',
      title: 'Pre-First Client Security Hardening',
      description: 'Address security gaps before first live client',
      outcome: 'Rate limiting added, PII encrypted',
      status: 'active',
      priority: 'high',
      tags: [],
      tasks: [
        { id: 'task-3', story_id: 'story-2', title: 'Evaluate Token Check approach', category: 'research', priority: 'medium', status: 'ready', seq: 1, description: null, context: null, output: null, tags: [] }
      ]
    }
  ],
  standalone: [
    { id: 'task-4', title: 'Smoke test B&B workflow', category: 'testing', priority: 'medium', status: 'ready', description: null, context: null, output: null, tags: [] }
  ]
};

function mockList(page, response = MOCK_DATA, status = 200) {
  return page.route('**/webhook/mc-tasks', route =>
    route.fulfill({ status, body: JSON.stringify(response), contentType: 'application/json' })
  );
}

function mockMutate(page, response = { success: true }, status = 200) {
  return page.route('**/webhook/mc-mutate', route =>
    route.fulfill({ status, body: JSON.stringify(response), contentType: 'application/json' })
  );
}

function mockDispatch(page, response = { success: true, output: 'Agent output here' }, status = 200) {
  return page.route('**/webhook/mc-dispatch', route =>
    route.fulfill({ status, body: JSON.stringify(response), contentType: 'application/json' })
  );
}

test('page loads with title Mission Control — Norr AI', async ({ page }) => {
  await mockList(page);
  await page.goto('/internal/mission-control');
  await expect(page).toHaveTitle('Mission Control — Norr AI');
});

test('shows story cards in stories view by default', async ({ page }) => {
  await mockList(page);
  await page.goto('/internal/mission-control');
  await page.locator('.story-card').first().waitFor();
  const cards = page.locator('.story-card');
  await expect(cards).toHaveCount(2);
});

test('story cards display title and priority', async ({ page }) => {
  await mockList(page);
  await page.goto('/internal/mission-control');
  await page.locator('.story-card').first().waitFor();
  const firstCard = page.locator('.story-card').first();
  await expect(firstCard).toContainText('Build Buyer Briefing Generator');
  await expect(firstCard.locator('.story-priority-badge')).toContainText('High');
});

test('story cards show task progress', async ({ page }) => {
  await mockList(page);
  await page.goto('/internal/mission-control');
  await page.locator('.story-card').first().waitFor();
  const firstCard = page.locator('.story-card').first();
  await expect(firstCard).toContainText('0 / 2 tasks done');
});

test('standalone tasks section renders', async ({ page }) => {
  await mockList(page);
  await page.goto('/internal/mission-control');
  await page.locator('.story-card').first().waitFor();
  await expect(page.locator('#standalone-section')).toBeVisible();
  await expect(page.locator('.standalone-item')).toHaveCount(1);
  await expect(page.locator('.standalone-item')).toContainText('Smoke test B&B workflow');
});

test('board view toggle shows kanban columns', async ({ page }) => {
  await mockList(page);
  await page.goto('/internal/mission-control');
  await page.locator('.story-card').first().waitFor();
  await page.locator('#btn-board').click();
  await expect(page.locator('#board-view')).toBeVisible();
  const cols = page.locator('.board-col');
  await expect(cols).toHaveCount(6);
});

test('board view shows task cards in correct columns', async ({ page }) => {
  await mockList(page);
  await page.goto('/internal/mission-control');
  await page.locator('.story-card').first().waitFor();
  await page.locator('#btn-board').click();

  // Ready column should have tasks with status=ready
  const readyCol = page.locator('.board-col[data-status="ready"]');
  await expect(readyCol).toContainText('Research form fields');
  await expect(readyCol).toContainText('Evaluate Token Check approach');
  await expect(readyCol).toContainText('Smoke test B&B workflow');

  // Backlog column should have tasks with status=backlog
  const backlogCol = page.locator('.board-col[data-status="backlog"]');
  await expect(backlogCol).toContainText('Build buyer_briefing.html');
});

test('clicking a task card in board view opens the drawer', async ({ page }) => {
  await mockList(page);
  await page.goto('/internal/mission-control');
  await page.locator('.story-card').first().waitFor();
  await page.locator('#btn-board').click();

  const readyCol = page.locator('.board-col[data-status="ready"]');
  const firstCard = readyCol.locator('.board-card').first();
  await firstCard.click();

  await expect(page.locator('#drawer')).toHaveClass(/open/);
});

test('drawer shows task title and category badge', async ({ page }) => {
  await mockList(page);
  await page.goto('/internal/mission-control');
  await page.locator('.story-card').first().waitFor();
  await page.locator('#btn-board').click();

  const readyCol = page.locator('.board-col[data-status="ready"]');
  const card = readyCol.locator('.board-card').filter({ hasText: 'Research form fields' });
  await card.click();

  await expect(page.locator('#drawer-title')).toContainText('Research form fields');
  await expect(page.locator('#drawer-cat-badge .cat-badge')).toContainText('RESEARCH');
});

test('drawer close button hides drawer', async ({ page }) => {
  await mockList(page);
  await page.goto('/internal/mission-control');
  await page.locator('.story-card').first().waitFor();
  await page.locator('#btn-board').click();

  const readyCol = page.locator('.board-col[data-status="ready"]');
  await readyCol.locator('.board-card').first().click();
  await expect(page.locator('#drawer')).toHaveClass(/open/);

  await page.locator('#drawer-close').click();
  await expect(page.locator('#drawer')).not.toHaveClass(/open/);
});

test('category filter pills filter visible tasks in board view', async ({ page }) => {
  await mockList(page);
  await page.goto('/internal/mission-control');
  await page.locator('.story-card').first().waitFor();
  await page.locator('#btn-board').click();

  // Click the Dev filter pill
  await page.locator('#filter-pills .pill[data-cat="dev"]').click();

  // Only dev tasks should be visible
  const readyCol = page.locator('.board-col[data-status="ready"]');
  const backlogCol = page.locator('.board-col[data-status="backlog"]');

  // research tasks in ready column should not be visible
  await expect(readyCol).not.toContainText('Research form fields');
  // dev task in backlog should be visible
  await expect(backlogCol).toContainText('Build buyer_briefing.html');
});

test('new task button opens create modal', async ({ page }) => {
  await mockList(page);
  await page.goto('/internal/mission-control');
  await page.locator('.story-card').first().waitFor();
  await page.locator('#btn-new-task').click();
  await expect(page.locator('#modal-task')).toHaveClass(/visible/);
});

test('new story button opens create modal', async ({ page }) => {
  await mockList(page);
  await page.goto('/internal/mission-control');
  await page.locator('.story-card').first().waitFor();
  await page.locator('#btn-new-story').click();
  await expect(page.locator('#modal-story')).toHaveClass(/visible/);
});

test('shows error state when fetch fails', async ({ page }) => {
  await page.route('**/webhook/mc-tasks', route => route.fulfill({ status: 500, body: '' }));
  await page.goto('/internal/mission-control');
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#stories-view')).not.toHaveClass(/visible/);
});

test('refresh button triggers a second fetch', async ({ page }) => {
  let fetchCount = 0;
  await page.route('**/webhook/mc-tasks', route => {
    fetchCount++;
    return route.fulfill({ status: 200, body: JSON.stringify(MOCK_DATA), contentType: 'application/json' });
  });
  await page.goto('/internal/mission-control');
  await page.locator('.story-card').first().waitFor();
  await page.locator('#refresh-btn').click();
  await page.locator('.story-card').first().waitFor();
  expect(fetchCount).toBe(2);
});

test('sends x-norr-token header with correct value', async ({ page }) => {
  let tokenSent;
  await page.route('**/webhook/mc-tasks', route => {
    tokenSent = route.request().headers()['x-norr-token'];
    return route.fulfill({ status: 200, body: JSON.stringify(MOCK_DATA), contentType: 'application/json' });
  });
  await page.goto('/internal/mission-control');
  await page.locator('.story-card').first().waitFor();
  expect(tokenSent).toBe('8F68D963-7060-4033-BD04-7593E4B203CB');
});

test('shows loading state initially', async ({ page }) => {
  let resolveRoute;
  await page.route('**/webhook/mc-tasks', route => {
    return new Promise(resolve => { resolveRoute = () => resolve(route.fulfill({ status: 200, body: JSON.stringify(MOCK_DATA), contentType: 'application/json' })); });
  });
  await page.goto('/internal/mission-control');
  await expect(page.locator('#loading')).toBeVisible();
  resolveRoute();
  await page.locator('.story-card').first().waitFor();
  await expect(page.locator('#loading')).not.toBeVisible();
});

test('empty stories array shows empty state message', async ({ page }) => {
  await mockList(page, { generated_at: '2026-05-15T12:00:00Z', stories: [], standalone: [] });
  await page.goto('/internal/mission-control');
  await expect(page.locator('#stories-empty')).toBeVisible();
});
