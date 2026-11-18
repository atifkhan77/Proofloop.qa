import { test, expect, type Page } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * Phase 1 auth regression: route guards, login/register forms, session restore,
 * logout, and failure handling. Steps run in order and share one browser session.
 */

const runId = Date.now();
const ORG_NAME = `E2E Org ${runId}`;
const EMAIL = `e2e${runId}@example.com`;
const PASSWORD = 'Passw0rd!';
const TOKEN_KEY = 'proofloop-auth-token';

test.describe.configure({ mode: 'serial' });

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page?.close();
  // Users cascade-delete with their organization.
  await prisma.organization.deleteMany({ where: { name: ORG_NAME } });
  await prisma.$disconnect();
});

async function signIn(email: string, password: string) {
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('unauthenticated deep link redirects to /login', async () => {
  await page.goto('/risks');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('empty login shows client validation errors', async () => {
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Invalid email address')).toBeVisible();
  await expect(page.getByText('Password is required')).toBeVisible();
});

test('wrong credentials show server error and stay on /login', async () => {
  await signIn('ghost@example.com', 'wrongpass');
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password');
  await expect(page).toHaveURL(/\/login$/);
});

test('register creates account and lands on dashboard', async () => {
  await page.getByRole('link', { name: 'Register your organization' }).click();
  await expect(page).toHaveURL(/\/register$/);
  await page.getByLabel('First Name').fill('E2E');
  await page.getByLabel('Last Name').fill('Tester');
  await page.getByLabel('Organization Name').fill(ORG_NAME);
  // Padded + uppercase: client and API both trim/lowercase.
  await page.getByLabel('Work Email').fill(`  ${EMAIL.toUpperCase()}  `);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
});

test('authenticated user visiting /login is redirected to dashboard', async () => {
  await page.goto('/login');
  await expect(page).toHaveURL('/');
  await page.goto('/register');
  await expect(page).toHaveURL('/');
});

test('reload restores session', async () => {
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
});

test('sidebar navigation is client-side (no full reload)', async () => {
  await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Risk Analysis' }).click();
  await expect(page).toHaveURL(/\/risks$/);
  await expect(page.getByRole('heading', { name: 'Risk Analysis', level: 1 })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
});

test('unknown route inside app shows 404 page', async () => {
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
});

test('logout returns to /login and clears token', async () => {
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate((k) => localStorage.getItem(k), TOKEN_KEY)).toBeNull();
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('login redirects back to the originally requested page', async () => {
  await page.goto('/defects');
  await expect(page).toHaveURL(/\/login$/);
  await signIn(EMAIL, PASSWORD);
  await expect(page).toHaveURL(/\/defects$/);
  await expect(page.getByRole('heading', { name: 'Defect Intelligence', level: 1 })).toBeVisible();
  // Re-check after render: a competing redirect (GuestRoute) once bounced this to "/".
  await expect(page).toHaveURL(/\/defects$/);
});

test('duplicate registration shows "Email already in use"', async () => {
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/register');
  await page.getByLabel('First Name').fill('Dup');
  await page.getByLabel('Last Name').fill('User');
  await page.getByLabel('Organization Name').fill(ORG_NAME);
  await page.getByLabel('Work Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email already in use');
});

test('tampered token sends user to /login and removes it', async () => {
  await page.evaluate((k) => localStorage.setItem(k, 'not.a.jwt'), TOKEN_KEY);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), TOKEN_KEY)).toBeNull();
});

test('API down during session restore lands on /login without redirect loop', async () => {
  await signIn(EMAIL, PASSWORD);
  await expect(page).toHaveURL('/');

  await page.route('**/api/auth/me', (route) => route.abort('connectionrefused'));
  const navigations: string[] = [];
  const onNav = (frame: { url(): string }) => navigations.push(frame.url());
  page.on('framenavigated', onNav);

  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  // Give a loop time to manifest, then confirm the URL settled.
  await page.waitForTimeout(1000);
  await expect(page).toHaveURL(/\/login$/);
  expect(navigations.length).toBeLessThan(5);

  page.off('framenavigated', onNav);
  await page.unroute('**/api/auth/me');
});
