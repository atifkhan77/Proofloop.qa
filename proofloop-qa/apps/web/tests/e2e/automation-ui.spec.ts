import { test, expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * Module 5 UI regression: Automation Lab page, automation project / environment / trigger
 * modals, run history, project picker, RBAC visibility. Seed via API; browser reuses the token.
 */

const API = 'http://localhost:4000/api/';
const TOKEN_KEY = 'proofloop-auth-token';
const runId = Date.now();
const ORG = `E2E AutoUi ${runId}`;
const PROJECT = `Auto UI Project ${runId}`;
const SUITE = 'Checkout Suite';

test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;
let token: string;
let userId: string;
let projectId: string;

test.beforeAll(async () => {
  const anon = await request.newContext({ baseURL: API });
  const reg = await (
    await anon.post('auth/register', {
      data: { email: `e2e-autoui-${runId}@example.com`, password: 'Passw0rd!', firstName: 'A', lastName: 'U', organizationName: ORG },
    })
  ).json();
  token = reg.token;
  userId = reg.user.id;
  await anon.dispose();
  api = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  projectId = (await (await api.post('projects', { data: { name: PROJECT } })).json()).id;
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

const card = (page: Page, name: string) => page.getByRole('article', { name });

test('project page links to the Automation Lab; empty state shown', async ({ page }) => {
  await page.goto(`/projects/${projectId}`);
  // Scope to <main>: the sidebar has a same-named "Automation Lab" link.
  await page.getByRole('main').getByRole('link', { name: /Automation Lab/ }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/automation$`));
  await expect(page.getByRole('heading', { name: 'Automation Lab', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: `Back to ${PROJECT}` })).toBeVisible();
  await expect(page.getByText('No Automation Projects')).toBeVisible();
});

test('create modal: blank name and javascript: repository rejected; Escape closes and resets', async ({ page }) => {
  await page.goto(`/projects/${projectId}/automation`);
  await page.getByRole('button', { name: 'New Automation Project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New Automation Project' });
  await dialog.getByLabel('Name').fill('   ');
  await dialog.getByLabel('Repository URL (Optional)').fill('javascript:alert(1)');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog.getByText('Automation project name is required')).toBeVisible();
  await expect(dialog.getByText('Must be a valid HTTP or HTTPS URL')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'New Automation Project' }).click();
  await expect(dialog.getByLabel('Name')).toHaveValue('');
  await expect(dialog.getByLabel('Repository URL (Optional)')).toHaveValue('');
});

test('create automation project: card shows name, repository@branch, 0 Executions', async ({ page }) => {
  await page.goto(`/projects/${projectId}/automation`);
  await page.getByRole('button', { name: 'New Automation Project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New Automation Project' });
  await dialog.getByLabel('Name').fill(`  ${SUITE}  `);
  await dialog.getByLabel('Description (Optional)').fill('Cart and payment flows');
  await dialog.getByLabel('Repository URL (Optional)').fill(' https://github.com/acme/shop-e2e ');
  await dialog.getByLabel('Branch (Optional)').fill('main');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();

  const c = card(page, SUITE);
  await expect(c).toBeVisible();
  await expect(c).toContainText('PLAYWRIGHT');
  await expect(c).toContainText('Cart and payment flows');
  await expect(c).toContainText('https://github.com/acme/shop-e2e');
  await expect(c).toContainText('@main');
  await expect(c).toContainText('0 Executions');

  const saved = await prisma.automationProject.findFirstOrThrow({ where: { projectId } });
  expect(saved.name).toBe(SUITE);
  expect(saved.repository).toBe('https://github.com/acme/shop-e2e');
});

test('duplicate automation project name shows the API 409 message', async ({ page }) => {
  await page.goto(`/projects/${projectId}/automation`);
  await page.getByRole('button', { name: 'New Automation Project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New Automation Project' });
  await dialog.getByLabel('Name').fill(SUITE);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('An automation project with this name already exists');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'New Automation Project' }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('environments modal: validation, uppercase names, sorted list, duplicate 409 message', async ({ page }) => {
  await page.goto(`/projects/${projectId}/automation`);
  await page.getByRole('button', { name: 'Environments' }).click();
  const dialog = page.getByRole('dialog', { name: 'Manage Environments' });
  await expect(dialog.getByText('No environments configured for this project.')).toBeVisible();

  await dialog.getByLabel('Environment Name').fill('   ');
  await dialog.getByLabel('Base URL (Optional)').fill('file:///etc/passwd');
  await dialog.getByRole('button', { name: 'Add environment' }).click();
  await expect(dialog.getByText('Environment name is required')).toBeVisible();
  await expect(dialog.getByText('Must be a valid HTTP or HTTPS URL')).toBeVisible();

  await dialog.getByLabel('Environment Name').fill('uat');
  await dialog.getByLabel('Base URL (Optional)').fill('');
  await dialog.getByRole('button', { name: 'Add environment' }).click();
  await expect(dialog.getByLabel('Environment Name')).toHaveValue(''); // reset after save, modal stays open

  await dialog.getByLabel('Environment Name').fill(' staging ');
  await dialog.getByLabel('Base URL (Optional)').fill('https://staging.example.com');
  await dialog.getByRole('button', { name: 'Add environment' }).click();

  const items = dialog.getByRole('list', { name: 'Configured environments' }).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('STAGING');
  await expect(items.nth(0)).toContainText('https://staging.example.com');
  // Row also shows the "Variables Vault" toggle label; UAT has no base URL.
  await expect(items.nth(1)).toContainText('UAT');
  await expect(items.nth(1)).not.toContainText('http');

  await dialog.getByLabel('Environment Name').fill('Staging');
  await dialog.getByRole('button', { name: 'Add environment' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('An environment with this name already exists in this project');
  await expect(items).toHaveCount(2);
});

test('Run dialog lists environments on a fresh page load (env modal never opened)', async ({ page }) => {
  await page.goto(`/projects/${projectId}/automation`);
  await page.getByRole('button', { name: `Run ${SUITE}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Trigger Execution' });
  await expect(dialog).toContainText(SUITE);
  await expect(dialog.getByLabel('Target Environment (Optional)').getByRole('option')).toHaveText([
    '-- No Environment --',
    'STAGING',
    'UAT',
  ]);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('trigger runs: count increments, history shows newest first with environment', async ({ page }) => {
  await page.goto(`/projects/${projectId}/automation`);
  const c = card(page, SUITE);

  await page.getByRole('button', { name: `Run ${SUITE}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Trigger Execution' });
  await dialog.getByLabel('Target Environment (Optional)').selectOption({ label: 'STAGING' });
  await dialog.getByRole('button', { name: 'Start Run' }).click();
  await expect(dialog).toBeHidden();
  await expect(c).toContainText('1 Execution');

  await c.getByRole('button', { name: 'View History' }).click();
  const history = c.getByRole('list', { name: `Run history for ${SUITE}` }).getByRole('listitem');
  await expect(history).toHaveCount(1);
  await expect(history.nth(0)).toContainText('RUN-001');
  // History is fetched fresh; the worker may already have started (or finished) the run.
  await expect(history.nth(0)).toContainText(/PENDING|RUNNING|PASSED|FAILED/);
  await expect(history.nth(0)).toContainText('STAGING');
  await expect(history.nth(0)).toContainText('MANUAL');

  // Second run while history is open, no environment: prepended without reload.
  await page.getByRole('button', { name: `Run ${SUITE}` }).click();
  await dialog.getByRole('button', { name: 'Start Run' }).click();
  await expect(dialog).toBeHidden();
  await expect(c).toContainText('2 Executions');
  await expect(history).toHaveCount(2);
  await expect(history.nth(0)).toContainText('RUN-002');
  await expect(history.nth(0)).toContainText('No environment');
  await expect(history.nth(1)).toContainText('RUN-001');

  await c.getByRole('button', { name: 'Hide History' }).click();
  await expect(history).toHaveCount(0);
});

test('stored runs match the UI; history after reload comes from the API', async ({ page }) => {
  const runs = await prisma.automationExecution.findMany({
    where: { automationProject: { projectId } },
    include: { projectEnvironment: true },
    orderBy: { runId: 'asc' },
  });
  expect(runs.map((r) => [r.runId, r.trigger, r.projectEnvironment?.name ?? null])).toEqual([
    ['RUN-001', 'MANUAL', 'STAGING'],
    ['RUN-002', 'MANUAL', null],
  ]);
  // The worker picks runs up in the background (see automation-worker.spec.ts), so any
  // non-cancelled status is valid here.
  for (const r of runs) expect(['PENDING', 'RUNNING', 'PASSED', 'FAILED']).toContain(r.status);

  await page.goto(`/projects/${projectId}/automation`);
  const c = card(page, SUITE);
  await expect(c).toContainText('2 Executions');
  await c.getByRole('button', { name: 'View History' }).click();
  const history = c.getByRole('list', { name: `Run history for ${SUITE}` }).getByRole('listitem');
  await expect(history).toHaveCount(2);
  await expect(history.nth(0)).toContainText('RUN-002');
  await expect(history.nth(1)).toContainText('STAGING');
});

test('sidebar Automation Lab opens the project picker, then the lab', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Automation Lab' }).click();
  await expect(page).toHaveURL(/\/automation$/);
  await expect(page.getByRole('heading', { name: 'Automation Lab', level: 1 })).toBeVisible();
  await expect(page.getByText('Coming soon')).toHaveCount(0);
  await page.getByRole('link', { name: new RegExp(PROJECT) }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/automation$`));
});

test('unknown project shows "Project not found"', async ({ page }) => {
  await page.goto('/projects/00000000-0000-0000-0000-000000000000/automation');
  await expect(page.getByRole('alert')).toHaveText('Project not found');
});

test('VIEWER sees suites and history but no Run, Environments or New buttons', async ({ page }) => {
  await prisma.user.update({ where: { id: userId }, data: { role: 'VIEWER' } });
  await page.goto(`/projects/${projectId}/automation`);
  const c = card(page, SUITE);
  await expect(c).toContainText('2 Executions');
  await expect(page.getByRole('button', { name: `Run ${SUITE}` })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Environments' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New Automation Project' })).toHaveCount(0);
  await c.getByRole('button', { name: 'View History' }).click();
  await expect(c.getByRole('list', { name: `Run history for ${SUITE}` }).getByRole('listitem')).toHaveCount(2);
});
