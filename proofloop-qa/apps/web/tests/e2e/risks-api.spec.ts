import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma, type Role } from '@proofloop/prisma';

/**
 * Phase 3 API regression: Risk Intelligence Engine.
 * Server-side score/level calculation, validation bounds, RBAC, tenant isolation,
 * register ordering, and that the /api-level mount does not hijack other /api paths.
 */

const API = 'http://localhost:4000/api/';
const runId = Date.now();
const PASSWORD = 'Passw0rd!';
const ORG_PREFIX = `E2E RiskOrg ${runId}`;

test.describe.configure({ mode: 'serial' });

let anon: APIRequestContext;
let admin: APIRequestContext;
let engineer: APIRequestContext;
let viewer: APIRequestContext;
let other: APIRequestContext;
let orgAId: string;
let projectId: string;
let reqA: string; // requirement REQ-A
let reqB: string; // requirement REQ-B

async function register(tag: string) {
  const email = `e2e-risk-${tag}-${runId}@example.com`;
  const res = await anon.post('auth/register', {
    data: { email, password: PASSWORD, firstName: 'E2E', lastName: tag, organizationName: `${ORG_PREFIX} ${tag}` },
  });
  expect(res.status()).toBe(201);
  const { user, token } = await res.json();
  return { id: user.id as string, organizationId: user.organizationId as string, email, token: token as string };
}

const client = (token: string) =>
  request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

/** Register then move into org A with `role` (authenticate reads role/org from DB, so the token stays valid). */
async function memberOfOrgA(role: Role) {
  const u = await register(role.toLowerCase());
  await prisma.user.update({ where: { id: u.id }, data: { role, organizationId: orgAId } });
  return client(u.token);
}

const risk = (probability: unknown, impact: unknown, extra: object = {}) => ({
  title: `Risk ${probability}x${impact}`,
  description: 'Payment gateway timeout',
  probability,
  impact,
  ...extra,
});

test.beforeAll(async () => {
  anon = await request.newContext({ baseURL: API });

  const a = await register('admin');
  orgAId = a.organizationId;
  admin = await client(a.token);
  engineer = await memberOfOrgA('QA_ENGINEER');
  viewer = await memberOfOrgA('VIEWER');
  other = await client((await register('other')).token);

  projectId = (await (await admin.post('projects', { data: { name: 'Risk Project' } })).json()).id;
  const moduleId = (await (await admin.post(`projects/${projectId}/modules`, { data: { name: 'Payments' } })).json()).id;
  const mk = async (reqId: string) =>
    (
      await (
        await admin.post(`modules/${moduleId}/requirements`, {
          data: { reqId, title: `${reqId} title`, description: 'd', priority: 'HIGH', businessCriticality: 'CRITICAL' },
        })
      ).json()
    ).id as string;
  reqA = await mk('REQ-A');
  reqB = await mk('REQ-B');
});

test.afterAll(async () => {
  await Promise.all([anon, admin, engineer, viewer, other].map((c) => c?.dispose()));
  await prisma.organization.deleteMany({ where: { name: { startsWith: ORG_PREFIX } } });
  await prisma.$disconnect();
});

// ---------- Score & level (server-calculated) ----------

const cases: Array<[number, number, number, string]> = [
  [1, 1, 1, 'LOW'],
  [1, 5, 5, 'LOW'], // highest LOW
  [2, 3, 6, 'MEDIUM'], // lowest MEDIUM
  [3, 3, 9, 'MEDIUM'],
  [2, 5, 10, 'MEDIUM'], // highest MEDIUM
  [3, 4, 12, 'HIGH'], // lowest HIGH
  [4, 4, 16, 'HIGH'], // highest HIGH
  [4, 5, 20, 'CRITICAL'], // lowest CRITICAL
  [5, 5, 25, 'CRITICAL'],
];

for (const [p, i, score, level] of cases) {
  test(`probability ${p} x impact ${i} -> score ${score}, ${level}`, async () => {
    const res = await admin.post(`requirements/${reqA}/risks`, { data: risk(p, i) });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.riskScore).toBe(score);
    expect(body.level).toBe(level);
    expect(body.requirementId).toBe(reqA);
  });
}

test('client-supplied riskScore/level are ignored', async () => {
  const res = await admin.post(`requirements/${reqB}/risks`, {
    data: risk(1, 2, { riskScore: 25, level: 'CRITICAL', title: 'Tamper attempt' }),
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.riskScore).toBe(2);
  expect(body.level).toBe('LOW');
});

test('text fields are trimmed; mitigation optional', async () => {
  const res = await admin.post(`requirements/${reqB}/risks`, {
    data: risk(2, 2, { title: '  Trimmed  ', mitigation: '  Add retries  ' }),
  });
  const body = await res.json();
  expect(body.title).toBe('Trimmed');
  expect(body.mitigation).toBe('Add retries');
});

// ---------- Validation ----------

test('out-of-range, non-integer and string scales are rejected', async () => {
  for (const [p, i] of [[0, 3], [6, 3], [3, 0], [3, 6], [2.5, 3], ['3', 3]] as const) {
    const res = await admin.post(`requirements/${reqA}/risks`, { data: risk(p, i) });
    expect(res.status(), `p=${JSON.stringify(p)} i=${JSON.stringify(i)}`).toBe(400);
  }
  const res = await admin.post(`requirements/${reqA}/risks`, { data: risk(0, 6) });
  const { details } = await res.json();
  expect(details.probability).toEqual(['Probability must be at least 1']);
  expect(details.impact).toEqual(['Impact cannot exceed 5']);
});

test('blank title/description are rejected', async () => {
  const res = await admin.post(`requirements/${reqA}/risks`, {
    data: risk(2, 2, { title: '   ', description: '   ' }),
  });
  expect(res.status()).toBe(400);
  const { details } = await res.json();
  expect(details.title).toEqual(['Risk title is required']);
  expect(details.description).toEqual(['Risk description is required']);
});

// ---------- RBAC & tenancy ----------

test('VIEWER cannot create a risk (403); QA_ENGINEER can (201)', async () => {
  expect((await viewer.post(`requirements/${reqA}/risks`, { data: risk(1, 1) })).status()).toBe(403);
  expect((await engineer.post(`requirements/${reqA}/risks`, { data: risk(1, 1) })).status()).toBe(201);
});

test('other org cannot create risks on, or read the register of, this project (404)', async () => {
  expect((await other.post(`requirements/${reqA}/risks`, { data: risk(1, 1) })).status()).toBe(404);
  expect((await other.get(`projects/${projectId}/risks`)).status()).toBe(404);
});

test('unknown requirement / project return 404; no token returns 401', async () => {
  expect((await admin.post('requirements/not-a-real-id/risks', { data: risk(1, 1) })).status()).toBe(404);
  expect((await admin.get('projects/not-a-real-id/risks')).status()).toBe(404);
  expect((await anon.get(`projects/${projectId}/risks`)).status()).toBe(401);
  expect((await anon.post(`requirements/${reqA}/risks`, { data: risk(1, 1) })).status()).toBe(401);
});

// ---------- Register ----------

test('project register: all risks, highest score first, with requirement summary', async () => {
  const res = await viewer.get(`projects/${projectId}/risks`);
  expect(res.status()).toBe(200);
  const list = await res.json();
  // 9 matrix cases + tamper + trimmed + engineer's
  expect(list).toHaveLength(12);
  const scores = list.map((r: { riskScore: number }) => r.riskScore);
  expect(scores).toEqual([...scores].sort((a, b) => b - a));
  expect(list[0].riskScore).toBe(25);
  expect(list[0].requirement).toEqual({ reqId: 'REQ-A', title: 'REQ-A title' });
  expect(new Set(list.map((r: { requirement: { reqId: string } }) => r.requirement.reqId))).toEqual(new Set(['REQ-A', 'REQ-B']));
});

test('requirement list reflects risk counts', async () => {
  const req = await prisma.requirement.findUniqueOrThrow({ where: { id: reqA } });
  const list = await (await viewer.get(`modules/${req.moduleId}/requirements`)).json();
  const a = list.find((r: { reqId: string }) => r.reqId === 'REQ-A');
  expect(a._count.risks).toBe(10); // 9 matrix cases + engineer's
});

// ---------- GET /projects/:projectId/requirements (flat picker list) ----------

test('flat requirements list: all project requirements, sorted by reqId, minimal fields', async () => {
  const res = await viewer.get(`projects/${projectId}/requirements`);
  expect(res.status()).toBe(200);
  const list = await res.json();
  expect(list.map((r: { reqId: string }) => r.reqId)).toEqual(['REQ-A', 'REQ-B']);
  expect(Object.keys(list[0]).sort()).toEqual(['id', 'reqId', 'title']);
  expect(list[0]).toEqual({ id: reqA, reqId: 'REQ-A', title: 'REQ-A title' });
});

test('flat requirements list: 404 other org / unknown project, 401 without token', async () => {
  expect((await other.get(`projects/${projectId}/requirements`)).status()).toBe(404);
  expect((await admin.get('projects/not-a-real-id/requirements')).status()).toBe(404);
  expect((await anon.get(`projects/${projectId}/requirements`)).status()).toBe(401);
  // The wrong mount (module router) must not exist.
  expect((await admin.get(`modules/projects/${projectId}/requirements`)).status()).not.toBe(200);
});

// ---------- Data model: no orphans ----------

test('deleting a requirement cascades to its risks (no orphans)', async () => {
  const before = await prisma.risk.count({ where: { requirementId: reqB } });
  expect(before).toBe(2); // tamper + trimmed
  await prisma.requirement.delete({ where: { id: reqB } });
  expect(await prisma.risk.count({ where: { requirementId: reqB } })).toBe(0);
  // Register no longer lists them, and nothing is left dangling.
  const list = await (await viewer.get(`projects/${projectId}/risks`)).json();
  expect(list).toHaveLength(10);
});

// ---------- Mount does not hijack other /api paths ----------

test('/api/health still public and unknown /api paths still 404 (not 401)', async () => {
  expect((await anon.get('health')).status()).toBe(200);
  expect((await anon.get('definitely-not-a-route')).status()).toBe(404);
});
