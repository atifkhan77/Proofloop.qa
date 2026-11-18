import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma, type Role } from '@proofloop/prisma';

/**
 * Module 10 Defect Intelligence backend: create/list/detail/update, validation, Bug ID
 * uniqueness, test case / assignee scoping, reporter = caller, RBAC, tenancy, delete rules.
 */

const API = 'http://localhost:4000/api/';
const runId = Date.now();
const ORG_PREFIX = `E2E Defects ${runId}`;

test.describe.configure({ mode: 'serial' });

let anon: APIRequestContext;
let admin: APIRequestContext;
let engineer: APIRequestContext;
let viewer: APIRequestContext;
let other: APIRequestContext;
let adminId: string;
let engineerId: string;
let otherUserId: string;
let orgAId: string;
let projectId: string;
let project2Id: string;
let otherProjectId: string;
let testCaseId: string;
let project2TestCaseId: string;
let defectId: string;

async function register(tag: string) {
  const res = await anon.post('auth/register', {
    data: { email: `e2e-defects-${tag}-${runId}@example.com`, password: 'Passw0rd!', firstName: 'D', lastName: tag, organizationName: `${ORG_PREFIX} ${tag}` },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { token: string; user: { id: string; organizationId: string } };
}
const client = (token: string) => request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

async function memberOfOrgA(role: Role) {
  const u = await register(role.toLowerCase());
  await prisma.user.update({ where: { id: u.user.id }, data: { role, organizationId: orgAId } });
  return { ctx: await client(u.token), id: u.user.id };
}

const base = { title: 'Login fails', description: 'Valid credentials rejected', severity: 'HIGH' };

test.beforeAll(async () => {
  anon = await request.newContext({ baseURL: API });
  const a = await register('admin');
  orgAId = a.user.organizationId;
  adminId = a.user.id;
  admin = await client(a.token);
  const e = await memberOfOrgA('QA_ENGINEER');
  engineer = e.ctx;
  engineerId = e.id;
  viewer = (await memberOfOrgA('VIEWER')).ctx;
  const o = await register('other');
  other = await client(o.token);
  otherUserId = o.user.id;

  projectId = (await (await admin.post('projects', { data: { name: 'Defects' } })).json()).id;
  project2Id = (await (await admin.post('projects', { data: { name: 'Defects 2' } })).json()).id;
  otherProjectId = (await (await other.post('projects', { data: { name: 'Other' } })).json()).id;
  testCaseId = (await (await admin.post(`projects/${projectId}/test-cases`, { data: { tcId: 'TC-LOGIN', title: 'Login', priority: 'HIGH', testType: 'UI', automationStatus: 'MANUAL' } })).json()).id;
  project2TestCaseId = (await (await admin.post(`projects/${project2Id}/test-cases`, { data: { tcId: 'TC-X', title: 'X', priority: 'LOW', testType: 'API', automationStatus: 'MANUAL' } })).json()).id;
});

test.afterAll(async () => {
  await Promise.all([anon, admin, engineer, viewer, other].map((c) => c?.dispose()));
  // Defects first: Defect.reporter is onDelete: Restrict, which blocks deleting an
  // organization that still has defects (ISSUE-LOG DEF-02).
  const orgs = { name: { startsWith: ORG_PREFIX } };
  await prisma.defect.deleteMany({ where: { project: { organization: orgs } } });
  await prisma.organization.deleteMany({ where: orgs });
  await prisma.$disconnect();
});

// ---------- Create ----------

test('create: Bug ID trimmed + uppercased, default OPEN, reporter = caller (body ignored), blank steps -> null', async () => {
  const res = await engineer.post(`projects/${projectId}/defects`, {
    data: { ...base, bugId: '  bug-001 ', stepsToReproduce: '   ', reporterId: adminId, testCaseId, assigneeId: adminId },
  });
  expect(res.status()).toBe(201);
  const d = await res.json();
  expect(d).toMatchObject({
    bugId: 'BUG-001',
    status: 'OPEN',
    severity: 'HIGH',
    stepsToReproduce: null,
    testCaseId,
    reporterId: engineerId,
    reporter: { id: engineerId, firstName: 'D', lastName: 'qa_engineer' },
    assignee: { id: adminId },
  });
  expect(d.reporter.email).toBeUndefined(); // only id + names are exposed
  defectId = d.id;
});

test('validation: blank title/description/bugId, invalid severity and status', async () => {
  const res = await admin.post(`projects/${projectId}/defects`, { data: { bugId: ' ', title: ' ', description: ' ', severity: 'URGENT', status: 'DONE' } });
  expect(res.status()).toBe(400);
  expect((await res.json()).details).toEqual({
    bugId: ['Bug ID is required'],
    title: ['Title is required'],
    description: ['Description is required'],
    severity: ['Invalid severity'],
    status: ['Invalid status'],
  });
});

test('Bug ID unique per project, case-insensitive; same ID allowed in another project', async () => {
  const dup = await admin.post(`projects/${projectId}/defects`, { data: { ...base, bugId: 'Bug-001' } });
  expect(dup.status()).toBe(409);
  expect(await dup.json()).toEqual({ error: 'A defect with this Bug ID already exists in this project' });
  expect((await admin.post(`projects/${project2Id}/defects`, { data: { ...base, bugId: 'BUG-001' } })).status()).toBe(201);
});

test('test case must be in the same project; assignee must be in the same organization', async () => {
  const foreignTc = await admin.post(`projects/${projectId}/defects`, { data: { ...base, bugId: 'BUG-X1', testCaseId: project2TestCaseId } });
  expect(foreignTc.status()).toBe(400);
  expect((await foreignTc.json()).details).toEqual({ testCaseId: ['Invalid Test Case ID'] });

  const foreignUser = await admin.post(`projects/${projectId}/defects`, { data: { ...base, bugId: 'BUG-X2', assigneeId: otherUserId } });
  expect(foreignUser.status()).toBe(400);
  expect((await foreignUser.json()).details).toEqual({ assigneeId: ['Invalid Assignee ID'] });
  expect(await prisma.defect.count({ where: { projectId, bugId: { in: ['BUG-X1', 'BUG-X2'] } } })).toBe(0);
});

// ---------- Read ----------

test('list newest first with reporter/assignee; detail includes the linked test case', async () => {
  await admin.post(`projects/${projectId}/defects`, { data: { ...base, bugId: 'BUG-002', severity: 'LOW' } });
  const list = await (await viewer.get(`projects/${projectId}/defects`)).json();
  expect(list.map((d: { bugId: string }) => d.bugId)).toEqual(['BUG-002', 'BUG-001']);
  expect(list[1].reporter.id).toBe(engineerId);

  const detail = await (await viewer.get(`defects/${defectId}`)).json();
  expect(detail.testCase).toEqual({ id: testCaseId, tcId: 'TC-LOGIN', title: 'Login' });
});

// ---------- Update ----------

test('update: status/severity/title, clear steps with "", unassign with ""; untouched fields unchanged', async () => {
  await admin.patch(`defects/${defectId}`, { data: { stepsToReproduce: '1. open /login' } });
  const res = await engineer.patch(`defects/${defectId}`, { data: { status: 'IN_PROGRESS', severity: 'CRITICAL', title: '  Login broken  ' } });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: 'IN_PROGRESS', severity: 'CRITICAL', title: 'Login broken', stepsToReproduce: '1. open /login', assigneeId: adminId });

  const cleared = await (await admin.patch(`defects/${defectId}`, { data: { stepsToReproduce: '', assigneeId: '' } })).json();
  expect(cleared).toMatchObject({ stepsToReproduce: null, assigneeId: null, assignee: null, status: 'IN_PROGRESS' });

  const reassigned = await (await admin.patch(`defects/${defectId}`, { data: { assigneeId: engineerId } })).json();
  expect(reassigned.assignee.id).toBe(engineerId);

  const noop = await admin.patch(`defects/${defectId}`, { data: {} });
  expect(noop.status()).toBe(200);
  expect((await noop.json()).title).toBe('Login broken');
});

test('update validation: blank title, invalid status, foreign assignee; reporter cannot be changed', async () => {
  const blank = await admin.patch(`defects/${defectId}`, { data: { title: '  ' } });
  expect(blank.status()).toBe(400);
  expect((await blank.json()).details).toEqual({ title: ['Title is required'] });
  expect((await admin.patch(`defects/${defectId}`, { data: { status: 'DONE' } })).status()).toBe(400);
  const foreign = await admin.patch(`defects/${defectId}`, { data: { assigneeId: otherUserId } });
  expect(foreign.status()).toBe(400);

  const sneaky = await (await admin.patch(`defects/${defectId}`, { data: { reporterId: adminId, bugId: 'HACKED' } })).json();
  expect(sneaky.reporterId).toBe(engineerId);
  expect(sneaky.bugId).toBe('BUG-001');
});

// ---------- RBAC & tenancy ----------

test('VIEWER reads but gets 403 on create/update; other org 404 everywhere; no token 401', async () => {
  expect((await viewer.post(`projects/${projectId}/defects`, { data: { ...base, bugId: 'V-1' } })).status()).toBe(403);
  expect((await viewer.patch(`defects/${defectId}`, { data: { status: 'CLOSED' } })).status()).toBe(403);

  expect((await other.get(`projects/${projectId}/defects`)).status()).toBe(404);
  expect((await other.post(`projects/${projectId}/defects`, { data: { ...base, bugId: 'O-1' } })).status()).toBe(404);
  expect((await other.get(`defects/${defectId}`)).status()).toBe(404);
  expect((await other.patch(`defects/${defectId}`, { data: { status: 'CLOSED' } })).status()).toBe(404);
  expect((await admin.get(`projects/${otherProjectId}/defects`)).status()).toBe(404);
  expect((await admin.get('defects/00000000-0000-0000-0000-000000000000')).status()).toBe(404);

  expect((await anon.get(`projects/${projectId}/defects`)).status()).toBe(401);
  expect((await anon.patch(`defects/${defectId}`, { data: {} })).status()).toBe(401);
  expect((await anon.get('health')).status()).toBe(200); // router does not intercept /api/health
});

// ---------- Delete rules ----------

test('deleting the linked test case or the assignee keeps the defect (links set to null)', async () => {
  await prisma.testCase.delete({ where: { id: testCaseId } });
  const afterTc = await prisma.defect.findUniqueOrThrow({ where: { id: defectId } });
  expect(afterTc.testCaseId).toBeNull();

  const tmp = await memberOfOrgA('QA_LEAD');
  await admin.patch(`defects/${defectId}`, { data: { assigneeId: tmp.id } });
  await prisma.user.delete({ where: { id: tmp.id } });
  const afterUser = await prisma.defect.findUniqueOrThrow({ where: { id: defectId } });
  expect(afterUser.assigneeId).toBeNull();
  await tmp.ctx.dispose();
});

test('Restrict: a reporter with defects cannot be deleted, nor can their organization until its defects are removed', async () => {
  await expect(prisma.user.delete({ where: { id: engineerId } })).rejects.toThrow(/Defect_reporterId_fkey/);

  const t = await register('teardown');
  const tc = await client(t.token);
  const p = (await (await tc.post('projects', { data: { name: 'T' } })).json()).id;
  expect((await tc.post(`projects/${p}/defects`, { data: { ...base, bugId: 'T-1' } })).status()).toBe(201);
  await tc.dispose();

  // Documented limitation (DEF-02): the org delete is blocked by the reporter constraint.
  await expect(prisma.organization.delete({ where: { id: t.user.organizationId } })).rejects.toThrow(/Defect_reporterId_fkey/);
  await prisma.defect.deleteMany({ where: { projectId: p } });
  await prisma.organization.delete({ where: { id: t.user.organizationId } });
  expect(await prisma.project.count({ where: { id: p } })).toBe(0);
});
