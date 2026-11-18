import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma, type Role } from '@proofloop/prisma';

/**
 * Module 4 API regression: Test Case Studio backend.
 * Nested step writes, tcId normalisation, step-number integrity, requirement
 * scoping, RBAC, tenant isolation, and that the /api mount stays non-invasive.
 */

const API = 'http://localhost:4000/api/';
const runId = Date.now();
const PASSWORD = 'Passw0rd!';
const ORG_PREFIX = `E2E TcOrg ${runId}`;

test.describe.configure({ mode: 'serial' });

let anon: APIRequestContext;
let admin: APIRequestContext;
let engineer: APIRequestContext;
let viewer: APIRequestContext;
let other: APIRequestContext;
let orgAId: string;
let projectId: string;
let project2Id: string;
let reqInProject: string;
let reqInProject2: string;
let otherOrgReq: string;
let tc1Id: string;

async function register(tag: string) {
  const email = `e2e-tc-${tag}-${runId}@example.com`;
  const res = await anon.post('auth/register', {
    data: { email, password: PASSWORD, firstName: 'E2E', lastName: tag, organizationName: `${ORG_PREFIX} ${tag}` },
  });
  expect(res.status()).toBe(201);
  const { user, token } = await res.json();
  return { id: user.id as string, organizationId: user.organizationId as string, token: token as string };
}

const client = (token: string) =>
  request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

async function memberOfOrgA(role: Role) {
  const u = await register(role.toLowerCase());
  await prisma.user.update({ where: { id: u.id }, data: { role, organizationId: orgAId } });
  return client(u.token);
}

async function makeRequirement(api: APIRequestContext, projId: string, reqId: string) {
  const mod = await (await api.post(`projects/${projId}/modules`, { data: { name: `Mod ${reqId}` } })).json();
  const r = await api.post(`modules/${mod.id}/requirements`, {
    data: { reqId, title: `${reqId} title`, description: 'd', priority: 'HIGH', businessCriticality: 'HIGH' },
  });
  return (await r.json()).id as string;
}

const tc = (tcId: string, extra: object = {}) => ({
  tcId,
  title: `${tcId} title`,
  priority: 'HIGH',
  testType: 'UI',
  automationStatus: 'MANUAL',
  ...extra,
});

test.beforeAll(async () => {
  anon = await request.newContext({ baseURL: API });
  const a = await register('admin');
  orgAId = a.organizationId;
  admin = await client(a.token);
  engineer = await memberOfOrgA('QA_ENGINEER');
  viewer = await memberOfOrgA('VIEWER');
  const o = await register('other');
  other = await client(o.token);

  projectId = (await (await admin.post('projects', { data: { name: 'TC Project' } })).json()).id;
  project2Id = (await (await admin.post('projects', { data: { name: 'TC Project 2' } })).json()).id;
  reqInProject = await makeRequirement(admin, projectId, 'REQ-LOGIN');
  reqInProject2 = await makeRequirement(admin, project2Id, 'REQ-ELSEWHERE');
  const otherProject = (await (await other.post('projects', { data: { name: 'Other' } })).json()).id;
  otherOrgReq = await makeRequirement(other, otherProject, 'REQ-OTHER');
});

test.afterAll(async () => {
  await Promise.all([anon, admin, engineer, viewer, other].map((c) => c?.dispose()));
  await prisma.organization.deleteMany({ where: { name: { startsWith: ORG_PREFIX } } });
  await prisma.$disconnect();
});

// ---------- Create ----------

test('create with steps: tcId uppercased, fields trimmed, steps numbered 1..n by array order', async () => {
  const res = await admin.post(`projects/${projectId}/test-cases`, {
    data: tc('  tc-001 ', {
      title: '  Login works  ',
      preconditions: ' User exists ',
      requirementId: reqInProject,
      steps: [
        { action: 'Open /login', expectedResult: 'Form visible' },
        { action: ' Click login ', expectedResult: ' Dashboard shown ' },
      ],
    }),
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  tc1Id = body.id;
  expect(body.tcId).toBe('TC-001');
  expect(body.title).toBe('Login works');
  expect(body.preconditions).toBe('User exists');
  expect(body.requirementId).toBe(reqInProject);
  expect(body.steps.map((s: { stepNumber: number; action: string }) => [s.stepNumber, s.action])).toEqual([
    [1, 'Open /login'],
    [2, 'Click login'],
  ]);
  expect(body.steps[1]).toMatchObject({ expectedResult: 'Dashboard shown' });
});

test('create without steps and with empty requirementId: no steps, requirement null', async () => {
  const res = await admin.post(`projects/${projectId}/test-cases`, { data: tc('TC-002', { requirementId: '' }) });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.steps).toEqual([]);
  expect(body.requirementId).toBeNull();
});

test('duplicate tcId (case-insensitive) returns 409', async () => {
  const res = await admin.post(`projects/${projectId}/test-cases`, { data: tc('Tc-001') });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toBe('A Test Case with this ID already exists in this project');
});

test('same tcId in another project is allowed', async () => {
  expect((await admin.post(`projects/${project2Id}/test-cases`, { data: tc('TC-001') })).status()).toBe(201);
});

// ---------- Step integrity ----------

test('client-sent stepNumbers (duplicate, gapped, zero) are ignored: server numbers 1..n', async () => {
  const res = await admin.post(`projects/${projectId}/test-cases`, {
    data: tc('TC-AUTONUM', {
      steps: [
        { stepNumber: 7, action: 'first', expectedResult: 'r1' },
        { stepNumber: 7, action: 'second', expectedResult: 'r2' },
        { stepNumber: 0, action: 'third', expectedResult: 'r3' },
      ],
    }),
  });
  expect(res.status()).toBe(201);
  const stored = await prisma.testStep.findMany({
    where: { testCase: { projectId, tcId: 'TC-AUTONUM' } },
    orderBy: { stepNumber: 'asc' },
  });
  expect(stored.map((s) => [s.stepNumber, s.action])).toEqual([
    [1, 'first'],
    [2, 'second'],
    [3, 'third'],
  ]);
  // Remove so later list assertions stay focused.
  await prisma.testCase.deleteMany({ where: { projectId, tcId: 'TC-AUTONUM' } });
});

test('invalid step content is rejected and nothing is created', async () => {
  for (const step of [
    { action: '   ', expectedResult: 'b' },
    { action: 'a', expectedResult: '' },
    { action: 'a' },
  ]) {
    const res = await admin.post(`projects/${projectId}/test-cases`, { data: tc('TC-BADSTEP', { steps: [step] }) });
    expect(res.status(), JSON.stringify(step)).toBe(400);
    expect((await res.json()).details.steps).toBeDefined();
  }
  expect(await prisma.testCase.count({ where: { projectId, tcId: 'TC-BADSTEP' } })).toBe(0);
});

// ---------- Field validation ----------

test('invalid enums and blank required fields are rejected with field messages', async () => {
  const res = await admin.post(`projects/${projectId}/test-cases`, {
    data: { tcId: '  ', title: ' ', priority: 'URGENT', testType: 'MANUAL', automationStatus: 'DONE' },
  });
  expect(res.status()).toBe(400);
  const { details } = await res.json();
  expect(details.tcId).toEqual(['Test Case ID is required']);
  expect(details.title).toEqual(['Title is required']);
  expect(details.priority).toEqual(['Invalid priority']);
  expect(details.testType).toEqual(['Invalid test type']);
  expect(details.automationStatus).toEqual(['Invalid automation status']);
});

// ---------- Requirement scoping ----------

test('requirementId from another project, another org, or unknown is rejected (400)', async () => {
  for (const requirementId of [reqInProject2, otherOrgReq, 'not-a-real-id']) {
    const res = await admin.post(`projects/${projectId}/test-cases`, { data: tc(`TC-REQ-${requirementId.slice(0, 4)}`, { requirementId }) });
    expect(res.status()).toBe(400);
    expect((await res.json()).details).toEqual({ requirementId: ['Invalid requirement ID for this project'] });
  }
});

// ---------- RBAC & tenancy ----------

test('VIEWER cannot create (403); QA_ENGINEER can (201)', async () => {
  expect((await viewer.post(`projects/${projectId}/test-cases`, { data: tc('TC-V') })).status()).toBe(403);
  expect((await engineer.post(`projects/${projectId}/test-cases`, { data: tc('TC-ENG') })).status()).toBe(201);
});

test('other org: 404 on create, list and detail; no token: 401', async () => {
  expect((await other.post(`projects/${projectId}/test-cases`, { data: tc('TC-X') })).status()).toBe(404);
  expect((await other.get(`projects/${projectId}/test-cases`)).status()).toBe(404);
  expect((await other.get(`test-cases/${tc1Id}`)).status()).toBe(404);
  expect((await anon.get(`projects/${projectId}/test-cases`)).status()).toBe(401);
  expect((await anon.get(`test-cases/${tc1Id}`)).status()).toBe(401);
  expect((await anon.post(`projects/${projectId}/test-cases`, { data: tc('TC-Y') })).status()).toBe(401);
});

// ---------- Read ----------

test('list: newest first, step counts, requirement summary; VIEWER can read', async () => {
  const res = await viewer.get(`projects/${projectId}/test-cases`);
  expect(res.status()).toBe(200);
  const list = await res.json();
  expect(list.map((t: { tcId: string }) => t.tcId)).toEqual(['TC-ENG', 'TC-002', 'TC-001']);
  const t1 = list.find((t: { tcId: string }) => t.tcId === 'TC-001');
  expect(t1._count).toEqual({ steps: 2 });
  expect(t1.requirement).toEqual({ reqId: 'REQ-LOGIN', title: 'REQ-LOGIN title' });
  expect(list.find((t: { tcId: string }) => t.tcId === 'TC-002').requirement).toBeNull();
});

test('detail: ordered steps and requirement summary; unknown id 404', async () => {
  const res = await viewer.get(`test-cases/${tc1Id}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.steps.map((s: { stepNumber: number; action: string }) => [s.stepNumber, s.action])).toEqual([
    [1, 'Open /login'],
    [2, 'Click login'],
  ]);
  expect(body.requirement).toEqual({ reqId: 'REQ-LOGIN', title: 'REQ-LOGIN title' });
  expect((await admin.get('test-cases/not-a-real-id')).status()).toBe(404);
});

test('requirement list reflects linked test case count', async () => {
  const req = await prisma.requirement.findUniqueOrThrow({ where: { id: reqInProject } });
  const list = await (await viewer.get(`modules/${req.moduleId}/requirements`)).json();
  expect(list[0]._count.testCases).toBe(1);
});

// ---------- Data model ----------

test('deleting the linked requirement keeps the test case (requirement set to null)', async () => {
  await prisma.requirement.delete({ where: { id: reqInProject } });
  const body = await (await admin.get(`test-cases/${tc1Id}`)).json();
  expect(body.requirementId).toBeNull();
  expect(body.steps).toHaveLength(2);
});

// ---------- Mount does not hijack other /api paths ----------

test('/api/health still public and unknown /api paths still 404', async () => {
  expect((await anon.get('health')).status()).toBe(200);
  expect((await anon.get('definitely-not-a-route')).status()).toBe(404);
});
