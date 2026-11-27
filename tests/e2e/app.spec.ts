import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  createMockGasController,
  INITIAL_MOCK_ITEMS,
  LEADING_ZERO_CREATE_FIXTURE,
  MOCK_GAS_API_PATH,
  MOCK_HTML_ERROR_BODY,
} from '../fixtures/items';

const WCAG_22_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const FRONTEND_DIST_ASSETS_DIR = resolve(process.cwd(), 'frontend/dist/assets');

/**
 * Automated WCAG 2.2 AA scan via `@axe-core/playwright`.
 * Note (ADR-0004): Axe is a minimum automated gate only and does not substitute
 * for manual keyboard navigation, focus visibility, and screen-reader verification.
 */
async function assertNoWcag22AaViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA_TAGS).analyze();
  expect(results.violations).toEqual([]);
}

async function mountSharedMockGasRoutes(page: Page): Promise<void> {
  const controller = createMockGasController();

  await page.route(`**${MOCK_GAS_API_PATH}*`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method().toUpperCase();

    if (method === 'GET') {
      const response = controller.handleGet(url.searchParams);
      await route.fulfill({
        status: response.status,
        contentType: response.contentType,
        body: response.body,
      });
      return;
    }

    if (method === 'POST') {
      const response = controller.handlePost(req.postData() ?? '');
      await route.fulfill({
        status: response.status,
        contentType: response.contentType,
        body: response.body,
      });
      return;
    }

    await route.abort();
  });
}

test.describe('Starter Item UI (production bundle offline E2E)', () => {
  test('lists shared fixture items, creates a leading-zero item, and passes WCAG 2.2 AA Axe scan', async ({
    page,
  }) => {
    await mountSharedMockGasRoutes(page);
    await page.goto('/');

    await expect(
      page.getByRole('heading', { level: 1, name: /react \+ gas starter template/i }),
    ).toBeVisible();

    for (const item of INITIAL_MOCK_ITEMS) {
      await expect(page.getByText(item.code, { exact: true })).toBeVisible();
      await expect(page.getByText(item.name, { exact: true })).toBeVisible();
    }

    const codeInput = page.getByLabel(/item code/i);
    const nameInput = page.getByLabel(/item name/i);
    const saveButton = page.getByRole('button', { name: /^save$/i });

    await codeInput.fill(LEADING_ZERO_CREATE_FIXTURE.code);
    await nameInput.fill(LEADING_ZERO_CREATE_FIXTURE.name);
    await saveButton.click();

    await expect(page.getByText(LEADING_ZERO_CREATE_FIXTURE.code, { exact: true })).toBeVisible();
    await expect(page.getByText(LEADING_ZERO_CREATE_FIXTURE.name, { exact: true })).toBeVisible();
    await expect(codeInput).toHaveValue('');
    await expect(nameInput).toHaveValue('');

    await assertNoWcag22AaViolations(page);
  });

  test('displays accessible alerts for client-side and server-side validation errors', async ({
    page,
  }) => {
    await mountSharedMockGasRoutes(page);
    await page.goto('/');

    await expect(page.getByText(INITIAL_MOCK_ITEMS[0].code, { exact: true })).toBeVisible();

    const codeInput = page.getByLabel(/item code/i);
    const nameInput = page.getByLabel(/item name/i);
    const saveButton = page.getByRole('button', { name: /^save$/i });

    await saveButton.click();
    const formAlert = page.getByRole('alert');
    await expect(formAlert).toContainText(/both item code and item name are required/i);
    await expect(codeInput).toHaveAttribute('aria-invalid', 'true');
    await expect(nameInput).toHaveAttribute('aria-invalid', 'true');

    await codeInput.fill('0'.repeat(65));
    await nameInput.fill('Oversized Code Item');
    await saveButton.click();

    await expect(formAlert).toContainText(/code must not exceed 64 characters/i);
    await assertNoWcag22AaViolations(page);
  });

  test('displays an accessible error alert when GAS returns a server error envelope', async ({
    page,
  }) => {
    await page.route(`**${MOCK_GAS_API_PATH}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          ok: false,
          error: {
            code: 'CONFIG_MISSING',
            message: 'SPREADSHEET_ID is not configured',
          },
        }),
      });
    });

    await page.goto('/');

    const alert = page.getByRole('alert');
    await expect(alert).toContainText(/failed to load items: spreadsheet_id is not configured/i);
    await assertNoWcag22AaViolations(page);
  });

  test('classifies HTTP 200 HTML responses as NON_JSON_RESPONSE in the UI alert', async ({
    page,
  }) => {
    await page.route(`**${MOCK_GAS_API_PATH}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: MOCK_HTML_ERROR_BODY,
      });
    });

    await page.goto('/');

    const alert = page.getByRole('alert');
    await expect(alert).toContainText(/html response instead of json/i);
    await assertNoWcag22AaViolations(page);
  });

  for (const viewport of [
    { name: 'desktop', width: 1280, height: 720 },
    { name: 'mobile', width: 375, height: 667 },
  ]) {
    test(`renders without horizontal overflow and passes WCAG 2.2 AA Axe scan on ${viewport.name} (${viewport.width}x${viewport.height})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mountSharedMockGasRoutes(page);
      await page.goto('/');

      await expect(page.getByText(INITIAL_MOCK_ITEMS[0].code, { exact: true })).toBeVisible();
      await expect(page.getByLabel(/item code/i)).toBeVisible();
      await expect(page.getByLabel(/item name/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /^save$/i })).toBeVisible();

      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasHorizontalOverflow).toBe(false);

      // Verify keyboard Tab reaches form inputs and submit button cleanly
      await page.keyboard.press('Tab');
      await expect(page.getByLabel(/item code/i)).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByLabel(/item name/i)).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: /^save$/i })).toBeFocused();

      await assertNoWcag22AaViolations(page);
    });
  }

  test('confirms dev-only mock API and fixtures are absent from the built production bundle', async ({
    request,
  }) => {
    const assetFiles = await readdir(FRONTEND_DIST_ASSETS_DIR);
    const jsFiles = assetFiles.filter((file) => file.endsWith('.js'));
    expect(jsFiles.length).toBeGreaterThan(0);

    for (const file of jsFiles) {
      const content = await readFile(join(FRONTEND_DIST_ASSETS_DIR, file), 'utf8');
      expect(content).not.toContain('react-gas-dev-mock-api');
      expect(content).not.toContain('createMockGasMiddleware');
      expect(content).not.toContain('INITIAL_MOCK_ITEMS');
      expect(content).not.toContain(INITIAL_MOCK_ITEMS[0].name);
      expect(content).not.toContain(LEADING_ZERO_CREATE_FIXTURE.name);
    }

    // Unintercepted request directly to `vite preview` must not return a mock GAS JSON envelope
    const previewResponse = await request.get(`${MOCK_GAS_API_PATH}?action=listItems`);
    const contentType = previewResponse.headers()['content-type'] ?? '';
    expect(contentType).not.toContain('application/json');
  });
});
