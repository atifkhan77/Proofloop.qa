import { test, expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * Traceability Matrix x Defect Intelligence: active (non-CLOSED) defects aggregated per
 * requirement through its test cases; API shape + UI column / counters.
 */

const API = 'http://localhost:4000/api/';
const TOKEN_KEY = 'proofloop-auth-token';
const runId = Date.now();
const ORG = `E2E RtmDef ${runId}`;

test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;
let token: string;
let projectId: string;
const defectIds: Record<string, string> = {};

type Row = {
  reqId: string;
  testCases: Record<string, unknown>[];
  activeDefects: { bugId: string; status: string; severity: string }[];
  hasActiveDefects: boolean;
  hasTestCoverage: boolean;
};

const matrix = async (): Promise<Record<string, Row>> =>
  Object.fromEntries(((await (await api.get(`projects/${projectId}/traceability`)).json()) as Row[]).map((r) => [r.reqId, r]));

test.beforeAll(async () => {
  const anon = await request.newContext({ baseURL: API });
  token = (await (await anon.post('auth/register', {
    data: { email: `e2e-rtmdef-${runId}@example.com`, password: 'Passw0rd!', firstName: 'R', lastName: 'D', organizationName: ORG },
  })).json()).token;
  await anon.dispose();
  api = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

  projectId = (await (await api.post('projects', { data: { name: 'RTM Defects' } })).json()).id;
  const moduleId = (await (await api.post(`projects/${projectId}/modules`, { data: { name: 'Checkout' } })).json()).id;
  const req = async (reqId: string) =>
    (await (await api.post(`modules/${moduleId}/requirements`, { data: { reqId, title: `${reqId} title`, description: 'd', priority: 'HIGH', businessCriticality: 'HIGH' } })).json()).id;
  const tc = async (tcId: string, requirementId?: string) =>
    (await (await api.post(`projects/${projectId}/test-cases`, { data: { tcId, title: `${tcId} title`, priority: 'HIGH', testType: 'UI', automationStatus: 'MANUAL', ...(requirementId ? { requirementId } : {}) } })).json()).id;
  const bug = async (bugId: string, status: string, severity: string, testCaseId?: string) => {
    const res = await api.post(`projects/${projectId}/defects`, { data: { bugId, title: `${bugId} title`, description: 'd', severity, status, ...(testCaseId ? { testCaseId } : {}) } });
    expect(res.status(), await res.text()).toBe(201);
    defectIds[bugId] = (await res.json()).id;
  };

  const reqA = await req('REQ-A');
  const reqB = await req('REQ-B');
  await req('REQ-C'); // no test cases
  const tc1 = await tc('TC-1', reqA);
  const tc2 = await tc('TC-2', reqA);
  await tc('TC-3', reqB); // linked, no defects
  const standalone = await tc('TC-SOLO');

  await bug('BUG-3', 'OPEN', 'CRITICAL', tc1);
  await bug('BUG-1', 'IN_REVIEW', 'LOW', tc1);
  await bug('BUG-9', 'CLOSED', 'HIGH', tc1); // closed: excluded
  await bug('BUG-2', 'IN_PROGRESS', 'MEDIUM', tc2);
  await bug('BUG-SOLO', 'OPEN', 'HIGH', standalone); // standalone test case: not attributable
  await bug('BUG-FREE', 'OPEN', 'HIGH'); // no test case: not attributable
});

test.afterAll(async () => {
  await api?.dispose();
  // Defects first: Defect.reporter is onDelete: Restrict (ISSUE-LOG DEF-02).
  await prisma.defect.deleteMany({ where: { project: { organization: { name: ORG } } } });
  await prisma.organization.deleteMany({ where: { name: ORG } });
  await prisma.$disconnect();
});

test('API: active defects aggregated per requirement via its test cases; CLOSED and unlinked excluded', async () => {
  const m = await matrix();
  expect(m['REQ-A'].activeDefects.map((d) => [d.bugId, d.status, d.severity])).toEqual([
    ['BUG-1', 'IN_REVIEW', 'LOW'], // TC-1, by bugId
    ['BUG-3', 'OPEN', 'CRITICAL'],
    ['BUG-2', 'IN_PROGRESS', 'MEDIUM'], // TC-2
  ]);
  expect(m['REQ-A'].hasActiveDefects).toBe(true);
  expect(m['REQ-B']).toMatchObject({ activeDefects: [], hasActiveDefects: false, hasTestCoverage: true });
  expect(m['REQ-C']).toMatchObject({ activeDefects: [], hasActiveDefects: false, hasTestCoverage: false });

  const all = Object.values(m).flatMap((r) => r.activeDefects.map((d) => d.bugId));
  expect(all).not.toContain('BUG-9');
  expect(all).not.toContain('BUG-SOLO');
  expect(all).not.toContain('BUG-FREE');
});

test('API: testCases payload unchanged (no nested defects)', async () => {
  const m = await matrix();
  for (const tc of m['REQ-A'].testCases) {
    expect(Object.keys(tc).sort()).toEqual(['automationStatus', 'id', 'tcId', 'testType', 'title']);
  }
});

test('API: closing a defect removes it; reopening brings it back', async () => {
  await api.patch(`defects/${defectIds['BUG-3']}`, { data: { status: 'CLOSED' } });
  expect((await matrix())['REQ-A'].activeDefects.map((d) => d.bugId)).toEqual(['BUG-1', 'BUG-2']);
  await api.patch(`defects/${defectIds['BUG-3']}`, { data: { status: 'OPEN' } });
  expect((await matrix())['REQ-A'].activeDefects.map((d) => d.bugId)).toEqual(['BUG-1', 'BUG-3', 'BUG-2']);
});

// ---------- UI ----------

const rowFor = (page: Page, reqId: string) =>
  page.getByRole('row').filter({ has: page.getByText(reqId, { exact: true }) });

test('UI: header counter, per-requirement status and Active Defects column', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, token] as const);
  await page.goto(`/projects/${projectId}/traceability`);

  await expect(page.getByRole('columnheader', { name: 'Active Defects' })).toBeVisible();
  const counter = page.getByRole('definition').filter({ hasText: /^\d+$/ }).last();
  await expect(page.getByRole('term').filter({ hasText: 'Active Bugs (linked)' })).toBeVisible();
  await expect(counter).toHaveText('3');

  const a = rowFor(page, 'REQ-A');
  await expect(a).toContainText('3 Active Bugs');
  const cells = a.getByRole('cell');
  await expect(cells).toHaveCount(5);
  await expect(cells.nth(4).getByRole('link')).toHaveText(['BUG-1', 'BUG-3', 'BUG-2']);
  await expect(cells.nth(4)).not.toContainText('BUG-9');

  await expect(rowFor(page, 'REQ-B')).toContainText('No Active Bugs');
  await expect(rowFor(page, 'REQ-B').getByRole('cell').nth(4)).toHaveText('No active bugs');
  const c = rowFor(page, 'REQ-C');
  await expect(c).toContainText('Missing Tests');
  await expect(c).toContainText('No Active Bugs'); // not "Bug Free"
  await expect(page.getByText('Bug Free')).toHaveCount(0);

  // Module group row spans all 5 columns.
  await expect(page.getByRole('cell', { name: 'Module: Checkout' })).toHaveAttribute('colspan', '5');

  await cells.nth(4).getByRole('link', { name: 'BUG-3' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/defects$`));
});
