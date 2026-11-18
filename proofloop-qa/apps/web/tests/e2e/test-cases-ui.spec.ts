import { test, expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * Module 4 UI regression: Test Case Studio page, design modal (dynamic steps),
 * project picker, RBAC visibility. Seed data via API; browser reuses the token.
 */

const API = 'http://localhost:4000/api/';
const TOKEN_KEY = 'proofloop-auth-token';
const runId = Date.now();
const ORG = `E2E TcUi ${runId}`;
const PROJECT = `TC UI Project ${runId}`;

test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;
let token: string;
let userId: string;
let projectId: string;

test.beforeAll(async () => {
  const anon = await request.newContext({ baseURL: API });
  const reg = await (
    await anon.post('auth/register', {
      data: { email: `e2e-tcui-${runId}@example.com`, password: 'Passw0rd!', firstName: 'T', lastName: 'U', organizationName: ORG },
    })
  ).json();
  token = reg.token;
  userId = reg.user.id;
  await anon.dispose();
  api = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

  projectId = (await (await api.post('projects', { data: { name: PROJECT } })).json()).id;
  const moduleId = (await (await api.post(`projects/${projectId}/modules`, { data: { name: 'Auth' } })).json()).id;
  await api.post(`modules/${moduleId}/requirements`, {
    data: { reqId: 'REQ-LOGIN', title: 'User login', description: 'd', priority: 'HIGH', businessCriticality: 'CRITICAL' },
  });
});

test.afterAll(async () => {
  await api?.dispose();
  await prisma.organization.deleteMany({ where: { name: ORG } });
  await prisma.$disconnect();
});

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, token] as const);
});

const dataRows = (page: Page) => page.getByRole('row').filter({ hasNot: page.getByRole('columnheader') });

test('project page links to the Test Case Studio; empty state shown', async ({ page }) => {
  await page.goto(`/projects/${projectId}`);
  // Scope to <main>: the sidebar has a same-named "Test Case Studio" link, and it is the
  // only match while the project page is still loading.
  await page.getByRole('main').getByRole('link', { name: /Test Case Studio/ }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/test-cases$`));
  await expect(page.getByRole('heading', { name: 'Test Case Studio', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: `Back to ${PROJECT}` })).toBeVisible();
  await expect(page.getByText('No test cases designed')).toBeVisible();
});

test('modal validation: blank ID/title and blank step fields; Escape closes and resets', async ({ page }) => {
  await page.goto(`/projects/${projectId}/test-cases`);
  await page.getByRole('button', { name: 'New Test Case' }).click();
  const dialog = page.getByRole('dialog', { name: 'Design Test Case' });
  await dialog.getByLabel('Test Case ID').fill('   ');
  await dialog.getByRole('button', { name: 'Save Test Case' }).click();
  await expect(dialog.getByText('Test Case ID is required')).toBeVisible();
  await expect(dialog.getByText('Title is required')).toBeVisible();
  await expect(dialog.getByText('Action is required')).toBeVisible();
  await expect(dialog.getByText('Expected result is required')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'New Test Case' }).click();
  await expect(dialog.getByLabel('Test Case ID')).toHaveValue('');
  await expect(dialog.getByLabel('Step 1 action')).toHaveValue('');
  await expect(dialog.getByLabel('Step 2 action')).toHaveCount(0);
});

test('create: add 3 steps, remove the middle one, save; row shows 2 steps immediately', async ({ page }) => {
  await page.goto(`/projects/${projectId}/test-cases`);
  await page.getByRole('button', { name: 'New Test Case' }).click();
  const dialog = page.getByRole('dialog', { name: 'Design Test Case' });

  await dialog.getByLabel('Test Case ID').fill('tc-login-01');
  await dialog.getByLabel('Title').fill('Valid login');
  await dialog.getByLabel('Link Requirement (Optional)').selectOption({ label: 'REQ-LOGIN: User login' });
  await dialog.getByLabel('Type').selectOption('UI');
  await dialog.getByLabel('Automation').selectOption('AUTOMATED');

  await dialog.getByLabel('Step 1 action').fill('Open /login');
  await dialog.getByLabel('Step 1 expected result').fill('Form visible');
  await dialog.getByRole('button', { name: 'Add Step' }).click();
  await dialog.getByLabel('Step 2 action').fill('TO BE REMOVED');
  await dialog.getByLabel('Step 2 expected result').fill('x');
  await dialog.getByRole('button', { name: 'Add Step' }).click();
  await dialog.getByLabel('Step 3 action').fill('Submit valid credentials');
  await dialog.getByLabel('Step 3 expected result').fill('Dashboard shown');

  await dialog.getByRole('button', { name: 'Remove step 2' }).click();
  await expect(dialog.getByLabel('Step 2 action')).toHaveValue('Submit valid credentials'); // renumbered
  await expect(dialog.getByLabel('Step 3 action')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Save Test Case' }).click();
  await expect(dialog).toBeHidden();

  const row = dataRows(page).first();
  await expect(row).toContainText('TC-LOGIN-01');
  await expect(row).toContainText('Valid login');
  await expect(row).toContainText('UI');
  await expect(row).toContainText('AUTOMATED');
  await expect(row).toContainText('REQ-LOGIN');
  await expect(row.getByRole('cell').nth(3)).toHaveText('2'); // from steps[], not a stale 0
});

test('stored steps are 1..n in UI order (removed step gone)', async () => {
  const steps = await prisma.testStep.findMany({
    where: { testCase: { projectId, tcId: 'TC-LOGIN-01' } },
    orderBy: { stepNumber: 'asc' },
  });
  expect(steps.map((s) => [s.stepNumber, s.action, s.expectedResult])).toEqual([
    [1, 'Open /login', 'Form visible'],
    [2, 'Submit valid credentials', 'Dashboard shown'],
  ]);
});

test('standalone test case with zero steps; list after reload uses _count', async ({ page }) => {
  await page.goto(`/projects/${projectId}/test-cases`);
  await page.getByRole('button', { name: 'New Test Case' }).click();
  const dialog = page.getByRole('dialog', { name: 'Design Test Case' });
  await dialog.getByLabel('Test Case ID').fill('TC-EXPLORE');
  await dialog.getByLabel('Title').fill('Exploratory session');
  await dialog.getByRole('button', { name: 'Remove step 1' }).click();
  await expect(dialog.getByText('No execution steps defined.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save Test Case' }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  const rows = dataRows(page);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('TC-EXPLORE');
  await expect(rows.nth(0)).toContainText('Standalone');
  await expect(rows.nth(0).getByRole('cell').nth(3)).toHaveText('0');
  await expect(rows.nth(1)).toContainText('TC-LOGIN-01');
  await expect(rows.nth(1).getByRole('cell').nth(3)).toHaveText('2');
});

test('duplicate test case ID (case-insensitive) shows the API 409 message', async ({ page }) => {
  await page.goto(`/projects/${projectId}/test-cases`);
  await page.getByRole('button', { name: 'New Test Case' }).click();
  const dialog = page.getByRole('dialog', { name: 'Design Test Case' });
  await dialog.getByLabel('Test Case ID').fill('Tc-Login-01');
  await dialog.getByLabel('Title').fill('Dup');
  await dialog.getByLabel('Step 1 action').fill('a');
  await dialog.getByLabel('Step 1 expected result').fill('b');
  await dialog.getByRole('button', { name: 'Save Test Case' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('A Test Case with this ID already exists in this project');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'New Test Case' }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

// ---------- Description / Test Data fields ----------

test('modal saves description and test data (trimmed); blanks are stored as null', async ({ page }) => {
  await page.goto(`/projects/${projectId}/test-cases`);
  await page.getByRole('button', { name: 'New Test Case' }).click();
  const dialog = page.getByRole('dialog', { name: 'Design Test Case' });
  await dialog.getByLabel('Test Case ID').fill('TC-DETAIL');
  await dialog.getByLabel('Title').fill('Lockout after 5 failures');
  await dialog.getByLabel('Description (Optional)').fill('  Account locks after repeated bad passwords  ');
  await dialog.getByLabel('Test Data (Optional)').fill('  user@example.com\nWrongPass1  ');
  await dialog.getByLabel('Preconditions (Optional)').fill('Account is active');
  await dialog.getByLabel('Link Requirement (Optional)').selectOption({ label: 'REQ-LOGIN: User login' });
  await dialog.getByLabel('Priority').selectOption('HIGH');
  await dialog.getByLabel('Step 1 action').fill('Enter wrong password 5 times');
  await dialog.getByLabel('Step 1 expected result').fill('Error shown each time');
  await dialog.getByRole('button', { name: 'Add Step' }).click();
  await dialog.getByLabel('Step 2 action').fill('Enter correct password');
  await dialog.getByLabel('Step 2 expected result').fill('Account locked message');
  await dialog.getByRole('button', { name: 'Save Test Case' }).click();
  await expect(dialog).toBeHidden();

  const saved = await prisma.testCase.findFirstOrThrow({ where: { projectId, tcId: 'TC-DETAIL' } });
  expect(saved.description).toBe('Account locks after repeated bad passwords');
  expect(saved.testData).toBe('user@example.com\nWrongPass1');
  const blank = await prisma.testCase.findFirstOrThrow({ where: { projectId, tcId: 'TC-LOGIN-01' } });
  expect(blank.description).toBeNull();
  expect(blank.testData).toBeNull();
});

// ---------- Detail page ----------

test('clicking a test case ID opens its detail page with all fields and ordered steps', async ({ page }) => {
  await page.goto(`/projects/${projectId}/test-cases`);
  await page.getByRole('link', { name: 'TC-DETAIL' }).click();
  await expect(page).toHaveURL(/\/test-cases\/[0-9a-f-]+$/);

  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Lockout after 5 failures', level: 1 })).toBeVisible();
  await expect(main.getByText('TC-DETAIL', { exact: true })).toBeVisible();
  await expect(main.getByText('Account locks after repeated bad passwords')).toBeVisible();
  await expect(main.getByText('HIGH • FUNCTIONAL')).toBeVisible();
  await expect(main.getByText('REQ-LOGIN')).toBeVisible();
  await expect(main.getByText('Account is active')).toBeVisible();
  await expect(main.getByText('user@example.com')).toBeVisible();

  const actions = main.getByText(/^Enter (wrong|correct) password/);
  await expect(actions).toHaveText(['Enter wrong password 5 times', 'Enter correct password']);
  await expect(main.getByText('Account locked message')).toBeVisible();
});

test('back link returns to the Test Case Studio', async ({ page }) => {
  const tcRow = await prisma.testCase.findFirstOrThrow({ where: { projectId, tcId: 'TC-DETAIL' } });
  await page.goto(`/test-cases/${tcRow.id}`);
  await page.getByRole('link', { name: 'Back to Test Case Studio' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/test-cases$`));
});

test('clicking anywhere on a row opens the detail page', async ({ page }) => {
  await page.goto(`/projects/${projectId}/test-cases`);
  await dataRows(page).filter({ hasText: 'TC-EXPLORE' }).getByText('Exploratory session').click();
  await expect(page.getByRole('heading', { name: 'Exploratory session', level: 1 })).toBeVisible();
  // Standalone + no steps empty states.
  await expect(page.getByText('Standalone (No linked requirement)')).toBeVisible();
  await expect(page.getByText('No execution steps defined for this test case.')).toBeVisible();
});

test('unknown test case id shows "Test case not found"', async ({ page }) => {
  await page.goto('/test-cases/00000000-0000-0000-0000-000000000000');
  await expect(page.getByRole('alert')).toHaveText('Test case not found');
});

test('sidebar Test Case Studio opens the project picker, then the studio', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Test Case Studio' }).click();
  await expect(page).toHaveURL(/\/test-cases$/);
  await expect(page.getByRole('heading', { name: 'Test Case Studio', level: 1 })).toBeVisible();
  await expect(page.getByText('Coming soon')).toHaveCount(0);
  await page.getByRole('link', { name: new RegExp(PROJECT) }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/test-cases$`));
});

test('unknown project shows "Project not found"', async ({ page }) => {
  await page.goto('/projects/00000000-0000-0000-0000-000000000000/test-cases');
  await expect(page.getByRole('alert')).toHaveText('Project not found');
});

test('VIEWER sees test cases and details but no New Test Case button', async ({ page }) => {
  await prisma.user.update({ where: { id: userId }, data: { role: 'VIEWER' } });
  await page.goto(`/projects/${projectId}/test-cases`);
  await expect(dataRows(page)).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'New Test Case' })).toHaveCount(0);
  await page.getByRole('link', { name: 'TC-DETAIL' }).click();
  await expect(page.getByRole('heading', { name: 'Lockout after 5 failures', level: 1 })).toBeVisible();
});
