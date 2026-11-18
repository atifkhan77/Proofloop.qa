import { test, expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * Traceability Matrix UI regression: entry point, summary counts, module grouping,
 * coverage badges, nested risks/test cases, links, empty and error states, VIEWER access.
 */

const API = 'http://localhost:4000/api/';
const TOKEN_KEY = 'proofloop-auth-token';
const runId = Date.now();
const ORG = `E2E RtmUi ${runId}`;
const PROJECT = `RTM UI Project ${runId}`;

test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;
let token: string;
let userId: string;
let projectId: string;
let emptyProjectId: string;

test.beforeAll(async () => {
  const anon = await request.newContext({ baseURL: API });
  const reg = await (
    await anon.post('auth/register', {
      data: { email: `e2e-rtmui-${runId}@example.com`, password: 'Passw0rd!', firstName: 'R', lastName: 'T', organizationName: ORG },
    })
  ).json();
  token = reg.token;
  userId = reg.user.id;
  await anon.dispose();
  api = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

  projectId = (await (await api.post('projects', { data: { name: PROJECT } })).json()).id;
  emptyProjectId = (await (await api.post('projects', { data: { name: `RTM Empty ${runId}` } })).json()).id;
  const zeta = (await (await api.post(`projects/${projectId}/modules`, { data: { name: 'Zeta' } })).json()).id;
  const alpha = (await (await api.post(`projects/${projectId}/modules`, { data: { name: 'Alpha' } })).json()).id;
  const mkReq = async (moduleId: string, reqId: string, title: string) =>
    (
      await (
        await api.post(`modules/${moduleId}/requirements`, {
          data: { reqId, title, description: 'd', priority: 'HIGH', businessCriticality: 'HIGH' },
        })
      ).json()
    ).id as string;

  const a1 = await mkReq(alpha, 'REQ-A1', 'Login with password');
  await mkReq(alpha, 'REQ-A2', 'Password reset');
  const z1 = await mkReq(zeta, 'REQ-Z1', 'Export report');

  for (const [title, p, i] of [['Brute force', 4, 5], ['Typo in label', 1, 2]] as const) {
    await api.post(`requirements/${a1}/risks`, { data: { title, description: 'd', probability: p, impact: i } });
  }
  await api.post(`projects/${projectId}/test-cases`, {
    data: { tcId: 'TC-LOGIN', title: 'Valid login', priority: 'HIGH', testType: 'UI', automationStatus: 'MANUAL', requirementId: a1 },
  });
  await api.post(`projects/${projectId}/test-cases`, {
    data: { tcId: 'TC-EXPORT', title: 'CSV export', priority: 'LOW', testType: 'API', automationStatus: 'AUTOMATED', requirementId: z1 },
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

const reqRow = (page: Page, reqId: string) => page.getByRole('row').filter({ hasText: reqId });

test('project page "Traceability Matrix" button opens the matrix', async ({ page }) => {
  await page.goto(`/projects/${projectId}`);
  await page.getByRole('main').getByRole('link', { name: 'Traceability Matrix' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/traceability$`));
  await expect(page.getByRole('heading', { name: 'Traceability Matrix', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: `Back to ${PROJECT}` })).toBeVisible();
});

test('summary counts: 3 requirements, 1 missing test coverage', async ({ page }) => {
  await page.goto(`/projects/${projectId}/traceability`);
  await expect(page.getByText('Total Requirements').locator('..')).toContainText('3');
  await expect(page.getByText('Missing Test Coverage').locator('..')).toContainText('1');
});

test('rows grouped under module headers in module-name order', async ({ page }) => {
  await page.goto(`/projects/${projectId}/traceability`);
  const firstCells = page.getByRole('row').locator('td:first-child');
  await expect(firstCells).toHaveText([
    'Module: Alpha',
    /REQ-A1/,
    /REQ-A2/,
    'Module: Zeta',
    /REQ-Z1/,
  ]);
});

test('coverage badges per requirement', async ({ page }) => {
  await page.goto(`/projects/${projectId}/traceability`);
  await expect(reqRow(page, 'REQ-A1')).toContainText('Tests Linked');
  await expect(reqRow(page, 'REQ-A1')).toContainText('Risks Logged');
  await expect(reqRow(page, 'REQ-A2')).toContainText('Missing Tests');
  await expect(reqRow(page, 'REQ-A2')).toContainText('No Risks');
  await expect(reqRow(page, 'REQ-A2')).toContainText('Coverage Required');
  await expect(reqRow(page, 'REQ-Z1')).toContainText('Tests Linked');
  await expect(reqRow(page, 'REQ-Z1')).toContainText('No Risks');
});

test('risks listed highest score first with level tags', async ({ page }) => {
  await page.goto(`/projects/${projectId}/traceability`);
  await expect(reqRow(page, 'REQ-A1').getByRole('listitem').filter({ hasText: /^\[/ })).toHaveText([
    '[CRITICAL]Brute force',
    '[LOW]Typo in label',
  ]);
});

test('test case link opens the test case detail page', async ({ page }) => {
  await page.goto(`/projects/${projectId}/traceability`);
  await reqRow(page, 'REQ-Z1').getByRole('link', { name: 'TC-EXPORT' }).click();
  await expect(page).toHaveURL(/\/test-cases\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'CSV export', level: 1 })).toBeVisible();
});

test('empty project: empty state and zero counts', async ({ page }) => {
  await page.goto(`/projects/${emptyProjectId}/traceability`);
  await expect(page.getByText('No requirements found')).toBeVisible();
  await expect(page.getByText('Total Requirements').locator('..')).toContainText('0');
  await expect(page.getByText('Missing Test Coverage').locator('..')).toContainText('0');
});

test('unknown project shows "Project not found"', async ({ page }) => {
  await page.goto('/projects/00000000-0000-0000-0000-000000000000/traceability');
  await expect(page.getByRole('alert')).toHaveText('Project not found');
});

test('VIEWER can open the matrix', async ({ page }) => {
  await prisma.user.update({ where: { id: userId }, data: { role: 'VIEWER' } });
  await page.goto(`/projects/${projectId}`);
  await page.getByRole('main').getByRole('link', { name: 'Traceability Matrix' }).click();
  await expect(reqRow(page, 'REQ-A1')).toContainText('Tests Linked');
});
