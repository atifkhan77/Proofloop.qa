import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * Phase 3 UI regression: read-only project Risk Register.
 * Data is seeded through the API; the browser reuses the same token.
 */

const API = 'http://localhost:4000/api/';
const TOKEN_KEY = 'proofloop-auth-token';
const runId = Date.now();
const ORG = `E2E RiskUi ${runId}`;
const PROJECT = `Risk UI Project ${runId}`;

test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;
let token: string;
let userId: string;
let projectId: string;
let emptyProjectId: string;

test.beforeAll(async () => {
  const anon = await request.newContext({ baseURL: API });
  const reg = await anon.post('auth/register', {
    data: { email: `e2e-riskui-${runId}@example.com`, password: 'Passw0rd!', firstName: 'R', lastName: 'U', organizationName: ORG },
  });
  const regBody = await reg.json();
  token = regBody.token;
  userId = regBody.user.id;
  await anon.dispose();
  api = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

  projectId = (await (await api.post('projects', { data: { name: PROJECT } })).json()).id;
  emptyProjectId = (await (await api.post('projects', { data: { name: `Empty ${runId}` } })).json()).id;
  const moduleId = (await (await api.post(`projects/${projectId}/modules`, { data: { name: 'Payments' } })).json()).id;
  const reqId = (
    await (
      await api.post(`modules/${moduleId}/requirements`, {
        data: { reqId: 'REQ-PAY', title: 'Card payments', description: 'd', priority: 'HIGH', businessCriticality: 'CRITICAL' },
      })
    ).json()
  ).id;

  for (const [title, p, i] of [['Minor typo risk', 1, 2], ['Gateway outage', 5, 5], ['Slow refunds', 3, 4]] as const) {
    const res = await api.post(`requirements/${reqId}/risks`, { data: { title, description: `${title} desc`, probability: p, impact: i } });
    expect(res.status()).toBe(201);
  }
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

test('project page links to the Risk Register', async ({ page }) => {
  await page.goto(`/projects/${projectId}`);
  await page.getByRole('link', { name: /Risk Register/ }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/risks$`));
  await expect(page.getByRole('heading', { name: 'Risk Register', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: `Back to ${PROJECT}` })).toBeVisible();
});

test('register lists risks highest score first with server-computed level', async ({ page }) => {
  await page.goto(`/projects/${projectId}/risks`);
  const rows = page.getByRole('row').filter({ hasNot: page.getByRole('columnheader') });
  await expect(rows).toHaveCount(3);

  await expect(rows.nth(0)).toContainText('CRITICAL');
  await expect(rows.nth(0)).toContainText('Gateway outage');
  await expect(rows.nth(0)).toContainText('25');
  await expect(rows.nth(0)).toContainText('P:5 × I:5');
  await expect(rows.nth(0)).toContainText('REQ-PAY');
  await expect(rows.nth(0)).toContainText('Card payments');

  await expect(rows.nth(1)).toContainText('HIGH');
  await expect(rows.nth(1)).toContainText('12');
  await expect(rows.nth(2)).toContainText('LOW');
  await expect(rows.nth(2)).toContainText('P:1 × I:2');
});

test('back link returns to the project page', async ({ page }) => {
  await page.goto(`/projects/${projectId}/risks`);
  await page.getByRole('link', { name: `Back to ${PROJECT}` }).click();
  await expect(page.getByRole('heading', { name: PROJECT, level: 1 })).toBeVisible();
});

test('project without risks shows the empty state', async ({ page }) => {
  await page.goto(`/projects/${emptyProjectId}/risks`);
  await expect(page.getByText('No risks identified')).toBeVisible();
});

test('unknown project shows "Project not found"', async ({ page }) => {
  await page.goto('/projects/00000000-0000-0000-0000-000000000000/risks');
  await expect(page.getByRole('alert')).toHaveText('Project not found');
});

// ---------- New Risk modal ----------

test('New Risk: validation errors for missing requirement, blank text, out-of-range scales', async ({ page }) => {
  await page.goto(`/projects/${projectId}/risks`);
  await page.getByRole('button', { name: 'New Risk' }).click();
  const dialog = page.getByRole('dialog', { name: 'Log New Risk' });
  await dialog.getByLabel('Probability (1-5)').fill('6');
  await dialog.getByLabel('Impact (1-5)').fill('');
  await dialog.getByRole('button', { name: 'Log Risk' }).click();
  await expect(dialog.getByText('Please select a requirement')).toBeVisible();
  await expect(dialog.getByText('Risk title is required')).toBeVisible();
  await expect(dialog.getByText('Risk description is required')).toBeVisible();
  await expect(dialog.getByText('Probability cannot exceed 5')).toBeVisible();
  await expect(dialog.getByText('Impact is required')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('New Risk: dropdown lists project requirements; created risk appears in sorted position', async ({ page }) => {
  await page.goto(`/projects/${projectId}/risks`);
  await page.getByRole('button', { name: 'New Risk' }).click();
  const dialog = page.getByRole('dialog', { name: 'Log New Risk' });
  const select = dialog.getByLabel('Target Requirement');
  await expect(select.locator('option')).toHaveText(['-- Select a Requirement --', 'REQ-PAY: Card payments']);
  await select.selectOption({ label: 'REQ-PAY: Card payments' });
  await dialog.getByLabel('Risk Title').fill('Fraud spike');
  await dialog.getByLabel('Description & Impact').fill('Chargebacks increase');
  await dialog.getByLabel('Probability (1-5)').fill('4');
  await dialog.getByLabel('Impact (1-5)').fill('4');
  await dialog.getByLabel('Mitigation Strategy (Optional)').fill('Enable 3DS');
  await dialog.getByRole('button', { name: 'Log Risk' }).click();
  await expect(dialog).toBeHidden();

  // 25 (Gateway) > 16 (Fraud, new) > 12 (Slow refunds) > 2
  const rows = page.getByRole('row').filter({ hasNot: page.getByRole('columnheader') });
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(1)).toContainText('Fraud spike');
  await expect(rows.nth(1)).toContainText('HIGH');
  await expect(rows.nth(1)).toContainText('16');
  await expect(rows.nth(1)).toContainText('REQ-PAY');

  // Persisted server-side in the same position.
  await page.reload();
  await expect(rows.nth(1)).toContainText('Fraud spike');
});

test('New Risk on a project with no requirements: hint shown, submit disabled', async ({ page }) => {
  await page.goto(`/projects/${emptyProjectId}/risks`);
  await page.getByRole('button', { name: 'New Risk' }).click();
  const dialog = page.getByRole('dialog', { name: 'Log New Risk' });
  await expect(dialog.getByText('This project has no requirements yet.', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Log Risk' })).toBeDisabled();
});

// ---------- Sidebar "Risk Analysis" selector ----------

test('sidebar Risk Analysis lists projects and opens a register', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Risk Analysis' }).click();
  await expect(page).toHaveURL(/\/risks$/);
  await expect(page.getByRole('heading', { name: 'Risk Analysis', level: 1 })).toBeVisible();
  await expect(page.getByText('Coming soon')).toHaveCount(0); // not the placeholder
  await page.getByRole('link', { name: new RegExp(PROJECT) }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/risks$`));
  await expect(page.getByRole('heading', { name: 'Risk Register', level: 1 })).toBeVisible();
});

// ---------- RBAC (last: changes the user's role) ----------

test('VIEWER sees the register but no New Risk button', async ({ page }) => {
  await prisma.user.update({ where: { id: userId }, data: { role: 'VIEWER' } });
  await page.goto(`/projects/${projectId}/risks`);
  await expect(page.getByRole('heading', { name: 'Risk Register', level: 1 })).toBeVisible();
  await expect(page.getByRole('row', { name: /Gateway outage/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Risk' })).toHaveCount(0);
});
