import { test, expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * Module 10 UI: Defect Intelligence page, create/edit modal (incl. clearing fields in edit
 * mode), search, picker, RBAC, phone layout.
 */

const API = 'http://localhost:4000/api/';
const TOKEN_KEY = 'proofloop-auth-token';
const runId = Date.now();
const ORG_PREFIX = `E2E DefUi ${runId}`;
const PROJECT = `Defects UI ${runId}`;

test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;
let token: string;
let adminId: string;
let engineerId: string;
let projectId: string;

test.beforeAll(async () => {
  const anon = await request.newContext({ baseURL: API });
  const reg = async (tag: string) =>
    (await (await anon.post('auth/register', {
      data: { email: `e2e-defui-${tag}-${runId}@example.com`, password: 'Passw0rd!', firstName: tag === 'admin' ? 'Ada' : 'Eve', lastName: 'Lovelace', organizationName: `${ORG_PREFIX} ${tag}` },
    })).json()) as { token: string; user: { id: string; organizationId: string } };
  const a = await reg('admin');
  token = a.token;
  adminId = a.user.id;
  const e = await reg('engineer');
  engineerId = e.user.id;
  await prisma.user.update({ where: { id: engineerId }, data: { role: 'QA_ENGINEER', organizationId: a.user.organizationId } });
  await anon.dispose();

  api = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  projectId = (await (await api.post('projects', { data: { name: PROJECT } })).json()).id;
  await api.post(`projects/${projectId}/test-cases`, { data: { tcId: 'TC-LOGIN', title: 'Valid login', priority: 'HIGH', testType: 'UI', automationStatus: 'MANUAL' } });
});

test.afterAll(async () => {
  await api?.dispose();
  // Defects first: Defect.reporter is onDelete: Restrict (ISSUE-LOG DEF-02).
  const orgs = { name: { startsWith: ORG_PREFIX } };
  await prisma.defect.deleteMany({ where: { project: { organization: orgs } } });
  await prisma.organization.deleteMany({ where: orgs });
  await prisma.$disconnect();
});

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, token] as const);
});

const dataRows = (page: Page) => page.getByRole('row').filter({ hasNot: page.getByRole('columnheader') });
const dialog = (page: Page) => page.getByRole('dialog');

test('project page links to Defect Intelligence; empty state', async ({ page }) => {
  await page.goto(`/projects/${projectId}`);
  await page.getByRole('main').getByRole('link', { name: /Defect Intelligence/ }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/defects$`));
  await expect(page.getByRole('heading', { name: 'Defect Intelligence', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: `Back to ${PROJECT}` })).toBeVisible();
  await expect(page.getByText('No defects have been reported for this project.')).toBeVisible();
});

test('sidebar Defect Intelligence opens the project picker, then the defects page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Defect Intelligence' }).click();
  await expect(page).toHaveURL(/\/defects$/);
  await expect(page.getByRole('heading', { name: 'Defect Intelligence', level: 1 })).toBeVisible();
  await expect(page.getByText('Coming soon')).toHaveCount(0);
  await page.getByRole('link', { name: new RegExp(PROJECT) }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/defects$`));
});

test('create: validation, then a defect linked to a test case and assigned; row shows names', async ({ page }) => {
  await page.goto(`/projects/${projectId}/defects`);
  await page.getByRole('button', { name: 'Report Bug' }).click();
  const d = dialog(page);
  await expect(d).toHaveAccessibleName('Report New Defect');
  await d.getByRole('button', { name: 'Create Defect' }).click();
  await expect(d.getByText('Bug ID is required')).toBeVisible();
  await expect(d.getByText('Title is required')).toBeVisible();
  await expect(d.getByText('Description is required')).toBeVisible();

  await d.getByLabel('Bug ID').fill(' bug-101 ');
  await d.getByLabel('Title').fill('Login button does nothing');
  await d.getByLabel('Severity').selectOption('CRITICAL');
  await d.getByLabel('Description').fill('Clicking Login has no effect');
  await d.getByLabel('Steps to Reproduce (Optional)').fill('1. Open /login\n2. Click Login');
  await d.getByLabel('Linked Test Case (Optional)').selectOption({ label: 'TC-LOGIN - Valid login' });
  await d.getByLabel('Assignee (Optional)').selectOption(engineerId);
  await d.getByRole('button', { name: 'Create Defect' }).click();
  await expect(d).toBeHidden();

  const row = dataRows(page).first();
  await expect(row).toContainText('BUG-101');
  await expect(row).toContainText('Login button does nothing');
  await expect(row).toContainText('CRITICAL');
  await expect(row).toContainText('OPEN');
  await expect(row.getByRole('cell').nth(3)).toHaveText('Ada Lovelace'); // reporter = caller
  await expect(row.getByRole('cell').nth(4)).toHaveText('Eve Lovelace');

  const saved = await prisma.defect.findFirstOrThrow({ where: { projectId, bugId: 'BUG-101' }, include: { testCase: true } });
  expect(saved).toMatchObject({ reporterId: adminId, assigneeId: engineerId, stepsToReproduce: '1. Open /login\n2. Click Login' });
  expect(saved.testCase?.tcId).toBe('TC-LOGIN');
});

test('edit: Bug ID and test case fixed; status changed; steps cleared; unassigned', async ({ page }) => {
  await page.goto(`/projects/${projectId}/defects`);
  await page.getByRole('button', { name: 'Edit BUG-101' }).click();
  const d = dialog(page);
  await expect(d).toHaveAccessibleName('Edit Defect: BUG-101');
  await expect(d.getByLabel('Bug ID')).toBeDisabled();
  await expect(d.getByLabel('Linked Test Case (Optional)')).toBeDisabled();
  await expect(d.getByLabel('Steps to Reproduce (Optional)')).toHaveValue('1. Open /login\n2. Click Login');

  await d.getByLabel('Status').selectOption('IN_PROGRESS');
  await d.getByLabel('Steps to Reproduce (Optional)').fill('');
  await d.getByLabel('Assignee (Optional)').selectOption('');
  await d.getByRole('button', { name: 'Update Defect' }).click();
  await expect(d).toBeHidden();

  const row = dataRows(page).first();
  await expect(row).toContainText('IN PROGRESS');
  await expect(row.getByRole('cell').nth(4)).toHaveText('Unassigned');
  const saved = await prisma.defect.findFirstOrThrow({ where: { projectId, bugId: 'BUG-101' } });
  expect(saved).toMatchObject({ status: 'IN_PROGRESS', stepsToReproduce: null, assigneeId: null, bugId: 'BUG-101' });
  expect(saved.testCaseId).not.toBeNull(); // link kept
});

// Unknown assignee IDs can no longer be entered (assignee is a member dropdown); the API
// rejection ('Invalid Assignee ID') is covered in defects-api.spec.ts.
test('API errors shown in the modal (duplicate Bug ID); assignee limited to members; Escape closes and clears', async ({ page }) => {
  await page.goto(`/projects/${projectId}/defects`);
  await page.getByRole('button', { name: 'Report Bug' }).click();
  const d = dialog(page);
  await d.getByLabel('Bug ID').fill('Bug-101');
  await d.getByLabel('Title').fill('Dup');
  await d.getByLabel('Description').fill('Dup');
  await d.getByRole('button', { name: 'Create Defect' }).click();
  await expect(d.getByRole('alert')).toHaveText('A defect with this Bug ID already exists in this project');

  const assignee = d.getByLabel('Assignee (Optional)');
  await expect(assignee.locator('option[value="00000000-0000-0000-0000-000000000000"]')).toHaveCount(0);
  await expect(assignee.locator(`option[value="${engineerId}"]`)).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
  await page.getByRole('button', { name: 'Report Bug' }).click();
  await expect(d.getByRole('alert')).toHaveCount(0);
  await expect(d.getByLabel('Bug ID')).toHaveValue('');
});

test('search filters by Bug ID and title; no-match message', async ({ page }) => {
  await api.post(`projects/${projectId}/defects`, { data: { bugId: 'BUG-200', title: 'Avatar upload fails', description: 'x', severity: 'LOW' } });
  await page.goto(`/projects/${projectId}/defects`);
  await expect(dataRows(page)).toHaveCount(2);
  const search = page.getByRole('searchbox', { name: 'Search defects' });
  await search.fill('avatar');
  await expect(dataRows(page)).toHaveCount(1);
  await expect(dataRows(page).first()).toContainText('BUG-200');
  await search.fill('bug-101');
  await expect(dataRows(page).first()).toContainText('BUG-101');
  await search.fill('nothing-matches');
  await expect(page.getByText('Try adjusting your search.')).toBeVisible();
});

test('unknown project shows "Project not found"', async ({ page }) => {
  await page.goto('/projects/00000000-0000-0000-0000-000000000000/defects');
  await expect(page.getByRole('alert')).toHaveText('Project not found');
});

test('phone width: page has no horizontal scroll (table scrolls inside its container)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/projects/${projectId}/defects`);
  await expect(dataRows(page)).toHaveCount(2);
  const overflow = await page.getByRole('main').evaluate((m) => m.scrollWidth - m.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('VIEWER sees defects but no Report Bug or Edit controls', async ({ page }) => {
  await prisma.user.update({ where: { id: adminId }, data: { role: 'VIEWER' } });
  await page.goto(`/projects/${projectId}/defects`);
  await expect(dataRows(page)).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Report Bug' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0);
});
