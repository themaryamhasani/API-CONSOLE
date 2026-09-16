import { test, expect, type Page } from '@playwright/test';

const E2E_USER = 'e2e.user';
const E2E_PASS = 'e2e-password-123';

async function waitForLoginReady(page: Page) {
  await page.goto('/login');
  await expect(page.getByTestId('login-tabs')).toBeVisible({ timeout: 30_000 });
}

async function loginLocal(page: Page, username = E2E_USER, password = E2E_PASS) {
  await waitForLoginReady(page);
  await page.getByTestId('login-tab-local').click();
  await expect(page.getByTestId('local-login-form')).toBeVisible();
  await page.getByTestId('local-username').fill(username);
  await page.getByTestId('local-password').fill(password);
  await page.getByTestId('local-login-submit').click();
}

async function expectWorkspaceReady(page: Page) {
  await expect(page.getByRole('navigation', { name: 'منوی اصلی' })).toBeVisible({ timeout: 30_000 });
}

test.describe('API Console e2e', () => {
  test('login page shows CDE and Local tabs only (no IS)', async ({ page }) => {
    await waitForLoginReady(page);
    await expect(page.getByTestId('login-tab-cde')).toBeVisible();
    await expect(page.getByTestId('login-tab-local')).toBeVisible();
    await expect(page.getByText('ورود IS')).toHaveCount(0);
    await expect(page.getByText('Integrated Systems')).toHaveCount(0);
    await expect(page.getByText('API Console').first()).toBeVisible();
  });

  test('local tab reveals username/password form', async ({ page }) => {
    await waitForLoginReady(page);
    await page.getByTestId('login-tab-local').click();
    await expect(page.getByTestId('local-login-form')).toBeVisible();
    await expect(page.getByTestId('local-username')).toBeVisible();
    await expect(page.getByTestId('local-password')).toBeVisible();
    await expect(page.getByTestId('local-login-submit')).toBeVisible();
  });

  test('unauthenticated workspace routes redirect to login', async ({ page }) => {
    await page.goto('/requests');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('login-tabs')).toBeVisible();

    await page.goto('/runtime');
    await expect(page).toHaveURL(/\/login/);
  });

  test('API health is reachable through web proxy', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/api/health`);
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    expect(json.service).toBe('api-console');
    expect(json.isEnabled).toBe(false);
    expect(json.release).toBe('v1-cde-local');
  });

  test('IS auth login is disabled', async ({ request, baseURL }) => {
    const response = await request.post(`${baseURL}/api/auth/is/login`, {
      data: { cellphone: '09000000000', password: 'x' },
    });
    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(String(body?.error?.category || body?.category || '')).toMatch(/IS_DISABLED|IS/i);
  });

  test('bad local password shows error', async ({ page }) => {
    await loginLocal(page, E2E_USER, 'wrong-password');
    await expect(page.getByTestId('local-login-error')).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('local login reaches workspace and sidebar routes work', async ({ page }) => {
    await loginLocal(page);
    await expectWorkspaceReady(page);
    await expect(page).toHaveURL(/\/(requests)?$|\/$/);

    // LOCAL DEVELOPER: repository/runtime/environments are hidden
    await expect(page.getByRole('link', { name: 'مخزن' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Runtime' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'محیط‌ها' })).toHaveCount(0);

    await page.getByRole('link', { name: 'فعالیت' }).click();
    await expect(page).toHaveURL(/\/activity/);

    await page.getByRole('link', { name: 'درخواست‌ها' }).click();
    await expect(page).toHaveURL(/\/requests/);

    await page.getByRole('link', { name: 'Mock' }).click();
    await expect(page).toHaveURL(/\/mocks/);

    await page.getByRole('link', { name: 'دسترسی JIT' }).click();
    await expect(page).toHaveURL(/\/jit/);

    await page.getByRole('link', { name: 'گزارش‌ها' }).click();
    await expect(page).toHaveURL(/\/reports/);
  });

  test('portal route is reachable when authenticated', async ({ page }) => {
    await loginLocal(page);
    await expectWorkspaceReady(page);
    await page.getByRole('link', { name: 'پورتال عمومی' }).click();
    await expect(page).toHaveURL(/\/portal/);
  });

  test('logout returns to login and clears session', async ({ page }) => {
    await loginLocal(page);
    await expectWorkspaceReady(page);

    await page.getByTestId('header-account-menu').click();
    await page.getByTestId('header-logout').click();
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    await expect(page.getByTestId('login-tabs')).toBeVisible();

    await page.goto('/requests');
    await expect(page).toHaveURL(/\/login/);
  });
});
