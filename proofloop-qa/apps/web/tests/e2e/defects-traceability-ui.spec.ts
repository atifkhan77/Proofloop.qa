import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * Module 10 end-to-end scenario (user-supplied spec, corrected to the implemented app):
 * defects board (list, search, create, edit) -> traceability matrix aggregation.
 *
 * Corrections vs. the pasted version (each observed in a verbatim run, 2026-11-11):
 *  - requirement needs priority + businessCriticality (was 400)
 *  - test cases are created at /projects/:id/test-cases with requirementId (/requirements/:id/test-cases -> 404)
 *  - browser token key is 'proofloop-auth-token' (was 'proofloop_token' -> not logged in)
 *  - serial mode: test 2 uses BUG-003 created in test 1 (non-serial re-ran beforeAll, 2 orgs per run)
 *  - cells located by exact text: the "Edit BUG-001" button made getByRole('cell', { name: 'BUG-001' }) ambiguous
 *  - matrix counter is labelled "Active Bugs (linked)" (dt/dd), pill reads "2 Active Bugs" (not "Bug(s)")
 *  - "E2E " org name + cleanup (defects first: Defect.reporter is Restrict, DEF-02)
 */

const API = 'http://localhost:4000/api/';
const TOKEN_KEY = 'proofloop-auth-token';
const runId = Date.now();
const ORG = `E2E DefTrace ${runId}`;

test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;
let adminToken: string;
let projectId: string;

test.beforeAll(async () => {
  const anon = await request.newContext({ baseURL: API });
  const admin = await anon.post('auth/register', {
    data: { email: `e2e-deftrace-${runId}@example.com`, password: 'Passw0rd!', firstName: 'QA', lastName: 'Lead', organizationName: ORG },
  });
  expect(admin.status()).toBe(201);
  adminToken = (await admin.json()).token;
  await anon.dispose();
  api = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${adminToken}` } });

  projectId = (await (await api.post('projects', { data: { name: 'Traceability Project' } })).json()).id;
  const moduleId = (await (await api.post(`projects/${projectId}/modules`, { data: { name: 'Authentication' } })).json()).id;
  const reqRes = await api.post(`modules/${moduleId}/requirements`, {
    data: { reqId: 'REQ-AUTH-01', title: 'User Login', description: 'Allows user login', priority: 'HIGH', businessCriticality: 'HIGH' },
  });
  expect(reqRes.status()).toBe(201);
  const requirementId = (await reqRes.json()).id;
  const tcRes = await api.post(`projects/${projectId}/test-cases`, {
    data: { tcId: 'TC-001', title: 'Valid Login', priority: 'HIGH', testType: 'UI', automationStatus: 'MANUAL', requirementId },
  });
  expect(tcRes.status()).toBe(201);
  const tcId = (await tcRes.json()).id;

  for (const data of [
    { bugId: 'BUG-001', title: 'Login button disabled', description: 'Button stays disabled', severity: 'HIGH', status: 'OPEN', testCaseId: tcId },
    { bugId: 'BUG-002', title: 'Typo on login screen', description: 'Spelling error', severity: 'LOW', status: 'CLOSED', testCaseId: tcId },
  ]) {
    expect((await api.post(`projects/${projectId}/defects`, { data })).status()).toBe(201);
  }
});

test.afterAll(async () => {
  await api?.dispose();
  await prisma.defect.deleteMany({ where: { project: { organization: { name: ORG } } } });
  await prisma.organization.deleteMany({ where: { name: ORG } });
  await prisma.$disconnect();
});

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, adminToken] as const);
});

test('Defect board: list, search, create, edit', async ({ page }) => {
  await page.goto(`/projects/${projectId}/defects`);
  // Relative locator: also used as `has:` inside row filters (evaluated against each row).
  const bugId = (id: string) => page.getByText(id, { exact: true });

  // 1. Seeded defects listed
  await expect(bugId('BUG-001')).toBeVisible();
  await expect(bugId('BUG-002')).toBeVisible();

  // 2. Search
  await page.getByPlaceholder('Search bugs...').fill('BUG-001');
  await expect(bugId('BUG-001')).toBeVisible();
  await expect(bugId('BUG-002')).toBeHidden();
  await page.getByPlaceholder('Search bugs...').fill('');

  // 3. Create BUG-003 linked to TC-001
  await page.getByRole('button', { name: 'Report Bug' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report New Defect' });
  await dialog.getByLabel('Bug ID').fill('BUG-003');
  await dialog.getByLabel('Title').fill('Session timeout crash');
  await dialog.getByLabel('Description').fill('App crashes after 15 mins of inactivity');
  await dialog.getByLabel('Severity').selectOption('CRITICAL');
  await dialog.getByLabel('Linked Test Case (Optional)').selectOption({ label: 'TC-001 - Valid Login' });
  await dialog.getByRole('button', { name: 'Create Defect' }).click();
  await expect(dialog).toBeHidden();
  const bug3Row = page.getByRole('row').filter({ has: bugId('BUG-003') });
  await expect(bug3Row.getByRole('cell', { name: 'CRITICAL', exact: true })).toBeVisible();

  // 4. Edit BUG-001 -> IN_PROGRESS; Bug ID disabled while editing
  const bug1Row = page.getByRole('row').filter({ has: bugId('BUG-001') });
  await bug1Row.getByRole('button', { name: 'Edit BUG-001' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Defect: BUG-001' });
  await expect(edit.getByLabel('Bug ID')).toBeDisabled();
  await edit.getByLabel('Status').selectOption('IN_PROGRESS');
  await edit.getByRole('button', { name: 'Update Defect' }).click();
  await expect(edit).toBeHidden();
  await expect(bug1Row.getByRole('cell', { name: 'IN PROGRESS', exact: true })).toBeVisible();
});

test('Traceability matrix: active defects aggregated, CLOSED excluded, link to the board', async ({ page }) => {
  // BUG-001 (IN_PROGRESS) and BUG-003 (OPEN) are active; BUG-002 is CLOSED.
  await page.goto(`/projects/${projectId}/traceability`);

  const counter = page.getByRole('term').filter({ hasText: 'Active Bugs (linked)' }).locator('xpath=following-sibling::dd[1]');
  await expect(counter).toHaveText('2');

  const reqRow = page.getByRole('row').filter({ has: page.getByText('REQ-AUTH-01', { exact: true }) });
  await expect(reqRow.getByText('2 Active Bugs')).toBeVisible();
  await expect(reqRow.getByRole('link', { name: 'BUG-001' })).toBeVisible();
  await expect(reqRow.getByRole('link', { name: 'BUG-003' })).toBeVisible();
  await expect(reqRow.getByRole('link', { name: 'BUG-002' })).toHaveCount(0);

  await reqRow.getByRole('link', { name: 'BUG-001' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/defects$`));
});
